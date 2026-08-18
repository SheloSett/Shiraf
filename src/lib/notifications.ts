import { CONTACT } from "@/lib/contact";

/**
 * El texto de los avisos de turnos, en un solo lugar.
 *
 * Los mismos cuatro mensajes salen por dos canales —WhatsApp y mail— y por dos
 * caminos —el panel al confirmar o cancelar, y la tarea del recordatorio—. Si
 * cada uno redactara el suyo, en un mes dirían cosas distintas: es exactamente
 * lo que le pasó a los datos de contacto antes de que existiera contact.ts, que
 * mostraba dos teléfonos diferentes según la pantalla.
 *
 * Por eso el mensaje se arma UNA vez, como lista de líneas, y cada canal la
 * junta a su manera: WhatsApp con saltos de línea, el mail con párrafos. El
 * texto es el mismo.
 *
 * Sin emojis a propósito. El resto del sitio no usa ninguno, y un mensaje que
 * llega con caritas cuando la marca en todo lo demás es sobria se lee como
 * mandado por otra persona.
 */

export type AppointmentEvent =
  /** El centro pasó el turno a confirmado. Va a la clienta. */
  | "confirmed"
  /** El centro dio de baja el turno. Va a la clienta. */
  | "cancelled"
  /** Día previo. Va a la clienta. */
  | "reminder"
  /** Entró una reserva por el sitio y espera confirmación. Va al centro. */
  | "new-request";

/** Lo mínimo para poder redactar cualquiera de los avisos. */
export type NotifiableAppointment = {
  /** ISO, como viene de appointments.starts_at. */
  startsAt: string;
  /** Nombre de la clienta, tenga cuenta o no. */
  clientName: string;
  clientPhone?: string | null;
  serviceName?: string | null;
  professionalName?: string | null;
};

export type AppointmentMessage = {
  /** Asunto del mail. WhatsApp no lo usa. */
  subject: string;
  /** El cuerpo, una línea por elemento. Las vacías son separación de párrafo. */
  lines: string[];
};

/**
 * El huso del centro, escrito y no heredado del reloj de la máquina.
 *
 * Los formatters de shiraf.ts no lo declaran, y hacen bien: corren en el
 * navegador de la clienta, que ya está en hora argentina. Estos mensajes no —
 * los arma también el servidor, que en producción corre en UTC. Sin el huso, un
 * turno de las 21:30 se anunciaría con la fecha del día siguiente, que es un
 * error de los que hacen que alguien se pierda el turno.
 */
const TIMEZONE = "America/Argentina/Buenos_Aires";

/** Primer nombre a secas: "Hola María" y no "Hola María Fernanda Gómez". */
function firstName(fullName: string): string {
  return fullName.trim().split(/\s+/)[0] || fullName.trim();
}

/** "el jueves 21 de agosto a las 14:30" */
function whenPhrase(startsAt: string): string {
  const date = new Date(startsAt);
  const day = date.toLocaleDateString("es-AR", {
    weekday: "long",
    day: "2-digit",
    month: "long",
    timeZone: TIMEZONE,
  });
  const time = date.toLocaleTimeString("es-AR", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: TIMEZONE,
  });
  return `el ${day} a las ${time}`;
}

/** "Peeling químico, con Micaela" — y se banca que falte cualquiera de los dos. */
function whatPhrase(appointment: NotifiableAppointment): string | null {
  const { serviceName, professionalName } = appointment;
  if (serviceName && professionalName) return `${serviceName}, con ${professionalName}`;
  return serviceName ?? (professionalName ? `Con ${professionalName}` : null);
}

/**
 * El aviso que corresponde a un evento, ya redactado.
 *
 * Los tres primeros hablan de vos a la clienta; "new-request" es interno y va
 * para el otro lado, así que cambia de tono a propósito: es una notificación de
 * trabajo, no un mensaje de atención al público.
 */
