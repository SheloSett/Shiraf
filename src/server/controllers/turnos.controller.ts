import type { appointment_status, Prisma } from "@prisma/client";
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
  RtaProfesionalesParaElTurno,
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

/**
 * Un turno que nadie va a atender — y que TODAVÍA SE PUEDE ATENDER.
 *
 * Los dos casos de "nadie", y el segundo es el que engaña: la fila muestra un
 * nombre, así que parece resuelta, pero esa profesional está desactivada y no
 * viene más.
 *
 * El `starts_at` en el futuro es la tercera condición, y es la que faltaba. Un
 * turno de hace dos meses sin profesional no es trabajo pendiente: es historia,
 * y muchas veces historia de alguien que se borró del equipo. Contarlo hacía que
 * el cartel reclamara asignarle a alguien, y asignarle a alguien HOY un turno de
 * agosto sería escribir que la atendió una persona que no la atendió.
 *
 * Se arma como función y no como constante porque `new Date()` tiene que
 * evaluarse en cada pedido: como constante de módulo, el corte quedaría clavado
 * en el arranque del proceso.
 *
 * Escrito una vez y usado en los dos lugares —el filtro de la tabla y el
 * contador del menú— porque si se separan, el número diría una cosa y la lista
 * mostraría otra. Ese desacuerdo es de los que nadie reporta: se asume que el
 * número está mal y se lo ignora.
 */
// Tipado y no `as const`: con `as const` el array de OR queda readonly y Prisma
// lo rechaza pidiendo uno mutable, con un error que habla de exactOptional y no
// de esto.
const sinQuienLoAtienda = (): Prisma.appointmentsWhereInput => ({
  OR: [{ professional_id: null }, { professional: { is_active: false } }],
  starts_at: { gte: new Date() },
});

/**
 * La tabla de Turnos.
 *
 * ── LOS DOS FILTROS ───────────────────────────────────────────────────────
 *
 * `estado` es obligatorio y acepta los cuatro de siempre más `todos`, que es
 * justamente "no filtres por estado". Sin ese valor no habría forma de ver un
 * turno sin saber de antemano en qué estado quedó.
 *
 * `sinProfesional=1` deja sólo los que **no tienen quién los atienda**, y eso
 * son DOS casos, no uno:
 *
 *   · el turno no tiene profesional asignada, y
 *   · la tiene, pero esa profesional está desactivada.
 *
 * El segundo es el que se pasa por alto. La fila muestra un nombre, así que
 * parece resuelta — y esa persona ya no atiende. Cuando se desactiva a alguien,
 * sus turnos futuros NO se tocan a propósito (a veces es justo lo que se
 * quiere), pero entonces quedan colgados sin que nada lo diga.
 *
 * Es lo que abre el cartel rojo de la pantalla: son trabajo pendiente del centro
 * y hay que poder verlos todos juntos, sin ir pestaña por pestaña.
 */
export async function listar(ctx: Ctx) {
  const crudo = ctx.url.searchParams.get("estado");
  // `todos` no es un `appointment_status`, así que no pasa por `estadoDe`: se
  // mira antes y se traduce a "sin filtro de estado".
  const todos = crudo === "todos";
  const estado = todos ? null : estadoDe(crudo);
  if (!todos && !estado) return json({ error: "Falta el estado." }, 400);

  const soloSinProfesional = ctx.url.searchParams.get("sinProfesional") === "1";

  const turnos = await prisma.appointments.findMany({
    where: {
      ...(estado ? { status: estado } : {}),
      ...(soloSinProfesional ? sinQuienLoAtienda() : {}),
    },
    // Los últimos que salieron, arriba.
    //
    // Era `starts_at: "asc"`, o sea el turno más viejo primero — y con eso la
    // tabla arrancaba mostrando turnos que ya pasaron y había que bajar hasta el
    // final para ver lo último que entró. En una pantalla que se abre para ver
    // "qué hay de nuevo", lo nuevo tiene que estar arriba.
    //
    // El desempate por `starts_at` es para los turnos que el centro carga de a
    // varios: se dan de alta en el mismo segundo, y sin segundo criterio el
    // orden entre ellos queda a lo que devuelva la base.
    orderBy: [{ created_at: "desc" }, { starts_at: "desc" }],
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
      // `is_active` viaja a la pantalla: es lo que le permite marcar en rojo al
      // turno de una profesional que ya no atiende.
      professional: { select: { full_name: true, is_active: true } },
      // El nombre congelado: es lo único que queda cuando la ficha del equipo se
      // borró, y sin esto el turno viejo se vería igual que uno sin asignar.
      professional_name: true,
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
      professional_name: t.professional_name,
      person: personaDe(t),
    })),
  } satisfies RtaTurnos);
}

