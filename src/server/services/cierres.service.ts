import { estaAusente } from "@/lib/shiraf";
import { prisma } from "@/server/db";
import { comoFecha } from "@/server/serializar";
import {
  enHoraDelCentro,
  hoyEnElCentro,
  nombreDelTratamiento,
} from "@/server/services/turnos.service";
import type { TurnoEnDiaCerrado } from "@/lib/api-tipos";

/**
 * Los días que el centro no abre. Ver `center_closures` en el esquema.
 *
 * ── QUÉ HAY ACÁ Y QUÉ NO ──────────────────────────────────────────────────
 *
 * Acá viven las LECTURAS: qué cierres tocan una ventana de días, cuáles siguen
 * vigentes y qué turnos quedaron adentro de cada uno. El CANDADO —que una
 * clienta no pueda reservar ni moverse un turno a un día cerrado— NO está acá:
 * es `exigirQueElCentroAbra`, en `turnos.service.ts`, al lado del de las
 * ausencias. Vive allá por lo mismo que aquél: es una regla de `validarTurno`,
 * y las reglas del turno se leen todas juntas o se pierde alguna.
 *
 * Este archivo importa de `turnos.service` y aquél NO importa de éste. No es
 * casualidad: si los dos se importaran mutuamente, el orden en que se cargan
 * decidiría cuál de los dos ve `undefined` en el arranque, y ese error aparece
 * lejos de acá y sólo a veces.
 */

const UN_DIA = 24 * 60 * 60 * 1000;

/** Un cierre en fechas del almanaque: la forma que entiende `estaAusente`. */
function comoTramo(c: { starts_on: Date; ends_on: Date }) {
  return { starts_on: comoFecha(c.starts_on), ends_on: comoFecha(c.ends_on) };
}

/**
 * Los cierres que tocan una ventana de días.
 *
 * Es el gemelo de `ausenciasDe` en `agenda.service`: la misma consulta de dos
 * rangos que se pisan —cada uno empieza antes de que termine el otro— y la
 * misma forma de salida. A propósito: `disponibilidad()` los mezcla en una sola
 * lista con las ausencias, porque para quien está eligiendo horario da lo mismo
 * POR QUÉ ese día no se atiende. Ver el comentario de `ausencias` en
 * `RtaDisponibilidad`.
 *
 * Sin chequeo de permiso, igual que `ausenciasDe`: la pantalla de reserva es
 * pública y tiene que poder saber qué días no ofrecer. Lo que sale es "de tal
 * día a tal día", nunca el motivo.
 */
export async function cierresDelCentro(
  desde: Date,
  hasta: Date,
): Promise<{ empiezaEl: Date; terminaEl: Date }[]> {
  const tramos = await prisma.center_closures.findMany({
    where: {
      starts_on: { lte: hasta },
      ends_on: { gte: desde },
    },
    select: { starts_on: true, ends_on: true },
    orderBy: { starts_on: "asc" },
  });

  return tramos.map((c) => ({ empiezaEl: c.starts_on, terminaEl: c.ends_on }));
}

/**
 * Los cierres que todavía tapan algo: los que terminan de hoy en adelante.
 *
 * Es el mismo corte que usa la lista de ausencias de cada ficha, y por el
 * mismo motivo: un cierre pasado no cambia qué se puede reservar y en la
 * pantalla sería ruido. Sigue en la base, nomás no se lista.
 */
export async function cierresVigentes() {
  return prisma.center_closures.findMany({
    where: { ends_on: { gte: hoyEnElCentro() } },
    select: { id: true, starts_on: true, ends_on: true, reason: true },
    orderBy: { starts_on: "asc" },
  });
}

