import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { CONTACT } from "@/lib/contact";
import {
  buildAppointmentMessage,
  type AppointmentEvent,
  type AppointmentMessage,
  type NotifiableAppointment,
} from "@/lib/notifications";

/**
 * El envío de los mails de turnos.
 *
 * Corre en el servidor por dos motivos, y cualquiera de los dos alcanzaría:
 *
 *   1. La API key de Resend manda mail a nombre del dominio del centro. En el
 *      bundle del navegador la tendría cualquiera que abra las herramientas de
 *      desarrollo, y con eso puede escribirle a quien quiera firmando "Shiraf".
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

/** Los eventos que le hablan a la clienta. "new-request" le habla al centro. */
const TO_CLIENT: readonly AppointmentEvent[] = ["confirmed", "cancelled", "reminder"];

// ── El mail, en HTML ────────────────────────────────────────────────────────
// Escrito con las mismas restricciones que las plantillas de supabase/emails:
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

/** Manda un mail por Resend. Sin API key configurada no falla: no manda. */
async function sendEmail(input: {
  to: string;
  subject: string;
  text: string;
  html: string;
}): Promise<DeliveryResult> {
  const apiKey = process.env["RESEND_API_KEY"];
  const from = process.env["MAIL_FROM"];

  if (!apiKey || !from) {
    return { sent: false, reason: "El envío de mails todavía no está configurado." };
  }

  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from,
      to: [input.to],
      // La casilla que el centro mira de verdad es el Gmail, que no puede ser
      // remitente (Resend no firma por dominios de Google). Va de reply-to para
      // que la respuesta de la clienta caiga donde alguien la lee.
      reply_to: process.env["MAIL_REPLY_TO"] ?? CONTACT.email,
      subject: input.subject,
      text: input.text,
      html: input.html,
    }),
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    return { sent: false, reason: `Resend respondió ${response.status}. ${detail}`.trim() };
  }

  return { sent: true };
}

/**
 * Busca el turno, redacta el aviso y lo manda.
 *
 * Vive aparte del createServerFn porque tiene dos entradas: el panel, que llega
 * autenticado por el middleware, y la tarea del recordatorio, que no es ninguna
 * persona y se identifica con un secreto. La autorización la resuelve cada una
 * antes de llamar acá; esto ya asume que se puede.
 */
export async function deliverAppointmentEmail(
  appointmentId: string,
  event: AppointmentEvent,
): Promise<DeliveryResult> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

  const { data: appointment, error } = await supabaseAdmin
    .from("appointments")
    .select(
      "id, starts_at, client_id, guest_name, guest_phone, guest_email, services(name), professionals(full_name)",
    )
    .eq("id", appointmentId)
    .maybeSingle();

  if (error) return { sent: false, reason: "No se pudo leer el turno." };
  if (!appointment) return { sent: false, reason: "El turno no existe." };

  // ── Quién es la clienta y cómo se le escribe ──────────────────────────────
  let clientName = appointment.guest_name ?? "Clienta";
  let clientEmail = appointment.guest_email ?? null;

  if (appointment.client_id) {
    const { data: profile } = await supabaseAdmin
      .from("profiles")
      .select("full_name")
      .eq("id", appointment.client_id)
      .maybeSingle();
    if (profile?.full_name) clientName = profile.full_name;

    // La dirección está en auth.users y no en profiles, así que hay que ir a
    // buscarla por la Admin API.
    const { data: account } = await supabaseAdmin.auth.admin.getUserById(appointment.client_id);
    clientEmail = account?.user?.email ?? clientEmail;
  }

  const notifiable: NotifiableAppointment = {
    startsAt: appointment.starts_at,
    clientName,
    clientPhone: appointment.guest_phone,
    serviceName: appointment.services?.name ?? null,
    professionalName: appointment.professionals?.full_name ?? null,
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
  .middleware([requireSupabaseAuth])
  .validator((data: unknown) => NotifyInput.parse(data))
  .handler(async ({ data, context }): Promise<DeliveryResult> => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    if (data.event === "new-request") {
      const { data: appointment } = await supabaseAdmin
        .from("appointments")
        .select("client_id")
        .eq("id", data.appointmentId)
        .maybeSingle();

      if (!appointment || appointment.client_id !== context.userId) {
        throw new Error("Ese turno no es tuyo.");
      }
    } else {
      // El permiso se verifica contra las tablas y no llamando a
      // public.has_permission: esa función está concedida a `authenticated`, y
      // acá la conexión es la service role, que no hereda ese grant.
      const [{ data: roles }, { data: permissions }] = await Promise.all([
        supabaseAdmin.from("user_roles").select("role").eq("user_id", context.userId),
        supabaseAdmin
          .from("user_permissions")
          .select("permission")
          .eq("user_id", context.userId)
          .eq("permission", "appointments"),
      ]);

      const isAdmin = (roles ?? []).some((r) => r.role === "admin");
      if (!isAdmin && (permissions ?? []).length === 0) {
        throw new Error("No tenés permiso para avisar sobre turnos.");
      }
    }

    return deliverAppointmentEmail(data.appointmentId, data.event);
  });
