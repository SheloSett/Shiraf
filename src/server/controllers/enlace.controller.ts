import { prisma } from "@/server/db";
import { json, type Ctx } from "@/server/http";
import {
  cancelarTurnoDe,
  reprogramarTurnoDe,
  turnosPropios,
} from "@/server/controllers/clientas.controller";
import { telefonoDelEnlace, turnosDelTelefono } from "@/server/services/invitadas.service";
import {
  sacarLaSesionSiguiente,
  sesionAnterior,
  sesionesPendientes,
} from "@/server/services/series.service";
import { avisarSinEsperar } from "@/lib/notifications.server";
import type { RtaTurnosDelEnlace } from "@/lib/api-tipos";

/**
 * «Mis turnos» de quien reservó sin cuenta, detrás de su enlace personal
 * (5/10/2026).
 *
 * Es la mitad de abajo de clientas.controller —«Mi cuenta»— para alguien que no
 * tiene cuenta: ve sus turnos, los cambia, los cancela y saca la sesión que le
 * falta. Las reglas son las mismas y no están escritas de nuevo: cada handler
 * de acá resuelve DE QUIÉN son los turnos y le pasa eso a la misma función que
 * usa la clienta con cuenta.
 *
 * ── 🔴 EL TOKEN ES LA SESIÓN ──────────────────────────────────────────────
 *
 * Allá todo cuelga de `ctx.user.id`; acá, del token de la URL. Vale lo mismo y
 * hay que tratarlo igual: **ningún handler acepta un teléfono ni una lista de
 * turnos que venga del pedido.** El token dice qué teléfono es, el teléfono
 * dice qué turnos son, y un id de turno que no esté en esa lista contesta 404
 * como si no existiera.
 *
 * El token llega únicamente por WhatsApp al teléfono en cuestión, así que
 * tenerlo es la prueba de que ese teléfono es de quien lo abre. Por qué no
 * alcanza con escribir el número está en `guest_links`, en el esquema.
 *
 * ── LOS AVISOS SALEN DE ACÁ ───────────────────────────────────────────────
 *
 * En «Mi cuenta» los pide la pantalla, por `notifyAppointment`, que exige
 * sesión. Acá no hay: los dispara cada handler después de escribir. Ver
 * `avisarSinEsperar`.
 */

/**
 * De quién es este enlace: el filtro con sus turnos, o null si el token no
 * existe.
 *
 * Devuelve el `where` ya armado para que ningún handler tenga la tentación de
 * escribirlo a mano. `client_id: null` va además de los ids a propósito: si el
 * centro le pasó esos turnos a una cuenta, dejaron de ser de una invitada y por
 * este enlace no se tocan más — ahora están en «Mi cuenta», con su contraseña.
 */
async function deQuienEs(ctx: Ctx) {
  const telefono = await telefonoDelEnlace(ctx.params["token"] ?? "");
  if (!telefono) return null;

  const ids = await turnosDelTelefono(telefono);
  return { id: { in: ids }, client_id: null };
}

/** El mismo texto para todos: un enlace que no existe no dice nada más. */
const enlaceInvalido = () => json({ error: "Ese enlace no sirve." }, 404);

export async function verTurnos(ctx: Ctx) {
  const deQuien = await deQuienEs(ctx);
  if (!deQuien) return enlaceInvalido();

  const [turnos, pendientes, ultimo] = await Promise.all([
    turnosPropios(deQuien),
    sesionesPendientes(deQuien),
    // El nombre con que reservó la última vez. Es sólo para el saludo: el
    // mismo teléfono puede haber quedado anotado como "Lu", "Lucía" y "Lucía
    // Gómez", y el más nuevo es el que ella eligió último.
    prisma.appointments.findFirst({
      where: deQuien,
      orderBy: { created_at: "desc" },
      select: { guest_name: true },
    }),
  ]);

  return json({
    nombre: ultimo?.guest_name ?? null,
    turnos,
    pendientes,
  } satisfies RtaTurnosDelEnlace);
}

export async function cancelar(ctx: Ctx) {
  const deQuien = await deQuienEs(ctx);
  if (!deQuien) return enlaceInvalido();

  const respuesta = await cancelarTurnoDe(ctx, deQuien, null);

  // Al CENTRO, que es el que tiene que enterarse de que le quedó el hueco. A
  // ella no se le manda nada: lo acaba de hacer.
  if (respuesta.ok) avisarSinEsperar(ctx.params["id"]!, ["client-cancelled"]);
  return respuesta;
}

export async function reprogramar(ctx: Ctx) {
  const deQuien = await deQuienEs(ctx);
  if (!deQuien) return enlaceInvalido();

  const respuesta = await reprogramarTurnoDe(ctx, deQuien, null);

  // "client-rescheduled" y no "rescheduled": el segundo es el del centro, y
  // empieza con "Tuvimos que mover tu turno".
  if (respuesta.ok) avisarSinEsperar(ctx.params["id"]!, ["client-rescheduled"]);
  return respuesta;
}

/**
 * La invitada saca la sesión que sigue de un tratamiento suyo.
 *
 * Igual que `sacarMiSesionSiguiente`, con el enlace en el lugar de la sesión.
 */
export async function sacarSesionSiguiente(ctx: Ctx) {
  const deQuien = await deQuienEs(ctx);
  if (!deQuien) return enlaceInvalido();

  const id = ctx.body["appointment_id"];
  const cuando = ctx.body["starts_at"];
  if (typeof id !== "string" || typeof cuando !== "string") {
    return json({ error: "Faltan datos del turno." }, 400);
  }
  const starts_at = new Date(cuando);
  if (Number.isNaN(starts_at.getTime())) return json({ error: "Ese horario no se entiende." }, 400);

  const anterior = await sesionAnterior(id, deQuien);
  if (!anterior) return json({ error: "Ese turno no existe." }, 404);

  const profesionalId = ctx.body["professional_id"];
  const nota = typeof ctx.body["client_notes"] === "string" ? ctx.body["client_notes"].trim() : "";

  const creado = await sacarLaSesionSiguiente(anterior, {
    starts_at,
    professional_id: typeof profesionalId === "string" && profesionalId ? profesionalId : null,
    client_notes: nota.slice(0, 600) || null,
    acceso: null,
  });

  avisarSinEsperar(creado.id, ["requested", "new-request"]);
  return json(creado);
}
