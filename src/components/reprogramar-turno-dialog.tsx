import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { HelpCircle } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { api, apiPut } from "@/lib/api";
import { notifyAppointment } from "@/lib/notifications.functions";
import type { MiTurno, RtaDisponibilidad, RtaProfesionalesConHorarios } from "@/lib/api-tipos";
import { buildSlots, formatDateTime, formatTime, WEEKDAYS } from "@/lib/shiraf";

/**
 * La clienta se mueve su propio turno.
 *
 * ── POR QUÉ NO ALCANZABA CON CANCELAR Y RESERVAR DE NUEVO ─────────────────
 *
 * Era la única salida que había, y es mala por dos motivos: le pierde al turno
 * su historia —queda uno cancelado y otro nuevo, y en la ficha de la clienta se
 * lee como si se hubiera arrepentido— y entre una cosa y la otra el lugar queda
 * libre, así que puede tomarlo otra persona y quedarse sin ninguno de los dos.
 * Acá es un solo UPDATE: o se mueve, o se queda donde estaba.
 *
 * ── LO QUE ELIGE, Y LO QUE NO ─────────────────────────────────────────────
 *
 * Día, hora y profesional —la misma u otra, con tal de que haga ese
 * tratamiento—. El tratamiento no: eso ya es otro turno, con otro precio y otra
 * duración, y para eso está reservar.
 *
 * Los horarios que se ofrecen son los de la agenda REAL de la profesional
 * elegida, con sus ratos ocupados descontados. Es el mismo cálculo de /reservar
 * y del panel: `buildSlots` sobre lo que devuelve `/api/reservar/disponibilidad`.
 * El servidor lo vuelve a comprobar entero, así que esto es comodidad y no el
 * candado.
 */
