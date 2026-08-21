import type { Prisma } from "@prisma/client";
import { prisma } from "@/server/db";
import { json, type Ctx } from "@/server/http";
import { accesoDe, puede } from "@/server/services/authz.service";
import { comoHora, horaDesdeTexto } from "@/server/serializar";
import type {
  RtaProfesionalesAdmin,
  RtaServiciosParaElegir,
  RtaTurnosProximos,
} from "@/lib/api-tipos";

/**
 * Un horario ya validado y listo para Prisma.
 *
 * Vive acá y no en `api-tipos.ts` a propósito: lleva un `Date`, y ese archivo
 * declara lo que viaja por JSON — donde los Date no existen. Por el cable el
 * horario va como texto `"09:00"`; recién `horaDesdeTexto()` lo convierte.
 */
type HorarioAGuardar = { id?: string; weekday: number; start_time: Date; end_time: Date };

/**
 * Las fichas del equipo: quiénes son, qué hacen y cuándo. Permiso `team`.
 *
 * ⚠️ Vincular una ficha a una cuenta NO está acá: eso lo hace `team.functions.ts`
 * y **sólo la dueña**, porque atarse una ficha ajena es pasar a ver los
 * teléfonos y las notas clínicas de esas clientas. Lo hacía cumplir
 * `guard_professional_account_link` y ahora `exigirPoderAtarFicha`.
 */

// ─────────────────────────────────────────────────────────────────────────────
// Lectura
// ─────────────────────────────────────────────────────────────────────────────

export async function listar() {
  const fichas = await prisma.professionals.findMany({
    select: {
      id: true,
      full_name: true,
      specialty: true,
      bio: true,
      is_active: true,
      // Acá SÍ va user_id, al revés que en el endpoint público: la pantalla lo
      // usa para saber si a esa profesional ya se le dio acceso al panel, y
      // quien la mira tiene el permiso `team`.
      user_id: true,
      services: {
        select: { id: true, service_id: true, service: { select: { id: true, name: true } } },
      },
      schedules: {
        select: { id: true, weekday: true, start_time: true, end_time: true },
        orderBy: [{ weekday: "asc" }, { start_time: "asc" }],
      },
    },
    orderBy: { full_name: "asc" },
  });

  const salida: RtaProfesionalesAdmin = {
    profesionales: fichas.map(({ services, schedules, ...ficha }) => ({
      ...ficha,
      professional_services: services.map((s) => ({
        id: s.id,
        service_id: s.service_id,
        services: s.service,
      })),
      professional_schedules: schedules.map((h) => ({
        id: h.id,
        weekday: h.weekday,
        start_time: comoHora(h.start_time),
        end_time: comoHora(h.end_time),
      })),
    })),
  };
  return json(salida);
}

/**
 * Los tratamientos, para el selector del formulario.
 *
 * ⚠️ No se reusa `/api/catalogo/servicios`: ése pide el permiso `catalog`, y
 * esta pantalla la abre quien tiene `team`. Son dos permisos distintos a
 * propósito — se puede armar el equipo sin poder tocar los precios.
 *
 * Qué se ve replica exactamente la policy `published services authenticated`:
 * los publicados los ve cualquiera con sesión, y los despublicados sólo quien
 * además edita el catálogo. Si acá se devolvieran todos, alguien con `team`
 * pasaría a ver el catálogo que la dueña todavía está armando.
 */
export async function serviciosParaElegir(ctx: Ctx) {
  const acceso = ctx.user ? await accesoDe(ctx.user.id) : null;
  const veTodo = acceso !== null && puede(acceso, "catalog");

  const servicios = await prisma.services.findMany({
    ...(veTodo ? {} : { where: { is_published: true } }),
    select: { id: true, name: true, category: true },
    orderBy: [{ category: "asc" }, { name: "asc" }],
  });

  const salida: RtaServiciosParaElegir = { servicios };
  return json(salida);
}

