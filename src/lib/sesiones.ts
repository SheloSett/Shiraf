import type { SesionPendiente } from "@/lib/api-tipos";
import { parseDateKey } from "@/lib/horarios";
import { toDateKey } from "@/lib/shiraf";

/**
 * Cómo se le dice a la clienta que le falta una sesión.
 *
 * Lo escriben tres lugares —el cartel del header, «Mi cuenta» y la pantalla de
 * reserva— más el enlace de quien reservó sin cuenta. Viven acá y no al pie del
 * diálogo que los usa por lo mismo que `horarios.ts`: funciones sueltas en el
 * archivo de un componente le rompen el hot-reload a Vite.
 */

/** "lunes 26 de octubre", a partir de "2026-10-26". */
export function diaLargo(dateKey: string): string {
  const fecha = parseDateKey(dateKey);
  if (!fecha) return dateKey;
  return fecha.toLocaleDateString("es-AR", { weekday: "long", day: "numeric", month: "long" });
}

/**
 * El primer día posible de esa sesión todavía no llegó.
 *
 * Se compara como texto: las dos son "AAAA-MM-DD", que ordena igual que como
 * fecha y no arrastra ninguna zona horaria. Es el mismo criterio que usa
 * `buildSlots` con las ausencias.
 */
export function todaviaNoSePuede(pendiente: SesionPendiente): boolean {
  return !!pendiente.desde && pendiente.desde > toDateKey(new Date());
}

/**
 * "La podés hacer desde el lunes 26 de octubre." — o "Ya la podés reservar."
 *
 * Las dos frases y no una sola con la fecha siempre: decirle a alguien "desde
 * el lunes pasado" la deja pensando si se le venció algo.
 */
export function desdeCuando(pendiente: SesionPendiente): string {
  return todaviaNoSePuede(pendiente) && pendiente.desde
    ? `La podés hacer desde el ${diaLargo(pendiente.desde)}.`
    : "Ya la podés reservar.";
}
