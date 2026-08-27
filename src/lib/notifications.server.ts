import { CONTACT } from "@/lib/contact";
import {
  buildAppointmentMessage,
  buildOverdueDigest,
  type TurnoVencido,
  type AppointmentEvent,
  type AppointmentMessage,
  type NotifiableAppointment,
} from "@/lib/notifications";

/**
 * El envío de los mails de turnos. **Sólo servidor.**
 *
 * ── POR QUÉ ESTE ARCHIVO SE SEPARÓ DE notifications.functions.ts ───────────
 *
 * Estaba todo junto ahí, y rompía la pantalla de Turnos con este error:
 *
 *     [import-protection] Import denied in client environment
 *     Denied by file pattern: (el glob que prohibe todo src/server/)
 *     Importer: src/lib/notifications.functions.ts
 *
 * El motivo es sutil. En un `createServerFn`, TanStack **borra el cuerpo del
 * handler del bundle del navegador**, así que un `await import("@/server/…")`
 * ahí adentro nunca llega al cliente. Pero `deliverAppointmentEmail` no era un
 * handler: era una función suelta exportada del mismo archivo, y ese archivo lo
 * importa `admin.turnos.tsx` para usar `notifyAppointment`. O sea que su
 * `import("@/server/db")` sí viajaba al cliente, y el guard lo frenaba —con
 * razón: eso habría arrastrado Prisma al navegador.
 *
 * La regla que queda, y vale para todo el proyecto: **si una función toca algo
 * de `src/server/` y no es el handler de un createServerFn, va en un archivo
 * `.server.ts` que ninguna pantalla importe.**
 *
 * ── CÓMO LLEGA EL DESTINATARIO ────────────────────────────────────────────
 *
 * Quien llama NUNCA dice a qué dirección mandar: manda el id del turno y el
 * destinatario lo resuelve el servidor contra la base. Si el destinatario
 * viajara en el pedido, esto sería un formulario de spam abierto con el dominio
 * del centro.
 */

/**
 * El envío de los mails de turnos.
 *
 * Corre en el servidor por dos motivos, y cualquiera de los dos alcanzaría:
 *
 *   1. La contraseña del SMTP manda mail a nombre del centro. En el bundle del
 *      navegador la tendría cualquiera que abra las herramientas de desarrollo,
 *      y con eso puede escribirle a quien quiera firmando "Shiraf".
 *   2. La dirección de la clienta no está en `profiles` — está en `auth.users`,
 *      que sólo se lee con la service role. Ver la migración de columnas
 *      sensibles: el mail quedó del lado de auth a propósito.
 *
 * Hay una consecuencia de diseño importante en el punto 2: quien llama NUNCA
 * dice a qué dirección mandar. Manda el id del turno, y el destinatario lo
 * resuelve el servidor contra la base. Si el destinatario viajara en el pedido,
 * esta función sería un formulario de spam abierto con el dominio del centro.
 *
 * Ojo con el import de client.server: va adentro de los handlers, igual que en
 * team.functions.ts. Este archivo se compila también para el navegador y un
 * import de nivel superior arrastraría la service role al bundle.
 */

/**
 * Los eventos que le hablan a la clienta. Los que no están acá van al centro.
 *
 * ⚠️ Los tres que van al centro se parecen mucho a los otros y hay que mirarlos
 * dos veces antes de tocar esta lista:
 *
 *   new-request        · entró una reserva  → al centro (la clienta recibe
 *                                              "requested", que es otro texto)
 *   client-cancelled   · la clienta canceló → al centro (la clienta NO recibe
 *                                              nada: lo acaba de hacer ella)
 *   client-rescheduled · la clienta se movió el turno → al centro. Ojo con
 *                        éste: "rescheduled", que SÍ está en la lista de abajo,
 *                        es el mismo hecho pero al revés —lo manda el centro y
 *                        va a la clienta— y su texto empieza con "Tuvimos que
 *                        mover tu turno". Confundirlos le manda a la clienta
 *                        una disculpa por algo que decidió ella.
 *
 * Meter cualquiera de los dos acá adentro le manda a la clienta un mail escrito
 * para el panel, con el enlace a /admin/turnos.
 */
