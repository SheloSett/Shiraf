import { prisma } from "@/server/db";
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
  professional_id: string | null;
  starts_at: Date;
};

export type TurnoValidado = {
  /** Los fija la base, nunca quien llama. Ver abajo. */
  price: string;
  duration_minutes: number;
  /**
   * El nombre del tratamiento, congelado en el turno igual que el precio.
   *
   * Es lo que permite BORRAR un tratamiento del catálogo sin que los turnos
   * viejos queden diciendo "turno de nada": el vínculo se corta, el nombre se
   * queda. Ver `appointments.service_name`.
   */
  service_name: string;

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
    select: { name: true, price: true, duration_minutes: true, is_published: true },
  });
  if (!servicio) throw new ErrorDeRegla("El tratamiento no existe.");

  const validado: TurnoValidado = {
    price: servicio.price.toString(),
    duration_minutes: servicio.duration_minutes,
    service_name: servicio.name,
    professional_name: null,
  };

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
 * Que el turno entre en el horario de la profesional.
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
}): string {
  return turno.service?.name ?? turno.service_name ?? "Tratamiento eliminado";
}
