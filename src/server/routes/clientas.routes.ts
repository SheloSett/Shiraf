import { createRouter } from "@/server/http";
import { authMiddleware } from "@/server/middleware/auth.middleware";
import { json, type Ctx, type Handler } from "@/server/http";
import { accesoDe, exigirAlguno, exigirPermiso } from "@/server/services/authz.service";
// El alta vive en auth.controller y no acá: es el único archivo que escribe
// contraseñas, y tenerla junto a `login` es lo que deja ver que las dos puntas
// usan el mismo bcrypt. Ver `crearCuentaDeClienta`.
import { crearClienta } from "@/server/controllers/auth.controller";
import {
  borrarClienta,
  cancelarMiTurno,
  reprogramarMiTurno,
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

/**
 * Dar de alta una clienta pide `clients_contact` **a secas**, y no el «uno u
 * otro» de arriba.
 *
 * La diferencia es a propósito. `appointments` alcanza para VER la ficha porque
 * la agenda muestra nombres, pero crear una cuenta es otra cosa: queda una
 * clienta que puede entrar al sitio con la contraseña que le pusieron. Quien
 * gestiona turnos y nada más ya tiene su forma de anotar a alguien que no está
 * registrada —la carga como invitada al crear el turno— y esa no crea ninguna
 * cuenta.
 *
 * `clients_contact` es la casilla «Ver datos de clientas», que es la que
 * gobierna la base de clientas como tal. Si esto cambia, tiene que cambiar
 * también el `can()` que esconde el botón en admin.clientes.tsx: si los dos se
 * separan, el botón aparece y el servidor lo rechaza.
 */
const gestionarClientas: Handler = async (ctx: Ctx) => {
  if (!ctx.user) return json({ error: "No autorizado." }, 401);
  exigirPermiso(await accesoDe(ctx.user.id), "clients_contact");
  return undefined;
};

// ── La lista del panel ──────────────────────────────────────────────────────
clientasRouter.get("/clientas", authMiddleware, verClientas, listar);
clientasRouter.post("/clientas", authMiddleware, gestionarClientas, crearClienta);
clientasRouter.get("/clientas/equipo", authMiddleware, verClientas, equipo);
// ⚠️ DESPUÉS de "/clientas/equipo": las rutas se prueban en el orden en que se
// declaran y gana la primera que matchea. Declarada antes, "/clientas/:id" se
// comería a "equipo" y el panel pediría la ficha de una clienta con ese id.
clientasRouter.get("/clientas/:id", authMiddleware, verClientas, verClienta);
// ⚠️ Sin `verClientas`, y no es un olvido: el candado de esta ruta es `admin` y
// está adentro del controller, igual que en las de Equipo y por el mismo motivo.
// Poniéndole el middleware de arriba, cualquiera con `clients_contact` —o con
// `appointments`, que lo arrastra— podría borrar cuentas con su historial. Ver
// borrarClienta.
clientasRouter.delete("/clientas/:id", authMiddleware, borrarClienta);

// ── Mi cuenta: sin permisos, sólo sesión ────────────────────────────────────
// Lo que protege esta mitad no es un permiso sino que TODO sale de la sesión:
// ningún handler de acá acepta un id de clienta que venga del pedido.
clientasRouter.get("/mi-cuenta", authMiddleware, miFicha);
clientasRouter.put("/mi-cuenta", authMiddleware, guardarMiFicha);
clientasRouter.get("/mi-cuenta/turnos", authMiddleware, misTurnos);
clientasRouter.put("/mi-cuenta/turnos/:id/cancelar", authMiddleware, cancelarMiTurno);
// Moverse el propio turno: día, hora y profesional. Mismo corte de horas que
// cancelar, y las mismas reglas de agenda que reservar de cero.
clientasRouter.put("/mi-cuenta/turnos/:id/reprogramar", authMiddleware, reprogramarMiTurno);