/**
 * Cuántos turnos futuros sin realizar tiene cada profesional.
 *
 * Sirve para avisar antes de desactivar o borrar a alguien: eso no toca los
 * turnos ya reservados, que quedan agendados con una profesional que ya no
 * atiende. No lo impide —a veces es lo que se quiere, porque renunció— pero lo
 * pone a la vista para poder reasignarlos.
 *
 * ── 🔴 SIN EL PERMISO `appointments`, DEVUELVE VACÍO Y NO ERROR ───────────
 *
 * Esto es deliberado y hay que mantenerlo. Con RLS, quien no podía leer turnos
 * ajenos recibía una lista vacía y el aviso simplemente no aparecía; está
 * anotado en la pantalla como limitación conocida —quien gestiona el equipo sin
 * ver la agenda no tiene con qué avisar—.
 *
 * Si acá se devolvieran los conteos igual, alguien con `team` y sin
 * `appointments` pasaría a saber cuántos turnos tiene cada profesional, que es
 * información de la agenda. Y si se devolviera un 403, la pantalla mostraría un
 * error donde antes no pasaba nada.
 */
export async function turnosProximos(ctx: Ctx) {
  const acceso = ctx.user ? await accesoDe(ctx.user.id) : null;
  if (acceso === null || !puede(acceso, "appointments")) {
    const vacio: RtaTurnosProximos = { turnos: {} };
    return json(vacio);
  }

  const filas = await prisma.appointments.groupBy({
    by: ["professional_id"],
    where: { status: { in: ["pending", "confirmed"] }, starts_at: { gte: new Date() } },
    _count: { _all: true },
  });

  const turnos: Record<string, number> = {};
  for (const fila of filas) {
    if (fila.professional_id) turnos[fila.professional_id] = fila._count._all;
  }

  const salida: RtaTurnosProximos = { turnos };
  return json(salida);
}

// ─────────────────────────────────────────────────────────────────────────────
// Alta, edición y baja
// ─────────────────────────────────────────────────────────────────────────────

type Campos = {
  full_name: string;
  specialty: string | null;
  bio: string | null;
  is_active: boolean;
};

function camposDe(ctx: Ctx): Campos | string {
  const nombre = typeof ctx.body["full_name"] === "string" ? ctx.body["full_name"].trim() : "";
  if (!nombre) return "Poné un nombre.";
  const especialidad =
    typeof ctx.body["specialty"] === "string" ? ctx.body["specialty"].trim() : "";
  const bio = typeof ctx.body["bio"] === "string" ? ctx.body["bio"].trim() : "";
  return {
    full_name: nombre,
    specialty: especialidad || null,
    bio: bio || null,
    is_active: ctx.body["is_active"] !== false,
  };
}

function serviciosDe(ctx: Ctx): string[] {
  const crudo = ctx.body["services"];
  if (!Array.isArray(crudo)) return [];
  return crudo.filter((x): x is string => typeof x === "string");
}

/** Los horarios del formulario, ya validados. Devuelve el motivo si algo falla. */
function horariosDe(ctx: Ctx): HorarioAGuardar[] | string {
  const crudo = ctx.body["schedules"];
  if (!Array.isArray(crudo)) return [];

  const salida: HorarioAGuardar[] = [];
  for (const item of crudo) {
    const h = item as { id?: unknown; weekday?: unknown; start_time?: unknown; end_time?: unknown };
    const weekday = Number(h.weekday);
    if (!Number.isInteger(weekday) || weekday < 0 || weekday > 6) return "Hay un día inválido.";

    const desde = horaDesdeTexto(h.start_time);
    const hasta = horaDesdeTexto(h.end_time);
    if (!desde || !hasta) return "Hay un horario mal escrito.";

    // La misma validación que hacía la pantalla. Se repite acá porque un pedido
    // hecho a mano no pasa por el formulario, y un horario que termina antes de
    // empezar deja a esa profesional sin ningún hueco reservable — sin error.
    if (desde >= hasta) return "Hay un horario que termina antes de empezar.";

    salida.push({
      ...(typeof h.id === "string" ? { id: h.id } : {}),
      weekday,
      start_time: desde,
      end_time: hasta,
    });
  }
  return salida;
}

/**
 * Reconcilia tratamientos y horarios de una profesional.
 *
 * Igual que con la galería del catálogo: se agrega, se actualiza y se saca, en
 * vez de borrar todo y reinsertar. Las filas que no cambiaron conservan su id.
 */
