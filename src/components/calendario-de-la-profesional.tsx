import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { es } from "date-fns/locale";
import { Calendar } from "@/components/ui/calendar";
import { api } from "@/lib/api";
import type { RtaDisponibilidad } from "@/lib/api-tipos";
import { parseDateKey } from "@/lib/horarios";
import { toDateKey } from "@/lib/shiraf";

/**
 * El calendario que sabe qué días viene la profesional.
 *
 * ── POR QUÉ NO EL `<input type="date">` DEL NAVEGADOR ────────────────────────
 *
 * Porque no sabe nada de Shiraf. Mostraba los domingos, las semanas de
 * vacaciones y los días que la profesional no trabaja exactamente igual que un
 * martes libre: se elegía a ciegas y el "no hay horarios" aparecía después, ya
 * con el día puesto. Además es otro widget en cada sistema operativo y no se
 * puede pintar, así que en medio de la ficha se leía como un pedazo de otra app.
 *
 * Acá los días que atiende salen resaltados en dorado y el resto queda
 * deshabilitado: los que no trabaja, los de ausencia y los que ya pasaron.
 *
 * ── LO QUE «RESALTADO» NO QUIERE DECIR ──────────────────────────────────────
 *
 * No quiere decir que haya lugar: un día que atiende puede estar completo, y eso
 * recién se sabe al elegirlo. Saberlo de antemano pediría calcular los huecos de
 * los treinta días, y `/api/reservar/disponibilidad` entrega los ratos ocupados
 * de UN día a propósito — un mes de eso es la agenda de la profesional publicada
 * entera.
 *
 * Lo usan las tres pantallas del panel (a través de `SelectorDeHorario`) y el
 * diálogo con el que la clienta se mueve su propio turno. Es el mismo dato en
 * los cuatro lados y por eso vive en un solo lugar.
 */
