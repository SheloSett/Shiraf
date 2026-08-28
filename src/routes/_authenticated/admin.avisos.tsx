import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { MessageCircle, TriangleAlert } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { api } from "@/lib/api";
import type { RtaAvisosDeManana, TurnoParaAvisar } from "@/lib/api-tipos";
import { appointmentWhatsappUrl } from "@/lib/notifications";
import { openWhatsapp, toNotifiable } from "@/hooks/useCambiarEstadoDeTurno";
import { formatTime } from "@/lib/shiraf";

export const Route = createFileRoute("/_authenticated/admin/avisos")({
  head: () => ({
    meta: [{ title: "Avisos de mañana — Panel Shiraf" }],
  }),
  component: AvisosDeManana,
});

/**
 * El día de mañana escrito para leer, a partir del AAAA-MM-DD del servidor.
 *
 * Se parte a mano y se arma con `new Date(a, m - 1, d)` en vez de
 * `new Date("2026-08-28")`: esa forma la parsea el navegador como medianoche
 * **UTC**, y en una zona al oeste cae en el día anterior. Con la fecha así, el
 * título diría un día menos que la lista que tiene abajo.
 */
function diaLargo(dia: string): string {
  const [a, m, d] = dia.split("-").map(Number);
  if (!a || !m || !d) return dia;
  return new Date(a, m - 1, d).toLocaleDateString("es-AR", {
    weekday: "long",
    day: "numeric",
    month: "long",
  });
}

/**
 * La lista para mandar los recordatorios de mañana por WhatsApp.
 *
 * ── POR QUÉ ESTA PANTALLA ─────────────────────────────────────────────────
 *
 * El recordatorio del día antes ya sale solo, pero **sólo por mail**. Por
 * WhatsApp no puede salir solo: eso necesita la API de Meta, con verificación
 * del negocio, plantillas aprobadas una por una y un número que deja de
 * funcionar en el celular. Está todo en `docs/whatsapp-automatico.md`.
 *
 * Y WhatsApp es el canal que las clientas realmente leen. Hasta ahora, mandarlo
 * significaba que alguien del centro se acordara, entrara a «Turnos», filtrara
 * por fecha y fuera abriendo turno por turno. Se hacía a veces, que es la peor
 * de las frecuencias posibles: la que no se puede prometer.
 *
 * Esto es esa lista ya hecha. Cinco minutos por día, cero costo, y no depende
 * de que nadie apruebe nada.
 *
 * ── LO QUE NO HACE, Y POR QUÉ ─────────────────────────────────────────────
 *
 * No marca cuáles ya se avisaron por WhatsApp. Abrir `wa.me` deja el mensaje
 * escrito en la app: si la persona apretó enviar o cerró la ventana, desde acá
 * no se puede saber, y una tilde que dice "avisado" sin serlo es peor que
 * ninguna. Tampoco se puede reusar `reminded_at`, que es la marca del MAIL —
 * escribirla dejaría a la clienta sin el mail.
 *
 * La marca de verdad necesita una columna propia. Está anotado en
 * `docs/whatsapp-automatico.md` como el paso siguiente.
 */
