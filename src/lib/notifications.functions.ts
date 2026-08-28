import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireAuth } from "@/lib/serverfn-auth";
import type { NotifyResult } from "@/lib/notifications.server";

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
  /**
   * ⚠️ **Esta lista tiene que tener los MISMOS valores que `AppointmentEvent`**
   * de @/lib/notifications. No es una copia decorativa: es el único lugar donde
   * el evento se valida, así que un valor que falte acá no es un error de tipos
   * —el validador recibe `unknown`— sino un mail que no sale.
   *
   * 27/8/2026: faltaba "rescheduled" y por eso el aviso de "te movimos el
   * turno" NUNCA salió. El mensaje estaba escrito en `buildAppointmentMessage`,
   * el evento estaba en `TO_CLIENT`, y `useReprogramarTurno` lo pedía — pero
   * zod lo rechazaba antes de llegar. Como el hook se traga el fallo del mail
   * para no romper la reprogramación, el síntoma era un toast que decía "Por
   * mail no salió" con un error de validación, en la pantalla que promete
   * "Se le avisa a la clienta con el horario nuevo".
   */
  event: z.enum([
    "requested",
    "confirmed",
    "cancelled",
    "rescheduled",
    "reminder",
    "new-request",
    "client-cancelled",
    "client-rescheduled",
  ]),
});

/**
 * Los avisos que dispara la CLIENTA sobre su propio turno.
 *
 * Los tres salen de dos acciones suyas —reservar y cancelar— y ninguno le puede
 * llegar a otra persona: dos van a la casilla del centro y el tercero
 * ("requested") va a su propia dirección, que el servidor saca de la base y no
 * del pedido.
 *
 * Todo lo que NO esté en esta lista lo manda el centro y exige el permiso
 * 'appointments'. Mover un evento de acá para allá sin pensarlo es dejar que
 * cualquiera con cuenta le haga llegar a otra un "tu turno fue cancelado"
 * firmado por Shiraf.
 */
const LOS_DISPARA_LA_CLIENTA = [
  "new-request",
  "requested",
  "client-cancelled",
  // Se movió el turno sola desde «Mi cuenta». Va al centro, igual que
  // "client-cancelled" y por el mismo motivo: el que tiene que enterarse es
  // quien mira la agenda.
  "client-rescheduled",
] as const;

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
  .handler(async ({ data, context }): Promise<NotifyResult> => {
    const { prisma } = await import("@/server/db");

    if ((LOS_DISPARA_LA_CLIENTA as readonly string[]).includes(data.event)) {
      // Una clienta avisando que reservó o que canceló: tiene que ser SU turno.
      // El chequeo va sobre la base y no sobre lo que manda, que es el id del
      // turno.
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
    const { deliverAppointmentEmail, deliverAppointmentWhatsapp } =
      await import("@/lib/notifications.server");

    /*
     * Los dos canales, y el mail manda el resultado.
     *
     * En serie y no con `Promise.all`: son dos, tardan poco, y con el paralelo
     * un fallo de uno no queda claro cuál fue. Lo que gana el paralelo acá son
     * milisegundos; lo que cuesta es un log confuso a las tres de la mañana.
     *
     * ── POR QUÉ EL WHATSAPP VA APARTE Y NO CAMBIA `sent` ──────────────────
     *
     * Porque `sent` lo leen los toasts del panel, que ya dicen "por mail no
     * salió" con su motivo. Si el WhatsApp entrara en ese mismo booleano, un
     * canal apagado —que es el estado normal hoy— haría que TODOS los avisos se
     * reporten como fallados aunque el mail haya salido perfecto.
     *
     * Entonces viaja en su propio campo, opcional. Las pantallas que hoy sólo
     * miran `sent` y `reason` siguen andando sin tocar una línea, y el día que
     * el canal se encienda hay dónde mirar cómo le fue.
     */
    const mail = await deliverAppointmentEmail(data.appointmentId, data.event);
    const whatsapp = await deliverAppointmentWhatsapp(data.appointmentId, data.event);

    return { ...mail, whatsapp };
  });
