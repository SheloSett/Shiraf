import { createRouter } from "@/server/http";
import { authMiddleware, exigeMiddleware } from "@/server/middleware/auth.middleware";
import {
  calendario,
  cambiarEstado,
  listar,
  miAgendaDeHoy,
  pendientes,
} from "@/server/controllers/turnos.controller";

/**
 * Los turnos.
 *
 * ⚠️ Mirá la última línea: **«mi agenda» NO pide el permiso `appointments`**, y
 * no es un olvido. Ese permiso es "gestionar los turnos del centro"; ver los
 * propios no lo necesita — una profesional sin ningún acceso tildado entra al
 * panel y ve su agenda, que es exactamente para lo que se hizo.
 *
 * Lo que la protege es que el alcance sale de la sesión: la función no acepta un
 * id de profesional. Ver `miAgendaDeHoy`.
 */
export const turnosRouter = createRouter("/api/turnos");

const gestionarTurnos = [authMiddleware, exigeMiddleware("appointments")] as const;

turnosRouter.get("/", ...gestionarTurnos, listar);
turnosRouter.get("/pendientes", ...gestionarTurnos, pendientes);
turnosRouter.get("/calendario", ...gestionarTurnos, calendario);
turnosRouter.put("/:id/estado", ...gestionarTurnos, cambiarEstado);

// Sólo sesión: el alcance lo pone la sesión, no un permiso.
turnosRouter.get("/mi-agenda", authMiddleware, miAgendaDeHoy);
