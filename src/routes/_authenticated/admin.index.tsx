import { useEffect, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { ArrowUpRight, ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { api } from "@/lib/api";
import type { RtaCalendario } from "@/lib/api-tipos";
// `toStatus` se usaba cuando el botón enlazaba a la lista y había que elegirle
// la pestaña. Ahora va derecho a la ficha del turno, que no necesita el estado.
// import { formatTime, STATUS_LABEL, toStatus, WEEKDAYS } from "@/lib/shiraf";
import { formatTime, STATUS_LABEL, WEEKDAYS } from "@/lib/shiraf";

export const Route = createFileRoute("/_authenticated/admin/")({
  component: AdminCalendar,
});

/**
 * El color de un turno en la grilla.
 *
 * Son DOS cosas cruzadas, no una: el estado que le puso el panel y si la hora
 * del turno ya pasó. Un pendiente de la semana que viene es agenda por delante;
 * el mismo pendiente del martes pasado es un turno que ya se vivió y que nadie
 * cerró. Son situaciones opuestas con el mismo `status`, así que lo vencido se
 * decide ANTES que el estado y se lleva el rojizo: es lo único del calendario
 * que pide que alguien vaya a hacer algo.
 *
 * Antes esto era un ternario anidado acá abajo con sólo tres ramas —cancelado,
 * confirmado y "todo lo demás"—. El problema era ese "todo lo demás": los cuatro
 * estados de la base incluyen `completed`, que caía ahí y salía pintado igual
 * que un pendiente. Un turno ya cerrado se veía idéntico a uno que nadie tocó.
 *
 * `now` llega en null mientras no hidrató (ver abajo); sin reloj no se puede
 * saber qué venció, así que en ese rato los turnos se pintan por estado nomás.
 */
function appointmentTone(status: string, startsAt: string, now: number | null) {
  if (status === "cancelled") return "bg-muted text-muted-foreground line-through";

  // Realizado: mismo oliva que confirmado, pero con la barra sólida al costado y
  // el texto apagado. Se distingue del confirmado sin sumar un color nuevo a una
  // paleta que ya tiene cuatro, y se lee como lo que es: archivo, nada por hacer.
  if (status === "completed")
    return "border-l-2 border-primary bg-primary/10 text-muted-foreground";

  // Pendiente o confirmado con la hora ya pasada.
  if (now !== null && new Date(startsAt).getTime() < now)
    return "bg-destructive/12 text-foreground";

  if (status === "confirmed") return "bg-primary/10 text-foreground";
  return "bg-gold/15 text-foreground";
}

function AdminCalendar() {
  const [cursor, setCursor] = useState(() => {
    const d = new Date();
    d.setDate(1);
    d.setHours(0, 0, 0, 0);
    return d;
  });

  /**
   * El reloj, recién después de hidratar.
   *
   * No se puede leer durante el render del servidor: ahí la fecha se arma en la
   * zona horaria del servidor, que es UTC, y a las 23:35 de Argentina allá ya es
   * el día siguiente. El HTML llegaría con el círculo de "hoy" corrido un día y
   * saltando al hidratar. En null hasta que monta, y de ahí sale tanto qué día
   * se remarca como dónde está el corte de lo vencido.
   */
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => setNow(Date.now()), []);

  const monthStart = cursor;
  const monthEnd = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1);

  // El número de hoy, pero sólo si el mes que se está mirando es el corriente:
  // navegando a septiembre no tiene que quedar un 19 remarcado.
  const today = now === null ? null : new Date(now);
  const todayDay =
    today && today.getFullYear() === cursor.getFullYear() && today.getMonth() === cursor.getMonth()
      ? today.getDate()
      : null;

  const appointments = useQuery({
    queryKey: ["admin-calendar", monthStart.toISOString()],
    queryFn: async () =>
      (
        await api<RtaCalendario>(
          `/api/turnos/calendario?desde=${monthStart.toISOString()}&hasta=${monthEnd.toISOString()}`,
        )
      ).turnos,
  });

  const firstWeekday = monthStart.getDay();
  const daysInMonth = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 0).getDate();
  const cells: (number | null)[] = [
    ...Array.from({ length: firstWeekday }, () => null),
    ...Array.from({ length: daysInMonth }, (_, i) => i + 1),
  ];

  const byDay = (appointments.data ?? []).reduce<
    Record<number, NonNullable<typeof appointments.data>>
  >((acc, a) => {
    const day = new Date(a.starts_at).getDate();
    acc[day] = [...(acc[day] ?? []), a];
    return acc;
  }, {});

  return (
    <div>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-eyebrow text-muted-foreground">Agenda del mes</p>
          <h1 className="mt-3 font-display text-4xl text-foreground">
            {cursor.toLocaleDateString("es-AR", { month: "long", year: "numeric" })}
          </h1>
        </div>
        <div className="flex gap-2">
          <Button
            size="icon"
            variant="outline"
            onClick={() => setCursor(new Date(cursor.getFullYear(), cursor.getMonth() - 1, 1))}
          >
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <Button
            size="icon"
            variant="outline"
            onClick={() => setCursor(new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1))}
          >
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
      </div>

      <div className="mt-8 grid grid-cols-7 gap-px overflow-hidden rounded-sm border border-border bg-border">
        {WEEKDAYS.map((w) => (
          <div
            key={w}
            className="bg-secondary px-2 py-2 text-center text-[11px] tracking-[0.12em] uppercase text-muted-foreground"
          >
            {w.slice(0, 3)}
          </div>
        ))}
        {cells.map((day, i) => (
          <div
            key={i}
            className={`min-h-28 p-2 ${day === todayDay ? "bg-gold-soft/20" : "bg-card"}`}
          >
            {day && (
              <>
                {/* El día de hoy va marcado en la CELDA y no en cada turno: "hoy"
                    es una propiedad del día, y los turnos ya cargan su color de
                    estado. Ponerles encima una segunda señal deja dos cosas
                    distintas peleando por el mismo recuadro. */}
                {day === todayDay ? (
                  <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-primary text-[11px] font-medium text-primary-foreground">
                    {day}
                  </span>
                ) : (
                  <span className="text-xs text-muted-foreground">{day}</span>
                )}
                {/* Cada turno es el enlace a su ficha, y no un botoncito
                    aparte adentro del recuadro: el recuadro entero mide dos
                    renglones de 11px, así que un botón propio quedaría del
                    tamaño de una uña y le robaría el lugar al nombre del
                    tratamiento. Toda la pastilla es el botón —que es lo que la
                    persona ya intentaba apretar— y la flechita de la esquina
                    está para avisar que se puede.

                    Lleva a la ficha del turno: los datos de la clienta, el
                    tratamiento, el valor y los botones de confirmar, cancelar y
                    avisar. Al principio esto enlazaba a la LISTA con la fila
                    resaltada; la ficha es lo que pedía el TODO y es mejor para
                    lo que se hace acá — mirar un turno puntual, no revisar la
                    tanda del día. La vuelta de la ficha sigue llevando a la
                    lista con su pestaña y su fila marcada. */}
                <div className="mt-1 space-y-1">
                  {(byDay[day] ?? []).map((a) => (
                    <Link
                      key={a.id}
                      to="/admin/turnos/$id"
                      params={{ id: a.id }}
                      title="Ver el turno con sus detalles"
                      className={`group block rounded-sm px-1.5 py-1 text-[11px] leading-tight transition-shadow hover:ring-1 hover:ring-primary/40 ${appointmentTone(
                        a.status,
                        a.starts_at,
                        now,
                      )}`}
                    >
                      <span className="flex items-start justify-between gap-1">
                        <span className="min-w-0">
                          <span className="font-medium">{formatTime(a.starts_at)}</span>{" "}
                          {a.services?.name}
                          {/* Sin profesional, la línea quedaba VACÍA: el turno
                              se veía igual que cualquier otro y no había forma
                              de notar que le falta quién lo atienda.

                              Y con una profesional desactivada era peor: mostraba
                              su nombre como si nada, cuando esa persona ya no
                              viene. Los dos casos van en rojo, porque los dos
                              son el mismo trabajo pendiente. */}
                          {a.professionals && a.professionals.is_active ? (
                            <span className="block text-muted-foreground">
                              {a.professionals.full_name}
                            </span>
                          ) : (
                            <span className="block font-semibold text-destructive">
                              ⚠ {a.professionals ? "Ya no atiende" : "Sin asignar"}
                            </span>
                          )}
                        </span>
                        {/* El botón, dibujado y no insinuado. Antes era la
                            flecha suelta al 40% de opacidad que se encendía al
                            pasar el mouse: sobre una pastilla de color ya de por
                            sí clarita no se veía, y un botón que hay que
                            descubrir pasando el mouse por encima no es un botón.
                            Con recuadro, fondo propio y sombra se lee como algo
                            apretable estando quieto, que es cuando se lo busca. */}
                        <span
                          aria-hidden
                          className="mt-px inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-sm border border-foreground/25 bg-background/80 text-foreground shadow-sm transition-colors group-hover:border-primary group-hover:bg-primary group-hover:text-primary-foreground"
                        >
                          <ArrowUpRight className="h-3 w-3" />
                        </span>
                      </span>
                    </Link>
                  ))}
                </div>
              </>
            )}
          </div>
        ))}
      </div>

      {/* La leyenda tenía tres entradas para cuatro estados: faltaba "Realizado",
          que hasta ahora no se pintaba distinto. Van las cuatro más "Vencido",
          que no es un estado de la base sino el cruce de pendiente/confirmado
          con la hora ya pasada — por eso es la única sin STATUS_LABEL. */}
      <div className="mt-6 flex flex-wrap gap-x-4 gap-y-2 text-xs text-muted-foreground">
        <span className="flex items-center gap-2">
          <span className="h-3 w-3 rounded-sm bg-gold/40" /> {STATUS_LABEL["pending"]}
        </span>
        <span className="flex items-center gap-2">
          <span className="h-3 w-3 rounded-sm bg-primary/25" /> {STATUS_LABEL["confirmed"]}
        </span>
        <span className="flex items-center gap-2">
          <span className="h-3 w-3 rounded-sm border-l-2 border-primary bg-primary/25" />{" "}
          {STATUS_LABEL["completed"]}
        </span>
        <span className="flex items-center gap-2">
          <span className="h-3 w-3 rounded-sm bg-destructive/30" /> Vencido sin cerrar
        </span>
        <span className="flex items-center gap-2">
          <span className="h-3 w-3 rounded-sm bg-muted" /> {STATUS_LABEL["cancelled"]}
        </span>
      </div>
    </div>
  );
}
