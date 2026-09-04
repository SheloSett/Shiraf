import type { Prisma } from "@prisma/client";
import { prisma } from "@/server/db";
import { nombreDelTratamiento } from "@/server/services/turnos.service";

/**
 * Lo que hacían las funciones de la base sobre turnos y agenda.
 *
 * ── QUÉ SE PERDIÓ AL SACARLAS DE POSTGRES, Y CÓMO SE REEMPLAZA ────────────
 *
 * Las cuatro que se portan acá eran `SECURITY DEFINER`: corrían con los
 * permisos del dueño de la base, salteándose la RLS. Eso les permitía cruzar
 * tablas que quien llamaba no podía leer sueltas —`profiles`, `client_notes`—
 * sin abrirle esas tablas.
 *
 * Ahora **no hay RLS y no hay nada que saltear**: esta conexión ve todo. Lo que
 * antes garantizaba Postgres lo tiene que garantizar el código, y por eso cada
 * función de acá recibe el `userId` de la sesión como PRIMER parámetro y filtra
 * por él.
 *
 * ── LA REGLA QUE NO SE PUEDE ROMPER ───────────────────────────────────────
 *
 * `my_agenda()` en Postgres no tomaba ningún parámetro que nombrara a una
 * profesional, y estaba escrito por qué: si recibiera `_professional_id`,
 * cualquiera podría pedir la agenda de cualquiera. El alcance salía de
 * `auth.uid()`, que viene del token y no se puede falsear.
 *
 * Acá pasa lo mismo con `userId`: **sale de la sesión, nunca del cuerpo del
 * pedido**. Si alguna vez alguien agrega un parámetro `professionalId` a
 * `miAgenda` "para poder reusarla", vuelve a existir el agujero que esa función
 * evitaba desde el primer día.
 */

/** La ficha de profesional atada a esta cuenta, o null. */
export async function miFichaDeProfesional(userId: string): Promise<string | null> {
  const ficha = await prisma.professionals.findFirst({
    // `is_active` no es decorativo: una profesional dada de baja deja de ver la
    // agenda en el acto, sin tener que acordarse de borrarle también la cuenta.
    where: { user_id: userId, is_active: true },
    select: { id: true },
  });
  return ficha?.id ?? null;
}

export type TurnoDeMiAgenda = {
  id: string;
  empiezaEn: Date;
  minutos: number;
  estado: string;
  tratamiento: string;
  clienta: string | null;
  telefono: string | null;
  notasClinicas: string | null;
  notaDeLaReserva: string | null;
  esInvitada: boolean;
};

/**
 * Los próximos turnos de la profesional conectada.
 *
 * Qué entra, igual que en la función original:
 *   · 'pending' y 'confirmed'. Un cancelado no va a pasar y un 'completed' ya
 *     pasó; los dos ensucian una lista que se lee de un vistazo.
 *   · El que está EN CURSO sigue apareciendo: el corte es cuándo TERMINA, no
 *     cuándo empieza. Con `starts_at >= now()` el turno de las 14:00 se borraba
 *     de la pantalla a las 14:01, con la clienta todavía en la camilla.
 *   · Hasta `dias` adelante, para que no se convierta en un año.
 */
/**
 * Las columnas que necesita una fila de agenda, y cómo se arma.
 *
 * Estaban escritas una sola vez porque había una sola consulta. Ahora hay dos
 * —los próximos y el historial— y lo que devuelven tiene que ser idéntico: la
 * misma pantalla las dibuja con el mismo JSX. Si divergen, una de las dos vistas
 * empieza a mostrar "Sin nombre" o a perder las notas y cuesta ver por qué.
 */
const SELECT_DE_AGENDA = {
  id: true,
  starts_at: true,
  duration_minutes: true,
  status: true,
  client_notes: true,
  client_id: true,
  guest_name: true,
  guest_phone: true,
  service: { select: { name: true } },
  // El nombre congelado, por si el tratamiento ya no está en el catálogo.
  service_name: true,
  variant_name: true,
  client: {
    select: {
      profile: { select: { full_name: true, phone: true } },
      client_note: { select: { body: true } },
    },
  },
} as const;

