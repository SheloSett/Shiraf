import type { Prisma } from "@prisma/client";
import { prisma } from "@/server/db";
import type { Acceso } from "@/server/services/authz.service";
import {
  enHoraDelCentro,
  ErrorDeRegla,
  nombreDelTratamiento,
  validarTurno,
} from "@/server/services/turnos.service";
import type { SesionPendiente } from "@/lib/api-tipos";

/**
 * Las sesiones que a una clienta le falta sacar, y sacarlas (5/10/2026).
 *
 * ── QUÉ CAMBIÓ, Y QUÉ NO ──────────────────────────────────────────────────
 *
 * Hasta hoy la sesión que sigue de un tratamiento de varias la agendaba SÓLO el
 * centro, desde el panel (`agendarSiguienteSesion` en turnos.controller). La
 * regla estaba escrita en cuatro lugares —el esquema, el panel, la pantalla de
 * reserva y el mail— y decía: "la clienta reserva la primera; las que siguen se
 * coordinan en el centro".
 *
 * La dueña pidió que la clienta pueda sacarla sola y que el sitio se lo
 * recuerde mientras la tenga pendiente. Eso es este archivo. Lo del panel NO
 * cambió: el centro la sigue pudiendo agendar como siempre, con sus propias
 * libertades —adelantar el intervalo, cargar fuera de horario—.
 *
 * ── CUÁNDO UNA SESIÓN ESTÁ «PENDIENTE» ────────────────────────────────────
 *
 * Cuando la anterior está REALIZADA, el tratamiento tiene más sesiones y la
 * que sigue no está reservada. Es la misma condición con la que el panel
 * ofrece su botón, y por el mismo motivo: una sesión 1 que nadie marcó como
 * hecha no es una sesión 1 hecha, y la serie no avanza sola.
 *
 * La definición vive en `dondeQuedo()` y la usan los tres que preguntan: el
 * cartel del sitio, el enlace de la invitada y el aviso del reloj. Escrita tres
 * veces, un día las tres dirían cosas distintas.
 *
 * ── UNA SESIÓN CANCELADA NO CUENTA COMO RESERVADA ─────────────────────────
 *
 * Si la clienta saca la sesión 2 y después la cancela, la sesión 2 le sigue
 * faltando: el cartel vuelve a aparecer y la puede sacar de nuevo. Sin esto,
 * cancelar una sesión dejaba la serie trabada para siempre — la que sigue
 * "ya estaba agendada" y la cancelada no se puede reprogramar.
 */

const UN_DIA = 24 * 60 * 60 * 1000;

/**
 * Hasta cuándo se sigue ofreciendo la sesión que falta, contado desde la última
 * que se hizo.
 *
 * Sin tope, un tratamiento que alguien dejó por la mitad hace un año le seguiría
 * mostrando el cartel para siempre, y un cartel que está siempre deja de leerse.
 * Seis meses es de sobra para cualquier intervalo real entre sesiones. Pasado
 * eso la sesión no se pierde: la agenda el centro desde el panel.
 */
export const DIAS_QUE_SE_OFRECE_UNA_SESION = 180;

/**
 * Con cuánta anticipación sale el aviso de «ya podés reservar la que sigue».
 *
 * Una semana antes del primer día posible: da tiempo a elegir horario sin que
 * el mensaje llegue cuando todavía falta tanto que se olvida.
 */
export const DIAS_DE_ANTICIPACION_DEL_AVISO = 7;

const SELECT_DE_SESION = {
  id: true,
  starts_at: true,
  status: true,
  series_id: true,
  session_number: true,
  sessions_total: true,
  service_id: true,
  variant_id: true,
  professional_id: true,
  duration_minutes: true,
  buffer_minutes: true,
  client_id: true,
  guest_name: true,
  guest_phone: true,
  guest_email: true,
  // Para `nombreDelTratamiento`: el del catálogo primero, el congelado después.
  service_name: true,
  variant_name: true,
  variant: { select: { name: true } },
  // El intervalo sale del CATÁLOGO y no del turno, igual que en el panel: si el
  // centro lo cambia, la fecha que se ofrece tiene que seguir al catálogo.
  service: { select: { name: true, session_interval_days: true } },
} as const;

export type SesionDeSerie = Prisma.appointmentsGetPayload<{ select: typeof SELECT_DE_SESION }>;

