import { useEffect, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
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
import { supabase } from "@/integrations/supabase/client";
import { formatDateTime, formatMoney, STATUS_LABEL } from "@/lib/shiraf";
import { passwordProblem } from "@/lib/password";

export const Route = createFileRoute("/_authenticated/mi-cuenta")({
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
  const [newPassword, setNewPassword] = useState("");
  const [newPasswordAgain, setNewPasswordAgain] = useState("");

  const changePassword = useMutation({
    mutationFn: async () => {
      const problem = passwordProblem(newPassword, newPasswordAgain);
      if (problem) throw new Error(problem);
      const { error } = await supabase.auth.updateUser({ password: newPassword });
      if (error) throw error;
    },
    onSuccess: () => {
      setNewPassword("");
      setNewPasswordAgain("");
      toast.success("Contraseña actualizada.");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const profile = useQuery({
    queryKey: ["my-profile"],
    queryFn: async () => {
      const { data: auth } = await supabase.auth.getUser();
      // La nota ya no vive en profiles.notes: se mudó a client_notes para que
      // el permiso "Ver notas clínicas" del panel sea un candado de verdad y no
      // sólo un filtro de pantalla. Ver migración 20260814010000.
      const [row, note] = await Promise.all([
        supabase
          .from("profiles")
          .select("id, full_name, phone, birth_date")
          .eq("id", auth.user!.id)
          .maybeSingle(),
        supabase.from("client_notes").select("body").eq("client_id", auth.user!.id).maybeSingle(),
      ]);
      if (row.error) throw row.error;
      if (note.error) throw note.error;
      return row.data ? { ...row.data, notes: note.data?.body ?? "" } : null;
    },
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
    queryFn: async () => {
      const { data: auth } = await supabase.auth.getUser();
      const { data, error } = await supabase
        .from("appointments")
        .select(
          "id, starts_at, status, duration_minutes, client_notes, services(name, price, category), professionals(full_name)",
        )
        // El filtro es explícito y no se delega en la RLS. La policy dice
        // "los propios O los de todas si tenés el permiso de turnos", así que
        // sin este .eq() la dueña o una secretaria abrían SU cuenta y veían
        // ahí los turnos de todas las clientas, mezclados con los suyos.
        .eq("client_id", auth.user!.id)
        .order("starts_at", { ascending: false });
      if (error) throw error;
      return data;
    },
  });

  const saveProfile = useMutation({
    mutationFn: async () => {
      const { data: auth } = await supabase.auth.getUser();
      const { error } = await supabase
        .from("profiles")
        .update({ full_name: fullName, phone })
        .eq("id", auth.user!.id);
      if (error) throw error;

      // upsert y no update: la primera vez que escribe una nota todavía no hay
      // fila en client_notes.
      const { error: noteError } = await supabase
        .from("client_notes")
        .upsert({ client_id: auth.user!.id, body: notes.trim() || null });
      if (noteError) throw noteError;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["my-profile"] });
      toast.success("Datos actualizados.");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const cancel = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from("appointments")
        .update({ status: "cancelled" })
        .eq("id", id);
      if (error) throw error;
    },
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

        {/* Cambio de contraseña. Vive acá y no en el panel porque lo necesitan
            los dos lados: la clienta que quiere cambiarla, y la empleada que
            entró con la que le puso la dueña —en texto plano, porque tenía que
            poder dictársela— y hasta ahora no tenía forma de reemplazarla. */}
        <div className="mt-14 flex items-center gap-3">
          <KeyRound className="h-5 w-5 text-gold" />
          <h2 className="font-display text-2xl text-foreground">Contraseña</h2>
        </div>
        <Card className="mt-5 border-border/80 shadow-soft">
          <CardContent className="grid gap-4 p-6 sm:grid-cols-2">
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
