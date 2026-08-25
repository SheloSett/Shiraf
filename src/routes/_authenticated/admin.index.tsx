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
import { estadoVisible, formatTime, quienAtiende, STATUS_LABEL, WEEKDAYS } from "@/lib/shiraf";

export const Route = createFileRoute("/_authenticated/admin/")({
  component: AdminCalendar,
});

/**
 * El color de un turno en la grilla.
 *
 * QUÉ estado tiene un turno lo decide `estadoVisible` en lib/shiraf.ts —ahí
 * vive la regla de qué cuenta como vencido, y vive en un solo lugar para que la
 * grilla, la lista de Turnos y la ficha no puedan discrepar sobre el mismo
 * turno—. Acá quedó sólo lo que es propio del calendario: qué color le toca.
 *
 * Antes esto era un ternario anidado acá abajo con sólo tres ramas —cancelado,
 * confirmado y "todo lo demás"—. El problema era ese "todo lo demás": los cuatro
 * estados de la base incluyen `completed`, que caía ahí y salía pintado igual
 * que un pendiente. Un turno ya cerrado se veía idéntico a uno que nadie tocó.
 *
 * `now` llega en null mientras no hidrató (ver abajo); sin reloj no se puede
 * saber qué venció, así que en ese rato los turnos se pintan por estado nomás.
 */
type Tono = {
  /** El fondo y el color del texto principal de la pastilla. */
  pastilla: string;
  /** La línea de la profesional, que va un escalón por debajo. */
  secundario: string;
  /** El «⚠ Sin asignar» / «⚠ Ya no atiende». */
  aviso: string;
};

// Lo que vale para cuatro de los cinco estados. El realizado es el que se
// aparta, porque es el único con el fondo cargado.
const SECUNDARIO = "text-muted-foreground";
const AVISO = "text-destructive";

