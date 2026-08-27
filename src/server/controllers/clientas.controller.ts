import { prisma } from "@/server/db";
import { json, type Ctx } from "@/server/http";
import { accesoDe, exigirAdmin, puede, puedeAlguno } from "@/server/services/authz.service";
import { idsDelEquipo } from "@/server/services/agenda.service";
import {
  exigirAlcanceDeClienta,
  nombreDelTratamiento,
  validarTurno,
} from "@/server/services/turnos.service";
import { comoNumero } from "@/server/serializar";
import { HORAS_PARA_QUE_LA_CLIENTA_TOQUE_SU_TURNO, laClientaTodaviaPuede } from "@/lib/shiraf";
import type {
  RtaClientas,
  RtaEquipo,
  RtaFichaDeClienta,
  RtaMiCuenta,
  RtaMisTurnos,
} from "@/lib/api-tipos";

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
  // 27/8/2026 — 'clients_notes' se absorbió en 'clients_contact' (ver
  // PERMISSIONS). Se pregunta por los DOS y no por uno: la dueña decidió que
  // quien gestiona turnos ve todo de la clienta, y `puede()` no expande el
  // `implies` de 'appointments' — es una etiqueta para la pantalla de Equipo,
  // no una regla que corra acá. Sin nombrar los dos, a una empleada con la
  // agenda a cargo las notas le quedarían afuera.
  // const veNotas = puede(acceso, "clients_notes");
  const veNotas = puedeAlguno(acceso, ["clients_contact", "appointments"]);
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
      // Los dos ids los necesita «Reprogramar»: con el del tratamiento busca
      // quiénes lo hacen, y con el de la profesional preselecciona la actual.
      service_id: true,
      professional_id: true,
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
      service_id: t.service_id,
      professional_id: t.professional_id,
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
    select: { id: true, status: true, starts_at: true },
  });

  // 404 y no 403 si el turno es de otra: decir "existe pero no es tuyo" ya
  // confirma que ese turno existe.
  if (!turno) return json({ error: "Ese turno no existe." }, 404);

  exigirAlcanceDeClienta(await accesoDe(userId), turno, { status: "cancelled" });

  // El corte de las horas. Se comprueba ACÁ y no sólo escondiendo el botón: la
  // pantalla se puede saltear con un pedido a mano, y esto es una regla del
  // negocio, no una comodidad de la interfaz.
  //
  // Sólo alcanza a la clienta. El centro cancela cuando quiere desde el panel,
  // que es otro endpoint (`cambiarEstado`) y no pasa por acá.
  if (!laClientaTodaviaPuede(turno.starts_at.toISOString(), Date.now())) {
    return json(
      {
        error: `Este turno ya está a menos de ${HORAS_PARA_QUE_LA_CLIENTA_TOQUE_SU_TURNO} horas: no se puede cancelar solo. Escribinos y lo vemos.`,
      },
      422,
    );
  }

  /**
   * Por qué cancela.
   *
   * Va para el otro lado que el del panel: esto NO se le manda a la clienta
   * —lo acaba de escribir ella— sino que viaja en el aviso que recibe el centro
   * y queda en la ficha del turno. Es la diferencia entre "canceló" y "canceló
   * porque le salió el doble de lo que esperaba".
   *
   * Opcional, como del otro lado: pedirle una explicación obligatoria a alguien
   * que quiere cancelar es la forma de que escriba cualquier cosa.
   */
  const motivo = typeof ctx.body["motivo"] === "string" ? ctx.body["motivo"].trim() : "";

  await prisma.appointments.update({
    where: { id },
    data: { status: "cancelled", cancel_reason: motivo || null },
  });
  return json({ ok: true });
}

