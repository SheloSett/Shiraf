import { createRouter } from "@/server/http";
import { authMiddleware, exigeMiddleware } from "@/server/middleware/auth.middleware";
import { borrar, crear, editar, listar, mover } from "@/server/controllers/stock.controller";

/**
 * El stock. Todo pide `stock`.
 *
 * ⚠️ El permiso `stock_costs` NO aparece en esta columna, y no es un olvido: no
 * hay ninguna ruta que sea "los costos". El costo viaja adentro del producto, y
 * si se pide o no lo decide el controller mirando el permiso. Ponerlo acá
 * obligaría a partir cada ruta en dos.
 */
export const stockRouter = createRouter("/api/stock");

const soloStock = [authMiddleware, exigeMiddleware("stock")] as const;

stockRouter.get("/productos", ...soloStock, listar);
stockRouter.post("/productos", ...soloStock, crear);
stockRouter.put("/productos/:id", ...soloStock, editar);
stockRouter.delete("/productos/:id", ...soloStock, borrar);
stockRouter.post("/productos/:id/movimiento", ...soloStock, mover);
