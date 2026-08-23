import type { appointment_status } from "@prisma/client";
import { prisma } from "@/server/db";
import { json, type Ctx } from "@/server/http";
import { miAgenda, vincularTurnosDeInvitada } from "@/server/services/agenda.service";
import { accesoDe } from "@/server/services/authz.service";
import { nombreDelTratamiento, validarTurno } from "@/server/services/turnos.service";
import { comoNumero } from "@/server/serializar";
import type {
  RtaAlcanceInvitada,
  RtaCalendario,
  RtaClientasParaElegir,
  RtaCorreccion,
  RtaMiAgenda,
  RtaPendientes,
  RtaServiciosParaTurno,
  RtaTurnos,
  RtaTurnoEnDetalle,
} from "@/lib/api-tipos";

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
      // El nombre congelado, por si el tratamiento ya no está en el catálogo.
      service_name: true,
      price: true,
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
      // `t.service` puede ser null: el tratamiento se borró del catálogo. El
      // nombre sale congelado de la fila y el precio se cae al que se cobró.
      services: {
        name: nombreDelTratamiento(t),
        price: comoNumero(t.service ? t.service.price : t.price),
      },
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
// Un turno solo
// ─────────────────────────────────────────────────────────────────────────────

/**
 * La ficha de un turno.
 *
 * Pide el mismo permiso que la lista (`appointments`) y a propósito NO trae
 * `profiles.notes`: esas son las notas clínicas —alergias, embarazos— y tienen
 * su propio candado, `clients_notes`. Sumarlas acá seria abrirlas a todo el que
 * pueda gestionar turnos, que es justo lo que ese permiso separado evita.
 *
 * Lo que sí trae de más que la lista es el MAIL. La tabla no lo mostraba por
 * lugar, pero es el dato con el que se escribe cuando el teléfono no contesta.
 */