/**
 * La clienta se mueve su propio turno.
 *
 * ── QUÉ PUEDE ELEGIR ──────────────────────────────────────────────────────
 *
 * El día, la hora y la profesional — la misma u otra, con tal de que haga ese
 * tratamiento. El tratamiento NO se cambia: eso es otro turno, con otro precio y
 * otra duración, y para eso está reservar de nuevo.
 *
 * ── LAS REGLAS, Y DE DÓNDE SALE CADA UNA ──────────────────────────────────
 *
 * 1. El turno es suyo. Sale del `client_id` de la sesión, nunca de un id que
 *    venga en el pedido. Si no es suyo devuelve 404 y no 403: decir "existe pero
 *    no es tuyo" ya confirma que ese turno existe.
 *
 * 2. No está cerrado. Un realizado ya pasó y un cancelado ya no va.
 *
 * 3. Le queda margen. El mismo corte que para cancelar, y se mide sobre el
 *    horario que el turno tiene AHORA: lo que se está pidiendo es soltar ese
 *    lugar, y soltarlo dos horas antes deja el hueco sin llenar igual que
 *    cancelarlo. El horario NUEVO no lleva ese corte, porque reservar tampoco lo
 *    lleva: si el sitio deja sacar un turno para dentro de una hora, moverlo a
 *    dentro de una hora no puede estar peor visto.
 *
 * 4. El horario nuevo sirve de verdad. Eso lo decide `validarTurno` con el
 *    acceso de la clienta —no el del centro—, así que acá SÍ se exige lo que al
 *    panel se le perdona: que no sea en el pasado, que la profesional esté
 *    activa, que haga ese tratamiento y que el horario entre en su agenda.
 *
 * Y la superposición la sigue decidiendo el trigger, dentro de la transacción
 * del UPDATE. El router traduce su 23P01.
 */
export async function reprogramarMiTurno(ctx: Ctx) {
  const id = ctx.params["id"];
  if (!id) return json({ error: "Falta el turno." }, 400);

  const userId = ctx.user!.id;
  const turno = await prisma.appointments.findFirst({
    where: { id, client_id: userId },
    select: { id: true, status: true, starts_at: true, service_id: true },
  });
  if (!turno) return json({ error: "Ese turno no existe." }, 404);

  if (turno.status === "completed" || turno.status === "cancelled") {
    return json({ error: "Ese turno ya está cerrado." }, 422);
  }

  if (!laClientaTodaviaPuede(turno.starts_at.toISOString(), Date.now())) {
    return json(
      {
        error: `Este turno ya está a menos de ${HORAS_PARA_QUE_LA_CLIENTA_TOQUE_SU_TURNO} horas: no se puede mover solo. Escribinos y lo vemos.`,
      },
      422,
    );
  }

  // Sin tratamiento no hay nada que reprogramar: se borró del catálogo y el
  // turno conserva sólo el nombre congelado, así que no se puede saber quién lo
  // hace ni cuánto dura.
  if (!turno.service_id) {
    return json({ error: "Ese tratamiento ya no está disponible. Escribinos y lo vemos." }, 422);
  }

  const crudo = ctx.body["starts_at"];
  if (typeof crudo !== "string") return json({ error: "Falta el horario nuevo." }, 400);
  const starts_at = new Date(crudo);
  if (Number.isNaN(starts_at.getTime())) {
    return json({ error: "Ese horario no se entiende." }, 400);
  }

  const profesionalId = ctx.body["professional_id"];
  if (typeof profesionalId !== "string" || !profesionalId) {
    return json({ error: "Hay que elegir una profesional." }, 400);
  }

  const validado = await validarTurno(await accesoDe(userId), {
    service_id: turno.service_id,
    professional_id: profesionalId,
    starts_at,
  });

  // El precio y la duración NO se tocan: son los del día que se reservó. Mover
  // la hora no es volver a comprar.
  await prisma.appointments.update({
    where: { id },
    data: {
      starts_at,
      professional_id: profesionalId,
      professional_name: validado.professional_name,
      // Si ya se le había mandado el recordatorio, el de la fecha nueva no
      // saldría nunca: la tarea busca por `reminded_at IS NULL`.
      reminded_at: null,
    },
  });

  return json({ ok: true });
}