export function ReprogramarTurnoDialog({
  turno,
  onOpenChange,
}: {
  /** El turno a mover, o null con el diálogo cerrado. */
  turno: MiTurno | null;
  onOpenChange: (open: boolean) => void;
}) {
  const queryClient = useQueryClient();
  const [profesionalId, setProfesionalId] = useState("");
  const [dia, setDia] = useState("");
  const [hora, setHora] = useState("");

  // Al abrir, arranca con la profesional que ya tiene: lo más común es querer
  // cambiar el día y no la persona.
  useEffect(() => {
    if (!turno) return;
    setProfesionalId(turno.professional_id ?? "");
    setDia("");
    setHora("");
  }, [turno]);

  const profesionales = useQuery({
    queryKey: ["reprogramar", "profesionales", turno?.service_id],
    enabled: !!turno?.service_id,
    queryFn: async () =>
      (
        await api<RtaProfesionalesConHorarios>(
          `/api/publico/servicios/${turno!.service_id}/profesionales`,
        )
      ).profesionales,
  });

  const fecha = useMemo(() => {
    if (!dia) return null;
    // "2026-09-15" se parsea a mediodía y no a medianoche: con la hora en 00:00
    // y el navegador en una zona al oeste de UTC, `new Date("...")` cae en el
    // día anterior. El mediodía deja margen para cualquier zona.
    const [a, m, d] = dia.split("-").map(Number);
    if (!a || !m || !d) return null;
    return new Date(a, m - 1, d, 12, 0, 0, 0);
  }, [dia]);

  const disponibilidad = useQuery({
    // `turno.id` va en la clave además de en la URL: si no, dos turnos del
    // mismo día y la misma profesional comparten entrada de cache y el segundo
    // se abre con los horarios calculados para el primero.
    queryKey: ["reprogramar", "disponibilidad", profesionalId, dia, turno?.id],
    enabled: !!profesionalId && !!fecha && !!turno,
    queryFn: async () => {
      const day = new Date(fecha!);
      day.setHours(0, 0, 0, 0);
      // `excluir` deja fuera de los ocupados al turno que se está moviendo,
      // para que su propio horario siga a la vista — es el único que permite
      // quedarse a la misma hora y cambiar de profesional.
      return api<RtaDisponibilidad>(
        `/api/reservar/disponibilidad?profesional=${profesionalId}&fecha=${day.toISOString()}&excluir=${turno!.id}`,
      );
    },
  });

  /** Los horarios libres de ese día, ya descontado lo ocupado. */
  const libres = useMemo(() => {
    if (!fecha || !turno || !disponibilidad.data) return [];
    return buildSlots(
      fecha,
      disponibilidad.data.schedules,
      disponibilidad.data.busy,
      { minutos: turno.duration_minutes, margen: turno.buffer_minutes },
      disponibilidad.data.ausencias,
    );
  }, [fecha, turno, disponibilidad.data]);

  /**
   * El instante que el turno YA tiene, para reconocerlo entre los libres.
   *
   * Se compara por instante y no por texto: `libres` son los ISO en UTC que arma
   * `buildSlots` ("2026-08-28T12:00:00.000Z") y `turno.starts_at` es lo que vino
   * del servidor, que puede estar escrito distinto —con offset en vez de Z, con
   * o sin milisegundos— y ser el mismo momento. `getTime()` los deja iguales.
   *
   * Si el día elegido no es el del turno, no coincide con ninguno y no se marca
   * nada, que es exactamente lo que corresponde.
   */
  const instanteActual = useMemo(
    () => (turno ? new Date(turno.starts_at).getTime() : null),
    [turno],
  );

  /** Qué días de la semana atiende, para explicar un día vacío. */
  const diasQueAtiende = useMemo(() => {
    const p = profesionales.data?.find((x) => x.id === profesionalId);
    if (!p) return [];
    return [...new Set(p.professional_schedules.map((s) => s.weekday))]
      .sort((x, y) => x - y)
      .map((d) => WEEKDAYS[d]);
  }, [profesionales.data, profesionalId]);

  const mover = useMutation({
    mutationFn: async () => {
      /*
       * `hora` YA es el instante absoluto, en ISO.
       *
       * 🔴 27/8/2026 — acá había una conversión que rompía el botón ENTERO, y
       * de la peor manera: no fallaba a veces, fallaba siempre.
       *
       *     const [hh, mm] = hora.split(":").map(Number);
       *     const cuando = new Date(fecha!);
       *     cuando.setHours(hh ?? 0, mm ?? 0, 0, 0);
       *     … starts_at: cuando.toISOString()
       *
       * Da por sentado que `hora` es "14:30", y no lo es: sale de `setHora(h)`
       * con lo que devuelve `buildSlots`, que son ISOs en UTC
       * ("2026-09-15T13:50:00.000Z" — ver el `toISOString()` del final de esa
       * función). Partido por ":" eso da ["2026-09-15T13", "50", "00.000Z"], y
       * `Number("2026-09-15T13")` es NaN.
       *
       * Y `??` NO atrapa NaN —sólo null y undefined—, así que el NaN pasaba
       * derecho a `setHours`, la fecha quedaba Invalid Date y `toISOString()`
       * tiraba RangeError. La clienta elegía todo, apretaba «Cambiar el turno»
       * y lo único que veía era un toast que decía "Invalid time value".
       *
       * No lo agarra TypeScript porque `hora` es `string` de las dos formas.
       *
       * La conversión no hacía falta para nada: el instante ya está calculado
       * sobre el día elegido —`buildSlots` arma cada horario desde `fecha`— así
       * que se manda tal cual, igual que hace /reservar con su `slot`. La
       * pantalla lo muestra con `formatTime`; lo que viaja es el ISO.
       */
      await apiPut(`/api/mi-cuenta/turnos/${turno!.id}/reprogramar`, {
        starts_at: hora,
        professional_id: profesionalId,
      });

      /*
       * Avisarle al CENTRO, que es el único que no se enteró.
       *
       * Es el mismo par que ya existía para cancelar —la clienta cancela y el
       * centro recibe "client-cancelled"— y faltaba de este lado: moverse el
       * turno cambiaba la agenda del día sin que nadie del equipo lo tocara ni
       * recibiera nada. El hueco viejo quedaba libre en silencio y el horario
       * nuevo aparecía sin aviso.
       *
       * A la clienta no se le manda nada: acaba de elegir el horario en esta
       * misma pantalla. Ojo con "rescheduled", que es el evento de al lado en
       * la lista: ése lo manda el CENTRO y su texto arranca con "Tuvimos que
       * mover tu turno" — mandárselo acá sería pedirle disculpas por algo que
       * decidió ella.
       *
       * El fallo se traga, igual que en cancelar: el turno YA se movió y es lo
       * que le importa a quien apretó el botón. Un mail que no sale no puede
       * convertirse en "no se pudo cambiar", que la haría intentar de nuevo
       * sobre un turno que ya está en el horario nuevo.
       */
      await notifyAppointment({
        data: { appointmentId: turno!.id, event: "client-rescheduled" },
      }).catch(() => undefined);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["my-appointments"] });
      toast.success("Listo, te movimos el turno.");
      onOpenChange(false);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  // El día de hoy, para que el calendario no ofrezca fechas pasadas. El servidor
  // las rechaza igual.
  const hoy = new Date();
  const minimo = `${hoy.getFullYear()}-${String(hoy.getMonth() + 1).padStart(2, "0")}-${String(hoy.getDate()).padStart(2, "0")}`;

  return (
    <Dialog open={turno !== null} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="font-display text-2xl">Cambiar el turno</DialogTitle>
          <DialogDescription>
            {turno ? (
              <>
                {turno.services.name} — hoy lo tenés {formatDateTime(turno.starts_at)}.
              </>
            ) : null}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <label className="block">
            <span className="text-eyebrow text-muted-foreground">Con quién</span>
            <select
              value={profesionalId}
              onChange={(e) => {
                setProfesionalId(e.target.value);
                setHora("");
              }}
              className="mt-2 h-10 w-full rounded-sm border border-input bg-background px-3 text-sm text-foreground"
            >
              <option value="">Elegí una profesional</option>
              {profesionales.data?.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.full_name}
                </option>
              ))}
            </select>
          </label>

          <label className="block">
            <span className="text-eyebrow text-muted-foreground">Qué día</span>
            <input
              type="date"
              min={minimo}
              value={dia}
              onChange={(e) => {
                setDia(e.target.value);
                setHora("");
              }}
              className="mt-2 h-10 w-full rounded-sm border border-input bg-background px-3 text-sm text-foreground"
            />
          </label>

          {profesionalId && fecha && (
            <div>
              <span className="text-eyebrow text-muted-foreground">A qué hora</span>
              {disponibilidad.isPending ? (
                <p className="mt-2 text-sm text-muted-foreground">Buscando horarios…</p>
              ) : libres.length === 0 ? (
                <p className="mt-2 text-sm text-muted-foreground">
                  Ese día no le quedan horarios.
                  {diasQueAtiende.length > 0 && <> Atiende {diasQueAtiende.join(", ")}.</>}
                </p>
              ) : (
                <TooltipProvider delayDuration={200}>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {libres.map((h) => {
                      /*
                       * El horario que la clienta ya tiene aparece igual que los
                       * demás y eso se lee como un horario libre cualquiera: abre
                       * «Cambiar», ve las 09:00 entre las opciones y no tiene cómo
                       * saber que es justo el que está ocupando ella.
                       *
                       * Va MARCADO, no deshabilitado. Que esté a la vista no es un
                       * descuido: el `excluir` de la disponibilidad lo deja fuera de
                       * los ocupados a propósito —ver el comentario de esa query—
                       * porque es el único camino para quedarse a la misma hora y
                       * cambiar sólo de profesional. Apagarlo cerraría esa puerta.
                       *
                       * Tampoco se preselecciona: con el botón «Cambiar el turno»
                       * habilitado desde el vamos, apretarlo sin tocar nada manda un
                       * PUT que no mueve nada y le avisa al centro de un cambio que
                       * no existió.
                       */
                      const esElActual =
                        instanteActual !== null && Date.parse(h) === instanteActual;
                      const elegido = hora === h;

                      const boton = (
                        <button
                          key={h}
                          type="button"
                          onClick={() => setHora(h)}
                          className={`inline-flex items-center gap-1.5 rounded-sm border px-3 py-1.5 text-sm transition-colors ${
                            elegido
                              ? "border-primary bg-primary text-primary-foreground"
                              : esElActual
                                ? "border-dashed border-primary/50 bg-primary/5 text-foreground hover:border-primary"
                                : "border-input bg-background text-foreground hover:border-primary"
                          }`}
                        >
                          {/* 26/8/2026 — acá decía `{h}` a secas, y `h` es el ISO en UTC
                              que después se le manda al servidor: los botones salían
                              escritos "2026-08-31T13:50:00.000Z" en vez de "10:50".
                              Además de ser ilegible, mostraba la hora en UTC, tres
                              horas corrida de la que la clienta iba a ir. El valor
                              que viaja no cambia — sigue siendo `h`, tanto en el
                              `key` como en `setHora` —; lo único que cambia es cómo
                              se lee. `formatTime` es la misma función con la que
                              pinta los horarios la pantalla de reservar, así que las
                              dos pantallas que mueven un turno ahora dicen la hora
                              igual. */}
                          {/* {h} */}
                          {formatTime(h)}
                          {esElActual && (
                            <HelpCircle className="size-3.5 shrink-0 opacity-70" aria-hidden />
                          )}
                        </button>
                      );

                      // El disparador es el botón entero y no el iconito: pasar el
                      // mouse justo por encima de un signo de pregunta de 14px es
                      // pedir demasiado. El icono está para que se vea que ahí hay
                      // algo para leer.
                      return esElActual ? (
                        <Tooltip key={h}>
                          <TooltipTrigger asChild>{boton}</TooltipTrigger>
                          <TooltipContent className="max-w-56 text-center">
                            Es el horario que tenés ahora. Si lo dejás como está, podés cambiar sólo
                            la profesional.
                          </TooltipContent>
                        </Tooltip>
                      ) : (
                        boton
                      );
                    })}
                  </div>
                </TooltipProvider>
              )}
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Dejarlo como está
          </Button>
          <Button
            disabled={!profesionalId || !fecha || !hora || mover.isPending}
            onClick={() => mover.mutate()}
          >
            {mover.isPending ? "Moviendo…" : "Cambiar el turno"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