export function CalendarioDeLaProfesional({
  profesionalId,
  dateKey,
  onDateKey,
  noAntesDe,
  motivoDelPiso,
}: {
  /** De quién es la agenda. Sin esto no hay nada que consultar. */
  profesionalId: string | undefined;
  /** "AAAA-MM-DD" del día elegido, o "" si todavía no eligió ninguno. */
  dateKey: string;
  onDateKey: (next: string) => void;
  /**
   * El día más temprano que se puede elegir, si hay uno.
   *
   * Lo usa la sesión siguiente de un tratamiento de varias: el intervalo que
   * carga el centro —"cada 21 días"— es un mínimo, y adelantarlo es justo lo que
   * no hay que poder hacer sin querer.
   */
  noAntesDe?: Date;
  /** Qué decir sobre los días grises de antes del piso. */
  motivoDelPiso?: string;
}) {
  /**
   * El mes que se está mirando.
   *
   * Arranca en el del día elegido y cambia con las flechas: si alguien avanza a
   * octubre, las vacaciones de octubre tienen que aparecer grises sin tener que
   * hacer clic en un día para enterarse.
   */
  const [mes, setMes] = useState<Date>(() => parseDateKey(dateKey) ?? new Date());

  /*
   * Si el día elegido cae en otro mes, el calendario va ahí.
   *
   * Hace falta porque quien nos usa puede escribir `dateKey` DESPUÉS de que este
   * componente se montó —el diálogo de la sesión siguiente lo hace en un efecto,
   * al abrirse— y el `useState` de arriba ya corrió con el valor viejo. Sin
   * esto, una fecha sugerida en octubre abría el calendario en septiembre, con
   * el día elegido fuera de la vista.
   */
  useEffect(() => {
    const elegido = parseDateKey(dateKey);
    if (!elegido) return;
    if (elegido.getFullYear() !== mes.getFullYear() || elegido.getMonth() !== mes.getMonth()) {
      setMes(elegido);
    }
    // `mes` a propósito fuera de las dependencias: adentro sólo se lee para
    // comparar, y ponerlo haría que este efecto se dispare al mover el
    // calendario con las flechas — y lo devolvería al mes del día elegido.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dateKey]);

  const delMes = useQuery({
    queryKey: ["disponibilidad-mes", profesionalId, mes.getFullYear(), mes.getMonth()],
    enabled: !!profesionalId,
    // El mismo endpoint que arma los horarios, con `hasta`: devuelve los
    // horarios semanales (que no dependen del día) y las ausencias de todo el
    // mes. Los ratos ocupados que trae son sólo los del primer día y acá no se
    // usan — los del día elegido los pide quien muestra las horas.
    queryFn: async () => {
      const primero = new Date(mes.getFullYear(), mes.getMonth(), 1);
      const ultimo = new Date(mes.getFullYear(), mes.getMonth() + 1, 0);
      return api<RtaDisponibilidad>(
        `/api/reservar/disponibilidad?profesional=${profesionalId}&fecha=${primero.toISOString()}&hasta=${ultimo.toISOString()}`,
      );
    },
  });

  /** Qué días de la semana atiende: 0 domingo … 6 sábado. */
  const diasQueAtiende = useMemo(
    () => new Set((delMes.data?.schedules ?? []).map((h) => h.weekday)),
    [delMes.data],
  );

  /**
   * Un día cae dentro de una ausencia.
   *
   * Las ausencias vienen como "AAAA-MM-DD" con los dos extremos incluidos, así
   * que se comparan como texto: ordena igual que como fecha y no arrastra
   * ninguna zona horaria. Es el mismo criterio que usa `buildSlots`.
   */
  const estaDeAusencia = useMemo(() => {
    const tramos = delMes.data?.ausencias ?? [];
    return (dia: Date) => {
      const clave = toDateKey(dia);
      return tramos.some((a) => clave >= a.starts_on && clave <= a.ends_on);
    };
  }, [delMes.data]);

  /** Hoy a medianoche, o el piso si es posterior: de ahí para adelante se elige. */
  const desdeCuando = useMemo(() => {
    const hoy = new Date();
    hoy.setHours(0, 0, 0, 0);
    return noAntesDe && noAntesDe > hoy ? noAntesDe : hoy;
  }, [noAntesDe]);

  return (
    <div className="space-y-2">
      <Calendar
        mode="single"
        locale={es}
        month={mes}
        onMonthChange={setMes}
        selected={parseDateKey(dateKey)}
        onSelect={(dia) => dia && onDateKey(toDateKey(dia))}
        disabled={[
          { before: desdeCuando },
          // `size > 0`: mientras la consulta no volvió no se sabe qué días
          // atiende, y deshabilitar todo haría parpadear el calendario entero.
          (dia: Date) => diasQueAtiende.size > 0 && !diasQueAtiende.has(dia.getDay()),
          estaDeAusencia,
        ]}
        modifiers={{
          atiende: (dia: Date) =>
            dia >= desdeCuando && diasQueAtiende.has(dia.getDay()) && !estaDeAusencia(dia),
        }}
        modifiersClassNames={{
          // Dorado suave y en negrita: se lee como "acá sí" sin competir con el
          // día elegido, que es el único con fondo lleno.
          atiende: "bg-gold/15 font-semibold text-foreground rounded-sm",
        }}
        className="w-full rounded-sm border border-border"
      />

      {motivoDelPiso && noAntesDe && noAntesDe > new Date() && (
        <p className="rounded-sm border border-gold/40 bg-gold/5 px-2.5 py-2 text-xs leading-relaxed text-foreground">
          {motivoDelPiso}
        </p>
      )}

      {delMes.isPending ? (
        <p className="text-xs text-muted-foreground">Buscando los días que atiende…</p>
      ) : diasQueAtiende.size === 0 ? (
        <p className="text-xs text-muted-foreground">
          Esta profesional no tiene horarios de atención cargados.
        </p>
      ) : (
        <p className="text-xs text-muted-foreground">
          En dorado, los días que atiende. Los grises no trabaja, está ausente o ya pasaron.
        </p>
      )}
    </div>
  );
}
