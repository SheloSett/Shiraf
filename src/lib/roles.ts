import type { QueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";

export type Role = Database["public"]["Enums"]["app_role"];

/**
 * Los roles de una persona, en una sola definición.
 *
 * Antes esta consulta estaba escrita a mano dentro de useAuth y de useAccess,
 * cada una con su clave de caché. Ahora también la necesitan los `beforeLoad`
 * del router, que corren fuera de React y no pueden usar un hook: si se copiaba
 * una tercera vez, alcanzaba con que una devolviera otra forma de dato para que
 * las dos versiones se pisaran en la caché de react-query bajo la misma clave.
 *
 * El staleTime va acá y no en cada llamada por lo mismo: entrar al panel dispara
 * el `beforeLoad` y además monta el header, y sin esto eran dos consultas
 * idénticas seguidas.
 */
export function rolesQuery(userId: string) {
  return {
    queryKey: ["roles", userId],
    staleTime: 60_000,
    queryFn: async (): Promise<Role[]> => {
      const { data, error } = await supabase
        .from("user_roles")
        .select("role")
        .eq("user_id", userId);
      if (error) throw error;
      return data.map((r) => r.role);
    },
  };
}

/**
 * ¿Esta cuenta es del centro (la dueña o alguien del equipo) y no de una
 * clienta?
 *
 * Es la pregunta que decide a dónde va cada quien al ingresar. Nada más: quién
 * puede hacer qué lo sigue decidiendo la RLS.
 */
export function isTeamRole(roles: readonly Role[]): boolean {
  return roles.includes("admin") || roles.includes("staff");
}

/**
 * La misma pregunta, para los `beforeLoad` del router.
 *
 * Si la consulta falla devuelve `false`, o sea "es una clienta". La dirección
 * del error está elegida: equivocarse hacia false manda a una empleada a
 * /mi-cuenta, que es molesto pero funciona; equivocarse hacia true manda a una
 * clienta al panel, donde se choca con "Acceso restringido" y parece que la app
 * se rompió. Además esto sólo elige a qué pantalla ir — no abre ninguna puerta.
 */
export async function isTeamAccount(queryClient: QueryClient, userId: string): Promise<boolean> {
  try {
    return isTeamRole(await queryClient.ensureQueryData(rolesQuery(userId)));
  } catch {
    return false;
  }
}