/**
 * Los dos números que el panel muestra sin que nadie los vaya a buscar.
 *
 * ── POR QUÉ VIAJAN JUNTOS ─────────────────────────────────────────────────
 *
 * Son dos consultas de conteo sobre la misma tabla y los dos los pinta el mismo
 * menú lateral. En dos endpoints serían dos viajes y dos relojes de refresco
 * distintos, con el resultado de que un número se actualiza y el otro no.
 *
 * ── QUÉ ES CADA UNO ───────────────────────────────────────────────────────
 *
 *   total          · turnos pedidos por la web que nadie contestó todavía.
 *   sinProfesional · turnos que se van a atender y NO tienen a quién.
 *
 * El segundo es el que no se puede ignorar: el turno existe, la clienta lo
 * espera, y el día que llegue no hay nadie para atenderla. Pasa cuando el centro
 * lo carga sin decidir quién atiende, cuando se reasigna uno y se deja a medias,
 * y —el caso que más se escapa— **cuando se desactiva a una profesional y sus
 * turnos futuros quedan a su nombre**. Ese último ni siquiera se ve: la fila
 * muestra un nombre como cualquier otra.
 *
 * Cancelados y realizados quedan afuera de esa cuenta: al primero no hay que
 * asignarle a nadie y el segundo ya pasó. Y desde `sinQuienLoAtienda`, también
 * quedan afuera los que siguen abiertos pero cuya hora ya pasó: ésos tampoco se
 * arreglan asignando a nadie.
 */
export async function pendientes() {
  const [total, sinProfesional] = await Promise.all([
    prisma.appointments.count({ where: { status: "pending" } }),
    prisma.appointments.count({
      where: { ...sinQuienLoAtienda(), status: { in: ["pending", "confirmed"] } },
    }),
  ]);
  return json({ total, sinProfesional } satisfies RtaPendientes);
}

// ─────────────────────────────────────────────────────────────────────────────
// Un turno solo
// ─────────────────────────────────────────────────────────────────────────────

