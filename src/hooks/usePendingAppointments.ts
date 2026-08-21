import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import type { RtaPendientes } from "@/lib/api-tipos";

/**
 * Cuántos turnos están esperando respuesta.
 *
 * Un turno pedido por la web nace "pendiente" y se queda ahí hasta que alguien
 * del centro lo confirma o lo cancela. Antes no había forma de enterarse sin
 * entrar a Turnos y mirar: este número existe para que la espera se vea desde
 * cualquier pantalla del panel.
 *
 * Va como hook y no como consulta suelta porque lo muestran dos lugares —el
 * menú lateral y la pestaña "Pendiente"— y react-query, al compartir la misma
 * queryKey, hace una sola consulta para los dos.
 *
 * `head: true` pide sólo el conteo: la base no manda ninguna fila. No hace
 * falta ver los turnos para contarlos, y así el número no arrastra datos de
 * clientas a una pantalla que no los va a mostrar.
 *
 * Lo que se cuenta es lo que la RLS deja ver, igual que la tabla de Turnos.
 *
 * @param enabled falso mientras no se sepa si la persona puede ver turnos, para
 *   no disparar una consulta que la base va a rechazar igual.
 */
export function usePendingAppointments(enabled = true) {
  const query = useQuery({
    // Cuelga de "admin-appointments" a propósito: cada vez que alguien
    // confirma, cancela o carga un turno se invalida esa clave, y así el
    // número se corrige solo sin tener que acordarse de refrescarlo en cada
    // pantalla que toca turnos.
    queryKey: ["admin-appointments", "pending-count"],
    enabled,
    // Los turnos entran solos, desde la web, sin que nadie toque esta pestaña.
    // Sin refetch el número quedaría clavado en lo que había al abrir el panel,
    // que es justo lo que este contador viene a evitar.
    staleTime: 30_000,
    refetchOnWindowFocus: true,
    refetchInterval: 60_000,
    queryFn: async () => (await api<RtaPendientes>("/api/turnos/pendientes")).total,
  });

  return query.data ?? 0;
}
