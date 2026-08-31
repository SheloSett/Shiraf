import type { Prisma } from "@prisma/client";
import { prisma } from "@/server/db";
import { json, type Ctx } from "@/server/http";
import {
  accesoDe,
  exigirAdmin,
  exigirPoderAtarFicha,
  puede,
} from "@/server/services/authz.service";
import { PERMISSION_VALUES, type Permission } from "@/lib/permissions";
import { diaConTramosSuperpuestos, estaAusente, WEEKDAYS } from "@/lib/shiraf";
import { comoFecha, comoHora, fechaDesdeTexto, horaDesdeTexto } from "@/server/serializar";
import { enHoraDelCentro, nombreDelTratamiento } from "@/server/services/turnos.service";
import type {
  RtaAusenciaGuardada,
  RtaEmpleadas,
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

/**
 * Hoy, como día del almanaque del centro.
 *
 * `new Date()` a secas serviría casi siempre y fallaría de noche: a las 22:30
 * de Buenos Aires el servidor —que en el contenedor corre en UTC— ya está en
 * el día siguiente, y una ausencia que empieza hoy se dejaría de mostrar unas
 * horas antes de tiempo.
 */
function hoyEnElCentro(): Date {
  return fechaDesdeTexto(enHoraDelCentro(new Date()).fecha) ?? new Date();
}

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
      // Las que todavía tapan algo: las que terminan de hoy en adelante. Una
      // ausencia vieja no cambia qué se puede reservar y en la pantalla sería
      // ruido; sigue en la base, nomás no se muestra.
      absences: {
        where: { ends_on: { gte: hoyEnElCentro() } },
        select: { id: true, starts_on: true, ends_on: true, reason: true },
        orderBy: { starts_on: "asc" },
      },
    },
    orderBy: { full_name: "asc" },
  });

  const salida: RtaProfesionalesAdmin = {
    profesionales: fichas.map(({ services, schedules, absences, ...ficha }) => ({
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
      professional_absences: absences.map((a) => ({
        id: a.id,
        starts_on: comoFecha(a.starts_on),
        ends_on: comoFecha(a.ends_on),
        reason: a.reason,
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

  // Dos tramos del mismo día pisándose. La pantalla ya lo avisa nombrando el
  // día; acá se repite por lo mismo que la validación de arriba: un pedido
  // hecho a mano no pasa por el formulario.
  //
  // Se compara sobre el texto original —"09:00", "13:00"— y no sobre las Date
  // que se guardan: son horas de pared del mismo día, así que el orden
  // alfabético y el del reloj coinciden, y es exactamente lo que compara la
  // pantalla. Ver `diaConTramosSuperpuestos`.
  const superpuesto = diaConTramosSuperpuestos(
    crudo.map((item) => {
      const h = item as { weekday?: unknown; start_time?: unknown; end_time?: unknown };
      return {
        weekday: Number(h.weekday),
        start_time: String(h.start_time),
        end_time: String(h.end_time),
      };
    }),
  );
  if (superpuesto !== null) {
    return `Hay dos tramos del ${WEEKDAYS[superpuesto]} que se pisan.`;
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

/**
 * Ata (o suelta) la ficha de una profesional con una cuenta.
 *
 * ── 🔴 POR QUÉ ESTO NO PUEDE SEGUIR SIENDO UN UPDATE DESDE EL NAVEGADOR ───
 *
 * Antes vivía en `src/lib/team.ts` y escribía `professionals.user_id` derecho
 * desde la pantalla. Se apoyaba en dos cosas que ya no existen: la RLS —que
 * pedía el permiso `team` para tocar la tabla— y el trigger
 * `guard_professional_account_link`, que además exigía el rol admin para esa
 * columna en particular.
 *
 * Sin las dos, un update desde el navegador no lo frena nadie. Y lo que está en
 * juego no es una inconsistencia: quien tiene `team` edita fichas, así que si
 * pudiera escribir `user_id` **se ataría a sí misma la ficha de otra** y pasaría
 * a ver, vía «Mi agenda», los teléfonos y las notas clínicas de las clientas de
 * esa profesional.
 *
 * Por eso `exigirPoderAtarFicha` pide **admin** y no `team`: `team` es
 * exactamente lo que tiene quien haría el abuso.
 *
 * Se suelta primero lo que hubiera: hay un índice único que impide que dos
 * fichas apunten a la misma cuenta, así que cambiar de ficha sin liberar la
 * anterior fallaría con un error de duplicado. Las dos escrituras van en una
 * transacción — a mitad de camino la cuenta queda sin ninguna ficha.
 */
export async function vincularCuenta(ctx: Ctx) {
  exigirPoderAtarFicha(await accesoDe(ctx.user!.id));

  const userId = ctx.body["userId"];
  const profesionalId = ctx.body["professionalId"];
  if (typeof userId !== "string" || !userId) return json({ error: "Falta la cuenta." }, 400);
  if (typeof profesionalId !== "string") return json({ error: "Falta la ficha." }, 400);

  await prisma.$transaction(async (tx) => {
    await tx.professionals.updateMany({ where: { user_id: userId }, data: { user_id: null } });
    // "" significa dejar la cuenta sin ninguna ficha.
    if (profesionalId) {
      await tx.professionals.update({ where: { id: profesionalId }, data: { user_id: userId } });
    }
  });

  return json({ ok: true });
}

// ─────────────────────────────────────────────────────────────────────────────
// Las empleadas y sus accesos — SÓLO LA DUEÑA
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Quienes tienen el rol `staff`, con su ficha y sus accesos.
 *
 * Antes eran TRES consultas encadenadas desde el navegador —los roles, después
 * los profiles de esos ids, después sus permisos— porque no había forma de
 * joinear desde PostgREST sin una vista. Acá es un include.
 */
export async function listarEmpleadas(ctx: Ctx) {
  // ⚠️ El chequeo va acá y no en la ruta, igual que en cambiarPermiso: la lista
  // dice quién trabaja en el centro y qué accesos tiene cada una, y eso es cosa
  // de la dueña. Sin esta línea alcanzaba con tener sesión.
  exigirAdmin(await accesoDe(ctx.user!.id));

  const cuentas = await prisma.users.findMany({
    where: { roles: { some: { role: "staff" } } },
    select: {
      id: true,
      email: true,
      is_active: true,
      profile: { select: { full_name: true, phone: true } },
      permissions: { select: { permission: true } },
    },
  });

  const empleadas = cuentas
    .map((c) => ({
      id: c.id,
      full_name: c.profile?.full_name ?? "Sin nombre",
      phone: c.profile?.phone ?? null,
      email: c.email,
      is_active: c.is_active,
      permissions: c.permissions.map((p) => p.permission as string),
    }))
    .sort((a, b) => a.full_name.localeCompare(b.full_name, "es"));

  return json({ empleadas } satisfies RtaEmpleadas);
}

/**
 * Tilda o destilda un acceso.
 *
 * 🔴 **Repartir accesos es del ROL admin, no de un permiso.** Era la policy
 * `admin grants permissions`, y el motivo está en su comentario: si fuera un
 * permiso, quien lo tuviera podría ampliarse a sí mismo cualquier otro. **Ningún
 * permiso se amplía a sí mismo.**
 */
export async function cambiarPermiso(ctx: Ctx) {
  exigirAdmin(await accesoDe(ctx.user!.id));

  const userId = ctx.params["id"];
  const permiso = ctx.body["permission"];
  const dar = ctx.body["grant"];

  if (!userId) return json({ error: "Falta la cuenta." }, 400);
  if (typeof permiso !== "string") return json({ error: "Falta el acceso." }, 400);
  if (typeof dar !== "boolean") return json({ error: "Falta si se da o se saca." }, 400);
  if (!esPermiso(permiso)) return json({ error: "Ese acceso no existe." }, 400);

  if (dar) {
    // Sin error si ya lo tenía: tildar dos veces es la misma intención.
    await prisma.user_permissions.createMany({
      data: [{ user_id: userId, permission: permiso }],
      skipDuplicates: true,
    });
  } else {
    await prisma.user_permissions.deleteMany({
      where: { user_id: userId, permission: permiso },
    });
  }

  return json({ ok: true });
}

/** ¿Es uno de los siete accesos que existen? El enum de la base ya no valida por sí solo. */
function esPermiso(valor: string): valor is Permission {
  return (PERMISSION_VALUES as readonly string[]).includes(valor);
}

/**
 * Da de baja una cuenta sin borrarla, o la vuelve a habilitar.
 *
 * ── POR QUÉ HACÍA FALTA ───────────────────────────────────────────────────
 *
 * Lo único que había era borrar, y borrar es definitivo. La empleada que se va
 * tres meses de licencia, la que dejó de trabajar pero cuyo historial se quiere
 * conservar, la cuenta que hay que cerrar un domingo a la noche por las dudas:
 * en los tres casos borrar es demasiado y no hacer nada es poco.
 *
 * La baja vale EN EL ACTO, no cuando se le venza el token: `authMiddleware`
 * mira `is_active` en cada pedido. Ver el comentario de allá.
 *
 * ── LOS MISMOS TRES CANDADOS QUE LA BAJA DEFINITIVA ───────────────────────
 *
 * Están escritos otra vez y no reusados a propósito: son la puerta de esta
 * pantalla, y tienen que poder leerse acá sin ir a buscarlos a otro archivo.
 *
 *   · sólo la dueña, porque esto es repartir accesos;
 *   · nadie se da de baja a sí mismo — quedaría afuera del panel que necesita
 *     para volver a entrar;
 *   · a una administradora no se la toca desde acá. El alta de admins vive
 *     fuera de la app a propósito y la baja respeta la misma puerta.
 */
export async function activarCuenta(ctx: Ctx) {
  exigirAdmin(await accesoDe(ctx.user!.id));

  const userId = ctx.params["id"];
  const activa = ctx.body["is_active"];

  if (!userId) return json({ error: "Falta la cuenta." }, 400);
  if (typeof activa !== "boolean") return json({ error: "Falta si se da de alta o de baja." }, 400);

  if (userId === ctx.user!.id) {
    return json({ error: "No podés dar de baja tu propia cuenta." }, 422);
  }

  const roles = await prisma.user_roles.findMany({
    where: { user_id: userId },
    select: { role: true },
  });

  if (roles.length === 0) return json({ error: "Esa cuenta no existe." }, 404);
  if (roles.some((r) => r.role === "admin")) {
    return json({ error: "No se puede dar de baja a una administradora desde el panel." }, 422);
  }
  if (!roles.some((r) => r.role === "staff")) {
    return json({ error: "Esa cuenta no es de una empleada." }, 422);
  }

  await prisma.users.update({ where: { id: userId }, data: { is_active: activa } });
  return json({ ok: true });
}

// ─────────────────────────────────────────────────────────────────────────────
// Los días que no está
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Cargar un tramo en que la profesional no atiende.
 *
 * ── SE GUARDA AUNQUE HAYA TURNOS ADENTRO ──────────────────────────────────
 *
 * Y se devuelven, para que la pantalla los muestre. Es una decisión del centro
 * (31/8/2026) y tiene su motivo: esos turnos son clientas con una confirmación
 * por mail en la mano. Cancelarlos en masa acá sería mandar de golpe un mail de
 * cancelación a cada una, sin forma de volver atrás; y no dejar guardar hasta
 * resolverlos obligaría a hacerlo justo cuando la dueña está anotando algo
 * rápido antes de olvidárselo.
 *
 * Entonces la ausencia entra —desde ya nadie reserva más ese día— y los turnos
 * que ya estaban quedan a la vista para reprogramarlos o cancelarlos uno por
 * uno, con el mail que cada caso merezca.
 */
export async function crearAusencia(ctx: Ctx) {
  const profesionalId = ctx.params["id"];
  if (!profesionalId) return json({ error: "Falta la profesional." }, 400);

  const ficha = await prisma.professionals.findUnique({
    where: { id: profesionalId },
    select: { id: true },
  });
  if (!ficha) return json({ error: "Esa profesional no existe." }, 404);

  const desde = fechaDesdeTexto(ctx.body["starts_on"]);
  const hasta = fechaDesdeTexto(ctx.body["ends_on"]);
  if (!desde || !hasta) return json({ error: "Poné las dos fechas." }, 400);
  if (hasta < desde) return json({ error: "La fecha de vuelta va después de la de salida." }, 400);

  const motivo = typeof ctx.body["reason"] === "string" ? ctx.body["reason"].trim() : "";

  const ausencia = await prisma.professional_absences.create({
    data: {
      professional_id: profesionalId,
      starts_on: desde,
      ends_on: hasta,
      reason: motivo || null,
    },
    select: { id: true, starts_on: true, ends_on: true, reason: true },
  });

  const salida: RtaAusenciaGuardada = {
    ausencia: {
      id: ausencia.id,
      starts_on: comoFecha(ausencia.starts_on),
      ends_on: comoFecha(ausencia.ends_on),
      reason: ausencia.reason,
    },
    turnos_en_pie: await turnosDentroDe(profesionalId, desde, hasta),
  };
  return json(salida, 201);
}

/**
 * Los turnos abiertos que caen adentro de un tramo de ausencia.
 *
 * ⚠️ El recorte por fecha es GRUESO y sobra un día de cada lado a propósito.
 * `starts_at` es un instante y el tramo son días de Buenos Aires: en UTC, el
 * turno de las 21:00 del 15 cae el 16. Quien decide de verdad es `estaAusente`,
 * sobre la fecha de cada turno ya pasada a hora del centro — la misma función
 * que usan la pantalla de reserva y el candado del servidor, para que las tres
 * no puedan discrepar.
 */
async function turnosDentroDe(
  profesionalId: string,
  desde: Date,
  hasta: Date,
): Promise<RtaAusenciaGuardada["turnos_en_pie"]> {
  const UN_DIA = 24 * 60 * 60 * 1000;

  const candidatos = await prisma.appointments.findMany({
    where: {
      professional_id: profesionalId,
      status: { in: ["pending", "confirmed"] },
      starts_at: {
        gte: new Date(desde.getTime() - UN_DIA),
        lt: new Date(hasta.getTime() + 2 * UN_DIA),
      },
    },
    select: {
      id: true,
      starts_at: true,
      guest_name: true,
      service_name: true,
      service: { select: { name: true } },
      client: { select: { profile: { select: { full_name: true } } } },
    },
    orderBy: { starts_at: "asc" },
  });

  const tramo = [{ starts_on: comoFecha(desde), ends_on: comoFecha(hasta) }];

  return candidatos
    .filter((t) => estaAusente(enHoraDelCentro(t.starts_at).fecha, tramo))
    .map((t) => ({
      id: t.id,
      starts_at: t.starts_at.toISOString(),
      // El mismo orden que en el resto del proyecto: primero la cuenta, y si no
      // hay, el nombre que el centro anotó a mano para la invitada.
      quien: t.client?.profile?.full_name ?? t.guest_name ?? "Sin nombre",
      tratamiento: nombreDelTratamiento(t),
    }));
}

/**
 * Borrar un tramo de ausencia: la profesional sí va a estar esos días.
 *
 * No devuelve nada de los turnos porque no hay nada que avisar — sacar una
 * ausencia sólo vuelve a abrir horarios que estaban cerrados.
 */
export async function borrarAusencia(ctx: Ctx) {
  const id = ctx.params["id"];
  if (!id) return json({ error: "Falta la ausencia." }, 400);

  const existe = await prisma.professional_absences.findUnique({
    where: { id },
    select: { id: true },
  });
  if (!existe) return json({ error: "Esa ausencia ya no está." }, 404);

  await prisma.professional_absences.delete({ where: { id } });
  return json({ ok: true });
}
