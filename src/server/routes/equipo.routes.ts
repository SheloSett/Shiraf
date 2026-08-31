import { createRouter } from "@/server/http";
import { authMiddleware, exigeMiddleware } from "@/server/middleware/auth.middleware";
import {
  activar,
  borrar,
  borrarAusencia,
  activarCuenta,
  cambiarPermiso,
  crear,
  crearAusencia,
  editar,
  listar,
  listarEmpleadas,
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

// Los días que una profesional no está. Piden `team` como el resto de la
// pantalla: es la misma ficha y la misma decisión —cuándo atiende— que los
// horarios semanales de arriba.
equipoRouter.post("/profesionales/:id/ausencias", ...soloEquipo, crearAusencia);
equipoRouter.delete("/ausencias/:id", ...soloEquipo, borrarAusencia);

// ⚠️ Sólo authMiddleware acá, y el candado adentro del controller: atar una
// ficha a una cuenta lo puede hacer SÓLO la dueña, no quien tiene `team`.
// Ponerle exigeMiddleware("team") sería el error exacto que esta ruta tiene que
// evitar — `team` es lo que tiene quien haría el abuso. Ver vincularCuenta.
equipoRouter.put("/vinculo", authMiddleware, vincularCuenta);

// Las empleadas y sus accesos. Mismo caso: el candado es `admin` y va adentro
// del controller — repartir accesos no se delega a un permiso, porque quien lo
// tuviera podría ampliarse a sí mismo cualquier otro.
equipoRouter.get("/empleadas", authMiddleware, listarEmpleadas);
equipoRouter.put("/empleadas/:id/permiso", authMiddleware, cambiarPermiso);
// Dar de baja sin borrar. El candado de "sólo la dueña" está adentro del
// controlador, igual que en los dos de arriba y por el mismo motivo.
equipoRouter.put("/empleadas/:id/activa", authMiddleware, activarCuenta);