/**
 * Los turnos que siguen en pie adentro de cada cierre.
 *
 * ── ESTO ES EL AVISO ──────────────────────────────────────────────────────
 *
 * Cerrar un día no cancela nada solo. Los turnos que ya estaban dados son
 * clientas con una confirmación por mail en la mano, y mandarles a todas una
 * cancelación de golpe no se puede deshacer (es la misma decisión que se tomó
 * el 31/8/2026 para las ausencias). Entonces el cierre entra, y estos turnos
 * quedan a la vista para reprogramarlos o cancelarlos uno por uno.
 *
 * Se devuelven agrupados por cierre —y no en una lista chata— porque la
 * pantalla los muestra debajo del cierre que los tapa: es lo que le dice a
 * quien mira "estos son por el feriado del 25, aquéllos por las vacaciones".
 *
 * ── SÓLO LOS QUE TODAVÍA VAN A PASAR ──────────────────────────────────────
 *
 * Un turno de un día cerrado que ya quedó atrás no es trabajo pendiente de
 * ESTA pantalla: si nadie lo cerró, es un vencido, y de ésos ya se ocupa el
 * resumen diario. Contarlo dos veces haría que el número rojo del menú no
 * bajara nunca aunque no quedara nada por resolver.
 *
 * ⚠️ El recorte por fecha es GRUESO y sobra un día de cada lado a propósito,
 * igual que en `turnosDentroDe` de equipo.controller: `starts_at` es un instante
 * y el cierre son días de Buenos Aires — en UTC, el turno de las 21:00 del 24
 * cae el 25. Quien decide de verdad es `estaAusente`, sobre la fecha de cada
 * turno ya pasada a hora del centro.
 */
export async function turnosEnDiasCerrados(
  cierres: { id: string; starts_on: Date; ends_on: Date }[],
): Promise<Map<string, TurnoEnDiaCerrado[]>> {
  const porCierre = new Map<string, TurnoEnDiaCerrado[]>(cierres.map((c) => [c.id, []]));
  if (cierres.length === 0) return porCierre;

  const candidatos = await prisma.appointments.findMany({
    where: {
      status: { in: ["pending", "confirmed"] },
      starts_at: { gte: new Date() },
      // Una ventana por cierre y no una sola de punta a punta: entre el
      // feriado de diciembre y las vacaciones de marzo hay dos meses de turnos
      // que no hace falta traer para descartarlos.
      OR: cierres.map((c) => ({
        starts_at: {
          gte: new Date(c.starts_on.getTime() - UN_DIA),
          lt: new Date(c.ends_on.getTime() + 2 * UN_DIA),
        },
      })),
    },
    select: {
      id: true,
      starts_at: true,
      status: true,
      guest_name: true,
      guest_phone: true,
      service_name: true,
      variant_name: true,
      service: { select: { name: true } },
      variant: { select: { name: true } },
      professional_name: true,
      professional: { select: { full_name: true } },
      client: { select: { profile: { select: { full_name: true, phone: true } } } },
    },
    orderBy: { starts_at: "asc" },
  });

  for (const t of candidatos) {
    const dia = enHoraDelCentro(t.starts_at).fecha;
    for (const c of cierres) {
      if (!estaAusente(dia, [comoTramo(c)])) continue;
      porCierre.get(c.id)?.push({
        id: t.id,
        starts_at: t.starts_at.toISOString(),
        status: t.status,
        // El mismo orden que en el resto del proyecto: primero la cuenta, y
        // si no hay, lo que el centro anotó a mano para la invitada.
        quien: t.client?.profile?.full_name ?? t.guest_name ?? "Sin nombre",
        telefono: t.client?.profile?.phone ?? t.guest_phone ?? null,
        tratamiento: nombreDelTratamiento(t),
        // Del catálogo si la ficha sigue, y si no el nombre congelado: es lo
        // que deja decir "con Camila" aunque Camila ya no esté en el equipo.
        profesional: t.professional?.full_name ?? t.professional_name ?? null,
      });
    }
  }

  return porCierre;
}

/**
 * Cuántos turnos distintos siguen en pie en días cerrados.
 *
 * Es el número rojo del menú, al lado de «Días cerrados». Distintos: dos
 * cierres que se pisen —las vacaciones y, adentro, el feriado— no pueden
 * contar el mismo turno dos veces.
 */
export async function cuantosTurnosEnDiasCerrados(): Promise<number> {
  const cierres = await cierresVigentes();
  if (cierres.length === 0) return 0;

  const porCierre = await turnosEnDiasCerrados(cierres);
  const ids = new Set<string>();
  for (const turnos of porCierre.values()) {
    for (const t of turnos) ids.add(t.id);
  }
  return ids.size;
}
