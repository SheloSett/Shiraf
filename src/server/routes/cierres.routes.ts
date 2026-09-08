import { createRouter } from "@/server/http";
import { authMiddleware, soloAdminMiddleware } from "@/server/middleware/auth.middleware";
import { borrar, crear, listar } from "@/server/controllers/cierres.controller";

/**
 * Los días que el centro no abre. Todo es de la dueña.
 *
 * 7/9/2026 — hasta hoy pedía `appointments`, con la idea de que "el 25 no
 * abrimos" era algo que se le podía pedir anotar a la secretaria. La dueña lo
 * pidió al revés: cerrar el centro lo decide ella, y una empleada no tiene por
 * qué ver esa pantalla. El GET también: sólo lo pide la pantalla de Días
 * cerrados, y esa pantalla ya no existe para el equipo. Los turnos que un
 * cierre deja en pie siguen a la vista de quien gestiona turnos, en la pestaña
 * de Turnos — eso sale de /api/turnos, no de acá.
 *
 * Lo viejo, comentado por la regla de este repo:
 *
 *   import { authMiddleware, exigeMiddleware } from "@/server/middleware/auth.middleware";
 *   const gestionarTurnos = [authMiddleware, exigeMiddleware("appointments")] as const;
 */
export const cierresRouter = createRouter("/api/cierres");

const soloLaDuena = [authMiddleware, soloAdminMiddleware] as const;

cierresRouter.get("/", ...soloLaDuena, listar);
cierresRouter.post("/", ...soloLaDuena, crear);
cierresRouter.delete("/:id", ...soloLaDuena, borrar);
