import { createRouter, type Ctx, type Handler } from "@/server/http";
import { authMiddleware, sesionOpcionalMiddleware } from "@/server/middleware/auth.middleware";
import { limitePorIp } from "@/server/middleware/limitePorIp";
import {
  disponibilidad,
  misSesionesPendientes,
  reservar,
  sacarMiSesionSiguiente,
} from "@/server/controllers/reservar.controller";

/**
 * Reservar un turno.
 *
 * 5/10/2026 — decía «Sólo sesión, ningún permiso». Ya no hace falta sesión para
 * las dos primeras: se puede reservar con nombre y teléfono. Lo que protege a
 * quien SÍ tiene cuenta no cambió —`client_id` sale de la sesión y los horarios
 * ajenos se devuelven sin decir de quién son—, y a lo que quedó abierto lo
 * frenan el tope de acá abajo y el de turnos por teléfono. Ver el controller.
 */
export const reservarRouter = createRouter("/api/reservar");

/**
 * Diez reservas sin cuenta por hora desde una misma conexión.
 *
 * Es mucho más de lo que hace una persona y muy poco para un script. No se baja
 * más porque los celulares comparten IP: detrás de la misma dirección de una
 * operadora puede haber varias clientas reales reservando la misma tarde.
 */
const limiteSinCuenta = limitePorIp({
  ventanaMs: 60 * 60 * 1000,
  maximo: 10,
  mensaje: (minutos) =>
    `Se hicieron muchas reservas seguidas desde esta conexión. Probá de nuevo en ${minutos} minutos, o escribinos y te lo reservamos nosotras.`,
});

/** El tope corre sólo para quien llega sin cuenta: a la sesión no se le cuenta nada. */
const frenarSinCuenta: Handler = (ctx: Ctx) => (ctx.user ? undefined : limiteSinCuenta(ctx));

// Antes: `reservarRouter.get("/disponibilidad", authMiddleware, disponibilidad);`
// Sin sesión porque la necesita quien todavía no reservó nada. Lo que devuelve
// ya estaba pensado para eso —cuándo y cuánto, nunca de quién—: ver el 🔴 del
// controller y la nota de `horariosOcupados`.
reservarRouter.get("/disponibilidad", disponibilidad);
// Antes: `reservarRouter.post("/", authMiddleware, reservar);`
reservarRouter.post("/", sesionOpcionalMiddleware, frenarSinCuenta, reservar);

// La sesión que sigue de un tratamiento de varias. Estas dos sí piden sesión:
// son de la clienta con cuenta. La que reservó sin cuenta tiene las suyas en
// enlace.routes.ts, colgadas de su enlace personal.
reservarRouter.get("/sesiones-pendientes", authMiddleware, misSesionesPendientes);
reservarRouter.post("/siguiente-sesion", authMiddleware, sacarMiSesionSiguiente);