const TO_CLIENT: readonly AppointmentEvent[] = [
  "requested",
  "confirmed",
  "cancelled",
  "reminder",
  "rescheduled",
];

// ── El mail, en HTML ────────────────────────────────────────────────────────
// Escrito con las mismas restricciones que las plantillas de emails:
// tablas en vez de flex, estilos inline en vez de clases, Georgia en vez de
// Bodoni y colores en hex en vez de oklch. El porqué de cada una está explicado
// arriba de recuperar-contrasena.html; en resumen, es lo único que se ve igual
// en Gmail, en Outlook y en el celular.

const PALETTE = {
  cream: "#f7f6f0",
  card: "#fcfcf9",
  border: "#dddbd1",
  ink: "#252b1f",
  muted: "#676b5e",
  olive: "#38472c",
  gold: "#d2a956",
} as const;

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * Las líneas del mensaje, como párrafos.
 *
 * Las líneas vacías que `buildAppointmentMessage` usa para separar párrafos se
 * descartan: acá la separación la da el margen del <p>, no un renglón en blanco.
 */
function renderEmailHtml(message: AppointmentMessage): string {
  const paragraphs = message.lines
    .filter((line) => line.trim() !== "")
    .map(
      (line) =>
        `<p style="margin:0 0 14px;font-family:Georgia,'Times New Roman',serif;font-size:16px;line-height:1.6;color:${PALETTE.ink}">${escapeHtml(line)}</p>`,
    )
    .join("");

  return `<!doctype html>
<html lang="es">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta name="color-scheme" content="light only" />
    <title>${escapeHtml(message.subject)}</title>
  </head>
  <body style="margin:0;padding:0;background-color:${PALETTE.cream};-webkit-font-smoothing:antialiased">
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background-color:${PALETTE.cream}">
      <tr>
        <td align="center" style="padding:32px 16px">
          <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="600" style="width:600px;max-width:100%">
            <tr>
              <td align="center" style="padding:0 0 24px">
                <span style="font-family:Georgia,'Times New Roman',serif;font-size:22px;letter-spacing:6px;color:${PALETTE.olive}">SHIRAF</span>
              </td>
            </tr>
            <tr>
              <td style="background-color:${PALETTE.card};border:1px solid ${PALETTE.border};border-radius:2px;padding:32px">
                ${paragraphs}
              </td>
            </tr>
            <tr>
              <td align="center" style="padding:24px 8px 0;font-family:Georgia,'Times New Roman',serif;font-size:13px;line-height:1.6;color:${PALETTE.muted}">
                ${escapeHtml(CONTACT.address)}, ${escapeHtml(CONTACT.city)}<br />
                ${escapeHtml(CONTACT.phoneDisplay)}
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;
}

// ── El envío ────────────────────────────────────────────────────────────────

export type DeliveryResult =
  | { sent: true }
  /**
   * No se mandó, y por qué. Es un resultado, no una excepción: que el mail no
   * salga no puede hacer fracasar el cambio de estado del turno, que ya está
   * guardado en la base. El panel lo muestra como aviso y sigue.
   */
  | { sent: false; reason: string };

/**
 * Manda el mail. Sin SMTP configurado no falla: no manda y lo dice.
 *
 * Acá adentro había un segundo cliente de Resend, escrito aparte del de
 * `email.service.ts` y leyendo las mismas variables. Eran dos transportes para
 * el mismo correo: cambiar de proveedor había que hacerlo en dos lados. Ahora el
 * transporte es uno solo y vive allá; lo de este archivo es redactar los avisos,
 * que es lo suyo.
 *
 * El import va adentro y no arriba porque `email.service` carga nodemailer, que
 * es de proceso Node. Es el mismo motivo por el que `deliverAppointmentEmail`
 * importa Prisma así.
 */
async function sendEmail(input: {
  to: string;
  subject: string;
  text: string;
  html: string;
}): Promise<DeliveryResult> {
  const { enviarMail } = await import("@/server/services/email.service");
  const envio = await enviarMail(input);
  return envio.ok ? { sent: true } : { sent: false, reason: envio.motivo };
}

/**
 * Busca el turno, redacta el aviso y lo manda.
 *
 * Vive aparte del createServerFn porque tiene dos entradas: el panel, que llega
 * autenticado por el middleware, y la tarea del recordatorio, que no llega de
 * ninguna persona —la dispara el reloj de `reminders.service.ts`, adentro del
 * proceso—. La autorización la resuelve cada una antes de llamar acá; esto ya
 * asume que se puede.
 */
export async function deliverAppointmentEmail(
  appointmentId: string,
  event: AppointmentEvent,
): Promise<DeliveryResult> {
  const { prisma } = await import("@/server/db");

  // El mail y el nombre de la clienta salen del mismo viaje que el turno.
  //
  // Antes eran hasta tres consultas: el turno, el profile, y la Admin API de
  // Supabase para el mail — que vivía en auth.users y no se podía joinear. Con
  // la tabla `users` propia, el mail está a un include de distancia.
  const appointment = await prisma.appointments.findUnique({
    where: { id: appointmentId },
    select: {
      id: true,
      starts_at: true,
      client_id: true,
      guest_name: true,
      guest_phone: true,
      guest_email: true,
      // Lo miran los dos mensajes de cancelación. Sale de la base y no del
      // pedido: quien dispara el aviso manda el id del turno y nada más.
      cancel_reason: true,
      service: { select: { name: true } },
      // El nombre congelado: si el tratamiento se borró del catálogo, el mail
      // igual tiene que decir de qué es el turno.
      service_name: true,
      professional: { select: { full_name: true } },
      client: { select: { email: true, profile: { select: { full_name: true } } } },
    },
  });

  if (!appointment) return { sent: false, reason: "El turno no existe." };

  // ── Quién es la clienta y cómo se le escribe ──────────────────────────────
  // Los datos de invitada son el respaldo: si hay cuenta, mandan los de la
  // cuenta. Es el mismo orden que antes.
  const clientName = appointment.client?.profile?.full_name ?? appointment.guest_name ?? "Clienta";
  const clientEmail = appointment.client?.email ?? appointment.guest_email ?? null;

  const notifiable: NotifiableAppointment = {
    startsAt: appointment.starts_at.toISOString(),
    clientName,
    clientPhone: appointment.guest_phone,
    serviceName: appointment.service?.name ?? appointment.service_name ?? null,
    professionalName: appointment.professional?.full_name ?? null,
    cancelReason: appointment.cancel_reason,
  };

  const recipient = TO_CLIENT.includes(event) ? clientEmail : CONTACT.email;

  if (!recipient) {
    // El caso real: una invitada cargada por teléfono, de la que el centro tiene
    // el celular y no el mail. No es un error — es el motivo por el que WhatsApp
    // sigue siendo el canal principal.
    return { sent: false, reason: "Esta clienta no tiene mail cargado." };
  }

  const message = buildAppointmentMessage(event, notifiable);

  return sendEmail({
    to: recipient,
    subject: message.subject,
    text: message.lines.join("\n"),
    html: renderEmailHtml(message),
  });
}

/**
 * Manda el resumen diario de turnos vencidos. Va a la casilla del centro.
 *
 * No pasa por `deliverAppointmentEmail` porque no habla de UN turno: recibe la
 * lista ya armada por quien la consultó —`reminders.service.ts`, que es el que
 * sabe qué es "vencido"— y acá sólo se redacta y se manda.
 *
 * Con la lista vacía no manda nada y lo dice. Un mail diario que dice "no hay
 * nada pendiente" se archiva sin leer a la semana, y con él se archiva el día
 * que sí había algo.
 */
export async function deliverOverdueDigest(
  turnos: TurnoVencido[],
  total: number,
): Promise<DeliveryResult> {
  if (turnos.length === 0) return { sent: false, reason: "No hay turnos vencidos." };

  const message = buildOverdueDigest(turnos, total);

  return sendEmail({
    to: CONTACT.email,
    subject: message.subject,
    text: message.lines.join("\n"),
    html: renderEmailHtml(message),
  });
}
