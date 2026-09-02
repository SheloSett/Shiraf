import { CONTACT } from "@/lib/contact";
import { TOLERANCIA_MINUTOS } from "@/lib/shiraf";

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
  /**
   * La clienta acaba de reservar por el sitio. Va a ELLA.
   *
   * No confirma nada —el turno nace pendiente— y por eso el texto es cuidadoso:
   * dice que el pedido llegó y que falta que el centro lo confirme. Sin este
   * aviso, reservar terminaba en un toast que desaparecía en cinco segundos y
   * la clienta se quedaba sin ningún papel de lo que había pedido.
   */
  | "requested"
  /** El centro pasó el turno a confirmado. Va a la clienta. */
  | "confirmed"
  /** El centro dio de baja el turno. Va a la clienta. */
  | "cancelled"
  /** El centro le movió el turno a otro día u hora. Va a la clienta. */
  | "rescheduled"
  /** Día previo. Va a la clienta. */
  | "reminder"
  /** Entró una reserva por el sitio y espera confirmación. Va al centro. */
  | "new-request"
  /**
   * La clienta canceló su propio turno desde «Mi cuenta». Va AL CENTRO.
   *
   * Es distinto de `cancelled`, que va para el otro lado. Acá no hay nada que
   * anunciarle a la clienta —lo acaba de hacer ella— pero el centro sí necesita
   * enterarse: le quedó un hueco en la agenda y, con suerte, el motivo escrito.
   */
  | "client-cancelled"
  /**
   * La clienta se movió su propio turno desde «Mi cuenta». Va AL CENTRO.
   *
   * Es a `rescheduled` lo que `client-cancelled` es a `cancelled`: el mismo
   * hecho contado para el otro lado del mostrador. Ella no necesita el mail
   * —acaba de elegir el horario nuevo en pantalla—; el centro sí, porque la
   * agenda del día le cambió sin que nadie del equipo lo tocara.
   */
  | "client-rescheduled";

/** Lo mínimo para poder redactar cualquiera de los avisos. */
export type NotifiableAppointment = {
  /** ISO, como viene de appointments.starts_at. */
  startsAt: string;
  /** Nombre de la clienta, tenga cuenta o no. */
  clientName: string;
  clientPhone?: string | null;
  serviceName?: string | null;
  professionalName?: string | null;
  /**
   * Por qué se canceló, si alguien lo escribió.
   *
   * Sólo lo miran los dos mensajes de cancelación. Cuando viene vacío, el texto
   * cae al genérico de siempre: es mejor "tuvimos que cancelar tu turno" que
   * "tuvimos que cancelar tu turno. Motivo:" seguido de nada.
   */
  cancelReason?: string | null;
  /**
   * Qué sesión de la serie es este turno, y de cuántas.
   *
   * Ausentes o 1 de 1 en casi todos los turnos, y ahí los mensajes no dicen
   * nada de sesiones. Con más de una, la clienta necesita leer en qué punto del
   * tratamiento está: tres mails iguales del mismo tratamiento, con tres fechas
   * distintas, se leen como un error del sistema.
   */
  sessionNumber?: number;
  sessionsTotal?: number;
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

/**
 * La frase de la tolerancia, escrita una vez.
 *
 * Va en los dos mails que la clienta lee ANTES de venir —el del pedido y el de
 * la confirmación— y también en la pantalla de reserva. Que esté dicho de
 * antemano y por escrito es lo que permite sostenerlo el día que alguien llega
 * media hora tarde: no es una regla nueva inventada en el momento.
 *
 * El número sale de `shiraf.ts`, donde viven las decisiones del negocio, y no
 * está escrito acá adentro: si el centro pasa a esperar 15 minutos, se cambia
 * en un solo lugar y la pantalla y el mail dicen lo mismo.
 */
const tolerancia = `Te esperamos hasta ${TOLERANCIA_MINUTOS} minutos; pasado ese rato el turno se libera.`;

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
  // Ver la nota de `formatTime` en shiraf.ts: 24 horas, y `hourCycle` en vez
  // de `hour12: false` por la medianoche. Acá importa el doble, porque el mail
  // es lo que la clienta mira el día anterior para saber a qué hora venir.
  const time = date.toLocaleTimeString("es-AR", {
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
    timeZone: TIMEZONE,
  });
  return `el ${day} a las ${time}`;
}

