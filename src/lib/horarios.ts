/**
 * Las tres conversiones entre lo que muestran los campos de fecha y hora y lo
 * que entiende el resto del código.
 *
 * Viven en `lib` y no al pie del componente que las usa por dos motivos: las
 * necesitan el selector de horario y los tres diálogos que lo usan, y mezclar
 * funciones sueltas con un componente en el mismo archivo le rompe el
 * hot-reload a Vite (la regla `react-refresh/only-export-components`).
 *
 * Ninguna usa `toLocaleString`: acá no se está formateando texto para leer sino
 * armando el valor exacto que esperan `<input type="date">` y
 * `<input type="time">`. Para mostrar están `formatDateTime` y `formatTime` en
 * shiraf.ts.
 */

/**
 * "2026-08-13" → Date local a medianoche.
 *
 * `new Date("2026-08-13")` lo interpretaría como UTC y, al oeste de Greenwich,
 * devolvería el día anterior. Por eso se arma por partes.
 */
export function parseDateKey(key: string): Date | undefined {
  const [y, m, d] = key.split("-").map(Number);
  if (!y || !m || !d) return undefined;
  const date = new Date(y, m - 1, d);
  return Number.isNaN(date.getTime()) ? undefined : date;
}

/**
 * Date → "HH:MM", el formato que espera <input type="time">.
 *
 * A mano y no con `formatTime()`, que usa toLocaleTimeString: el valor se
 * compara contra el del input para marcar el horario elegido, y alcanza con que
 * el locale devuelva algo distinto de "HH:MM" para que la comparación no case
 * nunca.
 *
 * 26/8/2026 — desde que `formatTime()` lleva `hourCycle: "h23"` devuelve "10:00"
 * y la comparación casaría. Igual se deja a mano, y a propósito: esto no es un
 * texto para leer sino el valor que espera el input, y atarlo a un formateador
 * de presentación significa que el día que alguien le cambie el locale o el
 * formato —como se acaba de hacer— se rompe el marcado del horario elegido, en
 * silencio y lejos de donde se tocó.
 */
export function toTimeInput(iso: string): string {
  const d = new Date(iso);
  return `${`${d.getHours()}`.padStart(2, "0")}:${`${d.getMinutes()}`.padStart(2, "0")}`;
}

/**
 * El día y la hora elegidos, como un instante. Null si falta alguno.
 *
 * Los dos son hora de pared —el reloj del centro—, así que se arma con el
 * constructor local y recién `toISOString()` lo pasa a instante absoluto. Es la
 * misma cuenta que hacía `new Date(valorDelDatetimeLocal)`, sólo que con el día
 * y la hora por separado.
 */
export function instanteDe(dateKey: string, time: string): Date | null {
  const date = parseDateKey(dateKey);
  if (!date || !time) return null;
  const [hh, mm] = time.split(":").map(Number);
  if (hh === undefined || mm === undefined || Number.isNaN(hh) || Number.isNaN(mm)) return null;
  const valor = new Date(date);
  valor.setHours(hh, mm, 0, 0);
  return valor;
}