export function buildAppointmentMessage(
  event: AppointmentEvent,
  appointment: NotifiableAppointment,
): AppointmentMessage {
  const who = firstName(appointment.clientName);
  const when = whenPhrase(appointment.startsAt);
  const what = whatPhrase(appointment);
  const place = `${CONTACT.address}, ${CONTACT.city}`;

  switch (event) {
    case "confirmed":
      return {
        subject: "Tu turno en Shiraf quedó confirmado",
        lines: [
          `Hola ${who}, te escribimos de Shiraf.`,
          "",
          `Tu turno ${when} quedó confirmado.`,
          ...(what ? [what] : []),
          "",
          `Te esperamos en ${place}.`,
          "Si no podés venir, avisanos y lo reprogramamos.",
        ],
      };

    case "cancelled":
      return {
        subject: "Tu turno en Shiraf fue cancelado",
        lines: [
          `Hola ${who}, te escribimos de Shiraf.`,
          "",
          `Tuvimos que cancelar tu turno ${when}${what ? ` (${what})` : ""}.`,
          "",
          "Perdón por el cambio. Escribinos y te buscamos otro horario.",
        ],
      };

    case "reminder":
      return {
        subject: "Te esperamos mañana en Shiraf",
        lines: [
          `Hola ${who}, te escribimos de Shiraf.`,
          "",
          `Te recordamos tu turno ${when}.`,
          ...(what ? [what] : []),
          "",
          `Te esperamos en ${place}.`,
          "Si no podés venir, avisanos así liberamos el horario.",
        ],
      };

    case "new-request":
      return {
        subject: `Nuevo turno pendiente — ${appointment.clientName}`,
        lines: [
          "Entró un turno por el sitio y está esperando confirmación.",
          "",
          `${appointment.clientName}${appointment.clientPhone ? ` · ${appointment.clientPhone}` : ""}`,
          `Turno ${when}`,
          ...(what ? [what] : []),
          "",
          `Confirmalo desde el panel: ${CONTACT.siteUrl}/admin/turnos`,
        ],
      };
  }
}

/**
 * El teléfono como lo quiere wa.me: sólo dígitos, con código de país y sin +.
 *
 * Los teléfonos se cargan a mano, así que llegan de cualquier forma:
 * "1136557290", "11 3655-7290", "+54 9 11 3655 7290". Lo que hay que producir es
 * siempre 549 + área + número.
 *
 * El 9 es el que más se olvida y el que rompe el enlace: en Argentina WhatsApp
 * identifica los celulares como 54 9 …, y un 54 sin 9 abre un chat con un número
 * que no existe — sin error, simplemente no llega nunca. Por eso se agrega si
 * falta.
 *
 * Devuelve null cuando el número no da para armar un enlace confiable, y ahí la
 * interfaz esconde el botón en vez de ofrecer uno roto.
 */
export function toWhatsappNumber(raw: string | null | undefined): string | null {
  const digits = (raw ?? "").replace(/\D/g, "");
  if (!digits) return null;

  // Ya viene con código de país y el 9 de celular.
  if (digits.startsWith("549") && digits.length >= 12) return digits;

  // Con código de país pero sin el 9: se lo agregamos.
  if (digits.startsWith("54") && digits.length >= 11) return `549${digits.slice(2)}`;

  // Sin código de país: el 0 de larga distancia y el 15 de celular no viajan al
  // formato internacional, así que se descartan antes de anteponer el 549.
  const local = digits.replace(/^0/, "").replace(/^(\d{2,4})15/, "$1");
  if (local.length >= 10) return `549${local}`;

  return null;
}

/**
 * El enlace que abre WhatsApp con el mensaje ya escrito.
 *
 * Va al teléfono de la clienta, no al del centro — al revés que buildWhatsappUrl
 * de contact.ts, que es el de "escribinos" del sitio público.
 *
 * No manda nada: abre la conversación con el texto cargado para que la persona
 * del centro lo lea y apriete enviar. Mandar solo exige la API de Meta, con
 * verificación del negocio y plantillas aprobadas una por una; mientras tanto
 * esto sale del número real del centro y no cuesta nada.
 */
export function appointmentWhatsappUrl(
  event: AppointmentEvent,
  appointment: NotifiableAppointment,
): string | null {
  const number = toWhatsappNumber(appointment.clientPhone);
  if (!number) return null;

  const { lines } = buildAppointmentMessage(event, appointment);
  return `https://wa.me/${number}?text=${encodeURIComponent(lines.join("\n"))}`;
}