export async function detalle(ctx: Ctx) {
  const id = ctx.params["id"];
  if (!id) return json({ error: "Falta el turno." }, 400);

  const t = await prisma.appointments.findUnique({
    where: { id },
    select: {
      id: true,
      starts_at: true,
      status: true,
      duration_minutes: true,
      price: true,
      client_notes: true,
      admin_notes: true,
      created_at: true,
      ...DATOS_DE_LA_PERSONA,
      // Pisa el `client` de DATOS_DE_LA_PERSONA para sumarle el mail. El resto
      // de lo que ese objeto pide sigue igual, porque `personaDe` lo necesita.
      client: { select: { email: true, profile: { select: { full_name: true, phone: true } } } },
      service: { select: { id: true, name: true, price: true } },
      // El nombre congelado, por si el tratamiento ya no está en el catálogo.
      service_name: true,
      professional: { select: { id: true, full_name: true } },
    },
  });

  if (!t) return json({ error: "Ese turno no existe." }, 404);

  return json({
    turno: {
      id: t.id,
      starts_at: t.starts_at.toISOString(),
      status: t.status,
      duration_minutes: t.duration_minutes,
      price: comoNumero(t.price),
      client_notes: t.client_notes,
      admin_notes: t.admin_notes,
      created_at: t.created_at.toISOString(),
      client_id: t.client_id,
      guest_name: t.guest_name,
      guest_phone: t.guest_phone,
      guest_email: t.guest_email,
      email: t.client?.email ?? t.guest_email,
      // El nombre siempre sale; el id y el precio de catálogo se van a null si
      // el tratamiento se borró. Lo que se cobró está en `price` del turno, que
      // va aparte y no depende de que el tratamiento siga existiendo.
      services: {
        id: t.service?.id ?? null,
        name: nombreDelTratamiento(t),
        price: t.service ? comoNumero(t.service.price) : null,
      },
      professionals: t.professional,
      person: personaDe(t),
    },
  } satisfies RtaTurnoEnDetalle);
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
      // El nombre congelado, por si el tratamiento ya no está en el catálogo.
      service_name: true,
      professional: { select: { full_name: true } },
    },
  });

  return json({
    turnos: turnos.map((t) => ({
      id: t.id,
      starts_at: t.starts_at.toISOString(),
      status: t.status,
      services: { name: nombreDelTratamiento(t) },
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

// ─────────────────────────────────────────────────────────────────────────────
// Cargar un turno desde el panel
// ─────────────────────────────────────────────────────────────────────────────

/** Las clientas con cuenta, para el buscador del formulario. */
export async function clientasParaElegir() {
  const fichas = await prisma.profiles.findMany({
    select: { id: true, full_name: true, phone: true },
    orderBy: { full_name: "asc" },
  });
  return json({ clientas: fichas } satisfies RtaClientasParaElegir);
}

/**
 * Los tratamientos, para el selector del formulario.
 *
 * Vienen TODOS, publicados y despublicados, con la marca. Es a proposito y no un
 * descuido del filtro: el centro puede cargarle a alguien un turno de un
 * tratamiento que todavia no esta en el sitio. validarTurno() lo permite
 * explicitamente para quien tiene el permiso, y la pantalla muestra el aviso.
 */
export async function serviciosParaTurno() {
  const servicios = await prisma.services.findMany({
    select: {
      id: true,
      name: true,
      category: true,
      duration_minutes: true,
      price: true,
      is_published: true,
    },
    orderBy: [{ category: "asc" }, { name: "asc" }],
  });
  return json({
    servicios: servicios.map((s) => ({ ...s, price: comoNumero(s.price) })),
  } satisfies RtaServiciosParaTurno);
}

function textoODefault(valor: unknown): string | null {
  return typeof valor === "string" && valor.trim() !== "" ? valor.trim() : null;
}

/**
 * Alta de un turno desde el panel, para una clienta con cuenta o para una
 * invitada.
 *
 * Nace `confirmed` y no `pending`: lo esta cargando el centro, no hay nada que
 * confirmar. El precio y la duracion los fija validarTurno(), igual que en la
 * reserva de la clienta.
 */
export async function crear(ctx: Ctx) {
  const serviceId = ctx.body["service_id"];
  const profesionalId = ctx.body["professional_id"];
  const cuando = ctx.body["starts_at"];
  const clienteId = ctx.body["client_id"];

  if (typeof serviceId !== "string" || typeof cuando !== "string") {
    return json({ error: "Faltan datos del turno." }, 400);
  }
  const starts_at = new Date(cuando);
  if (Number.isNaN(starts_at.getTime())) return json({ error: "Ese horario no se entiende." }, 400);

  const nombre = typeof ctx.body["guest_name"] === "string" ? ctx.body["guest_name"].trim() : "";
  const esInvitada = typeof clienteId !== "string" || !clienteId;

  // El CHECK `appointments_identifies_someone` lo frenaria igual, pero el
  // mensaje de Postgres no le dice nada a nadie.
  if (esInvitada && !nombre) return json({ error: "Poné al menos el nombre." }, 400);

  const validado = await validarTurno(await accesoDe(ctx.user!.id), {
    service_id: serviceId,
    professional_id: typeof profesionalId === "string" ? profesionalId : null,
    starts_at,
  });

  const creado = await prisma.appointments.create({
    data: {
      // Una cosa o la otra, nunca las dos.
      ...(esInvitada
        ? {
            guest_name: nombre,
            guest_phone: textoODefault(ctx.body["guest_phone"]),
            // En minuscula: es como compara el vinculo automatico cuando le pasa
            // los turnos a su cuenta. Guardarlo con mayusculas haria que ese
            // traspaso dependiera de como se escribio el dia que se cargo.
            guest_email: textoODefault(ctx.body["guest_email"])?.toLowerCase() ?? null,
          }
        : { client_id: clienteId as string }),
      service_id: serviceId,
      professional_id: typeof profesionalId === "string" ? profesionalId : null,
      starts_at,
      status: "confirmed",
      client_notes: textoODefault(ctx.body["client_notes"]),
      ...validado,
    },
    select: { id: true },
  });

  return json({ id: creado.id });
}

// ─────────────────────────────────────────────────────────────────────────────
// Los turnos de invitada
// ─────────────────────────────────────────────────────────────────────────────

/**
 * A que turnos alcanza corregir los datos de una invitada.
 *
 * El filtro se hace en JavaScript y no con un `where`, y hay un motivo concreto:
 * la comparacion tiene que ser insensible a mayusculas —asi compara el vinculo
 * automatico— y en Postgres eso sale por ILIKE, DONDE EL GUION BAJO ES UN
 * COMODIN de un caracter. Los mails llevan guiones bajos. Son pocas filas y el
 * filtro exacto vale mas que la consulta prolija.
 */
async function turnosDeLaInvitada(email: string): Promise<string[]> {
  const candidatos = await prisma.appointments.findMany({
    where: { client_id: null, guest_email: { not: null } },
    select: { id: true, guest_email: true },
  });
  return candidatos
    .filter((a) => (a.guest_email ?? "").trim().toLowerCase() === email)
    .map((a) => a.id);
}

export async function alcanceDeInvitada(ctx: Ctx) {
  const email = (ctx.url.searchParams.get("email") ?? "").trim().toLowerCase();
  if (!email) return json({ ids: [] } satisfies RtaAlcanceInvitada);
  return json({ ids: await turnosDeLaInvitada(email) } satisfies RtaAlcanceInvitada);
}

/**
 * Corrige los datos de una invitada.
 *
 * El conjunto a tocar SE RECALCULA ACA y no se recibe: si la pantalla mandara la
 * lista de ids, alguien podria reescribirle los datos de invitada a cualquier
 * turno. Sin mail, el alcance es un turno solo.
 */
export async function corregirInvitada(ctx: Ctx) {
  const appointmentId = ctx.body["appointmentId"];
  const crudo = typeof ctx.body["originalEmail"] === "string" ? ctx.body["originalEmail"] : "";
  const emailOriginal = crudo.trim().toLowerCase();

  const nombre = typeof ctx.body["name"] === "string" ? ctx.body["name"].trim() : "";
  if (!nombre) return json({ error: "Poné un nombre." }, 400);

  const unico = typeof appointmentId === "string" && appointmentId ? [appointmentId] : [];
  const ids = emailOriginal === "" ? unico : await turnosDeLaInvitada(emailOriginal);

  if (ids.length === 0) {
    return json({ error: "No se pudo determinar qué turnos corregir. Probá de nuevo." }, 400);
  }

  const { count } = await prisma.appointments.updateMany({
    where: { id: { in: ids } },
    data: {
      guest_name: nombre,
      guest_phone: textoODefault(ctx.body["phone"]),
      guest_email: textoODefault(ctx.body["email"])?.toLowerCase() ?? null,
    },
  });

  return json({ count } satisfies RtaCorreccion);
}

/** Le pasa a una clienta con cuenta los turnos que saco como invitada. */
export async function vincularInvitada(ctx: Ctx) {
  const telefono = ctx.body["phone"];
  const clientaId = ctx.body["clientId"];
  if (typeof telefono !== "string" || typeof clientaId !== "string") {
    return json({ error: "Faltan el teléfono o la clienta." }, 400);
  }

  const count = await vincularTurnosDeInvitada(telefono, clientaId);
  return json({ count } satisfies RtaCorreccion);
}
