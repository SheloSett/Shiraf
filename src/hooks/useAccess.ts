import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import type { AccessRequirement, Permission } from "@/lib/permissions";

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
      const [roles, permissions, professional] = await Promise.all([
        supabase.from("user_roles").select("role").eq("user_id", user!.id),
        supabase.from("user_permissions").select("permission").eq("user_id", user!.id),
        // Se pregunta por RPC y no consultando `professionals` derecho para que
        // la pantalla y la base contesten siempre lo mismo: la función es la
        // que también usa my_agenda() para decidir de quién es la agenda, con
        // el `is_active` incluido. Devuelve NULL para quien no sea profesional.
        supabase.rpc("my_professional_id"),
      ]);
      if (roles.error) throw roles.error;
      if (permissions.error) throw permissions.error;
      return {
        roles: (roles.data ?? []).map((r) => r.role),
        permissions: (permissions.data ?? []).map((p) => p.permission as Permission),
        // El error de esta tercera NO se propaga, y es a propósito. Mientras la
        // migración 20260818020000 no esté corrida, la función no existe y
        // PostgREST devuelve error; si eso tumbara la consulta entera, la dueña
        // se quedaría afuera de su propio panel —isAdmin saldría false— por una
        // sección que todavía no existe. Sin la función no hay agenda propia
        // para nadie, que es exactamente el estado anterior.
        professionalId: professional.error ? null : (professional.data ?? null),
      };
    },
  });

  const roles = access.data?.roles ?? [];
  const isAdmin = roles.includes("admin");
  const isStaff = roles.includes("staff");
  /** La ficha de profesional atada a esta cuenta, si hay alguna. */
  const professionalId = access.data?.professionalId ?? null;

  const can = (permission: Permission) =>
    isAdmin || (access.data?.permissions ?? []).includes(permission);

  return {
    loading: authLoading || access.isLoading,
    isAdmin,
    isStaff,
    professionalId,
    /**
     * Entra al panel quien administra, quien trabaja en el centro, y ahora
     * también la profesional que tiene su ficha vinculada: adentro no va a ver
     * más que su propia agenda, pero la puerta es la misma.
     */
    canEnterPanel: isAdmin || isStaff || Boolean(professionalId),
    permissions: access.data?.permissions ?? [],
    can,
    /**
     * Lo mismo que `can`, pero entendiendo los tres niveles que no son
     * permisos. Es lo que usa el panel para decidir qué secciones mostrar y
     * cuáles dejar entrar, con una sola regla en vez de tres condiciones
     * repetidas en cada lugar.
     *
     * Ojo con "own_agenda": es el ÚNICO que la dueña no pasa por ser dueña. No
     * es un candado, es que no habría nada que mostrarle — una agenda propia
     * sale de tener una ficha de profesional, y si la dueña también atiende,
     * alcanza con vincularle la suya desde Equipo.
     */
    allows: (requirement: AccessRequirement) =>
      requirement === "admin"
        ? isAdmin
        : requirement === "panel"
          ? isAdmin || isStaff || Boolean(professionalId)
          : requirement === "own_agenda"
            ? Boolean(professionalId)
            : can(requirement),
  };
}
