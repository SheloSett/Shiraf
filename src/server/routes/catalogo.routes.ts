import { createRouter } from "@/server/http";
import { authMiddleware, exigeMiddleware } from "@/server/middleware/auth.middleware";
import { borrar, crear, editar, listar, publicar } from "@/server/controllers/catalogo.controller";

/**
 * El catálogo, desde el panel. Todo pide el permiso `catalog`.
 *
 * Ojo con la diferencia respecto de `/api/publico/servicios`, que es la misma
 * tabla vista desde afuera: allá el filtro `is_published` es la regla de
 * seguridad; acá se ven todos, y lo que protege es el permiso de esta columna.
 */
export const catalogoRouter = createRouter("/api/catalogo");

const soloCatalogo = [authMiddleware, exigeMiddleware("catalog")] as const;

catalogoRouter.get("/servicios", ...soloCatalogo, listar);
catalogoRouter.post("/servicios", ...soloCatalogo, crear);
catalogoRouter.put("/servicios/:id", ...soloCatalogo, editar);
catalogoRouter.put("/servicios/:id/publicado", ...soloCatalogo, publicar);
catalogoRouter.delete("/servicios/:id", ...soloCatalogo, borrar);
