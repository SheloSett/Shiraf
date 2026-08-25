import { useQuery } from "@tanstack/react-query";
import { esDelCentro, sesionQuery } from "@/lib/sesion";

/**
 * Quién está conectada.
 *
 * Antes esto escuchaba `supabase.auth.onAuthStateChange` y consultaba los roles
 * aparte. Ahora es una sola consulta a `/api/auth/me`, compartida con
 * `useAccess()` y con los `beforeLoad` del router bajo la misma clave de caché.
 *
 * ⚠️ No hay suscripción a los cambios de sesión: con una cookie no hay a quién
 * suscribirse. Al entrar y al salir hay que llamar a `olvidarSesion()`.
 */
export function useAuth() {
  const sesion = useQuery(sesionQuery());
  const user = sesion.data ?? null;

  return {
    user,
    loading: sesion.isLoading,
    roles: user?.roles ?? [],
    isAdmin: user?.roles.includes("admin") === true,
    /**
     * Cuenta del centro: la dueña o alguien del equipo.
     *
     * El header lo usa para no ofrecerle "Reservar turno" ni "Mi perfil": esa
     * cuenta no es de una clienta y en el sitio público no le sirve de nada.
     */
    isTeam: esDelCentro(user),
    rolesLoading: sesion.isLoading,
  };
}
