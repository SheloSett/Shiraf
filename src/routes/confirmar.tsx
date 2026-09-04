import { useEffect, useRef, useState } from "react";
import { createFileRoute, useLocation, useNavigate } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { MailCheck } from "lucide-react";
import { Logo, LogoWordmark } from "@/components/logo";
import { Button } from "@/components/ui/button";
import { apiPost } from "@/lib/api";
import { olvidarSesion } from "@/lib/sesion";

/**
 * Destino del enlace de confirmación que llega por mail.
 *
 * 🔴 ESTA PANTALLA NO EXISTÍA. `register` mandaba el mail apuntando a
 * `/confirmar?token=...` desde el día uno y esa ruta nunca se creó: el enlace
 * caía en el 404 de TanStack. O sea que **nadie pudo confirmar su cuenta
 * nunca** — el único camino que dejaba `email_verified_at` en algo era
 * `resetPassword`, de rebote, y el alta manual del equipo.
 *
 * Es pública a propósito, fuera de _authenticated, igual que /recuperar: quien
 * llega puede estar abriendo el mail en otro navegador —el del teléfono, sin la
 * sesión de la compu— y ahí un guard la rebotaría a /auth sin confirmar nada.
 * El token vale por sí solo, no necesita sesión.
 */
export const Route = createFileRoute("/confirmar")({
  head: () => ({
    meta: [{ title: "Confirmar tu mail — Shiraf" }, { name: "robots", content: "noindex" }],
  }),
  component: ConfirmPage,
});

type Estado = "confirmando" | "listo" | "invalido";

function ConfirmPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [estado, setEstado] = useState<Estado>("confirmando");
  const [traspasados, setTraspasados] = useState(0);
  const [motivo, setMotivo] = useState("");

  const token = new URLSearchParams(useLocation().search).get("token") ?? "";

  // El token es de un solo uso: el segundo intento con el mismo siempre da
  // "venció o ya se usó". En desarrollo React monta los efectos dos veces, así
  // que sin este candado la confirmación buena se pisaba sola con el error.
  const yaSePidio = useRef(false);

  useEffect(() => {
    if (yaSePidio.current) return;
    yaSePidio.current = true;

    if (!token) {
      setMotivo("El enlace no trae ningún código.");
      setEstado("invalido");
      return;
    }

    void apiPost<{ ok: true; turnosTraspasados: number }>("/api/auth/verify-email", { token })
      .then((r) => {
        setTraspasados(r.turnosTraspasados);
        setEstado("listo");
        // La sesión que pueda haber abierta quedó con `emailVerificado: false`.
        // Sin esto, el cartel de "confirmá tu mail" de /mi-cuenta sigue ahí
        // después de confirmar, hasta que la consulta se vuelva a pedir sola.
        olvidarSesion(queryClient);
      })
      .catch((e) => {
        setMotivo(e instanceof Error ? e.message : "No se pudo confirmar la cuenta.");
        setEstado("invalido");
      });
  }, [token, queryClient]);

  return (
    <div className="grid min-h-screen lg:grid-cols-2">
      <div className="surface-olive hidden flex-col justify-between p-12 lg:flex">
        <LogoWordmark tone="light" />
        <div>
          <h1 className="max-w-sm text-5xl leading-tight text-primary-foreground">
            Tu espacio de calma, ordenado.
          </h1>
          <p className="mt-6 max-w-sm text-sm leading-relaxed text-primary-foreground/70">
            Con el mail confirmado también vas a ver los turnos que sacaste antes de tener cuenta.
          </p>
        </div>
        <p className="text-eyebrow text-primary-foreground/50">Calma, belleza y bienestar</p>
      </div>

      <div className="flex items-center justify-center px-5 py-16">
        <div className="w-full max-w-sm">
          <div className="flex justify-center lg:hidden">
            <Logo className="h-16 w-16" />
          </div>

          {estado === "confirmando" && (
            <p className="mt-8 text-center text-sm text-muted-foreground">Confirmando tu mail…</p>
          )}

          {estado === "listo" && (
            <div className="mt-8 rounded-sm border border-gold/50 bg-gold/10 p-6 text-center">
              <MailCheck className="mx-auto h-8 w-8 text-gold" />
              <h2 className="mt-4 font-display text-3xl text-foreground">Mail confirmado</h2>
              <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
                {/* Sólo se nombran los turnos si de verdad se traspasó alguno.
                    Decirle "sumamos tus turnos anteriores" a quien nunca vino
                    como invitada la manda a buscar algo que no está. */}
                {traspasados > 0
                  ? traspasados === 1
                    ? "Ya está. Sumamos a tu historial el turno que habías sacado antes de tener cuenta."
                    : `Ya está. Sumamos a tu historial los ${traspasados} turnos que habías sacado antes de tener cuenta.`
                  : "Ya está, tu cuenta quedó confirmada."}
              </p>
              <Button className="mt-6" onClick={() => navigate({ to: "/mi-cuenta" })}>
                Ir a mi cuenta
              </Button>
            </div>
          )}

          {estado === "invalido" && (
            <div className="mt-8 rounded-sm border border-border bg-card p-6 text-center">
              <h2 className="font-display text-2xl text-foreground">El enlace no sirve</h2>
              <p className="mt-3 text-sm leading-relaxed text-muted-foreground">{motivo}</p>
              <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
                Los enlaces duran una hora y valen una sola vez. Entrá a tu cuenta y pedí uno nuevo
                desde el aviso de arriba de todo.
              </p>
              <Button className="mt-6" onClick={() => navigate({ to: "/mi-cuenta" })}>
                Ir a mi cuenta
              </Button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
