import { prisma } from "@/server/db";
import { json, type Ctx } from "@/server/http";
import { accesoDe, puede } from "@/server/services/authz.service";
import { idsDelEquipo } from "@/server/services/agenda.service";
import { exigirAlcanceDeClienta, nombreDelTratamiento } from "@/server/services/turnos.service";
import { comoNumero } from "@/server/serializar";
import type { RtaClientas, RtaEquipo, RtaMiCuenta, RtaMisTurnos } from "@/lib/api-tipos";

/**
 * Las clientas: la lista del panel y el espacio propio de cada una.
 *
 * ── DOS SECCIONES CON DOS CANDADOS MUY DISTINTOS ──────────────────────────
 *
 * Arriba, la lista del panel: la ve quien tiene `clients_contact` **o**
 * `appointments`. Los dos permisos y no uno, igual que decía la policy
 * `read profiles` — la pantalla de turnos muestra el nombre y el teléfono de
 * quien reservó, así que una empleada que sólo gestiona turnos tiene que poder
 * leer la ficha o la agenda le queda llena de guiones.
 *
 * Abajo, "mi cuenta": no pide ningún permiso, sólo sesión. **Todo lo de esa
 * sección está atado a `ctx.user.id` y nunca a un id que venga del pedido.** Es
 * la traducción de `auth.uid()`, y es lo único que impide que una clienta lea la
 * ficha de otra cambiando un número.
 */

// ─────────────────────────────────────────────────────────────────────────────
// La lista del panel
// ─────────────────────────────────────────────────────────────────────────────

export async function listar(ctx: Ctx) {
  const acceso = await accesoDe(ctx.user!.id);
  const veNotas = puede(acceso, "clients_notes");
  const veTurnosAjenos = puede(acceso, "appointments");

  const fichas = await prisma.profiles.findMany({
    select: { id: true, full_name: true, phone: true, created_at: true },
    orderBy: { created_at: "desc" },
  });

  // ⚠️ El filtro replica la policy `read appointments`: los propios, o los de
  // todas si tiene el permiso. Sin él, alguien con `clients_contact` y sin
  // `appointments` pasaría a ver cuántas veces vino cada clienta y cuándo fue la
  // última — que es justamente lo que ese permiso no le da.
  //
  // Con RLS esto salía "gratis": la consulta devolvía sólo lo permitido y las
  // cuentas daban cero. Acá hay que escribirlo.
  const turnos = await prisma.appointments.findMany({
    where: veTurnosAjenos ? {} : { client_id: ctx.user!.id },
    select: { client_id: true, starts_at: true, status: true },
  });

  const notas = veNotas
    ? await prisma.client_notes.findMany({ select: { client_id: true, body: true } })
    : [];
  const notaDe = new Map(notas.map((n) => [n.client_id, n.body]));

  const clientas: RtaClientas["clientas"] = fichas.map((ficha) => {
    const suyos = turnos.filter((t) => t.client_id === ficha.id);
    const ultimo = suyos
      .map((t) => t.starts_at.toISOString())
      .sort()
      .at(-1);
    return {
      id: ficha.id,
      full_name: ficha.full_name,
      phone: ficha.phone,
      created_at: ficha.created_at.toISOString(),
      notes: notaDe.get(ficha.id) ?? null,
      total: suyos.length,
      done: suyos.filter((t) => t.status === "completed").length,
      ...(ultimo === undefined ? {} : { last: ultimo }),
    };
  });

  return json({ clientas } satisfies RtaClientas);
}

/**
 * Qué cuentas son del equipo y no clientas.
 *
 * `profiles` tiene una fila por cada cuenta y ahí no hay nada que diga quién es
 * clienta: el rol vive en `user_roles`. Sin esto, la dueña y las empleadas
 * figuran como clientas que nunca vinieron.
 *
 * ⚠️ Devuelve el dato crudo y no una lista ya filtrada porque cada pantalla lo
 * usa distinto: Clientes las **esconde** —es una lista comercial, y una empleada
 * con 0 turnos ensucia esa lectura— y el buscador de "Nuevo turno" las
 * **muestra marcadas**, porque una empleada también se atiende en el centro y
 * hay que poder cargarle el turno.
 */
export async function equipo() {
  return json({ ids: await idsDelEquipo() } satisfies RtaEquipo);
}

// ─────────────────────────────────────────────────────────────────────────────
// Mi cuenta — sólo sesión, todo atado a ctx.user.id
// ─────────────────────────────────────────────────────────────────────────────