function appointmentTone(status: string, startsAt: string, now: number | null): Tono {
  switch (estadoVisible(status, startsAt, now)) {
    case "cancelled":
      return {
        pastilla: "bg-muted text-muted-foreground line-through",
        secundario: SECUNDARIO,
        aviso: AVISO,
      };

    // Realizado: el mismo oliva que el confirmado, pero MUCHO más cargado.
    //
    // Antes era el tinte del confirmado —el mismo /10— con una barra de 2px al
    // costado, y en una pastilla de 11px eso no alcanzaba: dos estados opuestos se
    // veían del mismo color y había que apuntar el ojo al borde izquierdo para
    // saber cuál era cuál. El salto de /10 a /35 corre el fondo de casi blanco
    // (L≈0.93) a un oliva medio (L≈0.78), y como las otras cuatro pastillas viven
    // todas entre 0.93 y 0.96, el realizado queda siendo el ÚNICO tono medio de la
    // grilla: se lo ubica de un vistazo, y sin sumarle un quinto color a la paleta.
    //
    // El texto vuelve a `foreground`. Sobre este fondo el gris apagado quedaba en
    // 2.4:1 y dejaba de leerse; el problema que resolvía —que el realizado no grite
    // al lado de lo que sí pide acción— ya lo resuelve el fondo, que no es rojo ni
    // dorado. La barra al costado se va: era el único diferenciador, y ahora sobra.
    //
    // Y por eso la función devuelve los tres colores juntos y no sólo el fondo:
    // sobre /35 el gris de `muted-foreground` cae a 3.65:1 y el mínimo AA para
    // texto chico es 4.5:1. Se midió, no se estimó. La línea de la profesional
    // pasa entonces a `foreground` (9.66:1) y la jerarquía la sigue marcando el
    // peso: el nombre de la clienta es el único en semibold.
    //
    // El aviso rojo se queda en 3.57:1 y es una decisión, no un olvido. Bajar el
    // fondo hasta que el rojo pase pediría /13, que es no cambiar nada. Y en un
    // turno REALIZADO ese aviso no pide hacer nada —la profesional ya no atiende,
    // pero el turno ya pasó—, así que sí corresponde que grite menos que en uno
    // por venir, donde el fondo es claro y el rojo llega a 4.73:1. Sigue en
    // negrita y con el ⚠ adelante, y queda por encima del umbral de 3:1.
    case "completed":
      return {
        pastilla: "bg-primary/35 text-foreground",
        secundario: "text-foreground",
        aviso: AVISO,
      };

    // Lo único de la grilla que pide que alguien vaya a hacer algo.
    case "overdue":
      return {
        pastilla: "bg-destructive/12 text-foreground",
        secundario: SECUNDARIO,
        aviso: AVISO,
      };

    case "confirmed":
      return { pastilla: "bg-primary/10 text-foreground", secundario: SECUNDARIO, aviso: AVISO };

    case "pending":
      return { pastilla: "bg-gold/15 text-foreground", secundario: SECUNDARIO, aviso: AVISO };
  }
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
          // El día de hoy se marca con un ARO dorado, no con un fondo.
          //
          // El fondo era `bg-gold-soft/20`, y ahí había dos cosas mal cruzadas.
          // Una: las celdas se apoyan sobre el contenedor de la grilla, que es
          // `bg-border` para dibujar las líneas con `gap-px` — así que ese 20%
          // no se mezclaba con el crema de la celda sino con el gris de las
          // líneas. La otra: `gold-soft` (L 0.87) y `border` (L 0.89) están casi
          // a la misma altura, así que la mezcla daba L≈0.886. Es decir, el gris
          // exacto del hueco que queda después del 31. Hoy y "esto ni es del mes"
          // no se parecían: eran el mismo color.
          //
          // Un aro no depende de con qué se mezcla ni de si el valor coincide con
          // algo: se ve por contorno. Y deja la celda en `bg-card` como todas,
          // que en el día de hoy es justo la que suele tener más turnos adentro.
          <div
            key={i}
            className={`min-h-28 bg-card p-2 ${day === todayDay ? "ring-2 ring-inset ring-gold" : ""}`}
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
                  {(byDay[day] ?? []).map((a) => {
                    const tono = appointmentTone(a.status, a.starts_at, now);
                    return (
                      <Link
                        key={a.id}
                        to="/admin/turnos/$id"
                        params={{ id: a.id }}
                        title="Ver el turno con sus detalles"
                        className={`group block rounded-sm px-1.5 py-1 text-[11px] leading-tight transition-shadow hover:ring-1 hover:ring-primary/40 ${tono.pastilla}`}
                      >
                        <span className="flex items-start justify-between gap-1">
                          <span className="min-w-0">
                            {/* Tres líneas, en el orden en que se las busca:
                              QUIÉN viene, a qué, y con quién.

                              La clienta arriba y en negrita porque es el dato
                              por el que se mira un calendario — "¿quién viene el
                              martes?"—, y antes no estaba: la celda mostraba
                              hora, tratamiento y profesional, y para saber de
                              quién era el turno había que abrirlo. */}
                            <span className="block truncate font-semibold">
                              {formatTime(a.starts_at)} · {a.person.name}
                            </span>
                            <span className="block truncate">{a.services.name}</span>
                            {/* Sin profesional, la línea quedaba VACÍA: el turno
                              se veía igual que cualquier otro y no había forma
                              de notar que le falta quién lo atienda.

                              Y con una profesional desactivada era peor: mostraba
                              su nombre como si nada, cuando esa persona ya no
                              viene. Los dos casos van en rojo, porque los dos
                              son el mismo trabajo pendiente. */}
                            {(() => {
                              const q = quienAtiende(
                                a.professionals,
                                a.professional_name,
                                a.status,
                                a.starts_at,
                                now,
                              );

                              // El ⚠ rojo queda sólo donde todavía sirve. Sobre
                              // la pastilla de un turno que ya pasó era ruido:
                              // gritaba por algo que no se puede resolver bien.
                              if (q.caso === "asignada" || q.caso === "historica") {
                                return (
                                  <span className={`block truncate ${tono.secundario}`}>
                                    {q.nombre}
                                  </span>
                                );
                              }
                              if (!q.seArregla) {
                                return (
                                  <span className={`block truncate ${tono.secundario}`}>
                                    {q.caso === "desactivada" ? q.nombre : "Sin registrar"}
                                  </span>
                                );
                              }
                              return (
                                <span className={`block truncate font-semibold ${tono.aviso}`}>
                                  ⚠ {q.caso === "desactivada" ? "Ya no atiende" : "Sin asignar"}
                                </span>
                              );
                            })()}
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
                    );
                  })}
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
          {/* Los cuadraditos van más cargados que la pastilla que representan
              —el confirmado es /10 en la grilla y /25 acá— porque 12px de color
              se leen más flojos que una pastilla entera. El realizado sigue esa
              misma cuenta y va a /70: lo que importa es que el salto contra el
              confirmado se note igual acá abajo que arriba. */}
          <span className="h-3 w-3 rounded-sm bg-primary/70" /> {STATUS_LABEL["completed"]}
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