/**
 * "Es la sesión 2 de 3 de tu tratamiento." — o null si es de una sola.
 *
 * Sale como renglón propio y no pegado al nombre del tratamiento porque es
 * información de otro orden: el nombre dice QUÉ se hace, esto dice DÓNDE está
 * parada la clienta en un tratamiento que empezó hace tres semanas.
 */
function sessionPhrase(appointment: NotifiableAppointment): string | null {
  const { sessionNumber, sessionsTotal } = appointment;
  if (!sessionsTotal || sessionsTotal <= 1 || !sessionNumber) return null;
  return `Es la sesión ${sessionNumber} de ${sessionsTotal} de tu tratamiento.`;
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
  const sesion = sessionPhrase(appointment);
  const place = `${CONTACT.address}, ${CONTACT.city}`;

  /*
   * Lo que hay que aclarar la PRIMERA vez de un tratamiento de varias sesiones,
   * y sólo la primera: que esto no termina hoy y que las fechas que siguen se
   * acuerdan en el centro. Repetirlo en la sesión 2 sería explicarle a alguien
   * algo que ya está viviendo.
   */
  const avisoDeSerie =
    sesion && appointment.sessionNumber === 1
      ? "Las próximas sesiones las coordinamos con vos cuando vengas."
      : null;

  switch (event) {
    // Lo primero que la clienta recibe, y el único mail que llega sin que nadie
    // del centro haya hecho nada. Dice tres cosas y ninguna sobra: qué pidió,
    // que TODAVÍA NO está confirmado, y la tolerancia.
    case "requested":
      return {
        subject: "Recibimos tu pedido de turno en Shiraf",
        lines: [
          `Hola ${who}, te escribimos de Shiraf.`,
          "",
          `Recibimos tu pedido de turno ${when}.`,
          ...(what ? [what] : []),
          ...(sesion ? [sesion] : []),
          ...(avisoDeSerie ? [avisoDeSerie] : []),
          "",
          "Todavía no está confirmado: lo revisamos y te avisamos por este mismo medio.",
          "",
          `Te esperamos en ${place}.`,
          tolerancia,
        ],
      };

    case "confirmed":
      return {
        subject: "Tu turno en Shiraf quedó confirmado",
        lines: [
          `Hola ${who}, te escribimos de Shiraf.`,
          "",
          `Tu turno ${when} quedó confirmado.`,
          ...(what ? [what] : []),
          ...(sesion ? [sesion] : []),
          ...(avisoDeSerie ? [avisoDeSerie] : []),
          "",
          `Te esperamos en ${place}.`,
          tolerancia,
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
          // El motivo, si el centro lo escribió. Un renglón aparte y no pegado
          // a la frase de arriba: es lo que la clienta va a buscar con la vista.
          ...(appointment.cancelReason ? ["", `Motivo: ${appointment.cancelReason}`] : []),
          "",
          "Perdón por el cambio. Escribinos y te buscamos otro horario.",
        ],
      };

    // Al centro. La clienta ya sabe que canceló; el que necesita enterarse es
    // quien mira la agenda, porque le quedó un hueco que todavía se puede
    // vender.
    case "client-cancelled":
      return {
        subject: `Turno cancelado por la clienta — ${appointment.clientName}`,
        lines: [
          `${appointment.clientName}${appointment.clientPhone ? ` · ${appointment.clientPhone}` : ""} canceló su turno.`,
          "",
          `Era ${when}`,
          ...(what ? [what] : []),
          ...(appointment.cancelReason ? ["", `Motivo: ${appointment.cancelReason}`] : []),
          "",
          `El horario quedó libre: ${CONTACT.siteUrl}/admin/turnos`,
        ],
      };

    /**
     * Al centro, cuando la clienta se movió el turno sola.
     *
     * ── POR QUÉ NO DICE DE QUÉ HORARIO VENÍA ──────────────────────────────
     *
     * Porque acá no se sabe. El mail se arma leyendo el turno de la base
     * DESPUÉS del UPDATE (ver `deliverAppointmentEmail`), así que el horario
     * viejo ya no existe en ningún lado. Decirlo obligaría a que quien dispara
     * el aviso lo mande en el pedido, y eso es justo lo que este archivo no
     * hace: quien llama manda el id del turno y nada más.
     *
     * No es una pérdida grande: lo que el centro necesita saber es dónde está
     * el turno AHORA, y el hueco viejo lo ve solo al abrir la agenda. Si algún
     * día hace falta el "era X, ahora Y", el lugar de arreglarlo es el
     * controller, guardando el horario anterior antes de escribir.
     */
    case "client-rescheduled":
      return {
        subject: `Turno movido por la clienta — ${appointment.clientName}`,
        lines: [
          `${appointment.clientName}${appointment.clientPhone ? ` · ${appointment.clientPhone}` : ""} se movió el turno.`,
          "",
          `Queda ${when}`,
          ...(what ? [what] : []),
          "",
          `Se liberó el horario que tenía antes: ${CONTACT.siteUrl}/admin/turnos`,
        ],
      };

    // El turno se movió. El mensaje dice el horario NUEVO, que es el que la
    // clienta tiene que anotar; el viejo no se nombra a propósito, porque
    // repetirlo invita a confundir cuál de los dos vale.
    case "rescheduled":
      return {
        subject: "Cambiamos el horario de tu turno en Shiraf",
        lines: [
          `Hola ${who}, te escribimos de Shiraf.`,
          "",
          `Tuvimos que mover tu turno${what ? ` (${what})` : ""}.`,
          `Queda ${when}.`,
          "",
          `Te esperamos en ${place}.`,
          "Si ese horario no te sirve, avisanos y buscamos otro.",
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
          // En el recordatorio la sesión importa más que en ningún otro
          // mensaje: pasaron semanas desde la anterior y es lo que ubica a la
          // clienta en qué viene mañana. El aviso de "las próximas las
          // coordinamos" no va acá, que ya lo leyó al reservar.
          ...(sesion ? [sesion] : []),
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

/** Un turno que ya pasó y sigue abierto, para el resumen de abajo. */
export type TurnoVencido = {
  id: string;
  startsAt: string;
  clientName: string;
  serviceName?: string | null;
};

/**
 * El resumen de los turnos que vencieron: va AL CENTRO, una vez por día.
 *
 * ── POR QUÉ NO ES UN AVISO POR TURNO ──────────────────────────────────────
 *
 * Porque no es una novedad, es una lista de pendientes. Un mail por cada turno
 * vencido llena la casilla un lunes a la mañana y se archiva en bloque; uno solo
 * con los tres que quedaron abiertos se lee y se resuelve.
 *
 * ── Y POR QUÉ NO LE LLEGA A LA CLIENTA ────────────────────────────────────
 *
 * "Tu turno venció" es una acusación de no haber venido, y la mitad de las veces
 * el turno está abierto porque nadie del centro lo cerró, no porque la clienta
 * faltara. El que tiene algo que hacer es el centro: cerrarlo o —lo que
 * conviene— reprogramarlo, que es lo único que recupera ese turno.
 *
 * Se repite todos los días mientras el turno siga abierto. Es a propósito: es
 * una lista de tareas, y deja de aparecer cuando alguien la resuelve.
 */
export function buildOverdueDigest(turnos: TurnoVencido[], total: number): AppointmentMessage {
  const uno = total === 1;

  return {
    subject: `${total} turno${uno ? "" : "s"} sin cerrar en Shiraf`,
    lines: [
      uno
        ? "Hay un turno que ya pasó y sigue abierto."
        : `Hay ${total} turnos que ya pasaron y siguen abiertos.`,
      "",
      "Lo que conviene con cada uno es REPROGRAMARLO: así el turno no se pierde y la clienta vuelve. Si no, cerralo como realizado o cancelado.",
      "",
      ...turnos.flatMap((t) => [
        `${whenPhrase(t.startsAt).replace(/^el /, "")} · ${t.clientName}${t.serviceName ? ` · ${t.serviceName}` : ""}`,
        `${CONTACT.siteUrl}/admin/turnos/${t.id}`,
        "",
      ]),
      ...(total > turnos.length ? [`Y ${total - turnos.length} más en el panel.`, ""] : []),
      "Se listan los de los últimos días. Los más viejos siguen en el panel, con el cartel de «Vencido».",
    ],
  };
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
