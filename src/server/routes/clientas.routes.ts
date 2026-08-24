import { createRouter } from "@/server/http";
import { authMiddleware } from "@/server/middleware/auth.middleware";
import { json, type Ctx, type Handler } from "@/server/http";
import { accesoDe, exigirAlguno } from "@/server/services/authz.service";
import {
  cancelarMiTurno,
  equipo,
  guardarMiFicha,
  listar,
  miFicha,
  misTurnos,
  verClienta,
} from "@/server/controllers/clientas.controller";

/**
 * Dos secciones con dos candados distintos, en el mismo archivo para que la
 * diferencia se vea de un vistazo.
 */
export const clientasRouter = createRouter("/api");

/**
 * `clients_contact` **o** `appointments`, no uno solo.
 *
 * Es la policy `read profiles` tal cual estaba: la pantalla de turnos muestra el
 * nombre y el teléfono de quien reservó, así que una empleada que sólo gestiona
 * turnos tiene que poder leer la ficha. Si se traduce con un permiso solo, la
 * agenda queda mostrando una lista de «—» en vez de nombres.
 */
const verClientas: Handler = async (ctx: Ctx) => {
  if (!ctx.user) return json({ error: "No autorizado." }, 401);
  exigirAlguno(await accesoDe(ctx.user.id), ["clients_contact", "appointments"]);
  return undefined;
};

// ── La lista del panel ──────────────────────────────────────────────────────
clientasRouter.get("/clientas", authMiddleware, verClientas, listar);
clientasRouter.get("/clientas/equipo", authMiddleware, verClientas, equipo);
// ⚠️ DESPUÉS de "/clientas/equipo": las rutas se prueban en el orden en que se
// declaran y gana la primera que matchea. Declarada antes, "/clientas/:id" se
// comería a "equipo" y el panel pediría la ficha de una clienta con ese id.
clientasRouter.get("/clientas/:id", authMiddleware, verClientas, verClienta);

// ── Mi cuenta: sin permisos, sólo sesión ────────────────────────────────────
// Lo que protege esta mitad no es un permiso sino que TODO sale de la sesión:
// ningún handler de acá acepta un id de clienta que venga del pedido.
clientasRouter.get("/mi-cuenta", authMiddleware, miFicha);
clientasRouter.put("/mi-cuenta", authMiddleware, guardarMiFicha);
clientasRouter.get("/mi-cuenta/turnos", authMiddleware, misTurnos);
clientasRouter.put("/mi-cuenta/turnos/:id/cancelar", authMiddleware, cancelarMiTurno);
