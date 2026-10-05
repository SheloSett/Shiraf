import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import type { RtaSesionesPendientes } from "@/lib/api-tipos";
import { useAuth } from "@/hooks/useAuth";

/** La clave de caché, exportada para que quien saca una sesión pueda invalidarla. */
export const CLAVE_SESIONES_PENDIENTES = ["sesiones-pendientes"] as const;

/**
 * Las sesiones que le falta sacar a la clienta conectada.
 *
 * La comparten el cartel del header, «Mi cuenta» y la pantalla de reserva bajo
 * la misma clave, así que las tres dicen lo mismo y es un solo pedido.
 *
 * No se pide sin sesión ni para una cuenta del centro: la primera no tiene
 * tratamientos que mirar —quien reservó sin cuenta ve los suyos por su enlace—
 * y la segunda no es una clienta. Sin el `enabled`, cada visitante del sitio
 * dispararía un 401 por página.
 */
export function useSesionesPendientes() {
  const { user, isTeam } = useAuth();

  return useQuery({
    queryKey: CLAVE_SESIONES_PENDIENTES,
    enabled: !!user && !isTeam,
    // Cambia cuando el centro marca una sesión como realizada, que pasa por
    // afuera de esta pestaña. Un minuto alcanza: no es algo que haya que ver al
    // segundo, y el cartel va en todas las páginas.
    staleTime: 60_000,
    queryFn: async () =>
      (await api<RtaSesionesPendientes>("/api/reservar/sesiones-pendientes")).pendientes,
  });
}