/**
 * La ficha de un turno.
 *
 * Pide el mismo permiso que la lista (`appointments`) y NO trae `profiles.notes`
 * —las notas clínicas: alergias, embarazos, antecedentes—.
 *
 * ⚠️ El motivo por el que no las traía YA NO EXISTE. Hasta el 27/8/2026 tenían
 * candado propio (`clients_notes`) y sumarlas acá hubiera sido abrirlas a todo
 * el que gestiona turnos, que es lo que ese permiso separado evitaba. La dueña
 * unió los dos permisos, así que hoy quien abre esta ficha ya puede ver esas
 * notas — sólo que tiene que ir a busarlas a la ficha de la clienta.
 *
 * O sea que esto quedó como una decisión de pantalla y no de permisos, y hay
 * que tomarla a propósito: si la recepcionista abre un turno, el momento en que
 * una alergia importa es ESE. Pendiente de decidir con el centro.
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
      cancel_reason: true,
      created_at: true,
      ...DATOS_DE_LA_PERSONA,
      // Pisa el `client` de DATOS_DE_LA_PERSONA para sumarle el mail. El resto
      // de lo que ese objeto pide sigue igual, porque `personaDe` lo necesita.
      client: { select: { email: true, profile: { select: { full_name: true, phone: true } } } },
      service: { select: { id: true, name: true, price: true } },
      // El nombre congelado, por si el tratamiento ya no está en el catálogo.
      service_name: true,
      professional: { select: { id: true, full_name: true, is_active: true } },
      // Ver el comentario en el select de la lista.
      professional_name: true,
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
      cancel_reason: t.cancel_reason,
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
      professional_name: t.professional_name,
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
      // `is_active` va también acá: un turno de alguien que ya no atiende tiene
      // que verse en el calendario, no sólo en la tabla.
      professional: { select: { full_name: true, is_active: true } },
      // El nombre congelado: es lo único que queda cuando la ficha del equipo se
      // borró, y sin esto el turno viejo se vería igual que uno sin asignar.
      professional_name: true,
      // De quién es el turno. El calendario mostraba tratamiento y profesional
      // pero NO a la clienta, que es el dato por el que se mira un calendario:
      // "¿quién viene el martes?". Es el mismo `DATOS_DE_LA_PERSONA` de la
      // tabla, así que la invitada y la clienta con cuenta llegan con la misma
      // forma y `personaDe` resuelve cuál es cuál.
      ...DATOS_DE_LA_PERSONA,
    },
  });

  return json({
    turnos: turnos.map((t) => ({
      id: t.id,
      starts_at: t.starts_at.toISOString(),
      status: t.status,
      services: { name: nombreDelTratamiento(t) },
      professionals: t.professional,
      professional_name: t.professional_name,
      person: personaDe(t),
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
 *
 * ── REALIZADO NO SE PUEDE MARCAR ANTES DE QUE EMPIECE ─────────────────────
 *
 * Es lo único que se valida acá, y es una corrección: se podía marcar como
 * realizado un turno de la semana que viene. Un turno que no pasó no se puede
 * haber realizado, y el estado `completed` es el que dice qué se atendió de
 * verdad — si se puede poner sobre el futuro, deja de querer decir eso.
 *
 * El corte es el COMIENZO y no el final. Que la clienta se vaya cinco minutos
 * antes es normal, y hacer esperar a que termine el bloque para poder cerrarlo
 * sería una molestia sin ninguna ganancia.
 *
 * Los otros tres estados no se tocan: cancelar o confirmar un turno futuro es
 * exactamente lo que hay que poder hacer.
 */
export async function cambiarEstado(ctx: Ctx) {
  const id = ctx.params["id"];
  if (!id) return json({ error: "Falta el turno." }, 400);

  const estado = estadoDe(typeof ctx.body["status"] === "string" ? ctx.body["status"] : null);
  if (!estado) return json({ error: "Ese estado no existe." }, 400);

  const turno = await prisma.appointments.findUnique({
    where: { id },
    select: { id: true, starts_at: true },
  });
  if (!turno) return json({ error: "Ese turno no existe." }, 404);

  if (estado === "completed" && turno.starts_at > new Date()) {
    return json(
      { error: "Todavía no llegó la hora de ese turno: no se puede marcar como realizado." },
      422,
    );
  }

  /**
   * El motivo de la cancelación.
   *
   * ⚠️ **Se le manda a la clienta en el mail**, así que no es una nota interna —
   * para eso está `admin_notes`. La pantalla que lo pide lo dice con todas las
   * letras; acá se guarda tal cual llega.
   *
   * Se limpia cuando el turno SALE de cancelado: un turno que se revivió y
   * quedara con el motivo viejo colgado le mandaría a la clienta, en la próxima
   * cancelación, una explicación de la vez pasada.
   */
  const motivo = typeof ctx.body["motivo"] === "string" ? ctx.body["motivo"].trim() : "";

  await prisma.appointments.update({
    where: { id },
    data: {
      status: estado,
      ...(estado === "cancelled" ? { cancel_reason: motivo || null } : { cancel_reason: null }),
    },
  });
  return json({ ok: true });
}

