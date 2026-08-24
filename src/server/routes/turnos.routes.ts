import { createRouter } from "@/server/http";
import { authMiddleware, exigeMiddleware } from "@/server/middleware/auth.middleware";
import {
  alcanceDeInvitada,
  calendario,
  cambiarEstado,
  cambiarProfesional,
  clientasParaElegir,
  corregirInvitada,
  crear,
  detalle,
  listar,
  miAgendaDeHoy,
  pendientes,
  profesionalesParaElTurno,
  serviciosParaTurno,
  vincularInvitada,
} from "@/server/controllers/turnos.controller";

/**
 * Los turnos.
 *
 * ⚠️ Mirá la última línea: **«mi agenda» NO pide el permiso `appointments`**, y
 * no es un olvido. Ese permiso es "gestionar los turnos del centro"; ver los
 * propios no lo necesita — una profesional sin ningún acceso tildado entra al
 * panel y ve su agenda, que es exactamente para lo que se hizo.
 *
 * Lo que la protege es que el alcance sale de la sesión: la función no acepta un
 * id de profesional. Ver `miAgendaDeHoy`.
 */
export const turnosRouter = createRouter("/api/turnos");

const gestionarTurnos = [authMiddleware, exigeMiddleware("appointments")] as const;

turnosRouter.get("/", ...gestionarTurnos, listar);
turnosRouter.get("/pendientes", ...gestionarTurnos, pendientes);
turnosRouter.get("/calendario", ...gestionarTurnos, calendario);
turnosRouter.put("/:id/estado", ...gestionarTurnos, cambiarEstado);

// Pasarle el turno a otra profesional. El GET trae las candidatas —las que hacen
// ese tratamiento— y dice cuáles tienen el horario libre. Dos segmentos, así que
// no se pisan con las rutas de un solo segmento de más abajo.
turnosRouter.get("/:id/profesionales", ...gestionarTurnos, profesionalesParaElTurno);
turnosRouter.put("/:id/profesional", ...gestionarTurnos, cambiarProfesional);
turnosRouter.post("/", ...gestionarTurnos, crear);

// El formulario de «Nuevo turno».
turnosRouter.get("/clientas", ...gestionarTurnos, clientasParaElegir);
turnosRouter.get("/servicios", ...gestionarTurnos, serviciosParaTurno);

// Los turnos de invitada: corregir sus datos y pasárselos a una cuenta.
turnosRouter.get("/invitada/alcance", ...gestionarTurnos, alcanceDeInvitada);
turnosRouter.put("/invitada", ...gestionarTurnos, corregirInvitada);
turnosRouter.put("/invitada/vincular", ...gestionarTurnos, vincularInvitada);

// Sólo sesión: el alcance lo pone la sesión, no un permiso.
turnosRouter.get("/mi-agenda", authMiddleware, miAgendaDeHoy);

// ⚠️ ÚLTIMA, y no es cuestión de orden estético: las rutas se prueban en el
// orden en que se declaran y gana la primera que matchea (ver el `for` de
// http.ts). Declarada más arriba, "/:id" se comería a "/pendientes",
// "/calendario", "/clientas", "/servicios" y "/mi-agenda", que también son un
// solo segmento — y el síntoma sería el panel entero pidiendo un turno con id
// "pendientes".
turnosRouter.get("/:id", ...gestionarTurnos, detalle);
