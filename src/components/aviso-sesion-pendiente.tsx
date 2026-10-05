import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { SacarSesionDialog } from "@/components/sacar-sesion-dialog";
import { useSesionesPendientes } from "@/hooks/useSesionesPendientes";
import type { SesionPendiente } from "@/lib/api-tipos";
import { desdeCuando } from "@/lib/sesiones";

/**
 * «Te falta la sesión 2 de 3» — la franja dorada debajo del header (5/10/2026).
 *
 * ── POR QUÉ EN TODAS LAS PÁGINAS ──────────────────────────────────────────
 *
 * Lo pidió la dueña así: que la clienta lo tenga a la vista siempre, no sólo si
 * entra a su cuenta. Un tratamiento de tres sesiones que se queda en la primera
 * es plata que ya se cobró por un trabajo a medio hacer, y la clienta que no
 * vuelve casi nunca es porque decidió no volver: es porque se le pasó.
 *
 * Por eso vive adentro de `SiteHeader`, que es lo único que comparten todas las
 * páginas del sitio, y no en cada ruta. El panel no usa ese header y está bien:
 * ahí no entra ninguna clienta.
 *
 * ── CUÁNDO APARECE, Y CUÁNDO SE VA ────────────────────────────────────────
 *
 * Con sesión iniciada y al menos una sesión pendiente — la definición está en
 * `series.service.ts`. No tiene botón de cerrar a propósito: se va sola cuando
 * la reserva, que es justo lo que se quiere que pase.
 *
 * Muestra UNA, la que se puede hacer antes. Con más de una, el resto queda a un
 * clic en «Mi cuenta»: una franja que lista tres tratamientos deja de ser una
 * franja.
 */
export function AvisoSesionPendiente() {
  const pendientes = useSesionesPendientes();
  const [sacando, setSacando] = useState<SesionPendiente | null>(null);

  const primera = pendientes.data?.[0];
  const otras = (pendientes.data?.length ?? 0) - 1;

  return (
    <>
      {primera && (
        // El dorado del botón «Reservar turno», a todo el ancho: sobre el oliva
        // del header es lo único que se lee como aviso y no como parte de la
        // barra.
        <div className="border-t border-primary-foreground/15 bg-gold text-accent-foreground">
          <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-x-4 gap-y-1.5 px-4 py-2 sm:px-5">
            <p className="text-[13px] leading-snug">
              Te falta la{" "}
              <strong className="font-semibold">
                sesión {primera.session_number} de {primera.sessions_total}
              </strong>{" "}
              de {primera.tratamiento}. {desdeCuando(primera)}
              {otras > 0 && (
                <>
                  {" "}
                  <Link to="/mi-cuenta" className="underline underline-offset-2">
                    {otras === 1 ? "Tenés otra más." : `Tenés ${otras} más.`}
                  </Link>
                </>
              )}
            </p>
            <button
              type="button"
              onClick={() => setSacando(primera)}
              className="shrink-0 rounded-sm bg-primary px-3 py-1.5 text-[13px] font-medium text-primary-foreground transition-colors hover:bg-primary/90"
            >
              Reservarla
            </button>
          </div>
        </div>
      )}

      {/* Fuera del `primera &&`: al reservar, la lista se vacía y la franja
          desaparece, pero el diálogo tiene que seguir montado para cerrarse
          con su animación y no de un corte. */}
      <SacarSesionDialog
        pendiente={sacando}
        onOpenChange={(abierto) => !abierto && setSacando(null)}
      />
    </>
  );
}
