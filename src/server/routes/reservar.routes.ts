import { createRouter } from "@/server/http";
import { authMiddleware } from "@/server/middleware/auth.middleware";
import { disponibilidad, reservar } from "@/server/controllers/reservar.controller";

/**
 * Reservar un turno.
 *
 * Sólo sesión, ningún permiso: es la pantalla de la clienta. Lo que la protege
 * es que `client_id` sale de la sesión y que los horarios ajenos se devuelven
 * sin decir de quién son. Ver el controller.
 */
export const reservarRouter = createRouter("/api/reservar");

reservarRouter.get("/disponibilidad", authMiddleware, disponibilidad);
reservarRouter.post("/", authMiddleware, reservar);
