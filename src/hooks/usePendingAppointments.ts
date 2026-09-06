import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import type { RtaPendientes } from "@/lib/api-tipos";

/**
 * Los dos números que el panel muestra sin que nadie los vaya a buscar.
 *
 * ── POR QUÉ UNA SOLA CONSULTA Y DOS HOOKS ─────────────────────────────────
 *
 * Los dos números salen del mismo endpoint y los pintan las mismas pantallas.
 * Compartiendo la `queryKey`, react-query hace UNA consulta aunque cuatro
 * componentes distintos pidan los números: cada hook se queda con el suyo.
 *
 * Con dos consultas separadas cada número tendría su propio reloj de refresco,
 * y el resultado sería un menú donde un contador está al día y el otro no.
 *
 * Va como hook y no como consulta suelta porque los muestran varios lugares —el
 * menú lateral, la pestaña "Sin ver", el cartel de Turnos— y así ninguno tiene
 * que acordarse de los detalles de abajo.
 */
function useContadores(enabled: boolean) {
  return useQuery({
    // Cuelga de "admin-appointments" a propósito: cada vez que alguien
    // confirma, cancela, carga o reasigna un turno se invalida esa clave, y así
    // los números se corrigen solos sin tener que acordarse de refrescarlos en
    // cada pantalla que toca turnos.
    queryKey: ["admin-appointments", "contadores"],
    enabled,
    // Los turnos entran solos, desde la web, sin que nadie toque esta pestaña.
    // Sin refetch los números quedarían clavados en lo que había al abrir el
    // panel, que es justo lo que estos contadores vienen a evitar.
    staleTime: 30_000,
    refetchOnWindowFocus: true,
    refetchInterval: 60_000,
    queryFn: () => api<RtaPendientes>("/api/turnos/pendientes"),
  });
}

/**
 * Cuántos turnos entraron por la web que nadie del centro miró todavía.
 *
 * ── EL NOMBRE QUEDÓ VIEJO, EL NÚMERO CAMBIÓ DE SIGNIFICADO (6/9/2026) ─────
 *
 * Contaba los turnos en "pendiente": los que habían entrado por la web y
 * esperaban que alguien del centro los aceptara. Ese estado dejó de existir —la
 * clienta reserva y el turno queda confirmado en el acto—, pero el número hacía
 * DOS trabajos y sólo uno se pidió que desapareciera. El otro era avisar «entró
 * algo nuevo», y sin reemplazo el centro se quedaba sin bandeja de entrada.
 *
 * Así que hoy cuenta los turnos confirmados con `seen_at` en NULL: nadie abrió
 * la ficha. Se apaga solo al abrirla, no hay que marcar nada.
 *
 * El nombre del hook y del archivo se dejan como están a propósito: los importan
 * cuatro pantallas y renombrarlos sería un cambio de superficie en el mismo
 * movimiento que ya toca la base, el panel y los mails. Vale la pena hacerlo,
 * pero solo y en su propio commit.
 *
 * Lo que se cuenta es lo mismo que la persona puede ver en la tabla de Turnos:
 * el endpoint pide el permiso `appointments`.
 *
 * @param enabled falso mientras no se sepa si la persona puede ver turnos, para
 *   no disparar una consulta que el servidor va a rechazar igual.
 */
export function usePendingAppointments(enabled = true) {
  return useContadores(enabled).data?.total ?? 0;
}

/**
 * Cuántos turnos se van a atender y NO tienen profesional asignada.
 *
 * ── POR QUÉ ESTE NÚMERO EXISTE ────────────────────────────────────────────
 *
 * Es trabajo pendiente del centro, no un aviso informativo. El turno está
 * tomado y la clienta lo espera; si nadie le asigna una profesional, el día que
 * llegue no hay quién la atienda. Y a diferencia de un turno sin confirmar, esto
 * no se resuelve solo ni salta a la vista: la fila se ve igual que las demás.
 *
 * Pasa cuando el centro carga un turno sin decidir quién atiende, y también al
 * reasignar uno y dejarlo a medias.
 *
 * @param enabled igual que arriba.
 */
export function useUnassignedAppointments(enabled = true) {
  return useContadores(enabled).data?.sinProfesional ?? 0;
}

/**
 * Cuántos turnos siguen en pie en días que el centro cerró.
 *
 * Es de la misma familia que el de arriba y por el mismo motivo existe como
 * número en el menú: cerrar un día no cancela nada solo —esos turnos son
 * clientas con la confirmación en la mano—, así que quedan esperando que
 * alguien los reprograme o los cancele uno por uno. Hasta entonces, la clienta
 * va a llegar un día en que no hay nadie.
 *
 * Sale del mismo endpoint que los otros dos, así que se refresca con ellos:
 * cada vez que se toca un turno, y cada minuto.
 *
 * @param enabled igual que arriba.
 */
export function useAppointmentsOnClosedDays(enabled = true) {
  return useContadores(enabled).data?.enDiasCerrados ?? 0;
}
