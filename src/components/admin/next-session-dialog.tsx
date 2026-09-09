import { useEffect, useMemo, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { SelectorDeHorario } from "@/components/admin/selector-de-horario";
import { instanteDe, toTimeInput } from "@/lib/horarios";
import { apiPost } from "@/lib/api";
import { notifyAppointment } from "@/lib/notifications.functions";
import { toDateKey } from "@/lib/shiraf";

/** "viernes, 18 de septiembre" — la fecha como se la dice en voz alta. */
function fechaLarga(iso: string): string {
  return new Date(iso).toLocaleDateString("es-AR", {
    weekday: "long",
    day: "2-digit",
    month: "long",
  });
}

/** El turno del que se parte: de él salen la clienta, el tratamiento y la serie. */
export type SesionAAgendar = {
  id: string;
  /** Para el título: "Sesión 2 de 3". */
  session_number: number;
  sessions_total: number;
  /** Nombre del tratamiento y de quien viene, para que el diálogo diga de quién es. */
  serviceName: string;
  personName: string;
  /** Cuándo tocaría, según el intervalo del tratamiento. Null si no hay intervalo. */
  suggestedAt: string | null;
  /**
   * De quién es la agenda que hay que mirar, y cuánto ocupa el turno.
   *
   * Sin estos tres no se pueden calcular los horarios libres: el buscador
   * necesita saber a quién preguntarle y cuánto tiene que entrar. Vienen de la
   * fila, que ya los tiene congelados en el turno anterior — la sesión que
   * sigue dura lo mismo que la que se está copiando.
   */
  professionalId: string | undefined;
  duracion: number;
  margen: number;
};

/**
 * Agenda la sesión siguiente de un tratamiento de varias.
 *
 * ── POR QUÉ ESTO LO HACE EL CENTRO Y NO LA CLIENTA ───────────────────────────
 *
 * Porque así se decidió que funcione: la clienta reserva la PRIMERA sesión y las
 * que siguen se acuerdan cuando viene. Pedirle en el sitio tres fechas de una
 * —dos de ellas a veintiún días vista— es la forma más rápida de que abandone el
 * formulario.
 *
 * ── LA FECHA VIENE PROPUESTA, LOS HORARIOS SON LOS REALES ───────────────────
 *
 * El día se abre en la fecha que corresponde según el intervalo del tratamiento
 * —la calcula el servidor— y las horas que se ofrecen son los huecos libres de
 * esa profesional ese día, con la duración de este tratamiento. La primera
 * versión de esto era un `datetime-local` pelado: el calendario del navegador
 * ofrecía domingos, las 3 de la mañana y horarios ya tomados, todo con la misma
 * cara.
 */
export function NextSessionDialog({
  turno,
  onOpenChange,
  onCreated,
}: {
  /** El turno anterior, o null cuando el diálogo está cerrado. */
  turno: SesionAAgendar | null;
  onOpenChange: (next: boolean) => void;
  onCreated: () => void;
}) {
  const queryClient = useQueryClient();
  const [dateKey, setDateKey] = useState("");
  const [time, setTime] = useState("");
  const [manual, setManual] = useState(false);
  const [nota, setNota] = useState("");
  /**
   * Si se levantó el mínimo de días entre sesiones.
   *
   * Arranca apagado y se prende a mano. El intervalo del tratamiento es un
   * mínimo —la piel necesita ese descanso— así que adelantarlo tiene que ser una
   * decisión, no un clic distraído en el calendario. Pero se puede: la clienta
   * que se va de viaje y quiere venir antes existe, y el centro es quien sabe si
   * en ese caso se puede.
   */
  const [sinMinimo, setSinMinimo] = useState(false);

  // La propuesta se escribe cada vez que se abre el diálogo con otro turno. Sin
  // esto, abrir el segundo turno mostraría la fecha del primero.
  //
  // La HORA de la sugerencia no se preselecciona: puede estar tomada ese día, y
  // dejarla marcada sin que aparezca en la lista de libres haría que el botón
  // de guardar se habilite con un horario que la base va a rechazar. Se abre el
  // día correcto y la hora se elige de los huecos que de verdad hay.
  useEffect(() => {
    if (!turno) return;
    const sugerida = turno.suggestedAt ? new Date(turno.suggestedAt) : new Date();
    setDateKey(toDateKey(sugerida));
    setTime("");
    setManual(false);
    setSinMinimo(false);
    setNota("");
  }, [turno]);

  /**
   * El día más temprano que se puede elegir: el que marca el intervalo.
   *
   * A medianoche, porque el calendario compara por día y no por hora: con la
   * hora puesta, el propio día sugerido quedaría deshabilitado hasta esa hora.
   */
  const piso = useMemo(() => {
    if (!turno?.suggestedAt || sinMinimo) return undefined;
    const d = new Date(turno.suggestedAt);
    d.setHours(0, 0, 0, 0);
    return d;
  }, [turno, sinMinimo]);

  const cuando = instanteDe(dateKey, time);

  const agendar = useMutation({
    mutationFn: async () => {
      // `return;` daba undefined; con el resultado del mail como valor de la
      // mutación, el "no hubo nada que hacer" es null, que onSuccess distingue.
      // if (!turno || !cuando) return;
      if (!turno || !cuando) return null;
      // Antes se descartaba la respuesta; ahora hace falta el id para avisar.
      // await apiPost(`/api/turnos/${turno.id}/siguiente-sesion`, {
      const { id } = await apiPost<{ id: string }>(`/api/turnos/${turno.id}/siguiente-sesion`, {
        // El día y la hora son de pared —el reloj del centro— y viajan como
        // instante para que el servidor no tenga que adivinar la zona.
        starts_at: cuando.toISOString(),
        client_notes: nota.trim() || null,
      });

      // El mismo aviso que al cargar un turno nuevo, y por el mismo motivo: la
      // sesión nace confirmada y sin esto nadie se enteraba. El porqué largo
      // está en new-appointment-dialog.tsx.
      //
      // 9/9/2026 — y al centro, igual que el alta: agendar la sesión siguiente
      // también es cargar un turno desde el panel. Antes:
      //   return await notifyAppointment({ data: { appointmentId: id, event: "confirmed" } }).catch(
      //     (e: Error) => ({ sent: false as const, reason: e.message }),
      //   );
      const [mail] = await Promise.all([
        notifyAppointment({ data: { appointmentId: id, event: "confirmed" } }).catch(
          (e: Error) => ({ sent: false as const, reason: e.message }),
        ),
        notifyAppointment({ data: { appointmentId: id, event: "staff-created" } }).catch(
          (e: Error) => console.error("[panel] no se pudo avisar al centro:", e.message),
        ),
      ]);
      return mail;
    },
    // Antes no recibía nada: la mutación no devolvía el resultado del mail.
    // onSuccess: async () => {
    onSuccess: async (mail) => {
      await queryClient.invalidateQueries({ queryKey: ["admin-appointments"] });
      await queryClient.invalidateQueries({ queryKey: ["admin-calendar"] });
      // El toast pelado no decía si el mail salió; ahora lo dice en la bajada.
      // toast.success(`Sesión ${(turno?.session_number ?? 1) + 1} agendada.`);
      toast.success(`Sesión ${(turno?.session_number ?? 1) + 1} agendada.`, {
        ...(mail
          ? {
              description: mail.sent
                ? "Le avisamos por mail."
                : `Por mail no salió: ${mail.reason}`,
            }
          : {}),
      });
      onOpenChange(false);
      onCreated();
    },
    // El choque de horarios lo redacta el trigger de la base y llega tal cual:
    // "Ese horario ya fue tomado con esa profesional."
    onError: (e: Error) => toast.error(e.message),
  });

  const siguiente = (turno?.session_number ?? 0) + 1;

  return (
    <Dialog open={!!turno} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="font-display text-2xl">
            Agendar sesión {siguiente} de {turno?.sessions_total}
          </DialogTitle>
          <DialogDescription>
            {turno?.serviceName} · {turno?.personName}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {turno && (
            <>
              <p className="text-xs text-muted-foreground">
                {turno.suggestedAt
                  ? `Según el intervalo del tratamiento, esta sesión va a partir del ${fechaLarga(
                      turno.suggestedAt,
                    )}. Podés correrla más adelante si la clienta no puede.`
                  : "Este tratamiento no tiene días de intervalo cargados, así que cualquier día sirve."}
              </p>

              <SelectorDeHorario
                idPrefijo="ns"
                profesionalId={turno.professionalId}
                duracion={turno.duracion}
                margen={turno.margen}
                dateKey={dateKey}
                onDateKey={setDateKey}
                time={time}
                onTime={setTime}
                manual={manual}
                onManual={setManual}
                {...(piso ? { noAntesDe: piso } : {})}
                {...(piso
                  ? {
                      motivoDelPiso: `Los días anteriores al ${fechaLarga(
                        turno.suggestedAt!,
                      )} están deshabilitados: el tratamiento pide ese descanso entre sesiones.`,
                    }
                  : {})}
              />

              {/* La salida, explícita y con nombre — el mismo criterio que
                  «Cargar fuera de horario»: el panel avisa y explica, pero no le
                  prohíbe nada al centro, que es quien conoce el caso. */}
              {turno.suggestedAt && (
                <button
                  type="button"
                  onClick={() => {
                    setSinMinimo(!sinMinimo);
                    // Lo elegido con el otro criterio deja de valer.
                    setTime("");
                  }}
                  className="text-xs text-muted-foreground underline underline-offset-2 transition-colors hover:text-foreground"
                >
                  {sinMinimo
                    ? "Volver a respetar el intervalo del tratamiento"
                    : "Adelantar la sesión igual (la clienta no puede esperar)"}
                </button>
              )}
            </>
          )}

          <div className="space-y-2">
            <Label htmlFor="ns-nota">Nota (opcional)</Label>
            <Textarea
              id="ns-nota"
              rows={2}
              placeholder="Algo a tener en cuenta para esta sesión."
              value={nota}
              onChange={(e) => setNota(e.target.value)}
            />
          </div>

          <p className="text-xs text-muted-foreground">
            Queda confirmada y con la misma profesional. No se cobra de nuevo: el precio del
            tratamiento ya quedó en la primera sesión.
          </p>

          <Button
            className="w-full"
            disabled={!cuando || agendar.isPending}
            onClick={() => agendar.mutate()}
          >
            {agendar.isPending
              ? "Agendando…"
              : cuando
                ? `Agendar el ${cuando.toLocaleDateString("es-AR", {
                    day: "2-digit",
                    month: "long",
                  })} a las ${toTimeInput(cuando.toISOString())}`
                : "Elegí día y hora"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