async function guardarVinculos(
  tx: Prisma.TransactionClient,
  profesionalId: string,
  servicios: string[],
  horarios: HorarioAGuardar[],
) {
  // ── Tratamientos ──────────────────────────────────────────────────────────
  const actuales = await tx.professional_services.findMany({
    where: { professional_id: profesionalId },
    select: { id: true, service_id: true },
  });
  const yaEstan = new Map(actuales.map((a) => [a.service_id, a.id]));

  const aAgregar = servicios.filter((id) => !yaEstan.has(id));
  const aSacar = [...yaEstan.entries()]
    .filter(([serviceId]) => !servicios.includes(serviceId))
    .map(([, linkId]) => linkId);

  if (aAgregar.length > 0) {
    await tx.professional_services.createMany({
      data: aAgregar.map((service_id) => ({ professional_id: profesionalId, service_id })),
    });
  }
  if (aSacar.length > 0) {
    await tx.professional_services.deleteMany({ where: { id: { in: aSacar } } });
  }

  // ── Horarios ──────────────────────────────────────────────────────────────
  const antes = await tx.professional_schedules.findMany({
    where: { professional_id: profesionalId },
    select: { id: true, weekday: true, start_time: true, end_time: true },
  });

  const quedan = new Set(horarios.map((h) => h.id).filter(Boolean));
  const horariosASacar = antes.filter((h) => !quedan.has(h.id)).map((h) => h.id);

  for (const h of horarios) {
    const datos = { weekday: h.weekday, start_time: h.start_time, end_time: h.end_time };
    if (!h.id) {
      await tx.professional_schedules.create({
        data: { professional_id: profesionalId, ...datos },
      });
      continue;
    }
    // Sólo si cambió algo: un UPDATE que no cambia nada es ruido en el log y
    // mueve el updated_at de una fila que nadie tocó.
    const previo = antes.find((a) => a.id === h.id);
    if (
      previo &&
      (previo.weekday !== h.weekday ||
        previo.start_time.getTime() !== h.start_time.getTime() ||
        previo.end_time.getTime() !== h.end_time.getTime())
    ) {
      await tx.professional_schedules.update({ where: { id: h.id }, data: datos });
    }
  }

  if (horariosASacar.length > 0) {
    await tx.professional_schedules.deleteMany({ where: { id: { in: horariosASacar } } });
  }
}

export async function crear(ctx: Ctx) {
  const campos = camposDe(ctx);
  if (typeof campos === "string") return json({ error: campos }, 400);
  const horarios = horariosDe(ctx);
  if (typeof horarios === "string") return json({ error: horarios }, 400);

  const id = await prisma.$transaction(async (tx) => {
    const ficha = await tx.professionals.create({ data: campos, select: { id: true } });
    await guardarVinculos(tx, ficha.id, serviciosDe(ctx), horarios);
    return ficha.id;
  });

  return json({ id });
}

export async function editar(ctx: Ctx) {
  const id = ctx.params["id"];
  if (!id) return json({ error: "Falta la profesional." }, 400);

  const campos = camposDe(ctx);
  if (typeof campos === "string") return json({ error: campos }, 400);
  const horarios = horariosDe(ctx);
  if (typeof horarios === "string") return json({ error: horarios }, 400);

  await prisma.$transaction(async (tx) => {
    await tx.professionals.update({ where: { id }, data: campos });
    await guardarVinculos(tx, id, serviciosDe(ctx), horarios);
  });

  return json({ ok: true });
}

export async function activar(ctx: Ctx) {
  const id = ctx.params["id"];
  if (!id) return json({ error: "Falta la profesional." }, 400);
  const valor = ctx.body["is_active"];
  if (typeof valor !== "boolean") return json({ error: "Falta el valor." }, 400);

  await prisma.professionals.update({ where: { id }, data: { is_active: valor } });
  return json({ ok: true });
}

export async function borrar(ctx: Ctx) {
  const id = ctx.params["id"];
  if (!id) return json({ error: "Falta la profesional." }, 400);
  // Los turnos que tenía quedan con professional_id en NULL: la FK es
  // ON DELETE SET NULL. Es lo que ya pasaba, y por eso la pantalla avisa
  // cuántos turnos futuros hay antes de dejar borrar.
  await prisma.professionals.delete({ where: { id } });
  return json({ ok: true });
}
