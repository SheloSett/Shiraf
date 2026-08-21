import type { QueryClient } from "@tanstack/react-query";
import { esDelCentro, pedirSesion } from "@/lib/sesion";

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
 */
export async function isTeamAccount(queryClient: QueryClient): Promise<boolean> {
  return esDelCentro(await pedirSesion(queryClient));
}