/** "2026-10-05" más 21 días → "2026-10-26". Días de almanaque, sin zona. */
function sumarDias(fecha: string, dias: number): string {
  const [a = 0, m = 1, d = 1] = fecha.split("-").map(Number);
  return new Date(Date.UTC(a, m - 1, d + dias)).toISOString().slice(0, 10);
}

/**
 * El primer día en que se puede hacer la sesión que sigue a `anterior`.
 *
 * "AAAA-MM-DD" en el almanaque del centro, o null si el tratamiento no tiene
 * intervalo cargado —ahí cualquier día sirve—.
 *
 * Es un DÍA y no un instante a propósito: "cada 21 días" quiere decir que el
 * día 21 ya se puede, a cualquier hora, y no que hay que esperar a la misma
 * hora del turno anterior. Es la misma cuenta que hace el calendario del panel,
 * que deshabilita por día.
 */
export function desdeCuandoSePuede(anterior: {
  starts_at: Date;
  service: { session_interval_days: number } | null;
}): string | null {
  const dias = anterior.service?.session_interval_days ?? 0;
  if (dias <= 0) return null;
  return sumarDias(enHoraDelCentro(anterior.starts_at).fecha, dias);
}

/**
 * De las sesiones de UNA serie, la última realizada de la que hay que partir —
 * o null si a esa serie no le falta sacar nada.
 *
 * Es LA definición de "sesión pendiente". Ver el comentario de arriba.
 */
function dondeQuedo(sesiones: SesionDeSerie[], ahora: Date): SesionDeSerie | null {
  const hechas = sesiones.filter((s) => s.status === "completed");
  if (hechas.length === 0) return null;

  const ultima = hechas.reduce((mas, s) => (s.session_number > mas.session_number ? s : mas));

  if (ultima.session_number >= ultima.sessions_total) return null;
  // El tratamiento se borró del catálogo: no hay de dónde sacar quién lo hace
  // ni cuánto dura. Mismo criterio que reprogramar.
  if (!ultima.service_id) return null;

  // Ya hay una más adelante que sigue en pie: reservada, o hecha y sin cerrar.
  // `>` y no `=== + 1`: las series viejas pueden tener huecos en la numeración,
  // y lo que importa es que la serie ya avanzó.
  const yaAvanzo = sesiones.some(
    (s) => s.status !== "cancelled" && s.session_number > ultima.session_number,
  );
  if (yaAvanzo) return null;

  if (ultima.starts_at.getTime() < ahora.getTime() - DIAS_QUE_SE_OFRECE_UNA_SESION * UN_DIA) {
    return null;
  }

  return ultima;
}

function agruparPorSerie(sesiones: SesionDeSerie[]): SesionDeSerie[][] {
  const porSerie = new Map<string, SesionDeSerie[]>();
  for (const s of sesiones) {
    const clave = s.series_id ?? s.id;
    const grupo = porSerie.get(clave);
    if (grupo) grupo.push(s);
    else porSerie.set(clave, [s]);
  }
  return [...porSerie.values()];
}

/**
 * Las sesiones que le falta sacar a alguien.
 *
 * `deQuien` es el filtro que dice de quién son los turnos: `{ client_id }` para
 * una clienta con cuenta, `{ id: { in: [...] } }` para una invitada. Lo arma
 * quien llama, que es quien sabe con qué se identificó esa persona.
 */
export async function sesionesPendientes(
  deQuien: Prisma.appointmentsWhereInput,
): Promise<SesionPendiente[]> {
  const sesiones = await prisma.appointments.findMany({
    where: { AND: [deQuien, { sessions_total: { gt: 1 } }] },
    select: SELECT_DE_SESION,
  });

  const ahora = new Date();
  const pendientes: SesionPendiente[] = [];

  for (const serie of agruparPorSerie(sesiones)) {
    const ultima = dondeQuedo(serie, ahora);
    if (!ultima || !ultima.service_id) continue;

    pendientes.push({
      id: ultima.id,
      service_id: ultima.service_id,
      tratamiento: nombreDelTratamiento(ultima),
      session_number: ultima.session_number + 1,
      sessions_total: ultima.sessions_total,
      desde: desdeCuandoSePuede(ultima),
      professional_id: ultima.professional_id,
      duration_minutes: ultima.duration_minutes,
      buffer_minutes: ultima.buffer_minutes,
    });
  }

  // La que se puede hacer antes, primero. Las que no tienen intervalo —se
  // pueden hacer ya— van adelante: "" ordena antes que cualquier fecha.
  return pendientes.sort((a, b) => (a.desde ?? "").localeCompare(b.desde ?? ""));
}

