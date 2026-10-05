import { useState } from "react";
import { CalendarPlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { SacarSesionDialog } from "@/components/sacar-sesion-dialog";
import type { SesionPendiente } from "@/lib/api-tipos";
import { desdeCuando } from "@/lib/sesiones";

/**
 * Las sesiones que le falta sacar, una tarjeta por cada una, con su botón.
 *
 * Es la versión larga del cartel del header: allá entra un renglón, acá cada
 * tratamiento dice en qué sesión va y desde cuándo se puede. La muestran «Mi
 * cuenta» y la pantalla del enlace personal — por eso recibe la lista hecha en
 * vez de pedirla: cada una la saca de un lugar distinto.
 *
 * Sin pendientes no dibuja nada, ni el título. Una sección "Sesiones por
 * reservar" vacía en la cuenta de alguien que se hizo una limpieza facial le
 * hace preguntarse qué se está perdiendo.
 */
export function SesionesPorReservar({
  pendientes,
  token,
}: {
  pendientes: SesionPendiente[];
  /** El enlace personal, cuando quien mira reservó sin cuenta. */
  token?: string;
}) {
  const [sacando, setSacando] = useState<SesionPendiente | null>(null);

  if (pendientes.length === 0) return null;

  return (
    <>
      <div className="mt-12 flex items-center gap-3">
        <CalendarPlus className="h-5 w-5 text-gold" />
        <h2 className="font-display text-2xl text-foreground">Sesiones por reservar</h2>
      </div>

      <div className="mt-5 space-y-3">
        {pendientes.map((p) => (
          // Borde dorado y no el gris de los turnos de abajo: esto no es un
          // turno que ya tiene, es uno que le falta sacar.
          <Card key={p.id} className="border-gold/60 bg-gold/5 shadow-soft">
            <CardContent className="flex flex-wrap items-center justify-between gap-4 p-5">
              <div>
                <p className="font-display text-xl text-foreground">{p.tratamiento}</p>
                <p className="mt-1 text-sm text-muted-foreground">
                  Te falta la sesión {p.session_number} de {p.sessions_total} · incluida en tu
                  tratamiento
                </p>
                <p className="mt-1 text-sm text-foreground">{desdeCuando(p)}</p>
              </div>
              <Button size="sm" onClick={() => setSacando(p)}>
                Reservar la sesión {p.session_number}
              </Button>
            </CardContent>
          </Card>
        ))}
      </div>

      <SacarSesionDialog
        pendiente={sacando}
        onOpenChange={(abierto) => !abierto && setSacando(null)}
        {...(token ? { token } : {})}
      />
    </>
  );
}
