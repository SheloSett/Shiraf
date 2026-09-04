import { estaAusente } from "@/lib/shiraf";
import { prisma } from "@/server/db";
import { comoFecha } from "@/server/serializar";
import { ErrorDeAcceso, puede, type Acceso } from "@/server/services/authz.service";

/**
 * Las reglas del turno.
 *
 * Son la traducción de dos triggers de Postgres que hasta ahora corrían SIEMPRE,
 * sin importar quién escribiera: la app, un script o el SQL Editor. Ahora
 * dependen de que el controller las llame. **Si un camino de escritura las
 * saltea, no hay una segunda red.**
 *
 * Los originales están en `supabase/migrations/`:
 *
 *   · `validate_appointment`             → 20260813040000
 *   · `enforce_appointment_client_scope` → 20260819000000  ← ojo con cuál
 *
 * ── 🔴 SOBRE ESE «OJO CON CUÁL» ───────────────────────────────────────────
 *
 * `enforce_appointment_client_scope` va por su cuarta versión y ya se rompió una
 * vez exactamente por copiar de la equivocada: 20260818030000 la reescribió
 * desde 20260813040000 en lugar de desde 20260816020000, revirtió sin querer dos
 * cambios, y dejó a la empleada sin poder confirmar turnos durante días.
 *
 * Lo que se perdió aquella vez, y que acá está puesto:
 *
 *   1. La puerta de arriba pregunta por el PERMISO `appointments`, no por el ROL
 *      admin. La dueña lo cumple siempre; la empleada con «Gestionar turnos»,
 *      también — y es justo la que se había quedado afuera.
 *   2. Los tres `guest_*` están en la lista de campos protegidos.
 *
 * Si algún día hay que tocar esta función, **copiá de 20260819000000 y de
 * ninguna otra.**
 */

const TIMEZONE = "America/Argentina/Buenos_Aires";