/**
 * El turno del que se parte para sacar la sesión que sigue, si es de quien lo
 * pide.
 *
 * ⚠️ El `deQuien` no es opcional ni decorativo: es lo único que impide que
 * alguien saque la sesión siguiente del tratamiento de otra persona cambiando
 * un id. Es la mitad de la regla que antes ponía la RLS.
 */
export async function sesionAnterior(
  id: string,
  deQuien: Prisma.appointmentsWhereInput,
): Promise<SesionDeSerie | null> {
  return prisma.appointments.findFirst({
    where: { AND: [{ id }, deQuien] },
    select: SELECT_DE_SESION,
  });
}

/** "lunes 26 de octubre", para decirle a alguien desde cuándo puede. */
function fechaLarga(fecha: string): string {
  return new Date(`${fecha}T12:00:00-03:00`).toLocaleDateString("es-AR", {
    weekday: "long",
    day: "numeric",
    month: "long",
    timeZone: "America/Argentina/Buenos_Aires",
  });
}

/**
 * La clienta saca la sesión que sigue a `anterior`.
 *
 * `anterior` ya viene verificado como suyo: sale de `sesionAnterior()`.
 *
 * ── EN QUÉ SE DIFERENCIA DE LA DEL PANEL ──────────────────────────────────
 *
 * En lo que al centro se le perdona y a la clienta no:
 *
 *   · **El intervalo se exige.** En el panel es una propuesta que el centro
 *     puede adelantar a mano —la clienta que se va de viaje—; desde el sitio
 *     es un mínimo. Quien necesite adelantarla tiene que hablar con el centro,
 *     que es quien sabe si en su caso se puede.
 *   · **El horario tiene que entrar en la agenda.** Lo decide `validarTurno`
 *     con el acceso de quien pide, igual que al reservar de cero.
 *   · **Nace sin ver.** Es una reserva que entra por la web, así que cae en la
 *     pestaña «Sin ver» del panel como cualquier otra.
 *
 * Lo que NO cambia: el precio va en 0 —el paquete se cobró en la primera, lo
 * pone `validarTurno` mirando `session_number`— y la persona se copia tal cual
 * del turno anterior, tenga cuenta o no.
 */
export async function sacarLaSesionSiguiente(
  anterior: SesionDeSerie,
  pedido: {
    starts_at: Date;
    /** Si no viene, sigue la misma que atendió la anterior. */
    professional_id: string | null;
    client_notes: string | null;
    /** El de quien pide. Null para una invitada, que no tiene cuenta. */
    acceso: Acceso | null;
  },
): Promise<{ id: string; session_number: number }> {
  if (!anterior.service_id) {
    throw new ErrorDeRegla("Ese tratamiento ya no está disponible. Escribinos y lo vemos.");
  }
  if (anterior.session_number >= anterior.sessions_total) {
    throw new ErrorDeRegla("Ese tratamiento ya no tiene más sesiones.");
  }
  if (anterior.status !== "completed") {
    throw new ErrorDeRegla(
      "Tu sesión anterior todavía no figura como realizada. Escribinos y lo vemos.",
    );
  }

  const serie = anterior.series_id ?? anterior.id;
  const numero = anterior.session_number + 1;

  // Que no se saque dos veces la misma sesión: el botón tocado dos veces, o el
  // centro que ya se la había agendado por teléfono. Las canceladas no cuentan
  // —ver el comentario de arriba del archivo—.
  const yaEsta = await prisma.appointments.findFirst({
    where: {
      OR: [{ id: serie }, { series_id: serie }],
      session_number: { gte: numero },
      status: { not: "cancelled" },
    },
    select: { id: true },
  });
  if (yaEsta) throw new ErrorDeRegla("Esa sesión ya está reservada.");

  if (pedido.starts_at <= anterior.starts_at) {
    throw new ErrorDeRegla("La sesión siguiente tiene que ser después de la anterior.");
  }

  const desde = desdeCuandoSePuede(anterior);
  if (desde && enHoraDelCentro(pedido.starts_at).fecha < desde) {
    throw new ErrorDeRegla(
      `Esta sesión se puede hacer a partir del ${fechaLarga(desde)}: el tratamiento pide ese descanso. Si necesitás adelantarla, escribinos.`,
    );
  }

  const profesionalId = pedido.professional_id ?? anterior.professional_id;

  // La opción es la MISMA que se reservó en la primera: sacar la sesión 2 no es
  // volver a elegir qué se hace.
  const validado = await validarTurno(pedido.acceso, {
    service_id: anterior.service_id,
    variant_id: anterior.variant_id,
    professional_id: profesionalId,
    starts_at: pedido.starts_at,
    session_number: numero,
  });

  // Sin `status` ni `seen_at`: los pone el esquema, confirmado y sin ver, igual
  // que en `reservar`.
  const creado = await prisma.appointments.create({
    data: {
      ...(anterior.client_id
        ? { client_id: anterior.client_id }
        : {
            guest_name: anterior.guest_name,
            guest_phone: anterior.guest_phone,
            guest_email: anterior.guest_email,
          }),
      service_id: anterior.service_id,
      variant_id: anterior.variant_id,
      professional_id: profesionalId,
      starts_at: pedido.starts_at,
      series_id: serie,
      client_notes: pedido.client_notes,
      ...validado,
    },
    select: { id: true },
  });

  return { id: creado.id, session_number: numero };
}

