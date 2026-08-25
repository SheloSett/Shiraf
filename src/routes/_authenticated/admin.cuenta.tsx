import { useEffect, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { KeyRound, User } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { api, apiPut } from "@/lib/api";
import type { RtaMiCuenta } from "@/lib/api-tipos";
import { useAuth } from "@/hooks/useAuth";
import { passwordProblem } from "@/lib/password";
import { permissionLabel, PERMISSIONS } from "@/lib/permissions";
import { useAccess } from "@/hooks/useAccess";

/**
 * La cuenta de quien trabaja en el centro.
 *
 * Existe porque el panel dejó de ser sólo de la dueña. Antes esto vivía en
 * /mi-cuenta, la pantalla de clienta, y era el único motivo por el que una
 * empleada tenía que pasar por ahí: la dueña le crea la cuenta con una
 * contraseña que tiene que poder dictarle, o sea que la sabe alguien más, y sin
 * un lugar donde cambiarla esa contraseña era para siempre.
 *
 * Ahora que las cuentas del centro no entran a /mi-cuenta, esto tiene que estar
 * acá o no está en ningún lado.
 */
export const Route = createFileRoute("/_authenticated/admin/cuenta")({
  head: () => ({
    meta: [{ title: "Mi cuenta — Panel Shiraf" }],
  }),
  component: TeamAccountPage,
});

function TeamAccountPage() {
  const queryClient = useQueryClient();
  const { isAdmin, permissions } = useAccess();
  const [fullName, setFullName] = useState("");
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [newPasswordAgain, setNewPasswordAgain] = useState("");
  // El mail sale de la sesión, que ya lo trae: era el único motivo por el que
  // esta pantalla llamaba a supabase.auth.getUser().
  const { user } = useAuth();

  const profile = useQuery({
    queryKey: ["my-team-profile"],
    queryFn: async () => {
      const { ficha } = await api<RtaMiCuenta>("/api/mi-cuenta");
      return { ...ficha, email: user?.email ?? "" };
    },
  });

  useEffect(() => {
    if (profile.data?.full_name) setFullName(profile.data.full_name);
  }, [profile.data]);

  const saveName = useMutation({
    // Se mandan también el teléfono y la nota como están: el endpoint guarda la
    // ficha entera, y omitirlos los borraría.
    mutationFn: () =>
      apiPut("/api/mi-cuenta", {
        full_name: fullName,
        phone: profile.data?.phone ?? "",
        notes: profile.data?.notes ?? "",
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["my-team-profile"] });
      toast.success("Nombre actualizado.");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const changePassword = useMutation({
    mutationFn: async () => {
      const problem = passwordProblem(newPassword, newPasswordAgain);
      if (problem) throw new Error(problem);
      // Hace falta la contraseña ACTUAL, que Supabase no pedía teniendo sesión
      // abierta. Evita que alguien que se encuentra una sesión abierta —la compu
      // del centro, sin ir más lejos— se apropie de la cuenta.
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

  const problem = passwordProblem(newPassword, newPasswordAgain);

  return (
    <div>
      <p className="text-eyebrow text-muted-foreground">Tu acceso</p>
      <h1 className="mt-3 font-display text-4xl text-foreground">Mi cuenta</h1>

      <div className="mt-10 flex items-center gap-3">
        <User className="h-5 w-5 text-gold" />
        <h2 className="font-display text-2xl text-foreground">Tus datos</h2>
      </div>
      <Card className="mt-5 max-w-2xl border-border/80 shadow-soft">
        <CardContent className="grid gap-4 p-6 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="full-name">Nombre y apellido</Label>
            <Input id="full-name" value={fullName} onChange={(e) => setFullName(e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="email">Mail</Label>
            {/* Sólo de lectura: cambiar el mail es cambiar con qué se ingresa, y
                Supabase lo hace mandando un enlace de confirmación a la casilla
                nueva. Un input editable acá prometería algo que no pasa. */}
            <Input id="email" value={profile.data?.email ?? ""} disabled />
            <p className="text-xs text-muted-foreground">
              Con este mail ingresás. Para cambiarlo, pedíselo a la dueña.
            </p>
          </div>
          <div className="sm:col-span-2">
            <Button onClick={() => saveName.mutate()} disabled={saveName.isPending || !fullName}>
              Guardar cambios
            </Button>
          </div>
        </CardContent>
      </Card>

      <div className="mt-12 flex items-center gap-3">
        <KeyRound className="h-5 w-5 text-gold" />
        <h2 className="font-display text-2xl text-foreground">Contraseña</h2>
      </div>
      <Card className="mt-5 max-w-2xl border-border/80 shadow-soft">
        <CardContent className="grid gap-4 p-6 sm:grid-cols-2">
          <p className="text-sm leading-relaxed text-muted-foreground sm:col-span-2">
            Si entraste con una contraseña que te pasaron, cambiala por una que sepas sólo vos.
          </p>
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

          {newPassword.length > 0 && problem && (
            <p className="text-xs text-destructive sm:col-span-2">{problem}</p>
          )}

          <div className="sm:col-span-2">
            <Button
              onClick={() => changePassword.mutate()}
              disabled={
                changePassword.isPending ||
                currentPassword.length === 0 ||
                newPasswordAgain.length === 0 ||
                problem !== null
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

      {/* Que cada una vea qué le habilitaron. Sin esto, una empleada que no
          encuentra una sección no sabe si le falta el acceso o si la app está
          rota, y termina preguntándolo. */}
      <div className="mt-12">
        <h2 className="font-display text-2xl text-foreground">Tus accesos</h2>
        {isAdmin ? (
          <p className="mt-4 max-w-2xl text-sm leading-relaxed text-muted-foreground">
            Sos la dueña del centro: entrás a todo el panel y sos la única que puede dar y quitar
            accesos, desde <span className="text-foreground">Equipo</span>.
          </p>
        ) : (
          <div className="mt-4 max-w-2xl">
            {permissions.length === 0 ? (
              <p className="text-sm leading-relaxed text-muted-foreground">
                Todavía no te habilitaron ninguna sección. Pedíselo a la dueña.
              </p>
            ) : (
              <ul className="divide-y divide-border border-y border-border">
                {PERMISSIONS.filter((p) => permissions.includes(p.value)).map((p) => (
                  <li key={p.value} className="py-3">
                    <p className="text-[15px] text-foreground">{permissionLabel(p.value)}</p>
                    <p className="mt-1 text-xs text-muted-foreground">{p.description}</p>
                  </li>
                ))}
              </ul>
            )}
            <p className="mt-4 text-xs leading-relaxed text-muted-foreground">
              Los da y los quita la dueña. Si te falta alguno, hablalo con ella.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
