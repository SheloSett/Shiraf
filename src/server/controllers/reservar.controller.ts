import { prisma } from "@/server/db";
import { json, type Ctx } from "@/server/http";
import { ausenciasDe, horariosOcupados } from "@/server/services/agenda.service";
import { accesoDe } from "@/server/services/authz.service";
import { validarTurno } from "@/server/services/turnos.service";
import { comoFecha, comoHora } from "@/server/serializar";
import type { RtaDisponibilidad } from "@/lib/api-tipos";

/**
 * Reservar un turno. Sólo hace falta sesión: es la pantalla de la clienta.
 */

/**
 * Los horarios de la profesional y los ratos que ya tiene ocupados.
 *
 * ── 🔴 LO QUE SE DEVUELVE DE LOS TURNOS AJENOS ES SÓLO CUÁNDO Y CUÁNTO ────
 *
 * Y eso es toda la regla. En Supabase esto no se podía consultar derecho: la
 * policy `read appointments` sólo deja ver los propios, así que leer la tabla
 * devolvía los horarios de las demás clientas **como libres**. Por eso existía
 * la función `professional_busy_slots`, con SECURITY DEFINER, que devolvía nada
 * más que inicio y duración.
 *
 * Acá pasa lo mismo pero al revés: sin RLS, la consulta traería todo. **El
 * recorte es este `select`**, y por eso el endpoint devuelve
 * `{ starts_at, duration_minutes }` y nunca la fila. Quién reservó, qué
 * tratamiento y con qué nota no son asunto de quien está eligiendo horario.
 *
 * Está garantizado por `horariosOcupados()`, que ya devuelve sólo esos campos:
 * **no lo cambies para que devuelva el turno entero.** El `buffer_minutes` que
 * se sumó el 31/8/2026 entra en la misma promesa: es cuánto tarda la cabina en
 * quedar libre, no algo de la clienta que la ocupó.
 *
 * Las AUSENCIAS salen igual de acotadas: de tal día a tal día, sin el motivo.
 * Por qué la profesional no viene es asunto interno del centro y se queda en
 * `equipo.controller`.
 */
export async function disponibilidad(ctx: Ctx) {
  const profesionalId = ctx.url.searchParams.get("profesional");
  const fecha = ctx.url.searchParams.get("fecha");
  if (!profesionalId || !fecha) return json({ error: "Falta la profesional o la fecha." }, 400);

  /**
   * El turno que se está moviendo, para que no se cuente a sí mismo. Lo manda
   * el diálogo de reprogramar; al reservar de cero no viene.
   *
   * No se valida de quién es, y no hace falta — mirar el 🔴 de arriba, que
   * dice qué se devuelve: `{ starts_at, duration_minutes }` y nada más.
   * Mandar un id ajeno no revela nada nuevo, sólo ESCONDE un rato ocupado; y
   * quien se esconda un horario ocupado lo único que consigue es que la
   * reserva le rebote con el 409 del trigger, que es la única autoridad sobre
   * el solape. Pedir sesión para esto sería pedirla para nada.
   */
  const excluir = ctx.url.searchParams.get("excluir");

  const desde = new Date(fecha);
  if (Number.isNaN(desde.getTime())) return json({ error: "Esa fecha no se entiende." }, 400);
  desde.setHours(0, 0, 0, 0);
  const hasta = new Date(desde);
  hasta.setDate(hasta.getDate() + 1);

  /**
   * Hasta qué día traer las AUSENCIAS. Sólo las ausencias.
   *
   * El calendario del panel pinta un mes entero y necesita saber qué días la
   * profesional no viene, no sólo el del día elegido: sin esto, una semana de
   * vacaciones se mostraría como disponible hasta que alguien hiciera clic.
   *
   * ── LOS TURNOS OCUPADOS NO SE ENSANCHAN ──────────────────────────────────
   *
   * `hasta` sigue siendo el día siguiente para `horariosOcupados`. Lo que sale
   * de ahí son los ratos ocupados de la agenda —anónimos, pero ratos ocupados— y
   * no hay motivo para entregar un mes de eso cuando lo que se está armando son
   * los horarios de UN día. Las ausencias son otra cosa: es "no vengo", que el
   * sitio ya publica de mil maneras.
   *
   * El tope de 62 días es para que el parámetro no se convierta en un
   * exportador: dos meses es lo máximo que un calendario muestra de una.
   */
  const TOPE_DE_DIAS = 62;
  const crudoHasta = ctx.url.searchParams.get("hasta");
  const finDeAusencias = crudoHasta ? new Date(crudoHasta) : null;
  const hastaAusencias =
    finDeAusencias && !Number.isNaN(finDeAusencias.getTime()) && finDeAusencias > desde
      ? new Date(
          Math.min(finDeAusencias.getTime(), desde.getTime() + TOPE_DE_DIAS * 24 * 60 * 60 * 1000),
        )
      : hasta;

  const [horarios, ocupados, ausencias] = await Promise.all([
    prisma.professional_schedules.findMany({
      where: { professional_id: profesionalId },
      select: { weekday: true, start_time: true, end_time: true },
      orderBy: [{ weekday: "asc" }, { start_time: "asc" }],
    }),
    horariosOcupados(profesionalId, desde, hasta, excluir ?? undefined),
    ausenciasDe(profesionalId, desde, hastaAusencias),
  ]);

  return json({
    schedules: horarios.map((h) => ({
      weekday: h.weekday,
      start_time: comoHora(h.start_time),
      end_time: comoHora(h.end_time),
    })),
    busy: ocupados.map((o) => ({
      starts_at: o.empiezaEn.toISOString(),
      duration_minutes: o.minutos,
      buffer_minutes: o.margen,
    })),
    ausencias: ausencias.map((a) => ({
      starts_on: comoFecha(a.empiezaEl),
      ends_on: comoFecha(a.terminaEl),
    })),
  } satisfies RtaDisponibilidad);
}

