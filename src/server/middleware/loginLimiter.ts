import { json, type Ctx, type Handler } from "@/server/http";

/**
 * Frena los intentos de adivinar una contraseña.
 *
 * Es `loginLimiter.js` de Ecommerce_mm: 10 intentos por IP cada 5 minutos, y
 * **se resetea cuando alguien entra bien**. Ese detalle es el que hace que el
 * limitador no moleste a las personas reales: quien se equivoca dos veces y
 * después acierta vuelve a cero, y el contador queda sólo para quien nunca
 * acierta.
 *
 * ── POR QUÉ EN MEMORIA Y NO EN LA BASE ────────────────────────────────────
 *
 * Allá usan `express-rate-limit`, que también guarda en memoria por defecto.
 * Acá se escribe a mano porque no hay Express, son 40 líneas, y sumar una
 * dependencia para esto no se justifica.
 *
 * Lo que hay que saber de guardarlo en memoria: **se pierde al reiniciar el
 * contenedor**, y no se comparte si algún día hay más de una réplica. Para un
 * centro de estética con cuatro cuentas eso está bien — el ataque que esto
 * frena es el del script que prueba mil contraseñas seguidas, y ése se frena
 * igual. Si alguna vez hay varias réplicas, esto se muda a la base o a Redis.
 */

const VENTANA_MS = 5 * 60 * 1000;
const MAX_INTENTOS = 10;

const intentos = new Map<string, { cuenta: number; hasta: number }>();

/**
 * La IP de quien llama.
 *
 * Detrás del reverse proxy del VPS, `x-forwarded-for` trae la real; el primer
 * valor de la lista es el cliente y el resto son los proxies. Sin proxy, no
 * viene y se cae a un valor fijo — que es lo correcto en desarrollo, donde
 * todas las llamadas salen de la misma máquina igual.
 */
function ip(ctx: Ctx): string {
  const reenviada = ctx.req.headers.get("x-forwarded-for");
  if (reenviada) return reenviada.split(",")[0]!.trim();
  return ctx.req.headers.get("x-real-ip") ?? "local";
}

export const loginLimiter: Handler = (ctx: Ctx) => {
  const clave = ip(ctx);
  const ahora = Date.now();
  const registro = intentos.get(clave);

  if (!registro || ahora > registro.hasta) {
    intentos.set(clave, { cuenta: 1, hasta: ahora + VENTANA_MS });
    return undefined;
  }

  registro.cuenta += 1;

  if (registro.cuenta > MAX_INTENTOS) {
    const minutos = Math.ceil((registro.hasta - ahora) / 60000);
    return json({ error: "Demasiados intentos. Probá de nuevo en " + minutos + " minutos." }, 429);
  }

  return undefined;
};

/** Se llama al entrar bien. Es el `loginLimiter.resetKey(req.ip)` del ecommerce. */
export function resetearIntentos(ctx: Ctx): void {
  intentos.delete(ip(ctx));
}
