import { createRouter } from "@/server/http";
import { authMiddleware, exigeMiddleware } from "@/server/middleware/auth.middleware";
import {
  borrarDeProductos,
  borrarDeServicios,
  crearDeProductos,
  crearDeServicios,
  listarDeProductos,
  listarDeServicios,
  renombrarDeProductos,
  renombrarDeServicios,
  usoDeProductos,
  usoDeServicios,
} from "@/server/controllers/categorias.controller";

/**
 * Las categorías, de tratamientos y de productos.
 *
 * 🔴 **Mirá la columna de permisos: las de arriba piden `catalog` y las de abajo
 * piden `stock`.** No es un descuido ni una inconsistencia — es la corrección
 * que introdujo la migración `20260814000000`. Las categorías de producto
 * agrupan cremas e insumos internos que no salen en el sitio, así que las
 * maneja quien lleva el stock, no quien edita el catálogo.
 *
 * Que las dos mitades estén en el mismo archivo es a propósito: la diferencia
 * sólo se ve si están una al lado de la otra.
 */
export const categoriasRouter = createRouter("/api/categorias");

// ── Tratamientos ────────────────────────────────────────────────────────────
categoriasRouter.get("/servicios", authMiddleware, exigeMiddleware("catalog"), listarDeServicios);
categoriasRouter.get("/servicios/uso", authMiddleware, exigeMiddleware("catalog"), usoDeServicios);
categoriasRouter.post("/servicios", authMiddleware, exigeMiddleware("catalog"), crearDeServicios);
categoriasRouter.put(
  "/servicios/:id",
  authMiddleware,
  exigeMiddleware("catalog"),
  renombrarDeServicios,
);
categoriasRouter.delete(
  "/servicios/:id",
  authMiddleware,
  exigeMiddleware("catalog"),
  borrarDeServicios,
);

// ── Productos ───────────────────────────────────────────────────────────────
categoriasRouter.get("/productos", authMiddleware, exigeMiddleware("stock"), listarDeProductos);
categoriasRouter.get("/productos/uso", authMiddleware, exigeMiddleware("stock"), usoDeProductos);
categoriasRouter.post("/productos", authMiddleware, exigeMiddleware("stock"), crearDeProductos);
categoriasRouter.put(
  "/productos/:id",
  authMiddleware,
  exigeMiddleware("stock"),
  renombrarDeProductos,
);
categoriasRouter.delete(
  "/productos/:id",
  authMiddleware,
  exigeMiddleware("stock"),
  borrarDeProductos,
);
