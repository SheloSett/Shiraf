import { createRouter } from "@/server/http";
import { limitePorIp } from "@/server/middleware/limitePorIp";
import {
  cancelar,
  reprogramar,
  sacarSesionSiguiente,
  verTurnos,
} from "@/server/controllers/enlace.controller";

/**
 * «Mis turnos» de quien reservó sin cuenta (5/10/2026).
 *
 * **Sin `authMiddleware`, y no es que falte.** Estas cuatro rutas son de alguien
 * que no tiene cuenta: lo que hace de sesión es el `:token` de la URL, que le
 * llegó por WhatsApp. Lo comprueba cada handler —ninguno hace nada antes de
 * resolver de quién es el enlace— y está explicado arriba de enlace.controller.
 *
 * Son el espejo de la mitad «Mi cuenta» de clientas.routes.ts, ruta por ruta.
 */
export const enlaceRouter = createRouter("/api/enlace");

/**
 * Un tope por conexión, generoso a propósito.
 *
 * No está para frenar a la clienta, que abre su enlace y toca tres botones, sino
 * a quien pruebe tokens al voleo. Con 24 caracteres al azar eso no llega a
 * ningún lado ni sin tope; con él, tampoco puede intentarlo a mil por segundo.
 */
const limite = limitePorIp({
  ventanaMs: 5 * 60 * 1000,
  maximo: 120,
  mensaje: (minutos) => `Demasiados pedidos seguidos. Probá de nuevo en ${minutos} minutos.`,
});

enlaceRouter.get("/:token", limite, verTurnos);
enlaceRouter.put("/:token/turnos/:id/cancelar", limite, cancelar);
enlaceRouter.put("/:token/turnos/:id/reprogramar", limite, reprogramar);
enlaceRouter.post("/:token/siguiente-sesion", limite, sacarSesionSiguiente);
