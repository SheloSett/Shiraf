import { useEffect, useState } from "react";
import { createFileRoute, Link, redirect } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { CalendarDays, History, KeyRound, User } from "lucide-react";
import { SiteHeader } from "@/components/site-header";
import { SiteFooter } from "@/components/site-footer";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { api, apiPut } from "@/lib/api";
import type { RtaMiCuenta, RtaMisTurnos } from "@/lib/api-tipos";
import { formatDateTime, formatMoney, STATUS_LABEL } from "@/lib/shiraf";
import { passwordProblem } from "@/lib/password";
import { isTeamAccount } from "@/lib/roles";

export const Route = createFileRoute("/_authenticated/mi-cuenta")({
  /**
   * Las cuentas del centro no pasan por acá: van derecho al panel.
   *
   * Esta pantalla es de clienta —próximos turnos, historial, reservar—. La
   * dueña y las empleadas no son clientas: su cuenta existe para trabajar, y
   * dejarlas acá las hacía aterrizar en una página vacía ("No tenés turnos
   * pendientes") sin ninguna señal de que el panel existía.
   *
   * Lo que sí necesitaban de acá —cambiar la contraseña que les dictaron— se
   * mudó a /admin/cuenta.
   */
  beforeLoad: async ({ context }) => {
    if (await isTeamAccount(context.queryClient)) {
      throw redirect({ to: "/admin" });
    }
  },
  head: () => ({
    meta: [
      { title: "Mi cuenta y turnos — Shiraf" },
      {
        name: "description",
        content:
          "Tus datos, tus próximos turnos y el historial de tratamientos realizados en Shiraf.",
      },
      { property: "og:title", content: "Mi cuenta y turnos — Shiraf" },
      {
        property: "og:description",
        content: "Consultá tus próximos turnos y tu historial de tratamientos.",
      },
    ],
  }),
  component: AccountPage,
});