function AvisosDeManana() {
  const avisos = useQuery({
    queryKey: ["avisos-manana"],
    // Se refresca al volver a la pestaña: alguien puede confirmar o cancelar un
    // turno de mañana desde «Turnos» mientras esta lista está abierta, y avisarle
    // a una clienta de un turno que se acaba de caer es peor que no avisarle.
    staleTime: 60_000,
    refetchOnWindowFocus: true,
    queryFn: async () => api<RtaAvisosDeManana>("/api/turnos/manana"),
  });

  const turnos: TurnoParaAvisar[] = avisos.data?.turnos ?? [];
  const conTelefono = turnos.filter((t) => t.person.phone).length;

  return (
    <div>
      <div>
        <p className="text-eyebrow text-muted-foreground">Recordatorios</p>
        <h1 className="mt-3 font-display text-4xl text-foreground">Avisos de mañana</h1>
      </div>

      <p className="mt-4 max-w-2xl text-sm leading-relaxed text-muted-foreground">
        Los turnos confirmados de{" "}
        <span className="text-foreground">
          {avisos.data ? diaLargo(avisos.data.dia) : "mañana"}
        </span>
        . El mail del recordatorio sale solo; esto es para el WhatsApp, que va a mano. Cada botón
        abre la conversación con el mensaje ya escrito — sólo hay que apretar enviar.
      </p>

      {avisos.isLoading && <p className="mt-10 text-sm text-muted-foreground">Cargando…</p>}

      {/* El error va separado del vacío, igual que en «Mi agenda»: si una
          consulta que falla se dibuja como una que volvió sin filas, la pantalla
          dice "no hay turnos" cuando lo que pasó es que no se pudo preguntar —
          y ahí nadie revisa, se confía, y mañana llegan clientas sin aviso. */}
      {avisos.isError && (
        <div className="mt-10 max-w-xl rounded-sm border border-destructive/40 bg-destructive/5 p-5">
          <p className="text-sm font-medium text-foreground">No se pudo cargar la lista.</p>
          <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
            Puede ser la conexión. Probá de nuevo en un rato — esto no significa que no haya turnos
            mañana, así que conviene mirar la agenda antes de dar el día por avisado.
          </p>
        </div>
      )}

      {!avisos.isLoading && !avisos.isError && turnos.length === 0 && (
        <div className="mt-10 max-w-xl rounded-sm border border-dashed border-border p-8 text-center">
          <p className="text-sm text-foreground">Mañana no hay turnos confirmados.</p>
          <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
            Los turnos que todavía están pendientes no aparecen acá: recordarle a alguien que venga
            a algo que el centro no aceptó es prometerle un horario que puede no existir.
          </p>
        </div>
      )}

      {turnos.length > 0 && (
        <>
          <p className="mt-8 text-sm text-muted-foreground tabular-nums">
            {turnos.length} {turnos.length === 1 ? "turno" : "turnos"}
            {conTelefono < turnos.length && (
              <> · {turnos.length - conTelefono} sin teléfono cargado</>
            )}
          </p>

          <div className="mt-4 space-y-3">
            {turnos.map((t) => {
              // El mismo `toNotifiable` que usan «Turnos» y la ficha del turno,
              // así el texto del recordatorio es uno solo y no una tercera
              // redacción que dentro de un mes dice otra cosa.
              const url = appointmentWhatsappUrl("reminder", toNotifiable(t));

              return (
                <Card key={t.id} className="border-border/80 shadow-soft">
                  <CardContent className="flex flex-wrap items-start justify-between gap-4 p-5">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                        <span className="font-display text-2xl text-foreground tabular-nums">
                          {formatTime(t.starts_at)}
                        </span>
                        <span className="text-sm text-foreground">
                          {t.services?.name ?? "Sin tratamiento"}
                        </span>
                        <span className="text-xs text-muted-foreground">
                          {t.duration_minutes} min
                        </span>
                      </div>

                      <p className="mt-1.5 text-sm text-muted-foreground">
                        {t.person.name}
                        {t.person.phone ? <> · {t.person.phone}</> : null}
                        {t.professionals ? <> · {t.professionals.full_name}</> : null}
                      </p>

                      {/* La nota de la clienta, a la vista de quien está por
                          escribirle: es donde dice "estoy embarazada" o "soy
                          alérgica a las nueces". */}
                      {t.client_notes && (
                        <p className="mt-2 flex items-start gap-2 rounded-sm border border-gold/30 bg-gold/5 px-3 py-2 text-xs leading-relaxed text-foreground">
                          <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0 text-gold" />
                          {t.client_notes}
                        </p>
                      )}
                    </div>

                    <div className="flex shrink-0 flex-col items-end gap-2">
                      {url ? (
                        <Button size="sm" onClick={() => openWhatsapp(url)}>
                          <MessageCircle className="mr-2 h-4 w-4" /> Avisar por WhatsApp
                        </Button>
                      ) : (
                        /* Sin teléfono no hay a dónde escribir. Se dice por qué
                           y dónde se arregla, en vez de dejar un botón apagado
                           que no se distingue de uno roto. */
                        <p className="max-w-48 text-right text-xs leading-relaxed text-muted-foreground">
                          Sin teléfono cargado. Se agrega en la ficha de la clienta.
                        </p>
                      )}

                      {/* Que el mail haya salido no quiere decir que la clienta
                          lo haya leído — por eso el WhatsApp se manda igual. Está
                          para el caso contrario: si dice "mail pendiente", puede
                          ser que la clienta no tenga dirección cargada, y
                          entonces el WhatsApp es el ÚNICO aviso que va a recibir. */}
                      <Badge
                        variant={t.reminded_at ? "secondary" : "outline"}
                        className="font-normal"
                      >
                        {t.reminded_at ? "Mail enviado" : "Mail pendiente"}
                      </Badge>
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
