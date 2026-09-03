import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { CalendarDays, Clock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { CalendarioDeLaProfesional } from "@/components/calendario-de-la-profesional";
import { api } from "@/lib/api";
import type { RtaDisponibilidad } from "@/lib/api-tipos";
import { parseDateKey, toTimeInput } from "@/lib/horarios";
import { buildSlots, WEEKDAYS } from "@/lib/shiraf";

/**
 * Elegir día y hora mirando la agenda REAL de la profesional.
 *
 * ── POR QUÉ ES UN COMPONENTE Y NO CÓDIGO EN CADA DIÁLOGO ─────────────────────
 *
 * Porque el panel tiene tres lugares donde se elige un horario —cargar un turno
 * nuevo, moverlo de fecha y agendar la sesión siguiente de un tratamiento de
 * varias— y los tres tienen que ofrecer lo mismo: los huecos libres de esa
 * profesional ese día, con la duración de ESE tratamiento.
 *
 * Los dos últimos eran un `<input type="datetime-local">` pelado: un calendario
 * del navegador que no sabe nada de Shiraf. Ofrecía las 3 de la mañana, los
 * domingos y los horarios ya tomados con la misma naturalidad que uno libre, y
 * el turno recién rebotaba al guardar —o peor, entraba, porque al centro la
 * base no le exige respetar la agenda—. Elegir a ciegas y enterarse después es
 * exactamente lo que este componente saca del medio.
 *
 * ── LO QUE NO HACE: PROHIBIR ────────────────────────────────────────────────
 *
 * «Cargar fuera de horario» sigue estando, escondido detrás de un enlace. El
 * trigger `validate_appointment` exime al centro del control de agenda a
 * propósito —que una profesional se quede más tarde por una clienta es normal y
 * hay que poder registrarlo—, así que la lista de horarios es una ayuda, no una
 * reja. Lo único que no se perdona nunca es el solape, y eso lo sigue frenando
 * la base.
 *
 * El estado vive AFUERA (día y hora los tiene quien lo usa) porque cada diálogo
 * arma su `starts_at` distinto y necesita esos dos valores para saber si ya
 * puede guardar.
 */
export function SelectorDeHorario({
  profesionalId,
  duracion,
  margen,
  dateKey,
  onDateKey,
  time,
  onTime,
  manual,
  onManual,
  excluirTurnoId,
  noAntesDe,
  motivoDelPiso,
  idPrefijo = "sel",
  colapsable = false,
}: {
  /** De quién es la agenda. Sin esto no hay nada que consultar. */
  profesionalId: string | undefined;
  /** Cuánto dura el turno y cuánto deja después: define dónde entra. */
  duracion: number;
  margen: number;
  /** "AAAA-MM-DD", el valor del <input type="date">. */
  dateKey: string;
  onDateKey: (next: string) => void;
  /** "HH:MM", el horario elegido. */
  time: string;
  onTime: (next: string) => void;
  /** Si está abierta la puerta de atrás de escribir la hora a mano. */
  manual: boolean;
  onManual: (next: boolean) => void;
  /**
   * El turno que se está moviendo, para que no se cuente a sí mismo.
   *
   * Sin esto, al reprogramar, el horario que el turno ocupa hoy aparece como
   * tomado — por él mismo — y no se puede, por ejemplo, correrlo media hora.
   */
  excluirTurnoId?: string;
  /**
   * El día más temprano que se puede elegir, si hay uno.
   *
   * Lo usa la sesión siguiente de un tratamiento de varias: el intervalo que
   * carga el centro —"cada 21 días"— es un mínimo clínico, y adelantarlo es
   * justo lo que no hay que poder hacer sin querer. Los días anteriores salen
   * deshabilitados y el motivo se dice abajo.
   *
   * Sin esto, cualquier día futuro es válido.
   */
  noAntesDe?: Date;
  /** Qué decir cuando alguien mira los días grises de antes del piso. */
  motivoDelPiso?: string;
  /** Para que los `id` de los campos no choquen si hay dos en la misma página. */
  idPrefijo?: string;
  /**
   * Arranca oculto detrás de un botón, con la elección actual como resumen.
   *
   * Pensado para donde el horario es UNA sección más de una pantalla que ya
   * tiene otras —reprogramar un turno, agendar la sesión siguiente— y no el
   * motivo por el que se abrió esa pantalla: ahí el calendario entero, más los
   * horarios, era con diferencia el bloque más grande de toda la vista. En
   * «Nuevo turno» y en el paso 3 de /reservar, en cambio, elegir el horario ES
   * la tarea del paso, así que se dejan expandidos siempre (no pasan esta
   * prop).
   */
  colapsable?: boolean;
}) {
  const date = useMemo(() => parseDateKey(dateKey), [dateKey]);

  // Cerrado de entrada cuando es colapsable. No se repliega solo al elegir
  // día u hora —eso escondería justo lo que la persona acaba de tocar—, pero
  // sí tiene que poder cerrarlo a mano cuando ya terminó: el botón "Ocultar"
  // de abajo hace eso.
  const [abierto, setAbierto] = useState(!colapsable);

  const disponibilidad = useQuery({
    queryKey: ["disponibilidad", profesionalId, dateKey, excluirTurnoId ?? null],
    enabled: !!profesionalId && !!date,
    // El mismo endpoint que usa la clienta al reservar: los horarios de la
    // profesional y los ratos ocupados, sin decir de quién es cada turno.
    queryFn: async () => {
      const day = new Date(date!);
      day.setHours(0, 0, 0, 0);
      const excluir = excluirTurnoId ? `&excluir=${excluirTurnoId}` : "";
      return api<RtaDisponibilidad>(
        `/api/reservar/disponibilidad?profesional=${profesionalId}&fecha=${day.toISOString()}${excluir}`,
      );
    },
  });

  const libres = useMemo(() => {
    if (!date || !disponibilidad.data || duracion <= 0) return [];
    return buildSlots(
      date,
      disponibilidad.data.schedules,
      disponibilidad.data.busy,
      { minutos: duracion, margen },
      disponibilidad.data.ausencias,
    );
  }, [date, disponibilidad.data, duracion, margen]);

  /** Las franjas de atención de ese día: con qué se compara "fuera de horario". */
  const franjas = useMemo(() => {
    if (!date || !disponibilidad.data) return [];
    return disponibilidad.data.schedules.filter((s) => s.weekday === date.getDay());
  }, [date, disponibilidad.data]);

  /** La hora escrita a mano cae fuera de la agenda. Se avisa, no se bloquea. */
  const fueraDeHorario = useMemo(() => {
    if (!time || franjas.length === 0) return franjas.length === 0;
    const [hh = 0, mm = 0] = time.split(":").map(Number);
    const desde = hh * 60 + mm;
    const hasta = desde + duracion;
    return !franjas.some((s) => {
      const [sh = 0, sm = 0] = s.start_time.split(":").map(Number);
      const [eh = 0, em = 0] = s.end_time.split(":").map(Number);
      return desde >= sh * 60 + sm && hasta <= eh * 60 + em;
    });
  }, [time, franjas, duracion]);

  /*
   * Sin profesional no hay agenda que consultar, y el turno sin asignar existe:
   * es el que el centro carga sin decidir todavía quién atiende. Se dice qué
   * falta en vez de mostrar una lista de horarios vacía, que se leería como
   * "no hay lugar".
   */
  if (!profesionalId) {
    return (
      <p className="rounded-sm border border-border bg-secondary/40 p-2.5 text-xs leading-relaxed text-muted-foreground">
        Este turno no tiene profesional asignada, así que no hay horarios que mirar. Asignásela
        primero y volvé.
      </p>
    );
  }

  if (!abierto) {
    const fechaElegida = date
      ? date.toLocaleDateString("es-AR", { weekday: "long", day: "2-digit", month: "long" })
      : null;
    return (
      <button
        type="button"
        onClick={() => setAbierto(true)}
        className="flex w-full items-center gap-3 rounded-sm border border-border bg-secondary/30 p-3 text-left text-sm transition-colors hover:border-primary/40"
      >
        <CalendarDays className="h-4 w-4 shrink-0 text-muted-foreground" />
        {fechaElegida && time ? (
          <span className="text-foreground">
            {fechaElegida} · {time}
          </span>
        ) : (
          <span className="text-muted-foreground">Elegir día y horario</span>
        )}
        <span className="text-eyebrow ml-auto shrink-0 text-gold">Cambiar</span>
      </button>
    );
  }

  return (
    <>
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <Label>Día</Label>
          {colapsable && (
            <button
              type="button"
              onClick={() => setAbierto(false)}
              className="text-eyebrow text-gold transition-opacity hover:opacity-70"
            >
              Ocultar
            </button>
          )}
        </div>
        <CalendarioDeLaProfesional
          profesionalId={profesionalId}
          dateKey={dateKey}
          onDateKey={(next) => {
            onDateKey(next);
            // La hora elegida era de OTRO día: en el nuevo puede estar tomada.
            onTime("");
          }}
          {...(noAntesDe ? { noAntesDe } : {})}
          {...(motivoDelPiso ? { motivoDelPiso } : {})}
        />
      </div>

      <div className="space-y-2">
        <Label>Hora</Label>

        {/* Los tres estados se dicen distinto a propósito. Con un solo mensaje,
            un error de la base se leía como una respuesta tranquila sobre la
            agenda: "esta profesional no atiende ese día". */}
        {disponibilidad.isError ? (
          <p className="rounded-sm border border-destructive/50 bg-destructive/10 p-2.5 text-xs leading-relaxed text-foreground">
            No se pudieron consultar los horarios. No es que la profesional no atienda: la base
            devolvió un error.
            <span className="mt-1 block font-mono text-[11px] text-muted-foreground">
              {(disponibilidad.error as Error).message}
            </span>
          </p>
        ) : disponibilidad.isPending ? (
          <p className="text-xs text-muted-foreground">Buscando horarios…</p>
        ) : (
          <p className="text-xs text-muted-foreground">
            {franjas.length > 0 ? (
              <>
                {WEEKDAYS[date?.getDay() ?? 0]}:{" "}
                {franjas
                  .map((s) => `${s.start_time.slice(0, 5)}–${s.end_time.slice(0, 5)}`)
                  .join(", ")}
              </>
            ) : (
              <>Esta profesional no atiende ese día.</>
            )}
          </p>
        )}

        {/* Los huecos que quedan libres, y nada más. Cada uno arranca donde
            termina el anterior, así que la lista ya viene sin tiempo muerto. */}
        {disponibilidad.isError || disponibilidad.isPending ? null : libres.length > 0 ? (
          <div className="flex flex-wrap gap-1.5">
            {libres.map((iso) => {
              const label = toTimeInput(iso);
              return (
                <Button
                  key={iso}
                  type="button"
                  size="sm"
                  variant={time === label ? "default" : "outline"}
                  className="h-8"
                  onClick={() => {
                    onTime(label);
                    onManual(false);
                  }}
                >
                  {label}
                </Button>
              );
            })}
          </div>
        ) : (
          /* Sin horarios no alcanza con no mostrar nada: hay que decir por qué,
             porque la salida es distinta en cada caso. Si no atiende ese día se
             cambia el día; si está lleno, se carga fuera de horario o se busca
             otra profesional. */
          <p className="rounded-sm border border-border bg-secondary/40 p-2.5 text-xs leading-relaxed text-muted-foreground">
            {franjas.length === 0
              ? "No hay horarios para ofrecer: esta profesional no atiende ese día. Probá otro día, otra profesional, o cargalo fuera de horario."
              : "No queda lugar ese día: los horarios están tomados o ya pasaron."}
          </p>
        )}

        {/* La puerta de atrás, explícita y con nombre. */}
        <button
          type="button"
          onClick={() => {
            const next = !manual;
            onManual(next);
            // Al cerrarla se borra la hora escrita a mano, salvo que coincida
            // con una de la lista: si no, quedaba un 22:00 invisible y el botón
            // de guardar seguía habilitado.
            if (!next && !libres.some((iso) => toTimeInput(iso) === time)) onTime("");
          }}
          className="text-xs text-muted-foreground underline underline-offset-2 transition-colors hover:text-foreground"
        >
          {manual ? "Volver a los horarios de la lista" : "Cargar fuera de horario"}
        </button>

        {manual && (
          <div className="space-y-2 rounded-sm border border-border bg-secondary/30 p-3">
            <Label htmlFor={`${idPrefijo}-time`}>Hora a mano</Label>
            <Input
              id={`${idPrefijo}-time`}
              type="time"
              value={time}
              onChange={(e) => onTime(e.target.value)}
            />
            <p className="text-xs leading-relaxed text-muted-foreground">
              Para cuando la profesional le hace un lugar a alguien fuera de su horario. Dos turnos
              encimados los sigue rechazando la base.
            </p>

            {/* Aviso, no bloqueo: el trigger exime al centro del control de
                agenda a propósito. */}
            {time && fueraDeHorario && (
              <p className="flex items-start gap-2 rounded-sm border border-gold/50 bg-gold/10 p-2.5 text-xs text-foreground">
                <Clock className="mt-0.5 h-3.5 w-3.5 shrink-0 text-gold" />
                Ese horario queda fuera de la agenda habitual de la profesional. Se puede cargar
                igual.
              </p>
            )}
          </div>
        )}
      </div>
    </>
  );
}
