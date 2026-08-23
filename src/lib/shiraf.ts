export const WEEKDAYS = [
  "Domingo",
  "Lunes",
  "Martes",
  "Miércoles",
  "Jueves",
  "Viernes",
  "Sábado",
] as const;

export const STATUS_LABEL: Record<string, string> = {
  pending: "Pendiente",
  confirmed: "Confirmado",
  completed: "Realizado",
  cancelled: "Cancelado",
};

/**
 * Los mismos cuatro estados de arriba, pero como unión de TypeScript.
 *
 * STATUS_LABEL está tipado `Record<string, string>`: alcanza para poner un
 * cartel en pantalla, pero para el compilador la clave puede ser cualquier
 * texto. Desde que el calendario enlaza a la pestaña correcta de Turnos hace
 * falta lo otro: el enlace lleva el estado en la URL y el router exige que sea
 * uno de los cuatro, no un string suelto.
 */
export const STATUSES = ["pending", "confirmed", "completed", "cancelled"] as const;
export type AppointmentStatus = (typeof STATUSES)[number];

/**
 * El estado, si es uno de los cuatro; null si no.
 *
 * Se usa con datos que vienen de afuera y llegan como `string`: el `status` de
 * la base y el `?estado=` de la URL, que lo escribe cualquiera a mano.
 */
export function toStatus(value: unknown): AppointmentStatus | null {
  return STATUSES.includes(value as AppointmentStatus) ? (value as AppointmentStatus) : null;
}

export function formatMoney(value: number | string | null | undefined) {
  const n = Number(value ?? 0);
  return n.toLocaleString("es-AR", {
    style: "currency",
    currency: "ARS",
    maximumFractionDigits: 0,
  });
}