/** El error de una regla de negocio: 422, no 403 ni 500. */
export class ErrorDeRegla extends Error {
  readonly status = 422;
  constructor(mensaje: string) {
    super(mensaje);
    this.name = "ErrorDeRegla";
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 1. Qué puede tocar una clienta de su propio turno
//    (enforce_appointment_client_scope, 20260819000000)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Los campos que una clienta NO puede modificar de su propio turno.
 *
 * Que `client_notes` no esté en la lista es deliberado: su nota es suya. Y que
 * `reminded_at` sí esté también: sin eso, cualquiera se escribe una fecha ahí
 * desde el navegador y el recordatorio no le sale nunca.
 */
const CAMPOS_VEDADOS_A_LA_CLIENTA = [
  "client_id",
  "service_id",
  "professional_id",
  "starts_at",
  "duration_minutes",
  "price",
  "admin_notes",
  // Los datos de una invitada los carga el centro sobre alguien SIN cuenta, no
  // la clienta sobre sí misma.
  "guest_name",
  "guest_phone",
  "guest_email",
  "reminded_at",
  "created_at",
] as const;

export type CambioDeTurno = Partial<
  Record<(typeof CAMPOS_VEDADOS_A_LA_CLIENTA)[number] | "status" | "client_notes", unknown>
>;

/**
 * Exige que este cambio esté permitido para quien lo pide.
 *
 * Se llama ANTES de escribir. Quien tiene el permiso `appointments` —la dueña
 * siempre, y la empleada con «Gestionar turnos»— pasa sin más. De ahí para abajo
 * es una clienta sobre un turno propio, y **lo único suyo es cancelarlo y su
 * nota**.
 *
 * ⚠️ Que el turno le pertenezca NO se chequea acá. Antes lo garantizaba la RLS;
 * ahora lo tiene que garantizar el controller, filtrando por `client_id` al
 * buscarlo. Es la mitad que se pierde al salir de Supabase y la más fácil de
 * olvidar.
 */
export function exigirAlcanceDeClienta(
  acceso: Acceso,
  actual: { status: string },
  cambio: CambioDeTurno,
): void {
  if (puede(acceso, "appointments")) return;

  if (cambio.status !== undefined && cambio.status !== actual.status) {
    if (cambio.status !== "cancelled") {
      throw new ErrorDeAcceso("Sólo el centro puede confirmar o cerrar un turno.");
    }
    if (actual.status !== "pending" && actual.status !== "confirmed") {
      throw new ErrorDeRegla("Este turno ya no se puede cancelar.");
    }
  }

  for (const campo of CAMPOS_VEDADOS_A_LA_CLIENTA) {
    if (cambio[campo] !== undefined) {
      throw new ErrorDeAcceso(
        "Para reprogramar el turno escribinos: desde acá sólo podés cancelarlo.",
      );
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 2. Que el turno cierre
//    (validate_appointment, 20260813040000)
// ─────────────────────────────────────────────────────────────────────────────

export type TurnoAValidar = {
  service_id: string;
  /**
   * Qué opción del tratamiento se eligió, si el tratamiento tiene opciones.
   *
   * `null` es lo normal —la mayoría no tiene—, pero si el tratamiento SÍ tiene
   * opciones activas entonces es obligatorio: sin elegir una no hay precio ni
   * duración que valgan. Ver `service_variants`.
   */
  variant_id?: string | null;
  professional_id: string | null;
  starts_at: Date;
  /**
   * Qué sesión de la serie es este turno. 1 —o ausente— es la primera.
   *
   * Sólo lo manda `agendarSiguienteSesion`, que es el único lugar que crea una
   * sesión que no es la primera. Todo lo demás —la reserva de la clienta, el
   * alta del panel— empieza siempre por la 1.
   */
  session_number?: number;
};

export type TurnoValidado = {
  /** Los fija la base, nunca quien llama. Ver abajo. */
  price: string;
  duration_minutes: number;
  /**
   * El margen de limpieza del tratamiento, congelado igual que el precio.
   *
   * Va con los otros congelados y no con un join a `services` porque
   * `service_id` puede quedar en NULL: el turno sobrevive al borrado del
   * tratamiento, y sin esta copia la agenda no sabría cuánto tarda en liberarse
   * la cabina que ese turno ocupó. Ver `appointments.buffer_minutes`.
   */
  buffer_minutes: number;
  /**
   * El nombre del tratamiento, congelado en el turno igual que el precio.
   *
   * Es lo que permite BORRAR un tratamiento del catálogo sin que los turnos
   * viejos queden diciendo "turno de nada": el vínculo se corta, el nombre se
   * queda. Ver `appointments.service_name`.
   */
  service_name: string;

  /**
   * La opción elegida, congelada: "Cuerpo completo".
   *
   * `null` cuando el tratamiento no tiene opciones, que es el caso normal. Se
   * congela por lo mismo que el nombre del tratamiento: apagar o borrar una
   * opción del catálogo no puede dejar al turno viejo sin decir qué se hizo —y
   * acá pesa más todavía, porque el precio de "solo espalda" y el de "cuerpo
   * completo" sólo se distinguen por este nombre.
   */
  variant_name: string | null;

  /**
   * Qué sesión es y de cuántas, congeladas en el turno.
   *
   * 1 de 1 en casi todo el catálogo. Se congelan por lo mismo que el precio: si
   * mañana el tratamiento pasa de 3 sesiones a 4, el turno de quien ya empezó
   * tiene que seguir diciendo "2 de 3". Ver `appointments.sessions_total`.
   */
  session_number: number;
  sessions_total: number;

  /**
   * El nombre de la profesional, congelado igual que el del tratamiento.
   *
   * Va en null cuando el turno se carga sin asignar, que el centro puede hacer.
   */
  professional_name: string | null;
};

/**
 * Valida un turno y devuelve el precio y la duración que hay que guardar.
 *
 * ── LO QUE NO ES NEGOCIABLE NI SIQUIERA PARA LA DUEÑA ─────────────────────
 *
 * `price` y `duration_minutes` salen del tratamiento, siempre, y nunca de lo que
 * mande quien llama. En el original esas dos líneas iban ANTES de cualquier
 * chequeo de permisos, con un comentario que lo explica: son integridad del
 * dato, no autorización. Sin eso, una clienta reserva el tratamiento de $38.000
 * declarando `price: 1` y `duration_minutes: 5`, y encima ocupa menos agenda.
 *
 * El precio queda congelado: es el del día que se reservó, no el actual del
 * catálogo. Por eso `appointments.price` existe como columna en vez de leerse
 * de `services` con un join.
 *
 * El NOMBRE también se congela, en `service_name`, y ése además tiene una razón
 * propia: es lo que deja borrar un tratamiento del catálogo sin que el turno
 * viejo quede sin decir de qué fue.
 *
 * ── LO QUE SÍ SE LE PERDONA AL CENTRO ─────────────────────────────────────
 *
 * Tres cosas, y cada una por un motivo escrito en la migración:
 *
 *   · un turno en el pasado — hace falta para registrar lo que ya pasó por el
 *     mostrador;
 *   · un tratamiento despublicado;
 *   · un horario fuera de la agenda — que una profesional se quede más tarde por
 *     una clienta es normal y el panel tiene que poder registrarlo.
 *
 * Lo que NO se le perdona a nadie: asignarle a una profesional un tratamiento
 * que no realiza. Es una casilla del panel, y si no está tildada lo más probable
 * es que sea un error de carga.
 */
export async function validarTurno(
  acceso: Acceso | null,
  turno: TurnoAValidar,
): Promise<TurnoValidado> {
  const esCentro = acceso !== null && puede(acceso, "appointments");

  const servicio = await prisma.services.findUnique({
    where: { id: turno.service_id },
    select: {
      name: true,
      price: true,
      duration_minutes: true,
      buffer_minutes: true,
      is_published: true,
      sessions_count: true,
      // Sólo las activas: una opción apagada dejó de ofrecerse, así que no se
      // puede reservar ni siquiera desde el panel. Los turnos que ya la tenían
      // no se tocan — para eso está el nombre congelado.
      variants: {
        where: { is_active: true },
        select: { id: true, name: true, price: true, duration_minutes: true, buffer_minutes: true },
        orderBy: [{ position: "asc" }, { created_at: "asc" }],
      },
    },
  });
  if (!servicio) throw new ErrorDeRegla("El tratamiento no existe.");

  /*
   * De dónde salen el precio y la duración.
   *
   * Del tratamiento si no tiene opciones, y de la OPCIÓN si las tiene. Esta es
   * la única regla nueva que trajo `service_variants`, y vive acá adentro por lo
   * mismo que el precio: es integridad del dato, no una comodidad de la
   * pantalla. Si la elección de la opción se hiciera en el navegador y viajara
   * el precio, "solo espalda" se reservaría al precio de "solo espalda" y se
   * cobraría un "cuerpo completo".
   *
   * Con opciones cargadas, elegir una es OBLIGATORIO — también para el centro:
   * `services.price` en ese caso es un número que no se le cobra a nadie, y
   * dejarlo pasar guardaría un turno con un precio inventado.
   */
  const elegida = turno.variant_id
    ? servicio.variants.find((v) => v.id === turno.variant_id)
    : undefined;

  if (servicio.variants.length > 0 && !elegida) {
    throw new ErrorDeRegla(
      turno.variant_id
        ? "Esa opción del tratamiento ya no está disponible."
        : "Hay que elegir una opción del tratamiento.",
    );
  }
  // Al revés: mandar una opción de un tratamiento que no tiene ninguna es un
  // error de quien llama, y callarlo guardaría el turno al precio equivocado.
  if (servicio.variants.length === 0 && turno.variant_id) {
    throw new ErrorDeRegla("Ese tratamiento no tiene opciones para elegir.");
  }

  /*
   * ── LA PLATA DE UN TRATAMIENTO DE VARIAS SESIONES SE COBRA UNA VEZ ───────
   *
   * El precio que carga el centro es el del PAQUETE COMPLETO, no el de cada
   * sesión. Así que se congela entero en la PRIMERA y las siguientes van en 0.
   *
   * Si todas llevaran el precio, cada métrica que suma `appointments.price`
   * —la facturación del mes, lo que gastó una clienta, el ranking de
   * tratamientos— contaría la misma venta tres veces. Y es el error que no se
   * denuncia solo: cada turno mirado de a uno se ve perfecto.
   *
   * Que el turno de la sesión 2 diga $0 no es un agujero: al lado viaja
   * "sesión 2 de 3", y las pantallas escriben "incluido" en vez del número.
   */
  const sesion = turno.session_number ?? 1;

  const validado: TurnoValidado = {
    price: (sesion > 1 ? 0 : (elegida?.price ?? servicio.price)).toString(),
    duration_minutes: elegida?.duration_minutes ?? servicio.duration_minutes,
    buffer_minutes: elegida?.buffer_minutes ?? servicio.buffer_minutes,
    service_name: servicio.name,
    variant_name: elegida?.name ?? null,
    session_number: sesion,
    sessions_total: servicio.sessions_count,
    professional_name: null,
  };

  // Pedir la sesión 4 de un tratamiento de 3 es un error de quien llama, y
  // dejarlo pasar guardaría un turno que ninguna pantalla sabe explicar.
  if (sesion > servicio.sessions_count) {
    throw new ErrorDeRegla("Ese tratamiento no tiene tantas sesiones.");
  }

  if (!servicio.is_published && !esCentro) {
    throw new ErrorDeRegla("Ese tratamiento no está disponible para reservar.");
  }

  if (!esCentro && turno.starts_at <= new Date()) {
    throw new ErrorDeRegla("No se puede reservar un turno en el pasado.");
  }

  if (turno.professional_id === null) {
    // El centro puede dejarlo sin asignar y resolverlo después.
    if (esCentro) return validado;
    throw new ErrorDeRegla("Hay que elegir una profesional.");
  }

  const profesional = await prisma.professionals.findFirst({
    where: { id: turno.professional_id, is_active: true },
    select: { id: true, full_name: true },
  });
  if (!profesional) throw new ErrorDeRegla("Esa profesional no está disponible.");

  // Se congela acá, en el mismo lugar donde ya se congelaban el precio y el
  // nombre del tratamiento, y por el mismo motivo: que borrar la ficha del
  // equipo no borre quién atendió.
  validado.professional_name = profesional.full_name;

  const hace = await prisma.professional_services.findFirst({
    where: { professional_id: turno.professional_id, service_id: turno.service_id },
    select: { id: true },
  });
  if (!hace) throw new ErrorDeRegla("Esa profesional no realiza ese tratamiento.");

  if (!esCentro) {
    await exigirQueEntreEnLaAgenda(
      turno.professional_id,
      turno.starts_at,
      validado.duration_minutes,
    );
  }

  return validado;
}

/**
 * Que el turno entre en el horario de la profesional, y que ese día esté.
 *
 * ── EL HUSO HORARIO NO ES UN DETALLE ──────────────────────────────────────
 *
 * `professional_schedules` guarda TIME sin zona: es hora de pared del centro,
 * que está en Buenos Aires. `starts_at` es un instante absoluto. Compararlos
 * directo hace que una clienta con el reloj en otra zona reserve horarios
 * corridos.
 *
 * En Postgres esto era `starts_at AT TIME ZONE 'America/Argentina/Buenos_Aires'`.
 * Acá lo hace `Intl.DateTimeFormat`, que es la única forma en JavaScript de
 * pasar un instante a hora de pared de una zona concreta sin depender de la
 * configuración de la máquina donde corra el servidor — que en un contenedor es
 * UTC y en la máquina de casa no.
 */
async function exigirQueEntreEnLaAgenda(
  profesionalId: string,
  inicio: Date,
  duracionMinutos: number,
): Promise<void> {
  const fin = new Date(inicio.getTime() + duracionMinutos * 60_000);

  const desde = enHoraDelCentro(inicio);
  const hasta = enHoraDelCentro(fin);

  // Un turno que cruza la medianoche caería en otro día de la semana y rompería
  // la comparación de horas. El original lo cortaba igual.
  if (desde.fecha !== hasta.fecha) {
    throw new ErrorDeRegla("Ese horario está fuera de la agenda de la profesional.");
  }

  const entra = await prisma.professional_schedules.findFirst({
    where: {
      professional_id: profesionalId,
      weekday: desde.diaDeLaSemana,
      start_time: { lte: comoHora(desde.minutosDelDia) },
      end_time: { gte: comoHora(hasta.minutosDelDia) },
    },
    select: { id: true },
  });

  if (!entra) {
    throw new ErrorDeRegla("Ese horario está fuera de la agenda de la profesional.");
  }

  /*
   * ── Y QUE NO SEA UNO DE LOS DÍAS QUE AVISÓ QUE NO VIENE ─────────────────
   *
   * El horario semanal dice "los martes de 12 a 16" y no sabe de excepciones;
   * esto es la excepción. Va DESPUÉS del chequeo de arriba a propósito: un
   * horario fuera de agenda es un error distinto de un día que la profesional
   * no viene, y quien reserva merece leer cuál de los dos le pasó.
   *
   * ⚠️ Este candado es el que importa. La pantalla ya no ofrece esos días
   * —`buildSlots` los descarta—, pero eso es comodidad: un POST armado a mano
   * no pasa por ninguna pantalla. Es el mismo motivo por el que el solape lo
   * sigue frenando la base y no el formulario.
   */
  const tapan = await prisma.professional_absences.findMany({
    // Corte grueso, para traer sólo las que podrían tapar ese día. Quien
    // decide es `estaAusente`, abajo: la regla de que los dos extremos entran
    // está escrita ahí y en ningún otro lado. Es la lección de `yaVencio`, que
    // existe porque "vencido" se había escrito dos veces y se separaron.
    where: {
      professional_id: profesionalId,
      starts_on: { lte: fin },
      ends_on: { gte: inicio },
    },
    select: { starts_on: true, ends_on: true },
  });

  const ausente = estaAusente(
    desde.fecha,
    tapan.map((a) => ({ starts_on: comoFecha(a.starts_on), ends_on: comoFecha(a.ends_on) })),
  );

  if (ausente) {
    throw new ErrorDeRegla("Esa profesional no atiende ese día.");
  }
}

/**
 * ⚠️ Exportado a propósito desde 28/8/2026: lo usa `metricas.service`.
 *
 * Agrupar turnos por día, por hora o por mes es el MISMO problema que validar un
 * horario — pasar un instante absoluto a hora de pared de Buenos Aires— y
 * escribirlo dos veces es garantizar que un día den distinto. Con la zona del
 * proceso (UTC en el contenedor) un turno de las 21:00 cae en el día siguiente y
 * las métricas del lunes se cuentan el martes.
 */
export type HoraDelCentro = {
  /** "2026-08-21", para detectar el cruce de medianoche. */
  fecha: string;
  /** 0 = domingo, igual que EXTRACT(DOW) de Postgres y que WEEKDAYS. */
  diaDeLaSemana: number;
  minutosDelDia: number;
};

export function enHoraDelCentro(instante: Date): HoraDelCentro {
  // en-CA da "2026-08-21" y en-GB da "14:30:00", los dos en 24 horas. Es la
  // forma menos frágil de sacar los componentes sin parsear un texto localizado.
  const fecha = instante.toLocaleDateString("en-CA", { timeZone: TIMEZONE });
  const hora = instante.toLocaleTimeString("en-GB", { timeZone: TIMEZONE, hour12: false });
  const [hh = 0, mm = 0] = hora.split(":").map(Number);

  // El nombre del día en inglés y no getDay(): getDay() usa la zona del proceso,
  // que es justo lo que hay que evitar acá.
  const dia = instante.toLocaleDateString("en-US", { timeZone: TIMEZONE, weekday: "short" });
  const diaDeLaSemana = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(dia);

  return { fecha, diaDeLaSemana, minutosDelDia: hh * 60 + mm };
}

/**
 * Los `@db.Time` de Prisma viajan como Date con la fecha en el epoch: lo que
 * vale es la hora, el día es relleno. Se arma en UTC a propósito, que es como
 * Prisma los lee de la base.
 */
function comoHora(minutosDelDia: number): Date {
  return new Date(Date.UTC(1970, 0, 1, Math.floor(minutosDelDia / 60), minutosDelDia % 60, 0));
}

// ─────────────────────────────────────────────────────────────────────────────
// 4. Cómo se llamaba el tratamiento
// ─────────────────────────────────────────────────────────────────────────────

/**
 * El nombre del tratamiento de un turno, exista todavía en el catálogo o no.
 *
 * `appointments.service_id` es NULL-able desde que un tratamiento se puede
 * borrar: el turno viejo se queda sin vínculo pero conserva `service_name`,
 * congelado el día que se reservó.
 *
 * ── EL ORDEN NO ES CASUAL ─────────────────────────────────────────────────
 *
 * Primero el del catálogo y después el congelado. Así, renombrar un tratamiento
 * sigue arrastrando a todos sus turnos —que es lo que hacía antes y lo que
 * espera quien renombra— y el nombre congelado entra a jugar sólo cuando ya no
 * hay a quién preguntarle.
 *
 * El texto final es para los turnos anteriores a que existiera la columna, que
 * podrían tener las dos cosas en NULL. Con el CHECK
 * `appointments_names_its_service` puesto no debería pasar nunca más.
 */
export function nombreDelTratamiento(turno: {
  service?: { name: string } | null;
  service_name?: string | null;
  variant?: { name: string } | null;
  variant_name?: string | null;
}): string {
  const base = turno.service?.name ?? turno.service_name ?? "Tratamiento eliminado";

  /*
   * La opción va pegada al nombre y no en una columna aparte: "Masaje — cuerpo
   * completo". Con el nombre solo, dos turnos del mismo tratamiento y distinto
   * precio se leen como un error de carga, y eso se ve en todos lados a la vez
   * —la agenda, la tabla de turnos, el mail de confirmación, «mis turnos»—
   * porque todos pasan por esta función.
   *
   * Mismo orden que arriba y por lo mismo: primero el del catálogo, que sigue a
   * quien renombre la opción, y el congelado sólo cuando la opción ya no está.
   */
  const opcion = turno.variant?.name ?? turno.variant_name ?? null;
  return opcion ? `${base} — ${opcion}` : base;
}
