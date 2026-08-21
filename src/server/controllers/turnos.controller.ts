import type { appointment_status } from "@prisma/client";
import { prisma } from "@/server/db";
import { json, type Ctx } from "@/server/http";
import { miAgenda } from "@/server/services/agenda.service";
import { comoNumero } from "@/server/serializar";
import type { RtaCalendario, RtaMiAgenda, RtaPendientes, RtaTurnos } from "@/lib/api-tipos";

/**
 * Los turnos, desde el panel. Permiso `appointments`.
 *
 * ── UNA FORMA SOLA PARA LOS DOS TIPOS DE TURNO ────────────────────────────
 *
 * Un turno puede ser de una clienta con cuenta (`client_id`) o de una invitada
 * que cargó el centro por teléfono (`guest_name`, `guest_phone`). La tabla no
 * tiene por qué saber cuál es cuál, así que el controller arma un solo objeto
 * `person` con el nombre, el teléfono y una marca.
 *
 * Antes eso lo hacía la pantalla, y necesitaba **dos consultas**: los turnos y
 * después los `profiles` de los que tenían cuenta. Acá es un include.
 */

const ESTADOS = ["pending", "confirmed", "completed", "cancelled"] as const;

function estadoDe(valor: string | null): appointment_status | null {
  return ESTADOS.includes(valor as (typeof ESTADOS)[number]) ? (valor as appointment_status) : null;
}

const DATOS_DE_LA_PERSONA = {
  client_id: true,
  guest_name: true,
  guest_phone: true,
  guest_email: true,
  client: { select: { profile: { select: { full_name: true, phone: true } } } },
} as const;

type ConPersona = {
  client_id: string | null;
  guest_name: string | null;
  guest_phone: string | null;
  client: { profile: { full_name: string | null; phone: string | null } | null } | null;
};

/** El nombre y el teléfono, venga de una cuenta o de los datos de invitada. */
function personaDe(turno: ConPersona) {
  return {
    name: turno.client?.profile?.full_name ?? turno.guest_name ?? "Sin nombre",
    phone: turno.client?.profile?.phone ?? turno.guest_phone ?? null,
    isGuest: !turno.client_id,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// La lista del panel
// ─────────────────────────────────────────────────────────────────────────────

export async function listar(ctx: Ctx) {
  const estado = estadoDe(ctx.url.searchParams.get("estado"));
  if (!estado) return json({ error: "Falta el estado." }, 400);

  const turnos = await prisma.appointments.findMany({
    where: { status: estado },
    orderBy: { starts_at: "asc" },
    select: {
      id: true,
      starts_at: true,
      status: true,
      duration_minutes: true,
      client_notes: true,
      ...DATOS_DE_LA_PERSONA,
      service: { select: { name: true, price: true } },
      professional: { select: { full_name: true } },
    },
  });

  return json({
    turnos: turnos.map((t) => ({
      id: t.id,
      starts_at: t.starts_at.toISOString(),
      status: t.status,
      duration_minutes: t.duration_minutes,
      client_notes: t.client_notes,
      client_id: t.client_id,
      guest_name: t.guest_name,
      guest_phone: t.guest_phone,
      // No se muestra en la tabla, pero lo necesita el diálogo de editar: es lo
      // que decide a cuántos turnos alcanza la corrección de una invitada.
      guest_email: t.guest_email,
      services: { name: t.service.name, price: comoNumero(t.service.price) },
      professionals: t.professional,
      person: personaDe(t),
    })),
  } satisfies RtaTurnos);
}

/** Cuántos turnos esperan respuesta. Es el número del menú del panel. */
export async function pendientes() {
  const total = await prisma.appointments.count({ where: { status: "pending" } });
  return json({ total } satisfies RtaPendientes);
}

// ─────────────────────────────────────────────────────────────────────────────
// El calendario
// ─────────────────────────────────────────────────────────────────────────────

export async function calendario(ctx: Ctx) {
  const desde = ctx.url.searchParams.get("desde");
  const hasta = ctx.url.searchParams.get("hasta");
  if (!desde || !hasta) return json({ error: "Falta el rango." }, 400);

  const turnos = await prisma.appointments.findMany({
    where: { starts_at: { gte: new Date(desde), lt: new Date(hasta) } },
    orderBy: { starts_at: "asc" },
    select: {
      id: true,
      starts_at: true,
      status: true,
      service: { select: { name: true } },
      professional: { select: { full_name: true } },
    },
  });

  return json({
    turnos: turnos.map((t) => ({
      id: t.id,
      starts_at: t.starts_at.toISOString(),
      status: t.status,
      services: t.service,
      professionals: t.professional,
    })),
  } satisfies RtaCalendario);
}

// ─────────────────────────────────────────────────────────────────────────────
// Cambiar el estado
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Confirmar, cancelar o marcar realizado.
 *
 * ⚠️ **El mail no se manda desde acá.** Lo sigue mandando la pantalla, con
 * `notifyAppointment`, y es a propósito: si un mail que no sale hiciera fallar
 * esta llamada, la pantalla diría que el turno no se confirmó **cuando sí se
 * confirmó**. Está explicado en el `onSuccess` de la mutación.
 */
export async function cambiarEstado(ctx: Ctx) {
  const id = ctx.params["id"];
  if (!id) return json({ error: "Falta el turno." }, 400);

  const estado = estadoDe(typeof ctx.body["status"] === "string" ? ctx.body["status"] : null);
  if (!estado) return json({ error: "Ese estado no existe." }, 400);

  const turno = await prisma.appointments.findUnique({ where: { id }, select: { id: true } });
  if (!turno) return json({ error: "Ese turno no existe." }, 404);

  await prisma.appointments.update({ where: { id }, data: { status: estado } });
  return json({ ok: true });
}

// ─────────────────────────────────────────────────────────────────────────────
// Mi agenda
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Los próximos turnos de la profesional conectada.
 *
 * 🔴 **No toma el id de la profesional como parámetro, y eso no se cambia.**
 * Era la regla de la función `my_agenda()` original, escrita en el comentario de
 * `20260818020000`: si recibiera un `_professional_id`, cualquiera pediría la
 * agenda de cualquiera. El alcance sale de la sesión y de ningún otro lado.
 *
 * Por eso tampoco pide permiso: no hay nada que permitir. Quien no tenga ficha
 * de profesional recibe una lista vacía — es el caso de la dueña que no atiende
 * o de una empleada de stock, y no es un error.
 */
export async function miAgendaDeHoy(ctx: Ctx) {
  const dias = Number(ctx.url.searchParams.get("dias"));
  const turnos = await miAgenda(ctx.user!.id, Number.isFinite(dias) && dias > 0 ? dias : 30);

  return json({
    turnos: turnos.map((t) => ({
      // Los nombres son los que devolvía la RPC, para no tocar el JSX.
      appointment_id: t.id,
      appointment_start: t.empiezaEn.toISOString(),
      appointment_minutes: t.minutos,
      appointment_state: t.estado,
      service_name: t.tratamiento,
      client_name: t.clienta,
      client_phone: t.telefono,
      clinical_notes: t.notasClinicas,
      booking_note: t.notaDeLaReserva,
      client_is_guest: t.esInvitada,
    })),
  } satisfies RtaMiAgenda);
}
