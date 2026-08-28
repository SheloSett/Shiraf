import { createRouter } from "@/server/http";
import { authMiddleware, exigeMiddleware } from "@/server/middleware/auth.middleware";
import { metricas } from "@/server/controllers/metricas.controller";

/**
 * Los números del negocio: una sola ruta para las dos pantallas.
 *
 * El Dashboard y Métricas piden lo mismo con distinto rango. Ver la nota de
 * arriba de `metricas.service.ts` sobre por qué no son dos endpoints.
 *
 * `metrics` es un permiso propio, y no se llega a él por ningún otro: tener
 * `appointments` deja ver el precio de un turno, que hace falta para cobrarlo,
 * pero no la facturación del centro ni lo que factura cada profesional.
 */
export const metricasRouter = createRouter("/api/metricas");

metricasRouter.get("/", authMiddleware, exigeMiddleware("metrics"), metricas);
