import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type { Session, User } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";
import { isTeamRole, rolesQuery } from "@/lib/roles";

export function useAuth() {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const { data } = supabase.auth.onAuthStateChange((_event, next) => {
      setSession(next);
      setLoading(false);
    });
    supabase.auth.getSession().then(({ data: current }) => {
      setSession(current.session);
      setLoading(false);
    });
    return () => data.subscription.unsubscribe();
  }, []);

  const user: User | null = session?.user ?? null;

  // La consulta se movió a rolesQuery() para que la compartan el header, el
  // panel y los `beforeLoad` del router, que ahora también necesitan saber el
  // rol y no pueden llamar a un hook. Quedaba así:
  //
  //   const roles = useQuery({
  //     queryKey: ["roles", user?.id],
  //     enabled: Boolean(user?.id),
  //     queryFn: async () => {
  //       const { data, error } = await supabase
  //         .from("user_roles")
  //         .select("role")
  //         .eq("user_id", user!.id);
  //       if (error) throw error;
  //       return data.map((r) => r.role);
  //     },
  //   });
  const roles = useQuery({
    ...rolesQuery(user?.id ?? ""),
    enabled: Boolean(user?.id),
  });

  const list = roles.data ?? [];

  return {
    session,
    user,
    loading,
    roles: list,
    isAdmin: list.includes("admin"),
    /**
     * Cuenta del centro: la dueña o alguien del equipo.
     *
     * El header lo usa para no ofrecerle "Reservar turno" ni "Mi perfil": esa
     * cuenta no es de una clienta y en el sitio público no le sirve de nada.
     */
    isTeam: isTeamRole(list),
    rolesLoading: roles.isLoading,
  };
}
