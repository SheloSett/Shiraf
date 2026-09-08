import type { QueryClient } from "@tanstack/react-query";
import { cuentaInactiva, esDelCentro, pedirSesion } from "@/lib/sesion";

/**
 * ¿Esta cuenta es del centro (la dueña o alguien del equipo) y no de una
 * clienta?
 *
 * Es la pregunta que decide a dónde va cada quien al ingresar. Nada más: quién
 * puede hacer qué lo decide el servidor.
 *
 * Antes esto consultaba `user_roles` con su propia clave de caché. Ahora sale de
 * la misma sesión que usan los hooks, así que entrar al panel es UNA consulta y
 * no dos: el `beforeLoad` la pide y el header la reusa.
 *
 * 7/9/2026 — se suma la profesional dada de baja. Sin esto iba a /mi-cuenta y
 * veía su cuenta de clienta como si nada hubiera pasado; la dueña pidió que lo
 * único que vea sea el cartel de «Cuenta inactiva», que vive en /admin. La
 * profesional ACTIVA sin rol de equipo sigue como estaba: puede reservar y ver
 * su cuenta de clienta, y entra al panel escribiendo /admin. La línea vieja,
 * comentada por la regla de este repo:
 *
 *   return esDelCentro(await pedirSesion(queryClient));
 */
export async function isTeamAccount(queryClient: QueryClient): Promise<boolean> {
  const sesion = await pedirSesion(queryClient);
  return esDelCentro(sesion) || cuentaInactiva(sesion);
}
