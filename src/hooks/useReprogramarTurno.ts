import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { apiPut } from "@/lib/api";
import { appointmentWhatsappUrl, type NotifiableAppointment } from "@/lib/notifications";
import { notifyAppointment } from "@/lib/notifications.functions";
import { openWhatsapp } from "@/hooks/useCambiarEstadoDeTurno";

/**
 * Moverle el día y la hora a un turno.
 *
 * Sigue el mismo molde que `useCambiarEstadoDeTurno`, y las decisiones de fondo
 * están explicadas allá: el mail se manda pero su fracaso no rompe la mutación,
 * y el WhatsApp va en un botón del toast en vez de abrir la pestaña solo.
 *
 * Éste avisa SIEMPRE, no según el estado. Cambiarle el horario a una clienta sin
 * decírselo es la única forma de que se presente el día equivocado: es el aviso
 * que menos se puede saltear de todos.
 */
export function useReprogramarTurno() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      id,
      startsAt,
    }: {
      id: string;
      startsAt: string;
      /** El turno con el horario NUEVO, para redactar el aviso. */
      notify: NotifiableAppointment;
    }) => {
      await apiPut(`/api/turnos/${id}/horario`, { starts_at: startsAt });

      // El horario ya quedó guardado: un mail que no sale no puede hacer que la
      // pantalla diga que el turno no se movió.
      return {
        mail: await notifyAppointment({
          data: { appointmentId: id, event: "rescheduled" },
        }).catch((e: Error) => ({ sent: false as const, reason: e.message })),
      };
    },

    onSuccess: ({ mail }, { notify }) => {
      queryClient.invalidateQueries({ queryKey: ["admin-appointments"] });
      queryClient.invalidateQueries({ queryKey: ["admin-calendar"] });
      queryClient.invalidateQueries({ queryKey: ["turno"] });

      const url = appointmentWhatsappUrl("rescheduled", notify);

      toast.success("El turno se movió.", {
        description: mail.sent ? "Le avisamos por mail." : `Por mail no salió: ${mail.reason}`,
        ...(url
          ? { action: { label: "Avisar", onClick: () => openWhatsapp(url) }, duration: 10000 }
          : {}),
      });
    },

    onError: (e: Error) => toast.error(e.message),
  });
}
