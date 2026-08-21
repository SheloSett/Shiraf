import { createRouter } from "@/server/http";
import {
  listarProfesionales,
  listarServicios,
  profesionalesDelServicio,
  verServicio,
} from "@/server/controllers/publico.controller";

/**
 * Lo que se sirve sin cuenta: el catálogo y el equipo.
 *
 * **Ni un solo middleware, y es a propósito.** Es el único archivo de rutas del
 * proyecto donde la columna de la derecha está vacía, así que conviene que se
 * note: cualquiera puede llamar a estas cinco.
 *
 * Lo que las hace seguras no está acá sino en el controller, donde cada consulta
 * filtra por `is_published` o `is_active`. Si alguna vez hace falta una ruta que
 * devuelva algo sin publicar, **no va en este archivo**: va en el de la sección
 * que corresponda, con su `authMiddleware` y su permiso.
 */
export const publicoRouter = createRouter("/api/publico");

publicoRouter.get("/servicios", listarServicios);
publicoRouter.get("/servicios/:id", verServicio);
publicoRouter.get("/servicios/:id/profesionales", profesionalesDelServicio);
publicoRouter.get("/profesionales", listarProfesionales);