// ─────────────────────────────────────────────────────────────────────────────
// La ficha de una clienta
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Todo lo que el centro sabe de una clienta, para el panel lateral.
 *
 * ── POR QUÉ NO ALCANZABA CON LA LISTA ─────────────────────────────────────
 *
 * La tabla de Clientes muestra una fila por persona y ahí entra lo que entra:
 * nombre, teléfono, tres números y las notas recortadas a media celda. Para
 * saber qué se le hizo a alguien había que ir a Turnos y buscarla a ojo entre
 * todos los turnos de todas.
 *
 * ── LOS MISMOS RECORTES QUE LA LISTA, Y POR LOS MISMOS MOTIVOS ────────────
 *
 * La puerta la abre `clients_contact` **o** `appointments` (lo pide la ruta),
 * pero adentro cada cosa pide lo suyo:
 *
 *   · las notas clínicas       → `clients_contact` **o** `appointments`. Son
 *     alergias, embarazos y antecedentes. Hasta el 27/8/2026 tenían candado
 *     propio (`clients_notes`); la dueña decidió unirlas a la ficha, porque
 *     una ficha se abre entera o no se abre, y quien maneja la agenda de una
 *     clienta tiene que poder saber si está embarazada.
 *   · el historial de turnos   → `appointments`. Quien sólo tiene el contacto no
 *     puede ver cuándo vino ni qué se hizo, igual que en la lista.
 *
 * Se recorta EN EL SERVIDOR y no escondiendo cosas en la pantalla: lo que no
 * corresponde no viaja.
 */
export async function verClienta(ctx: Ctx) {
  const id = ctx.params["id"];
  if (!id) return json({ error: "Falta la clienta." }, 400);

  const acceso = await accesoDe(ctx.user!.id);
  // 27/8/2026 — 'clients_notes' se absorbió en 'clients_contact' (ver
  // PERMISSIONS). Se pregunta por los DOS y no por uno: la dueña decidió que
  // quien gestiona turnos ve todo de la clienta, y `puede()` no expande el
  // `implies` de 'appointments' — es una etiqueta para la pantalla de Equipo,
  // no una regla que corra acá. Sin nombrar los dos, a una empleada con la
  // agenda a cargo las notas le quedarían afuera.
  // const veNotas = puede(acceso, "clients_notes");
  const veNotas = puedeAlguno(acceso, ["clients_contact", "appointments"]);
  const veTurnos = puede(acceso, "appointments");

  const ficha = await prisma.profiles.findUnique({
    where: { id },
    select: {
      id: true,
      full_name: true,
      phone: true,
      birth_date: true,
      created_at: true,
      user: { select: { email: true, is_active: true } },
    },
  });
  if (!ficha) return json({ error: "Esa clienta no existe." }, 404);

  const nota = veNotas
    ? await prisma.client_notes.findUnique({ where: { client_id: id }, select: { body: true } })
    : null;

  // Los suyos, del más nuevo al más viejo: la última visita es lo primero que se
  // busca al abrir una ficha.
  const turnos = veTurnos
    ? await prisma.appointments.findMany({
        where: { client_id: id },
        orderBy: { starts_at: "desc" },
        select: {
          id: true,
          starts_at: true,
          status: true,
          price: true,
          service: { select: { name: true } },
          // El nombre congelado, por si el tratamiento ya no está en el catálogo:
          // el historial tiene que seguir diciendo qué se le hizo.
          service_name: true,
          professional: { select: { full_name: true } },
        },
      })
    : [];

  const salida: RtaFichaDeClienta = {
    clienta: {
      id: ficha.id,
      full_name: ficha.full_name,
      phone: ficha.phone,
      // `birth_date` es una columna `date`: se manda como "1990-05-23" y no como
      // instante, para que la pantalla no le reste un día según la zona horaria.
      birth_date: ficha.birth_date ? ficha.birth_date.toISOString().slice(0, 10) : null,
      created_at: ficha.created_at.toISOString(),
      email: ficha.user?.email ?? null,
      cuentaActiva: ficha.user?.is_active ?? null,
      notes: veNotas ? (nota?.body ?? null) : null,
      puedeVerNotas: veNotas,
      puedeVerTurnos: veTurnos,
      turnos: turnos.map((t) => ({
        id: t.id,
        starts_at: t.starts_at.toISOString(),
        status: t.status,
        price: comoNumero(t.price),
        service: nombreDelTratamiento(t),
        professional: t.professional?.full_name ?? null,
      })),
    },
  };
  return json(salida);
}

