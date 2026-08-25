import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import type { RtaEquipo } from "@/lib/api-tipos";

/** Estable entre renders: devolver un Set nuevo cada vez rompería los useMemo. */
const NONE: ReadonlySet<string> = new Set();

/**
 * Cuáles de los perfiles son del equipo y no clientas.
 *
 * `profiles` tiene una fila por cada cuenta que existe, y ahí no hay nada que
 * diga quién es clienta: el rol vive en `user_roles`. Sin esto, el buscador de
 * "Nuevo turno" y la pantalla de Clientes muestran a las empleadas y a la dueña
 * como si fueran clientas más.
 *
 * Devuelve el dato crudo y no una lista filtrada porque cada pantalla lo usa
 * distinto: Clientes las esconde (es una lista comercial) y Nuevo turno las
 * muestra marcadas (una empleada también se atiende y hay que poder cargarle el
 * turno).
 *
 * Tiene endpoint propio y no se arma consultando los roles desde la pantalla, y
 * el motivo sobrevive a la migración: la policy de `user_roles` dejaba leer el
 * rol propio y, si eras la dueña, el de las demás. Una empleada que la
 * consultara recibía sólo el suyo —sin error, con menos filas— y la lista le
 * salía mezclada igual. El endpoint devuelve nada más que ids.
 *
 * Se cachea 5 minutos: quién es empleada cambia cada varios meses, no entre una
 * pantalla y la otra.
 *
 * @param enabled falso mientras no se sepa si la persona puede ver clientas, para
 *   no disparar una consulta que la base va a devolver vacía igual.
 */
export function useTeamMemberIds(enabled = true): ReadonlySet<string> {
  const query = useQuery({
    queryKey: ["team-member-ids"],
    enabled,
    staleTime: 5 * 60_000,
    queryFn: async () => new Set((await api<RtaEquipo>("/api/clientas/equipo")).ids),
  });

  return query.data ?? NONE;
}