export function formatDateTime(iso: string) {
  return new Date(iso).toLocaleString("es-AR", {
    weekday: "long",
    day: "2-digit",
    month: "long",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function formatTime(iso: string) {
  return new Date(iso).toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit" });
}

export function formatDay(iso: string) {
  return new Date(iso).toLocaleDateString("es-AR", {
    weekday: "long",
    day: "2-digit",
    month: "long",
  });
}

export function toDateKey(date: Date) {
  const y = date.getFullYear();
  const m = `${date.getMonth() + 1}`.padStart(2, "0");
  const d = `${date.getDate()}`.padStart(2, "0");
  return `${y}-${m}-${d}`;
}

type Schedule = { weekday: number; start_time: string; end_time: string };
type Busy = { starts_at: string; duration_minutes: number };

const MINUTE = 60000;

/**
 * ── LAS PERILLAS DE LA AGENDA ───────────────────────────────────────────────
 * Están acá arriba y a la vista porque no son detalles de implementación: son
 * reglas del negocio. El margen de limpieza ya lo definió el centro; el
 * desborde sigue pendiente. Ver TODO.md.
 */

/**
 * Minutos entre una clienta y la siguiente, para limpiar y preparar la cabina.
 *
 * DEFINIDO POR EL CENTRO (18/8/2026): 10 minutos de limpieza entre clienta y
 * clienta. Antes estaba en 0 y los turnos iban pegados — la que entraba 12:45
 * se cruzaba en la puerta con la que salía.
 *
 * El margen sale del paso entre horarios y también ensancha los bloques ya
 * ocupados, así que vale igual contra un turno existente que entre dos horarios
 * sugeridos. Una profesional de 12 a 16 con sesiones de 45 ofrece ahora
 * 12:00, 12:55, 13:50, 14:45 — cuatro donde antes entraban cinco.
 *
 * Ojo con lo que esto le hace a los horarios: dejan de ser redondos y quedan en
 * :55, :50, :45, que son más incómodos de dictar por teléfono. Si el centro
 * prefiere 12:00 · 13:00 · 14:00 · 15:00, eso es este número en 15 y no en 10:
 * cuesta lo mismo en turnos (también entran cuatro) y se lee mucho mejor. Vale
 * la pena preguntárselo.
 */
export const SLOT_BUFFER_MINUTES = 10;

/**
 * ¿El último turno del día puede terminar después del horario de salida?
 *
 * PENDIENTE, y es LA pregunta para el centro. Con una profesional de 12 a 16,
 * sesiones de 45 minutos y los 10 de limpieza:
 *
 *   false → 12:00, 12:55, 13:50, 14:45   (la última sale 15:30)
 *   true  → ídem + 15:40, que la deja hasta las 16:25
 *
 * Queda en false, que NO es la lista que se pidió —esa incluía las 15:45—, y la
 * razón es en qué dirección duele equivocarse:
 *
 *   En false se ofrece un turno de menos. Se arregla solo: el panel lo puede
 *   cargar igual, porque a propósito no le aplica el control de agenda.
 *
 *   En true una clienta reserva sola, por el sitio, un horario que deja a la
 *   profesional trabajando después de su hora. Eso no se deshace: ya está
 *   comprometido y hay que llamarla para cancelarlo.
 *
 * Además el desborde puede ser grande, porque lo acota la DURACIÓN del
 * tratamiento y no un ratito fijo. Esa misma profesional de 12 a 16, con una
 * depilación de 90, encadena 12:00 y 13:40; en true se le suma 15:20, que
 * termina 16:50 — cincuenta minutos tarde. "Un ratito más" y "casi una hora"
 * son la misma regla, y la regla no sabe distinguirlas.
 *
 * Cuando el centro decida, esto es una sola línea.
 */
export const ALLOW_OVERTIME = false;

/**
 * Los horarios que se le pueden ofrecer a alguien para un tratamiento.
 *
 * Los turnos se ENCADENAN: cada uno arranca cuando termina el anterior, y el
 * paso lo da la duración del tratamiento. Una profesional de 12 a 16 con
 * sesiones de 45 ofrece 12:00, 12:45, 13:30, 14:15, 15:00.
 *
 * Antes esto caminaba una grilla fija de 30 minutos y descartaba lo que pisara
 * un turno. El problema no era estético: tomadas las 12:00, la sesión terminaba
 * 12:45, pero la grilla sólo conocía 12:30 (pisado) y 13:00 — las 12:45 no se
 * ofrecían nunca y esos 15 minutos se perdían. Repetido toda la tarde, entraban
 * cuatro clientas donde entran cinco.
 *
 * Lo que ocupa la agenda es el TURNO, no el servicio: los bloques ocupados
 * llegan de professional_busy_slots(), que devuelve todos los de esa
 * profesional sin importar de qué tratamiento sean. Por eso un masaje tomado a
 * las 12:00 tapa también la depilación de las 12:00, y la de 90 minutos se
 * reacomoda al primer hueco donde entre entera.
 *
 * Es una ayuda para elegir, no el candado: quien decide si el turno se puede
 * crear es la base (validate_appointment y check_appointment_overlap).
 */
export function buildSlots(
  date: Date,
  schedules: Schedule[],
  busy: Busy[],
  durationMinutes: number,
): string[] {
  const weekday = date.getDay();
  const daySchedules = schedules.filter((s) => s.weekday === weekday);
  if (daySchedules.length === 0 || durationMinutes <= 0) return [];

  const now = Date.now();
  const step = (durationMinutes + SLOT_BUFFER_MINUTES) * MINUTE;

  // Cada bloque ocupado se ensancha por el margen de limpieza a los dos lados:
  // así el margen vale tanto contra un turno ya existente como entre dos
  // horarios sugeridos, que lo toman del `step`.
  const blocked = busy
    .map((b) => {
      const from = new Date(b.starts_at).getTime();
      return {
        from: from - SLOT_BUFFER_MINUTES * MINUTE,
        to: from + (b.duration_minutes + SLOT_BUFFER_MINUTES) * MINUTE,
      };
    })
    .sort((a, b) => a.from - b.from);

  const windows = daySchedules.map((s) => ({
    from: atTime(date, s.start_time),
    to: atTime(date, s.end_time),
  }));

  // El desborde vale sólo al cierre del día, nunca en un corte del medio. Si la
  // profesional trabaja 09–13 y 16–20, estirarse a las 13 no es quedarse un
  // rato más: es comerle el almuerzo.
  const closing = Math.max(...windows.map((w) => w.to));

  const slots: string[] = [];

  for (const window of windows) {
    for (const gap of freeGaps(window, blocked)) {
      // Sólo el hueco que llega hasta la hora de salida puede desbordar. Contra
      // otro turno no hay desborde posible: ese tiempo es de otra clienta.
      const canOverrun = ALLOW_OVERTIME && gap.to === closing;

      for (let start = gap.from; ; start += step) {
        const fits = canOverrun ? start < gap.to : start + durationMinutes * MINUTE <= gap.to;
        if (!fits) break;
        // Los horarios ya pasados no se ofrecen, ni siquiera los de esta mañana
        // cuando se mira el día de hoy a la tarde.
        if (start > now) slots.push(new Date(start).toISOString());
      }
    }
  }

  return slots.sort();
}

/**
 * Los tramos libres de una franja de atención, ya descontados los turnos.
 *
 * Es el corazón del encadenado: en vez de probar una grilla contra los turnos,
 * se calculan los huecos reales y cada uno arranca su propia cadena. Por eso el
 * primer horario libre después de un turno es el instante en que ese turno
 * termina, y no el próximo número redondo.
 */
function freeGaps(
  window: { from: number; to: number },
  blocked: readonly { from: number; to: number }[],
): { from: number; to: number }[] {
  const gaps: { from: number; to: number }[] = [];
  let cursor = window.from;

  for (const block of blocked) {
    if (block.to <= cursor) continue; // ya quedó atrás
    if (block.from >= window.to) break; // los que siguen son de después
    if (block.from > cursor) gaps.push({ from: cursor, to: block.from });
    // Math.max y no block.to a secas: dos bloques encimados dejarían el cursor
    // yendo para atrás. La base no debería permitirlos, pero esto no depende de
    // eso para no devolver horarios ocupados.
    cursor = Math.max(cursor, block.to);
    if (cursor >= window.to) break;
  }

  if (cursor < window.to) gaps.push({ from: cursor, to: window.to });
  return gaps;
}

/** "13:30:00" sobre un día → el instante exacto, en hora local. */
function atTime(date: Date, time: string): number {
  const [h = 0, m = 0] = time.split(":").map(Number);
  const value = new Date(date);
  value.setHours(h, m, 0, 0);
  return value.getTime();
}
