import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { apiPut } from "@/lib/api";
import {
  appointmentWhatsappUrl,
  type AppointmentEvent,
  type NotifiableAppointment,
} from "@/lib/notifications";
import { notifyAppointment } from "@/lib/notifications.functions";
import type { AppointmentStatus } from "@/lib/shiraf";

/**
 * Confirmar, cancelar o marcar realizado un turno, con el aviso a la clienta.
 *
 * Vive acá y no adentro de una pantalla porque ahora son DOS las que lo hacen:
 * la lista de Turnos y la ficha de un turno. Todo lo que sigue estaba escrito
 * en `admin.turnos.tsx`; se mudó tal cual, con sus comentarios, que explican
 * decisiones que costaron y no hay que volver a discutir.
 */

/**
 * De los cambios de estado que hace el panel, cuáles ameritan avisarle a la
 * clienta.
 *
 * "completed" no está a propósito: marcar un turno como realizado es una
 * anotación interna que pasa DESPUÉS de que la clienta estuvo en el centro.
 * Avisarle de eso es mandarle un mensaje para contarle algo que ya vivió.
 */
export const NOTIFIES: Partial<Record<AppointmentStatus, AppointmentEvent>> = {
  confirmed: "confirmed",
  cancelled: "cancelled",
};

/**
 * Un turno en la forma que espera el módulo de avisos.
 *
 * El parámetro se tipa con lo mínimo que se usa y no con el turno entero: así
 * esta función no se rompe cada vez que una pantalla suma o saca un campo.
 */
export function toNotifiable(a: {
  starts_at: string;
  services: { name: string } | null;
  professionals: { full_name: string } | null;
  person: { name: string; phone: string | null };
}): NotifiableAppointment {
  return {
    startsAt: a.starts_at,
    clientName: a.person.name,
    clientPhone: a.person.phone,
    serviceName: a.services?.name ?? null,
    professionalName: a.professionals?.full_name ?? null,
  };
}

/** Abre WhatsApp con el mensaje cargado, en una pestaña aparte. */
export function openWhatsapp(url: string) {
  window.open(url, "_blank", "noopener,noreferrer");
}

export function useCambiarEstadoDeTurno() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      id,
      status,
    }: {
      id: string;
      status: AppointmentStatus;
      notify: NotifiableAppointment;
    }) => {
      await apiPut(`/api/turnos/${id}/estado`, { status });

      const event = NOTIFIES[status];
      if (!event) return { mail: null };

      // El mail se manda acá pero su fracaso NO se propaga: el cambio de estado
      // ya está guardado en la base, y hacer fallar la mutación por un mail que
      // no salió dejaría la pantalla diciendo que el turno no se confirmó cuando
      // sí se confirmó. Se reporta como aviso y el turno queda como quedó.
      return {
        mail: await notifyAppointment({ data: { appointmentId: id, event } }).catch((e: Error) => ({
          sent: false as const,
          reason: e.message,
        })),
      };
    },
    onSuccess: ({ mail }, { status, notify }) => {
      queryClient.invalidateQueries({ queryKey: ["admin-appointments"] });
      queryClient.invalidateQueries({ queryKey: ["admin-calendar"] });
      // La ficha del turno, que es la tercera pantalla que muestra este estado.
      queryClient.invalidateQueries({ queryKey: ["turno"] });

      // El WhatsApp va en un botón del toast y no abriendo la pestaña solo:
      // abrir una desde el callback de una petición ya no cuenta como gesto del
      // usuario y los bloqueadores de popups la comen. Apretar el botón sí.
      //
      // Que además sea opcional es a propósito: hay turnos que se confirman con
      // la clienta al teléfono, ya avisada, y ahí el mensaje sobra.
      const event = NOTIFIES[status];
      const url = event ? appointmentWhatsappUrl(event, notify) : null;

      toast.success("Turno actualizado.", {
        description: mail
          ? mail.sent
            ? "Le avisamos por mail."
            : `Por mail no salió: ${mail.reason}`
          : undefined,
        ...(url
          ? { action: { label: "Avisar", onClick: () => openWhatsapp(url) }, duration: 10000 }
          : {}),
      });
    },
    onError: (e: Error) => toast.error(e.message),
  });
}