/**
 * Borrar un turno de la base, para siempre.
 *
 * ── ESTO NO REEMPLAZA A CANCELAR, Y LA DIFERENCIA IMPORTA ─────────────────
 *
 * Cancelar deja el turno escrito: queda el horario que se había tomado, el
 * tratamiento, el precio y el hecho de que esa clienta canceló. Borrar no deja
 * nada. Sirve para lo que NUNCA fue un turno —el que se cargó dos veces, el que
 * se cargó en el día equivocado, el de prueba— y para nada más.
 *
 * `PERMISOS.md` decía «sin endpoint: un turno se cancela, no se borra». La
 * policy `delete appointments` existía igual y pedía el permiso `appointments`;
 * esta ruta es esa policy, y pide lo mismo.
 *
 * ── 🔴 UN TURNO QUE TODAVÍA SE VA A ATENDER NO SE BORRA ───────────────────
 *
 * Se cancela primero. No es burocracia: cancelar es lo único que dispara el
 * aviso a la clienta —el mail y el WhatsApp salen del cambio de estado, ver
 * `useCambiarEstadoDeTurno`— así que borrar derecho un turno de mañana le libera
 * el horario al centro y deja a la clienta viniendo a las 11:30 sin que nadie le
 * haya dicho nada.
 *
 * Ya cancelado, o vencido, o realizado, se borra sin más: ahí no hay nadie
 * esperando del otro lado.
 *
 * El chequeo va ADENTRO del `deleteMany` y no en un `findUnique` previo para que
 * la regla y el borrado sean una sola operación: entre leer el estado y borrar,
 * alguien puede estar confirmando ese mismo turno desde el calendario.
 */
export async function borrar(ctx: Ctx) {
  const id = ctx.params["id"];
  if (!id) return json({ error: "Falta el turno." }, 400);

  // El `OR` es la regla escrita al derecho —"ya está cerrado, **o** ya pasó"— y
  // no un `NOT` de las dos condiciones juntas: `NOT` con dos campos se lee de dos
  // maneras distintas y la que documenta Prisma ("todas dan false") sería un NOR,
  // que dejaría sin borrar justo al turno vencido, que es el caso más común.
  const { count } = await prisma.appointments.deleteMany({
    where: {
      id,
      OR: [{ status: { notIn: ["pending", "confirmed"] } }, { starts_at: { lte: new Date() } }],
    },
  });

  // No se borró nada, y hay dos motivos posibles. Se distinguen recién acá para
  // no hacer una consulta de más en el camino normal, que es el que anda.
  if (count === 0) {
    const existe = await prisma.appointments.findUnique({ where: { id }, select: { id: true } });
    if (!existe) return json({ error: "Ese turno no existe." }, 404);
    return json(
      {
        error:
          "Este turno todavía se va a atender. Cancelalo primero —así la clienta recibe el aviso— y después se puede borrar.",
      },
      409,
    );
  }

  return json({ ok: true });
}

/**
 * Moverle el día y la hora a un turno.
 *
 * ── PARA QUÉ ──────────────────────────────────────────────────────────────
 *
 * Es lo que faltaba para un turno VENCIDO. Un turno que se pasó de hora sin que
 * nadie lo cerrara no se arregla asignándole una profesional —eso sería anotar
 * que la atendió alguien que no la atendió— ni marcándolo realizado si no pasó.
 * Lo que corresponde es correrlo a una fecha nueva, y hasta ahora la única forma
 * era cancelarlo y volver a cargarlo, que le pierde el historial y el número de
 * turno.
 *
 * Vale también para uno por venir: la clienta que avisa que no llega, la
 * profesional que se enferma.
 *
 * ── LO QUE NO HACE ────────────────────────────────────────────────────────
 *
 * No toca el estado. Un pendiente sigue pendiente y un confirmado sigue
 * confirmado: mover la hora no cambia si el centro ya dijo que sí. Un vencido,
 * al correrse al futuro, deja de estar vencido solo — «vencido» no es una
 * columna sino la hora comparada con el reloj (ver `estadoVisible`).
 *
 * Un turno CERRADO no se mueve. Realizado ya pasó y cancelado ya no va; si hay
 * que revivirlo, primero se le cambia el estado y después se lo reprograma. Son
 * dos decisiones distintas y conviene que sean dos clics distintos.
 *
 * ── LO QUE SÍ HACE, Y ES FÁCIL DE OLVIDAR ─────────────────────────────────
 *
 * Limpia `reminded_at`. Si al turno ya se le mandó el recordatorio del día
 * previo, moverlo sin borrar esa marca haría que el recordatorio de la fecha
 * NUEVA no salga nunca: la tarea busca por `reminded_at IS NULL` (ver el índice
 * `appointments_pending_reminder_idx`). La clienta se quedaría sin aviso justo
 * en el turno que le cambiamos, que es cuando más falta hace.
 *
 * La superposición NO se chequea acá: la decide el trigger
 * `check_appointment_overlap` dentro de la misma transacción del UPDATE —mirarlo
 * en código sería "fijate si está libre" y después "escribí", con lugar para que
 * entre otra reserva en el medio—. El router traduce su 23P01 al mensaje que ve
 * la pantalla.
 */