/**
 * La fila que devuelve `SELECT_DE_AGENDA`, derivada del select y no escrita a
 * mano.
 *
 * La escribí a mano primero y ya salía mal en el primer intento: `client_note.
 * body` es nullable en el esquema y yo lo había puesto `string`. Ese es
 * exactamente el problema — un tipo copiado a mano empieza correcto y se pudre
 * en silencio la primera vez que alguien toca el schema. Así, cambiar el select
 * o la base rompe la compilación acá mismo en vez de mentir en producción.
 */
type FilaCruda = Prisma.appointmentsGetPayload<{ select: typeof SELECT_DE_AGENDA }>;

function aTurnoDeMiAgenda(t: FilaCruda): TurnoDeMiAgenda {
  return {
    id: t.id,
    empiezaEn: t.starts_at,
    minutos: t.duration_minutes,
    estado: t.status,
    tratamiento: nombreDelTratamiento(t),
    // La clienta puede ser una invitada: ahí el nombre y el teléfono salen de
    // las columnas guest_*, y `esInvitada` deja que la pantalla lo aclare en
    // vez de mostrar una ficha que no existe.
    clienta: t.client?.profile?.full_name ?? t.guest_name,
    telefono: t.client?.profile?.phone ?? t.guest_phone,
    // Alergias, embarazos, antecedentes. Son las que evitan aplicar algo
    // contraindicado, y por eso las ve — pero SÓLO de sus turnos.
    notasClinicas: t.client?.client_note?.body ?? null,
    notaDeLaReserva: t.client_notes,
    esInvitada: t.client_id === null,
  };
}

export async function miAgenda(userId: string, dias = 30): Promise<TurnoDeMiAgenda[]> {
  const fichaId = await miFichaDeProfesional(userId);

  // Sin ficha no hay agenda. Devolver vacío y no tirar: es el caso de la dueña
  // que no atiende, o de una empleada de stock. No es un error.
  if (!fichaId) return [];

  const ahora = new Date();
  const hasta = new Date(ahora.getTime() + Math.max(dias, 1) * 24 * 60 * 60 * 1000);

  const turnos = await prisma.appointments.findMany({
    where: {
      professional_id: fichaId,
      status: { in: ["pending", "confirmed"] },
      starts_at: { lt: hasta },
    },
    orderBy: { starts_at: "asc" },
    select: SELECT_DE_AGENDA,
  });

  // El corte por "cuándo termina" se hace acá y no en el WHERE porque depende de
  // dos columnas de la misma fila (starts_at + duration_minutes), y Prisma no
  // sabe expresar eso sin caer a SQL crudo. Son unas pocas decenas de filas por
  // profesional: filtrarlas en memoria no cuesta nada y se lee mejor.
  return turnos
    .filter((t) => t.starts_at.getTime() + t.duration_minutes * 60_000 >= ahora.getTime())
    .map(aTurnoDeMiAgenda);
}

/** Tope de filas del historial. Ver `miHistorial`. */
const TOPE_DEL_HISTORIAL = 300;

/**
 * Los turnos YA PASADOS de la profesional conectada.
 *
 * Mismo alcance y misma regla que `miAgenda`: el `userId` sale de la sesión y
 * acá tampoco entra ningún id de profesional. Ver la nota de arriba del archivo.
 *
 * En qué se diferencia de `miAgenda`, y por qué:
 *
 *   · **Entran todos los estados**, cancelados incluidos. En los próximos un
 *     cancelado es ruido porque no va a pasar; en el historial es justamente el
 *     dato — "esta clienta canceló tres veces" es algo que se quiere ver, y una
 *     lista que los esconde miente sobre lo que hubo. La pantalla los marca.
 *   · **Orden descendente**: el historial se lee del último para atrás.
 *   · **Tope de 300 filas** (`TOPE_DEL_HISTORIAL`). No hay paginado todavía; con
 *     la ventana de días que manda la pantalla no se llega ni cerca, pero el
 *     tope está para que el día que alguien pida "todo el año" la consulta no se
 *     traiga miles de filas a la memoria del servidor.
 *
 * El corte es cuándo TERMINA el turno, no cuándo empieza — el mismo criterio que
 * usa `miAgenda` para el turno en curso, y por eso los dos son complementarios:
 * el que está pasando ahora sale en los próximos y NO en el historial. Con
 * criterios distintos, un turno podría terminar apareciendo en las dos listas o
 * en ninguna.
 */
