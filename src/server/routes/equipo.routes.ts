import { createRouter } from "@/server/http";
import { authMiddleware, exigeMiddleware } from "@/server/middleware/auth.middleware";
import {
  activar,
  borrar,
  crear,
  editar,
  listar,
  serviciosParaElegir,
  turnosProximos,
  vincularCuenta,
} from "@/server/controllers/equipo.controller";

/**
 * Las fichas del equipo. Todo pide `team`.
 *
 * Dos rutas de acá leen datos de OTRA área, y en las dos el recorte lo hace el
 * controller y no esta columna:
 *
 *   · `/servicios` — el selector del formulario. Muestra los publicados; los
 *     despublicados sólo si además tiene `catalog`.
 *   · `/turnos-proximos` — devuelve vacío si no tiene `appointments`.
 *
 * Las dos podrían haber pedido el otro permiso acá arriba, pero eso dejaría la
 * pantalla rota para quien sólo gestiona el equipo, que es justo el caso que
 * tienen que soportar.
 */
export const equipoRouter = createRouter("/api/equipo");

const soloEquipo = [authMiddleware, exigeMiddleware("team")] as const;

equipoRouter.get("/profesionales", ...soloEquipo, listar);
equipoRouter.get("/servicios", ...soloEquipo, serviciosParaElegir);
equipoRouter.get("/turnos-proximos", ...soloEquipo, turnosProximos);
equipoRouter.post("/profesionales", ...soloEquipo, crear);
equipoRouter.put("/profesionales/:id", ...soloEquipo, editar);
equipoRouter.put("/profesionales/:id/activa", ...soloEquipo, activar);
equipoRouter.delete("/profesionales/:id", ...soloEquipo, borrar);

// ⚠️ Sólo authMiddleware acá, y el candado adentro del controller: atar una
// ficha a una cuenta lo puede hacer SÓLO la dueña, no quien tiene `team`.
// Ponerle exigeMiddleware("team") sería el error exacto que esta ruta tiene que
// evitar — `team` es lo que tiene quien haría el abuso. Ver vincularCuenta.
equipoRouter.put("/vinculo", authMiddleware, vincularCuenta);
