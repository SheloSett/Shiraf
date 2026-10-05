import { json, type Ctx, type Handler } from "@/server/http";
import { claveDeQuienLlama, registrar, type Registro } from "@/server/middleware/loginLimiter";

/**
 * Un tope de pedidos por conexión, para las rutas que se abrieron sin cuenta
 * (5/10/2026).
 *
 * ── POR QUÉ HIZO FALTA ────────────────────────────────────────────────────
 *
 * Hasta hoy reservar pedía sesión, y eso solo ya era un freno: para llenar la
 * agenda de turnos falsos había que crear cuentas. Sin cuenta, lo único que
 * separa a un script de la agenda del centro es esto y el tope de turnos
 * abiertos por teléfono (`MAX_TURNOS_ABIERTOS_POR_TELEFONO`). Son dos frenos
 * distintos a propósito: el del teléfono para quien repite el número, éste para
 * quien lo va cambiando.
 *
 * Y hay un segundo motivo, que pesa igual: cada reserva sin cuenta le manda un
 * WhatsApp al número que se escribió. Sin tope, el formulario es una forma de
 * hacer que el chip del centro le escriba a cualquiera, que es la manera más
 * rápida de que lo baneen.
 *
 * ── LO QUE COMPARTE CON EL DE LOGIN ───────────────────────────────────────
 *
 * De dónde sale la IP y cómo se cuenta: las dos funciones son las de
 * `loginLimiter.ts`, con todo lo que ese archivo explica sobre `TRUST_PROXY`.
 * Lo que no comparte es el contador —cada tope tiene su propio Map— porque
 * equivocarse diez veces la contraseña no tiene por qué dejar a alguien sin
 * poder reservar.
 *
 * Igual que allá: si no se puede saber la IP —desarrollo—, este tope se
 * abstiene en vez de meter a todo el mundo en el mismo balde.
 */
export function limitePorIp(opciones: {
  ventanaMs: number;
  maximo: number;
  /** Qué se le dice a quien se pasó. Recibe los minutos que le faltan. */
  mensaje: (minutos: number) => string;
}): Handler {
  const porIp = new Map<string, Registro>();

  return (ctx: Ctx) => {
    const ip = claveDeQuienLlama(ctx);
    if (!ip) return undefined;

    const { pasado, minutos } = registrar(porIp, ip, opciones.ventanaMs, opciones.maximo);
    return pasado ? json({ error: opciones.mensaje(minutos) }, 429) : undefined;
  };
}