export async function miFicha(ctx: Ctx) {
  const userId = ctx.user!.id;

  const [ficha, nota] = await Promise.all([
    prisma.profiles.findUnique({
      where: { id: userId },
      select: { id: true, full_name: true, phone: true, birth_date: true },
    }),
    prisma.client_notes.findUnique({ where: { client_id: userId }, select: { body: true } }),
  ]);

  if (!ficha) return json({ ficha: null } satisfies RtaMiCuenta);

  return json({
    ficha: {
      id: ficha.id,
      full_name: ficha.full_name,
      phone: ficha.phone,
      // Sólo la fecha: la columna es `date` y la pantalla la muestra tal cual.
      birth_date: ficha.birth_date ? ficha.birth_date.toISOString().slice(0, 10) : null,
      notes: nota?.body ?? "",
    },
  } satisfies RtaMiCuenta);
}

export async function guardarMiFicha(ctx: Ctx) {
  const userId = ctx.user!.id;
  const nombre = typeof ctx.body["full_name"] === "string" ? ctx.body["full_name"].trim() : "";
  const telefono = typeof ctx.body["phone"] === "string" ? ctx.body["phone"].trim() : "";
  const nota = typeof ctx.body["notes"] === "string" ? ctx.body["notes"].trim() : "";

  await prisma.$transaction(async (tx) => {
    await tx.profiles.update({
      where: { id: userId },
      data: { full_name: nombre || null, phone: telefono || null },
    });
    // upsert y no update: la primera vez que escribe una nota todavía no hay
    // fila en client_notes.
    await tx.client_notes.upsert({
      where: { client_id: userId },
      create: { client_id: userId, body: nota || null },
      update: { body: nota || null },
    });
  });

  return json({ ok: true });
}

export async function misTurnos(ctx: Ctx) {
  const turnos = await prisma.appointments.findMany({
    // 🔴 El filtro es explícito. La policy decía "los propios O los de todas si
    // tenés el permiso de turnos", así que sin este `client_id` la dueña o una
    // secretaria abrirían SU cuenta y verían ahí los turnos de todas las
    // clientas, mezclados con los suyos.
    where: { client_id: ctx.user!.id },
    select: {
      id: true,
      starts_at: true,
      status: true,
      duration_minutes: true,
      client_notes: true,
      service: { select: { name: true, price: true, category: true } },
      // El nombre congelado, por si el tratamiento ya no está en el catálogo.
      service_name: true,
      price: true,
      professional: { select: { full_name: true } },
    },
    orderBy: { starts_at: "desc" },
  });

  return json({
    turnos: turnos.map((t) => ({
      id: t.id,
      starts_at: t.starts_at.toISOString(),
      status: t.status,
      duration_minutes: t.duration_minutes,
      client_notes: t.client_notes,
      // Los nombres anidados vienen del select de supabase-js y se conservan
      // para no tener que tocar el JSX.
      //
      // `t.service` puede ser null: el tratamiento se borró del catálogo y el
      // turno quedó sin vínculo. El nombre sale igual —congelado en la fila— y
      // el precio se cae al que se cobró ese día, que es el único que queda.
      services: {
        name: nombreDelTratamiento(t),
        price: comoNumero(t.service ? t.service.price : t.price),
        category: t.service?.category ?? null,
      },
      professionals: t.professional,
    })),
  } satisfies RtaMisTurnos);
}

/**
 * Cancelar un turno propio.
 *
 * ⚠️ El turno se busca **filtrando por `client_id`**, y eso no es una comodidad:
 * es la mitad de la regla que se pierde al salir de Supabase.
 * `exigirAlcanceDeClienta` decide QUÉ puede cambiar una clienta, pero da por
 * sentado que el turno es suyo — antes lo garantizaba la RLS. Está dicho en el
 * comentario de esa función, y es lo más fácil de olvidar de toda la migración.
 */
export async function cancelarMiTurno(ctx: Ctx) {
  const id = ctx.params["id"];
  if (!id) return json({ error: "Falta el turno." }, 400);

  const userId = ctx.user!.id;
  const turno = await prisma.appointments.findFirst({
    where: { id, client_id: userId },
    select: { id: true, status: true },
  });

  // 404 y no 403 si el turno es de otra: decir "existe pero no es tuyo" ya
  // confirma que ese turno existe.
  if (!turno) return json({ error: "Ese turno no existe." }, 404);

  exigirAlcanceDeClienta(await accesoDe(userId), turno, { status: "cancelled" });

  await prisma.appointments.update({ where: { id }, data: { status: "cancelled" } });
  return json({ ok: true });
}
