import { useEffect, useRef, useState } from "react";
import { createFileRoute, useLocation, useNavigate } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { MailCheck } from "lucide-react";
import { Logo, LogoWordmark } from "@/components/logo";
import { Button } from "@/components/ui/button";
import { apiPost } from "@/lib/api";
import { olvidarSesion } from "@/lib/sesion";

/**
 * Destino del enlace que llega a la dirección NUEVA cuando alguien cambia el
 * mail de su cuenta.
 *
 * Es la hermana de /confirmar y hace lo mismo con otro token, pero son dos
 * pantallas y no una con un `if`: lo que hay que contar al final es distinto
 * —acá cambia con qué dirección se entra de ahora en más, y eso hay que decirlo
 * con todas las letras— y mezclarlas terminaría en una pantalla que dice cosas
 * a medias en los dos casos.
 *
 * Pública, fuera de _authenticated: este enlace se abre donde está la casilla
 * nueva, casi siempre el teléfono, y ahí no hay ninguna sesión abierta.
 */
export const Route = createFileRoute("/confirmar-mail")({
  head: () => ({
    meta: [{ title: "Confirmar tu mail nuevo — Shiraf" }, { name: "robots", content: "noindex" }],
  }),
  component: ConfirmEmailChangePage,
});

type Estado = "confirmando" | "listo" | "invalido";

function ConfirmEmailChangePage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [estado, setEstado] = useState<Estado>("confirmando");
  const [email, setEmail] = useState("");
  const [traspasados, setTraspasados] = useState(0);
  const [motivo, setMotivo] = useState("");

  const token = new URLSearchParams(useLocation().search).get("token") ?? "";

  // Un solo intento: el token vale una vez, y en desarrollo React monta los
  // efectos dos veces. Sin esto, el segundo pisa el resultado bueno con el
  // "venció o ya se usó". Mismo candado que en /confirmar.
  const yaSePidio = useRef(false);

  useEffect(() => {
    if (yaSePidio.current) return;
    yaSePidio.current = true;

    if (!token) {
      setMotivo("El enlace no trae ningún código.");
      setEstado("invalido");
      return;
    }

    void apiPost<{ ok: true; email: string; turnosTraspasados: number }>(
      "/api/auth/verify-email-change",
      { token },
    )
      .then((r) => {
        setEmail(r.email);
        setTraspasados(r.turnosTraspasados);
        setEstado("listo");
        // Si esto se abrió en el mismo navegador donde está la sesión, lo que
        // react-query recuerda quedó con el mail viejo.
        olvidarSesion(queryClient);
      })
      .catch((e) => {
        setMotivo(e instanceof Error ? e.message : "No se pudo cambiar el mail.");
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
            Desde ahora vas a entrar con tu dirección nueva.
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
            <p className="mt-8 text-center text-sm text-muted-foreground">
              Confirmando tu dirección nueva…
            </p>
          )}

          {estado === "listo" && (
            <div className="mt-8 rounded-sm border border-gold/50 bg-gold/10 p-6 text-center">
              <MailCheck className="mx-auto h-8 w-8 text-gold" />
              <h2 className="mt-4 font-display text-3xl text-foreground">Mail cambiado</h2>
              <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
                De ahora en más entrás con <span className="text-foreground">{email}</span>. Tu
                contraseña es la misma de siempre.
              </p>
              {traspasados > 0 && (
                <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
                  {traspasados === 1
                    ? "También sumamos a tu historial un turno que estaba anotado con esta dirección."
                    : `También sumamos a tu historial ${traspasados} turnos que estaban anotados con esta dirección.`}
                </p>
              )}
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
                Tu cuenta quedó como estaba, con la dirección de siempre. Los enlaces duran una hora
                y valen una sola vez: entrá y pedilo de nuevo desde Mis datos.
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