export async function reprogramar(ctx: Ctx) {
  const id = ctx.params["id"];
  if (!id) return json({ error: "Falta el turno." }, 400);

  const crudo = ctx.body["starts_at"];
  if (typeof crudo !== "string") return json({ error: "Falta el horario nuevo." }, 400);
  const starts_at = new Date(crudo);
  if (Number.isNaN(starts_at.getTime())) {
    return json({ error: "Ese horario no se entiende." }, 400);
  }

  const turno = await prisma.appointments.findUnique({
    where: { id },
    select: { id: true, status: true },
  });
  if (!turno) return json({ error: "Ese turno no existe." }, 404);

  if (turno.status === "completed" || turno.status === "cancelled") {
    return json(
      {
        error: "Ese turno está cerrado. Cambiale el estado primero y después reprogramalo.",
      },
      422,
    );
  }

  await prisma.appointments.update({
    where: { id },
    data: { starts_at, reminded_at: null },
  });
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

// ─────────────────────────────────────────────────────────────────────────────
// Cambiarle la profesional a un turno
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Las profesionales a las que se le puede pasar este turno.
 *
 * ── POR QUÉ NO ALCANZABA CON LA LISTA PÚBLICA ─────────────────────────────
 *
 * `/api/publico/servicios/:id/profesionales` ya devuelve quién hace un
 * tratamiento, pero para elegir a dónde mudar un turno falta lo que importa:
 * **quién tiene ese horario libre**. Sin eso hay que ir probando una por una y
 * comerse el rechazo de la base cada vez.
 *
 * Cada candidata viene con `libre`, que se calcula acá y no en el WHERE porque
 * la condición depende de dos columnas de la misma fila —`starts_at` y
 * `duration_minutes`— y Prisma no sabe expresar eso sin SQL crudo. Es la misma
 * decisión, con el mismo motivo, que en `miAgenda`.
 *
 * ⚠️ `libre` es una AYUDA PARA ELEGIR, no el candado. El candado sigue siendo
 * el trigger `check_appointment_overlap`, que decide dentro de la misma
 * transacción que la escritura. Entre que esta lista se dibuja y que se aprieta
 * Cambiar puede entrar otra reserva, y ahí manda la base.
 */
export async function profesionalesParaElTurno(ctx: Ctx) {
  const id = ctx.params["id"];
  if (!id) return json({ error: "Falta el turno." }, 400);

  const turno = await prisma.appointments.findUnique({
    where: { id },
    select: { id: true, service_id: true, starts_at: true, duration_minutes: true },
  });
  if (!turno) return json({ error: "Ese turno no existe." }, 404);

  // Si el tratamiento se borró del catálogo no hay con qué filtrar, así que se
  // ofrecen todas las activas. Es el caso raro y la alternativa —no ofrecer
  // ninguna— dejaría el turno sin poder reasignarse nunca.
  const candidatas = await prisma.professionals.findMany({
    where: {
      is_active: true,
      ...(turno.service_id ? { services: { some: { service_id: turno.service_id } } } : {}),
    },
    select: { id: true, full_name: true },
    orderBy: { full_name: "asc" },
  });

  const termina = new Date(turno.starts_at.getTime() + turno.duration_minutes * 60_000);
  // La ventana arranca 8 horas antes: un turno que empezó a la mañana no puede
  // seguir pisando a la tarde, y así se traen pocas filas en vez de la agenda
  // entera.
  const desde = new Date(turno.starts_at.getTime() - 8 * 60 * 60_000);

  const ocupadas = await prisma.appointments.findMany({
    where: {
      professional_id: { in: candidatas.map((c) => c.id) },
      status: { in: ["pending", "confirmed"] },
      id: { not: turno.id },
      starts_at: { gte: desde, lt: termina },
    },
    select: { professional_id: true, starts_at: true, duration_minutes: true },
  });

  const pisadas = new Set(
    ocupadas
      // Dos rangos se pisan si cada uno empieza antes de que termine el otro. El
      // `starts_at < termina` ya lo trajo el WHERE; falta la otra mitad.
      .filter(
        (a) => turno.starts_at < new Date(a.starts_at.getTime() + a.duration_minutes * 60_000),
      )
      .map((a) => a.professional_id),
  );

  return json({
    profesionales: candidatas.map((c) => ({
      id: c.id,
      full_name: c.full_name,
      libre: !pisadas.has(c.id),
    })),
  } satisfies RtaProfesionalesParaElTurno);
}

/**
 * Le cambia la profesional a un turno, o lo deja sin asignar.
 *
 * ── POR QUÉ EXISTE ────────────────────────────────────────────────────────
 *
 * Al desactivar a una profesional, el panel avisaba que le quedaban turnos
 * futuros y recomendaba "reasignarlos o cancelarlos". Reasignar no se podía
 * hacer desde ningún lado: la única salida real era cancelarle el turno a la
 * clienta y volver a sacarlo. El aviso mandaba a hacer algo que no existía.
 *
 * ── LO QUE SE VALIDA, Y LO QUE DEJA VALIDAR LA BASE ───────────────────────
 *
 * Acá: que la profesional exista, esté activa y haga ese tratamiento. Es la
 * misma regla que `validarTurno` le aplica al alta, y no se le perdona a nadie
 * —tampoco a la dueña— porque es una casilla del panel: si no está tildada, lo
 * más probable es que sea un error de carga.
 *
 * La superposición NO se chequea acá, y es a propósito. La decide el trigger
 * `check_appointment_overlap`, dentro de la misma transacción que el UPDATE.
 * Mirarlo en código sería "fijate si está libre" y después "escribí", con lugar
 * para que entre otra reserva en el medio. El router traduce el 23P01 del
 * trigger al mensaje que ve la pantalla.
 *
 * `null` está permitido: el panel puede dejar un turno sin asignar y resolverlo
 * después. Es lo mismo que ya deja hacer el alta.
 */
export async function cambiarProfesional(ctx: Ctx) {
  const id = ctx.params["id"];
  if (!id) return json({ error: "Falta el turno." }, 400);

  const crudo = ctx.body["professional_id"];
  const nuevaId = typeof crudo === "string" && crudo !== "" ? crudo : null;
  // El nombre congelado acompaña SIEMPRE al id, en los dos sentidos: al asignar
  // se escribe, y al desasignar se borra. Dejarlo pegado haría que un turno sin
  // profesional siguiera diciendo el nombre de la anterior.
  let nuevoNombre: string | null = null;

  const turno = await prisma.appointments.findUnique({
    where: { id },
    select: { id: true, service_id: true },
  });
  if (!turno) return json({ error: "Ese turno no existe." }, 404);

  if (nuevaId !== null) {
    const profesional = await prisma.professionals.findFirst({
      where: { id: nuevaId, is_active: true },
      select: { id: true, full_name: true },
    });
    if (!profesional) return json({ error: "Esa profesional no está disponible." }, 422);
    nuevoNombre = profesional.full_name;

    // Sin tratamiento no hay nada que comprobar: se borró del catálogo y el
    // turno conserva sólo el nombre congelado.
    if (turno.service_id) {
      const hace = await prisma.professional_services.findFirst({
        where: { professional_id: nuevaId, service_id: turno.service_id },
        select: { id: true },
      });
      if (!hace) return json({ error: "Esa profesional no realiza ese tratamiento." }, 422);
    }
  }

  await prisma.appointments.update({
    where: { id },
    data: { professional_id: nuevaId, professional_name: nuevoNombre },
  });
  return json({ ok: true });
}
