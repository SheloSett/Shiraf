import { createRouter } from "@/server/http";
import { authMiddleware, exigeMiddleware } from "@/server/middleware/auth.middleware";
import { borrar, crear, listar } from "@/server/controllers/cierres.controller";

/**
 * Los días que el centro no abre. Todo pide `appointments`.
 *
 * Es el mismo permiso que las rutas de /api/turnos y no `team`, como las
 * ausencias de una profesional: cerrar el centro es una decisión de agenda, y
 * lo que deja atrás lo resuelve quien gestiona turnos. El porqué largo está en
 * el controller.
 */
export const cierresRouter = createRouter("/api/cierres");

const gestionarTurnos = [authMiddleware, exigeMiddleware("appointments")] as const;

cierresRouter.get("/", ...gestionarTurnos, listar);
cierresRouter.post("/", ...gestionarTurnos, crear);
cierresRouter.delete("/:id", ...gestionarTurnos, borrar);