/**
 * Borrar la cuenta de una clienta, con todo lo suyo.
 *
 * ── QUÉ SE VA CON ELLA ────────────────────────────────────────────────────
 *
 * Todo, y hay que decirlo antes de apretar el botón: la cuenta, su ficha, sus
 * notas clínicas y **sus turnos**. Cae solo por las claves foráneas, que son
 * ON DELETE CASCADE — es la decisión que ya estaba tomada en el esquema y no se
 * discute acá: los turnos de una clienta son de la clienta.
 *
 * Eso quiere decir que borrar a alguien que vino veinte veces se lleva veinte
 * turnos realizados del historial del centro. Es exactamente lo que hay que
 * hacer cuando una clienta pide que le borren los datos, y es una pérdida cuando
 * lo que se quería era sólo sacarla de la lista. La pantalla lo cuenta con los
 * números a la vista antes de confirmar.
 *
 * ── LOS CUATRO CANDADOS ───────────────────────────────────────────────────
 *
 *   · Sólo la dueña. NO alcanza con `clients_contact`: quien tiene esa casilla
 *     lee teléfonos y fichas, que es una cosa; borrar una cuenta con su historial
 *     es otra, y es de las que no se deshacen. Mismo criterio que la baja de una
 *     empleada, que también es `exigirAdmin()`.
 *   · Nadie se borra a sí mismo: quedaría afuera del panel en el acto.
 *   · Una cuenta del equipo no se borra desde acá. La lista de Clientes esconde
 *     al equipo, así que llegar hasta acá con el id de una empleada es pedirlo a
 *     mano — pero la baja de una empleada tiene sus propias reglas (que no sea
 *     otra admin, que sea staff) y viven en Equipo.
 *   · Con turnos por venir sin cancelar, no se borra. Ver abajo.
 *
 * ── 🔴 LOS TURNOS POR VENIR FRENAN EL BORRADO ────────────────────────────
 *
 * Mismo motivo que en `turnos.controller → borrar`: el aviso a la clienta sale
 * de cancelar, no de borrar. Sin este freno, borrar la cuenta le libera el
 * horario al centro —el turno desaparece de la agenda— y la clienta se presenta
 * igual el martes a las 11:30 porque nadie le dijo nada. Se cancelan primero, y
 * ahí sí.
 *
 * La cuenta y el borrado NO van en una transacción a propósito: si entre las dos
 * consultas alguien reserva un turno, ese turno se pierde con la cuenta, que es
 * lo mismo que habría pasado un segundo antes. Lo que el freno evita es el
 * descuido, no una carrera de milisegundos.
 */
export async function borrarClienta(ctx: Ctx) {
  exigirAdmin(await accesoDe(ctx.user!.id));

  const id = ctx.params["id"];
  if (!id) return json({ error: "Falta la clienta." }, 400);
  if (id === ctx.user!.id) return json({ error: "No podés borrar tu propia cuenta." }, 422);

  const cuenta = await prisma.users.findUnique({
    where: { id },
    select: { roles: { select: { role: true } } },
  });
  if (!cuenta) return json({ error: "Esa clienta no existe." }, 404);

  if (cuenta.roles.some((r) => r.role === "admin" || r.role === "staff")) {
    return json(
      { error: "Esa cuenta es del equipo, no de una clienta. Se da de baja desde Equipo." },
      422,
    );
  }

  const porVenir = await prisma.appointments.count({
    where: {
      client_id: id,
      status: { in: ["pending", "confirmed"] },
      starts_at: { gt: new Date() },
    },
  });

  if (porVenir > 0) {
    return json(
      {
        error:
          porVenir === 1
            ? "No se puede eliminar: tiene 1 turno por venir. Cancelalo primero, así recibe el aviso."
            : `No se puede eliminar: tiene ${porVenir} turnos por venir. Cancelalos primero, así recibe el aviso.`,
      },
      409,
    );
  }

  // El resto cae solo: profile, client_notes, roles, permisos y appointments son
  // ON DELETE CASCADE.
  await prisma.users.delete({ where: { id } });
  return json({ ok: true });
}
