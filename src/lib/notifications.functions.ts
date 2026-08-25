import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireAuth } from "@/lib/serverfn-auth";
import type { DeliveryResult } from "@/lib/notifications.server";

/**
 * La puerta desde el navegador para mandar el aviso de un turno.
 *
 * Este archivo lo importan las pantallas (`admin.turnos.tsx`, `reservar.tsx`),
 * así que **no puede importar nada de `src/server/` de forma estática**: el
 * guard de TanStack lo frena, y con razón — arrastraría Prisma al bundle.
 *
 * Todo lo que toca la base va con `await import(...)` **adentro del handler**,
 * que es la parte que TanStack borra del bundle del cliente. El envío en sí
 * vive en `notifications.server.ts`, que ninguna pantalla importa.
 */

// ── La puerta desde el navegador ────────────────────────────────────────────

const NotifyInput = z.object({
  appointmentId: z.string().uuid(),
  event: z.enum(["confirmed", "cancelled", "reminder", "new-request"]),
});

/**
 * Manda el mail de un turno.
 *
 * Los permisos van por evento, porque los dos sentidos no son iguales:
 *
 *   · Los avisos a la clienta los manda el centro, así que exigen el permiso
 *     'appointments' — el mismo que hace falta para cambiarle el estado al
 *     turno. Sin esto, cualquier persona con cuenta podría hacer que le llegue
 *     a otra un "tu turno fue cancelado" firmado por Shiraf.
 *
 *   · "new-request" va al centro y lo dispara la clienta al reservar. Ahí el
 *     destinatario es la casilla del centro y nada más, así que alcanza con que
 *     el turno sea suyo.
 */
export const notifyAppointment = createServerFn({ method: "POST" })
  .middleware([requireAuth])
  .validator((data: unknown) => NotifyInput.parse(data))
  .handler(async ({ data, context }): Promise<DeliveryResult> => {
    const { prisma } = await import("@/server/db");

    if (data.event === "new-request") {
      // Una clienta avisando que reservó: tiene que ser SU turno. El chequeo va
      // sobre la base y no sobre lo que manda, que es el id del turno.
      const appointment = await prisma.appointments.findUnique({
        where: { id: data.appointmentId },
        select: { client_id: true },
      });

      if (!appointment || appointment.client_id !== context.userId) {
        throw new Error("Ese turno no es tuyo.");
      }
    } else {
      // El resto de los avisos los manda el centro.
      //
      // Antes esto consultaba las tablas a mano en vez de llamar a
      // has_permission(), porque esa función estaba concedida a `authenticated`
      // y acá la conexión era la service role. Esa distinción desapareció con
      // la RLS: ahora es la misma `puede()` que usa todo el servidor.
      const { accesoDe, puede } = await import("@/server/services/authz.service");
      if (!puede(await accesoDe(context.userId), "appointments")) {
        throw new Error("No tenés permiso para avisar sobre turnos.");
      }
    }

    // Dinámico y adentro del handler, como todo lo demás: notifications.server
    // importa Prisma, así que no puede entrar por un import de nivel superior.
    const { deliverAppointmentEmail } = await import("@/lib/notifications.server");
    return deliverAppointmentEmail(data.appointmentId, data.event);
  });