function AccountPage() {
  const queryClient = useQueryClient();
  const [fullName, setFullName] = useState("");
  const [phone, setPhone] = useState("");
  const [notes, setNotes] = useState("");
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [newPasswordAgain, setNewPasswordAgain] = useState("");

  const changePassword = useMutation({
    mutationFn: async () => {
      const problem = passwordProblem(newPassword, newPasswordAgain);
      if (problem) throw new Error(problem);
      // ⚠️ Ahora hace falta la contraseña ACTUAL, que Supabase no pedía teniendo
      // sesión abierta. Es lo que hace changePassword en Ecommerce_mm, y evita
      // que alguien que se encuentra una sesión abierta —un celular prestado,
      // una compu del centro— se apropie de la cuenta cambiándole la clave.
      await apiPut("/api/auth/password", { currentPassword, newPassword });
    },
    onSuccess: () => {
      setCurrentPassword("");
      setNewPassword("");
      setNewPasswordAgain("");
      toast.success("Contraseña actualizada.");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const profile = useQuery({
    queryKey: ["my-profile"],
    // Ya no hace falta preguntar quién soy: el servidor lo saca de la cookie.
    // La ficha y la nota vienen juntas — la nota vive en client_notes desde la
    // migración 20260814010000, para que "Ver notas clínicas" sea un candado de
    // verdad y no un filtro de pantalla.
    queryFn: async () => (await api<RtaMiCuenta>("/api/mi-cuenta")).ficha,
  });

  useEffect(() => {
    if (profile.data) {
      setFullName(profile.data.full_name ?? "");
      setPhone(profile.data.phone ?? "");
      setNotes(profile.data.notes ?? "");
    }
  }, [profile.data]);

  const appointments = useQuery({
    queryKey: ["my-appointments"],
    // El filtro por client_id sigue siendo explícito, ahora en el controller:
    // sin él la dueña o una secretaria abrirían SU cuenta y verían ahí los
    // turnos de todas las clientas, mezclados con los suyos.
    queryFn: async () => (await api<RtaMisTurnos>("/api/mi-cuenta/turnos")).turnos,
  });

  const saveProfile = useMutation({
    // La ficha y la nota se guardan en una transacción del lado del servidor.
    // Antes eran dos pedidos sueltos: si el segundo fallaba, quedaba el nombre
    // cambiado y la nota no.
    mutationFn: () => apiPut("/api/mi-cuenta", { full_name: fullName, phone, notes }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["my-profile"] });
      toast.success("Datos actualizados.");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const cancel = useMutation({
    mutationFn: (id: string) => apiPut(`/api/mi-cuenta/turnos/${id}/cancelar`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["my-appointments"] });
      toast.success("Turno cancelado.");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const now = Date.now();
  const all = appointments.data ?? [];
  const upcoming = all
    .filter((a) => new Date(a.starts_at).getTime() >= now && a.status !== "cancelled")
    .sort((a, b) => a.starts_at.localeCompare(b.starts_at));
  const history = all.filter(
    (a) => new Date(a.starts_at).getTime() < now || a.status === "cancelled",
  );

  return (
    <div className="min-h-screen">
      <SiteHeader />

      <section className="mx-auto max-w-5xl px-5 pt-14 pb-20">
        <p className="text-eyebrow text-muted-foreground">Mi espacio</p>
        <h1 className="mt-4 text-5xl text-foreground">
          Hola{fullName ? `, ${fullName.split(" ")[0]}` : ""}
        </h1>
        <div className="gold-rule mt-6" />

        <div className="mt-12 flex items-center gap-3">
          <CalendarDays className="h-5 w-5 text-gold" />
          <h2 className="font-display text-2xl text-foreground">Próximos turnos</h2>
        </div>

        <div className="mt-5 space-y-3">
          {upcoming.map((a) => (
            <Card key={a.id} className="border-border/80 shadow-soft">
              <CardContent className="flex flex-wrap items-center justify-between gap-4 p-5">
                <div>
                  <p className="font-display text-xl text-foreground">{a.services?.name}</p>
                  <p className="mt-1 text-sm text-muted-foreground">
                    {formatDateTime(a.starts_at)} · {a.professionals?.full_name}
                  </p>
                </div>
                <div className="flex items-center gap-3">
                  <Badge variant={a.status === "confirmed" ? "default" : "secondary"}>
                    {STATUS_LABEL[a.status]}
                  </Badge>
                  <span className="text-sm text-muted-foreground">
                    {formatMoney(a.services?.price)}
                  </span>
                  <Button size="sm" variant="ghost" onClick={() => cancel.mutate(a.id)}>
                    Cancelar
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
          {upcoming.length === 0 && (
            <Card className="border-dashed border-border bg-transparent shadow-none">
              <CardContent className="flex flex-wrap items-center justify-between gap-4 p-6">
                <p className="text-sm text-muted-foreground">No tenés turnos pendientes.</p>
                <Button asChild size="sm">
                  <Link to="/reservar">Reservar turno</Link>
                </Button>
              </CardContent>
            </Card>
          )}
        </div>

        <div className="mt-14 flex items-center gap-3">
          <History className="h-5 w-5 text-gold" />
          <h2 className="font-display text-2xl text-foreground">Historial</h2>
        </div>
        <div className="mt-5 divide-y divide-border border-y border-border">
          {history.map((a) => (
            <div key={a.id} className="flex flex-wrap items-center justify-between gap-3 py-4">
              <div>
                <p className="text-[15px] text-foreground">{a.services?.name}</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {formatDateTime(a.starts_at)} · {a.professionals?.full_name}
                </p>
              </div>
              <Badge variant="outline">{STATUS_LABEL[a.status]}</Badge>
            </div>
          ))}
          {history.length === 0 && (
            <p className="py-4 text-sm text-muted-foreground">
              Todavía no hay visitas registradas.
            </p>
          )}
        </div>

        <div className="mt-14 flex items-center gap-3">
          <User className="h-5 w-5 text-gold" />
          <h2 className="font-display text-2xl text-foreground">Mis datos</h2>
        </div>
        <Card className="mt-5 border-border/80 shadow-soft">
          <CardContent className="grid gap-4 p-6 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="fullName">Nombre y apellido</Label>
              <Input id="fullName" value={fullName} onChange={(e) => setFullName(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="phone">Teléfono</Label>
              <Input id="phone" value={phone} onChange={(e) => setPhone(e.target.value)} />
            </div>
            <div className="space-y-2 sm:col-span-2">
              <Label htmlFor="notes">Notas (alergias, tipo de piel, preferencias)</Label>
              <Textarea id="notes" value={notes} onChange={(e) => setNotes(e.target.value)} />
            </div>
            <div className="sm:col-span-2">
              <Button onClick={() => saveProfile.mutate()} disabled={saveProfile.isPending}>
                Guardar cambios
              </Button>
            </div>
          </CardContent>
        </Card>

        {/* Cambio de contraseña de la clienta. La versión del equipo vive en
            /admin/cuenta: esta pantalla ya no la ven, porque una cuenta del
            centro se desvía al panel antes de llegar acá. */}
        <div className="mt-14 flex items-center gap-3">
          <KeyRound className="h-5 w-5 text-gold" />
          <h2 className="font-display text-2xl text-foreground">Contraseña</h2>
        </div>
        <Card className="mt-5 border-border/80 shadow-soft">
          <CardContent className="grid gap-4 p-6 sm:grid-cols-2">
            <div className="space-y-2 sm:col-span-2">
              <Label htmlFor="current-pass">Tu contraseña actual</Label>
              <Input
                id="current-pass"
                type="password"
                autoComplete="current-password"
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="new-pass">Contraseña nueva</Label>
              <Input
                id="new-pass"
                type="password"
                autoComplete="new-password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="new-pass-2">Repetila</Label>
              <Input
                id="new-pass-2"
                type="password"
                autoComplete="new-password"
                value={newPasswordAgain}
                onChange={(e) => setNewPasswordAgain(e.target.value)}
              />
            </div>

            {newPassword.length > 0 && passwordProblem(newPassword, newPasswordAgain) && (
              <p className="text-xs text-destructive sm:col-span-2">
                {passwordProblem(newPassword, newPasswordAgain)}
              </p>
            )}

            <div className="sm:col-span-2">
              <Button
                onClick={() => changePassword.mutate()}
                disabled={
                  changePassword.isPending ||
                  currentPassword.length === 0 ||
                  newPasswordAgain.length === 0 ||
                  passwordProblem(newPassword, newPasswordAgain) !== null
                }
              >
                {changePassword.isPending ? "Cambiando…" : "Cambiar contraseña"}
              </Button>
              <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
                Al cambiarla seguís conectada acá, pero vas a tener que usar la nueva la próxima vez
                que ingreses.
              </p>
            </div>
          </CardContent>
        </Card>
      </section>

      <SiteFooter />
    </div>
  );
}