/**
 * Desde qué día se mandan los avisos de «ya podés reservar la que sigue».
 *
 * Fijo y no "los últimos N días" por lo mismo que el corte de `seen_at` en
 * reglas.sql: el día que esto se estrena hay tratamientos empezados hace
 * semanas, y sin el corte la primera corrida del reloj les escribe a todas
 * juntas por algo que el centro ya venía coordinando a mano. Con la fecha
 * fija, el aviso alcanza sólo a las sesiones que se hagan de acá en más.
 *
 * El cartel del sitio no lleva este corte: no le escribe a nadie, sólo se
 * muestra a quien entra.
 */
const AVISOS_DESDE = new Date("2026-10-05T00:00:00-03:00");

/**
 * Las sesiones realizadas a cuya dueña hay que avisarle que ya puede sacar la
 * que sigue. Lo llama la tarea del reloj.
 *
 * Tres condiciones además de la de `dondeQuedo`:
 *
 *   · que todavía no se le haya avisado (`next_session_notices`);
 *   · que la sesión sea de ayer o antes — el día que vino, el centro tiene la
 *     oportunidad de agendarle la que sigue en el mostrador, y un WhatsApp esa
 *     misma tarde pidiéndole que la reserve sería pisarse;
 *   · que falte una semana o menos para el primer día posible.
 */
export async function sesionesParaAvisar(): Promise<
  { anterior: SesionDeSerie; desde: string | null }[]
> {
  const ahora = new Date();

  const candidatas = await prisma.appointments.findMany({
    where: {
      status: "completed",
      sessions_total: { gt: 1 },
      starts_at: { gte: AVISOS_DESDE, lt: new Date(ahora.getTime() - UN_DIA) },
      next_session_notice: { is: null },
    },
    select: SELECT_DE_SESION,
  });
  if (candidatas.length === 0) return [];

  // Las series enteras, de una: hay que mirar las hermanas para saber si la
  // que sigue ya está reservada.
  const series = [...new Set(candidatas.map((c) => c.series_id ?? c.id))];
  const hermanas = await prisma.appointments.findMany({
    where: { OR: [{ id: { in: series } }, { series_id: { in: series } }] },
    select: SELECT_DE_SESION,
  });

  const hoy = enHoraDelCentro(ahora).fecha;
  const salida: { anterior: SesionDeSerie; desde: string | null }[] = [];

  for (const serie of agruparPorSerie(hermanas)) {
    const ultima = dondeQuedo(serie, ahora);
    // Sólo si la última realizada es una de las candidatas: si no, o ya se le
    // avisó, o es de antes del corte, o es de hoy.
    if (!ultima || !candidatas.some((c) => c.id === ultima.id)) continue;

    const desde = desdeCuandoSePuede(ultima);
    if (desde && sumarDias(desde, -DIAS_DE_ANTICIPACION_DEL_AVISO) > hoy) continue;

    salida.push({ anterior: ultima, desde });
  }

  return salida;
}