export async function miHistorial(userId: string, dias = 180): Promise<TurnoDeMiAgenda[]> {
  const fichaId = await miFichaDeProfesional(userId);
  if (!fichaId) return [];

  const ahora = new Date();
  const desde = new Date(ahora.getTime() - Math.max(dias, 1) * 24 * 60 * 60 * 1000);

  const turnos = await prisma.appointments.findMany({
    where: {
      professional_id: fichaId,
      starts_at: { gte: desde, lt: ahora },
    },
    orderBy: { starts_at: "desc" },
    take: TOPE_DEL_HISTORIAL,
    select: SELECT_DE_AGENDA,
  });

  // El `take` corre ANTES que este filtro, así que en el peor caso el historial
  // devuelve una fila menos que el tope: la del turno en curso, que se descarta
  // acá porque ya lo muestran los próximos. No vale la pena pedir de más para
  // compensar un desfasaje de una fila en el borde de una lista de 300.
  return turnos
    .filter((t) => t.starts_at.getTime() + t.duration_minutes * 60_000 < ahora.getTime())
    .map(aTurnoDeMiAgenda);
}

/**
 * Los horarios ya tomados de una profesional, para calcular los libres.
 *
 * Era `professional_busy_slots`. No lleva chequeo de permiso y es correcto: la
 * usa el formulario público de /reservar, donde una clienta sin cuenta tiene
 * que poder ver qué horarios quedan. Lo único que devuelve es "ocupado de tal a
 * tal hora, y con tanto margen detrás" — ni quién, ni de qué.
 *
 * El margen es el del turno, congelado: entre dos turnos manda el del que
 * termina, y el que termina es éste. Sin él la pantalla no puede saber dónde
 * empieza el hueco siguiente. Ver `buildSlots`.
 */
export async function horariosOcupados(
  profesionalId: string,
  desde: Date,
  hasta: Date,
  /**
   * Un turno que NO cuenta como ocupado. Es el que se está moviendo.
   *
   * Sin esto, reprogramar se choca contra sí mismo: el turno de las 09:00
   * vuelve entre los ocupados, `buildSlots` le tacha las 09:00, y la clienta
   * no puede quedarse en su horario y cambiar sólo de profesional — ni
   * entiende por qué su propia hora desapareció de la lista.
   *
   * La base ya lo hacía bien: `check_appointment_overlap` tiene
   * `AND a.id <> NEW.id` desde siempre. Lo que faltaba era que la pantalla
   * ofreciera lo que el servidor ya aceptaba.
   */
  excluirId?: string,
): Promise<{ empiezaEn: Date; minutos: number; margen: number }[]> {
  const turnos = await prisma.appointments.findMany({
    where: {
      professional_id: profesionalId,
      status: { in: ["pending", "confirmed"] },
      starts_at: { gte: desde, lt: hasta },
      ...(excluirId ? { id: { not: excluirId } } : {}),
    },
    select: { starts_at: true, duration_minutes: true, buffer_minutes: true },
    orderBy: { starts_at: "asc" },
  });

  return turnos.map((t) => ({
    empiezaEn: t.starts_at,
    minutos: t.duration_minutes,
    margen: t.buffer_minutes,
  }));
}

/**
 * Los tramos en que una profesional no atiende, dentro de una ventana.
 *
 * Sin chequeo de permiso, por lo mismo que `horariosOcupados`: la pantalla de
 * reserva es pública y tiene que poder saber qué días no ofrecer. Lo que
 * devuelve es "de tal día a tal día", sin el motivo — ése es interno y no sale
 * de `equipo.controller`.
 *
 * La consulta es la de dos rangos que se pisan, la misma forma que
 * `check_appointment_overlap`: cada uno empieza antes de que termine el otro.
 * Escrita al revés —`starts_on >= desde AND ends_on <= hasta`— se perdería
 * justo el caso que más importa, el de las vacaciones que ya empezaron y
 * todavía no terminaron.
 */
