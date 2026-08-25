import { useEffect, useState } from "react";
import { createFileRoute, useLocation, useNavigate } from "@tanstack/react-router";
import { toast } from "sonner";
import { KeyRound } from "lucide-react";
import { Logo, LogoWordmark } from "@/components/logo";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { apiPost } from "@/lib/api";
import { MIN_PASSWORD_LENGTH, passwordProblem } from "@/lib/password";

/**
 * Destino del link que llega por mail para recuperar la contraseña.
 *
 * Es una ruta PÚBLICA a propósito, fuera de _authenticated. Quien llega acá no
 * inició sesión: viene de un mail. Supabase manda los tokens en el fragmento de
 * la URL y el cliente los canjea solo por una sesión temporal —de ahí el evento
 * PASSWORD_RECOVERY—, pero eso tarda un instante. Bajo _authenticated, el
 * beforeLoad correría antes de que la sesión exista y la rebotaría a /auth: el
 * link del mail no llevaría a ningún lado.
 */
export const Route = createFileRoute("/recuperar")({
  // Sin SSR: el token viaja en el fragmento (#), que el navegador no le manda
  // al servidor. Renderizar esto del lado del servidor daría siempre "link
  // inválido".
  ssr: false,
  head: () => ({
    meta: [{ title: "Recuperar contraseña — Shiraf" }, { name: "robots", content: "noindex" }],
  }),
  component: RecoverPage,
});

type Status = "checking" | "ready" | "invalid" | "done";

function RecoverPage() {
  const navigate = useNavigate();
  const [status, setStatus] = useState<Status>("checking");
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [saving, setSaving] = useState(false);

  // El token viaja en la URL: el mail apunta a /recuperar?token=...
  //
  // Ya no hay carrera que resolver. Con Supabase el enlace abría una sesión y
  // había que escuchar PASSWORD_RECOVERY *y además* consultar getSession(),
  // porque si el canje pasaba antes de montar el efecto el evento ya no volvía.
  // Acá el token está en la URL y sigue estando: se lee y listo.
  //
  // Si es válido o no lo dice el servidor recién al guardar, y es a propósito:
  // un endpoint que conteste "este token sirve" antes de usarlo deja probar
  // tokens de a uno.
  const token = new URLSearchParams(useLocation().search).get("token") ?? "";

  useEffect(() => {
    setStatus(token ? "ready" : "invalid");
  }, [token]);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    const problem = passwordProblem(password, confirmation);
    if (problem) {
      toast.error(problem);
      return;
    }

    setSaving(true);
    try {
      await apiPost("/api/auth/reset-password", { token, password });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "No se pudo cambiar la contraseña.");
      return;
    } finally {
      setSaving(false);
    }

    setStatus("done");
    toast.success("Listo, ya podés entrar con tu contraseña nueva.");
  }

  return (
    <div className="grid min-h-screen lg:grid-cols-2">
      <div className="surface-olive hidden flex-col justify-between p-12 lg:flex">
        <LogoWordmark tone="light" />
        <div>
          <h1 className="max-w-sm text-5xl leading-tight text-primary-foreground">
            Volvamos a tu cuenta.
          </h1>
          <p className="mt-6 max-w-sm text-sm leading-relaxed text-primary-foreground/70">
            Elegí una contraseña nueva y seguí con tus turnos donde los dejaste.
          </p>
        </div>
        <p className="text-eyebrow text-primary-foreground/50">Calma, belleza y bienestar</p>
      </div>

      <div className="flex items-center justify-center px-5 py-16">
        <div className="w-full max-w-sm">
          <div className="flex justify-center lg:hidden">
            <Logo className="h-16 w-16" />
          </div>

          {status === "checking" && (
            <p className="mt-8 text-center text-sm text-muted-foreground">Validando el enlace…</p>
          )}

          {status === "invalid" && (
            <div className="mt-8 rounded-sm border border-border bg-card p-6 text-center">
              <h2 className="font-display text-2xl text-foreground">El enlace no sirve</h2>
              <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
                Puede haber vencido o ya haberse usado. Los enlaces duran una hora y valen una sola
                vez. Pedí uno nuevo desde la pantalla de ingreso.
              </p>
              <Button className="mt-6" onClick={() => navigate({ to: "/auth" })}>
                Ir a ingresar
              </Button>
            </div>
          )}

          {status === "done" && (
            <div className="mt-8 rounded-sm border border-gold/50 bg-gold/10 p-6 text-center">
              <h2 className="font-display text-2xl text-foreground">Contraseña cambiada</h2>
              <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
                Ya quedó guardada. Entrá con tu mail y la contraseña nueva.
              </p>
              <Button className="mt-6" onClick={() => navigate({ to: "/mi-cuenta" })}>
                Ir a mi cuenta
              </Button>
            </div>
          )}

          {status === "ready" && (
            <form onSubmit={save} className="mt-8 space-y-4">
              <div>
                <p className="text-eyebrow text-muted-foreground">Último paso</p>
                <h2 className="mt-3 font-display text-3xl text-foreground">Contraseña nueva</h2>
              </div>

              <div className="space-y-2">
                <Label htmlFor="new-password">Contraseña</Label>
                <Input
                  id="new-password"
                  type="password"
                  autoComplete="new-password"
                  required
                  minLength={MIN_PASSWORD_LENGTH}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="new-password-2">Repetila</Label>
                <Input
                  id="new-password-2"
                  type="password"
                  autoComplete="new-password"
                  required
                  value={confirmation}
                  onChange={(e) => setConfirmation(e.target.value)}
                />
              </div>

              {/* El aviso sale mientras escribe y no recién al enviar. */}
              {passwordProblem(password, confirmation) && password.length > 0 && (
                <p className="text-xs text-destructive">
                  {passwordProblem(password, confirmation)}
                </p>
              )}

              <Button type="submit" className="w-full" disabled={saving}>
                <KeyRound className="mr-2 h-4 w-4" />
                {saving ? "Guardando…" : "Guardar contraseña"}
              </Button>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
