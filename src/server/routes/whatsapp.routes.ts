import { createRouter } from "@/server/http";
import { authMiddleware, soloAdminMiddleware } from "@/server/middleware/auth.middleware";
import { desvincular, estado, qr, reconectar } from "@/server/controllers/whatsapp.controller";

/**
 * La conexión del chip de avisos, desde el panel (11/10/2026). Sólo la dueña:
 * el QR que sale de acá vincula el número del centro a quien lo escanee. El
 * porqué largo está en el controlador.
 */
export const whatsappRouter = createRouter("/api/whatsapp");

const soloLaDuena = [authMiddleware, soloAdminMiddleware] as const;

whatsappRouter.get("/estado", ...soloLaDuena, estado);
whatsappRouter.post("/reconectar", ...soloLaDuena, reconectar);
whatsappRouter.get("/qr", ...soloLaDuena, qr);
whatsappRouter.post("/desvincular", ...soloLaDuena, desvincular);