export async function ausenciasDe(
  profesionalId: string,
  desde: Date,
  hasta: Date,
): Promise<{ empiezaEl: Date; terminaEl: Date }[]> {
  const tramos = await prisma.professional_absences.findMany({
    where: {
      professional_id: profesionalId,
      starts_on: { lte: hasta },
      ends_on: { gte: desde },
    },
    select: { starts_on: true, ends_on: true },
    orderBy: { starts_on: "asc" },
  });

  return tramos.map((a) => ({ empiezaEl: a.starts_on, terminaEl: a.ends_on }));
}

/**
 * El mismo normalizador de teléfonos que hay en la base.
 *
 * Se queda con los últimos 10 dígitos, que en Argentina son área + número, así
 * da igual si alguien anotó el 54, el 9 de celular o ninguno de los dos.
 *
 * ⚠️ Está escrito DOS VECES a propósito: acá y en `prisma/sql/reglas.sql`. No es
 * un descuido — la de SQL existe porque un índice de expresión la necesita, y
 * ésta porque comparar en JavaScript evita traer filas para descartarlas. Las
 * dos tienen que dar el mismo resultado; si se toca una, se toca la otra.
 */
export function normalizarTelefono(valor: string | null | undefined): string | null {
  const digitos = (valor ?? "").replace(/\D/g, "");
  const ultimos = digitos.slice(-10);
  return ultimos.length === 10 ? ultimos : null;
}

/**
 * Pasa los turnos de una invitada al historial de una clienta registrada.
 *
 * Era `link_guest_appointments`. Devuelve cuántos se vincularon, porque agarra
 * TODOS los que tengan ese teléfono y no sólo el que se estaba mirando: si vino
 * cuatro veces, se vinculan los cuatro y conviene que la pantalla lo diga.
 *
 * El permiso lo verifica quien llama, no esta función. Ver la nota de arriba
 * del archivo.
 */
export async function vincularTurnosDeInvitada(
  telefono: string,
  clientaId: string,
): Promise<number> {
  const objetivo = normalizarTelefono(telefono);
  if (!objetivo) {
    throw new Error("Ese turno no tiene un teléfono con el que buscar.");
  }

  const existe = await prisma.profiles.findUnique({
    where: { id: clientaId },
    select: { id: true },
  });
  if (!existe) throw new Error("Esa clienta no existe.");

  // Se traen los candidatos y se filtran acá porque el criterio es sobre
  // normalize_phone(guest_phone), no sobre la columna. En SQL esto usaba el
  // índice de expresión; con Prisma habría que bajar a $queryRaw. Son los
  // turnos de invitadas de un centro de estética — pocos cientos en años.
  const candidatos = await prisma.appointments.findMany({
    where: { client_id: null, guest_phone: { not: null } },
    select: { id: true, guest_phone: true },
  });

  const aVincular = candidatos
    .filter((t) => normalizarTelefono(t.guest_phone) === objetivo)
    .map((t) => t.id);

  if (aVincular.length === 0) return 0;

  const { count } = await prisma.appointments.updateMany({
    where: { id: { in: aVincular } },
    data: { client_id: clientaId, guest_name: null, guest_phone: null, guest_email: null },
  });

  return count;
}

/**
 * Los ids de las cuentas del equipo (todo lo que no sea 'client').
 *
 * Era `team_member_ids`. Lo usan dos pantallas y de forma distinta a propósito:
 * **Clientes** los esconde —una empleada con 0 turnos ensucia la base
 * comercial— y **Nuevo turno** los muestra con la etiqueta «Equipo», porque una
 * empleada también se atiende y hay que poder cargarle el turno.
 */
export async function idsDelEquipo(): Promise<string[]> {
  const roles = await prisma.user_roles.findMany({
    where: { role: { not: "client" } },
    select: { user_id: true },
    distinct: ["user_id"],
  });
  return roles.map((r) => r.user_id);
}
