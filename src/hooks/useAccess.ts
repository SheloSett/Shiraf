import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import type { Permission } from "@/lib/permissions";

/**
 * Qué puede hacer quien está conectada.
 *
 * Esto decide qué se MUESTRA, no qué se puede hacer: lo segundo lo decide la
 * RLS, que es la que vale aunque alguien le pegue directo a la API. Acá se
 * repite la regla para que la pantalla no ofrezca botones que van a fallar.
 *
 * `can()` devuelve true para la dueña siempre, sin mirar la tabla de permisos —
 * es el mismo criterio que has_permission() en la base: el admin está por
 * encima del sistema de permisos, no adentro. Si fuera "un usuario con todas
 * las casillas tildadas", destildárselas la dejaría afuera de su propio panel.
 */
export function useAccess() {
  const { user, loading: authLoading } = useAuth();

  const access = useQuery({
    queryKey: ["access", user?.id],
    enabled: Boolean(user?.id),
    // Los accesos cambian por afuera de esta pestaña: la dueña destilda una
    // casilla desde su propia sesión. Sin esto, la empleada seguía viendo el
    // menú viejo hasta apretar F5.
    //
    // 60s de staleTime + refetch al volver a la pestaña cubre el caso real (la
    // dueña avisa y la empleada mira la pantalla) sin encajarle una consulta a
    // cada render. Igual esto es sólo lo que se MUESTRA: aunque el menú quedara
    // desactualizado un minuto, la RLS ya la está rechazando en la base.
    staleTime: 60_000,
    refetchOnWindowFocus: true,
    refetchInterval: 60_000,
    queryFn: async () => {
      const [roles, permissions] = await Promise.all([
        supabase.from("user_roles").select("role").eq("user_id", user!.id),
        supabase.from("user_permissions").select("permission").eq("user_id", user!.id),
      ]);
      if (roles.error) throw roles.error;
      if (permissions.error) throw permissions.error;
      return {
        roles: (roles.data ?? []).map((r) => r.role),
        permissions: (permissions.data ?? []).map((p) => p.permission as Permission),
      };
    },
  });

  const roles = access.data?.roles ?? [];
  const isAdmin = roles.includes("admin");
  const isStaff = roles.includes("staff");

  return {
    loading: authLoading || access.isLoading,
    isAdmin,
    isStaff,
    /** Entra al panel quien administra o quien trabaja en el centro. */
    canEnterPanel: isAdmin || isStaff,
    permissions: access.data?.permissions ?? [],
    can: (permission: Permission) =>
      isAdmin || (access.data?.permissions ?? []).includes(permission),
  };
}