/**
 * Reservar.
 *
 * Tres cosas que no las decide quien reserva:
 *
 * 1. **`client_id` sale de la sesión.** Es la traducción de `auth.uid()`: si
 *    viniera en el cuerpo, cualquiera reservaría a nombre de otra.
 * 2. **El precio y la duración los fija `validarTurno()`**, que los lee del
 *    tratamiento. El precio queda congelado al día de la reserva, que es el
 *    sentido de que la columna exista. En Supabase esto lo hacía el trigger
 *    `validate_appointment`.
 * 3. **El solape lo sigue frenando la base**, con `check_appointment_overlap`.
 *    No se chequea acá a propósito: "fijate si está libre" y después "insertá"
 *    son dos operaciones, y entre una y otra entra otra reserva. Es la razón
 *    por la que ese trigger se quedó en SQL — ver la Fase 3 del plan.
 */
export async function reservar(ctx: Ctx) {
  const serviceId = ctx.body["service_id"];
  const profesionalId = ctx.body["professional_id"];
  const cuando = ctx.body["starts_at"];
  const nota = typeof ctx.body["client_notes"] === "string" ? ctx.body["client_notes"].trim() : "";

  if (typeof serviceId !== "string" || typeof cuando !== "string") {
    return json({ error: "Faltan datos del turno." }, 400);
  }
  const starts_at = new Date(cuando);
  if (Number.isNaN(starts_at.getTime())) return json({ error: "Ese horario no se entiende." }, 400);

  /*
   * Qué opción del tratamiento se eligió, cuando el tratamiento tiene.
   *
   * Viaja el ID y NUNCA el precio ni la duración: los busca `validarTurno` en
   * la base, por lo mismo que ya hacía con los del tratamiento. Ver el punto 2
   * de arriba, que ahora vale para las dos cosas.
   */
  const variantId = typeof ctx.body["variant_id"] === "string" ? ctx.body["variant_id"] : null;

  const validado = await validarTurno(await accesoDe(ctx.user!.id), {
    service_id: serviceId,
    variant_id: variantId,
    professional_id: typeof profesionalId === "string" ? profesionalId : null,
    starts_at,
  });

  const creado = await prisma.appointments.create({
    data: {
      client_id: ctx.user!.id,
      service_id: serviceId,
      variant_id: variantId,
      professional_id: typeof profesionalId === "string" ? profesionalId : null,
      starts_at,
      client_notes: nota || null,
      ...validado,
    },
    select: { id: true },
  });

  return json({ id: creado.id });
}
