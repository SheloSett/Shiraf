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
   * Confirma el turno, desde el 6/9/2026: reservar por el sitio ES la
   * confirmación, y este mail es el comprobante. Antes decía que el pedido
   * había llegado y que faltaba que el centro lo aceptara, porque el turno
   * nacía pendiente. Sin este aviso, reservar terminaba en un toast que
   * desaparecía en cinco segundos y la clienta se quedaba sin ningún papel.
   */
  | "requested"
  /** El centro pasó el turno a confirmado. Va a la clienta. */
  | "confirmed"
  /** El centro dio de baja el turno. Va a la clienta. */
  | "cancelled"
  /** El centro le movió el turno a otro día u hora. Va a la clienta. */
  | "rescheduled"
  /**
   * Día previo. Va a la clienta, turno por turno.
   *
   * A la profesional NO le llega este mismo aviso: recibe UN resumen con todos
   * sus turnos de mañana, armado en `buildProfessionalDayDigest` y mandado por
   * la misma tarea del reloj (8/9/2026). Un mail por turno a quien atiende
   * cinco por día serían cinco mails iguales en la misma mañana.
   */
  | "reminder"
  /** Entró una reserva por el sitio, ya confirmada. Va al centro Y a la profesional. */
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
  | "client-rescheduled"
  /**
   * Alguien del centro cargó un turno desde el panel. Va AL CENTRO.
   *
   * 9/9/2026. Hasta hoy el alta desde el panel avisaba a la clienta y a la
   * profesional ("confirmed") y a nadie más, así que si lo cargaba la
   * secretaria, la dueña se enteraba sólo mirando la agenda. Es a
   * "new-request" lo que "confirmed" es a "requested": el mismo hecho —entró
   * un turno— pero lo hizo el equipo y no la clienta. Se dispara junto con
   * "confirmed" desde los dos diálogos del panel, y a quien lo cargó no le
   * llega: ya sabe.
   */
  | "staff-created";

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
  /**
   * Quién hizo la acción desde el panel, si se sabe. Sólo lo mira
   * "staff-created": el mail al centro dice "lo cargó Camila" en vez de "se
   * cargó", que es lo que la dueña quiere leer. Lo rellena el servidor con el
   * nombre de la sesión que disparó el aviso.
   */
  actorName?: string | null;
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
 * Los datos del centro que necesitan los mensajes, como están HOY en el panel.
 *
 * Es opcional en todas las funciones que lo reciben, y sin él caen a
 * `contact.ts` — el mismo patrón que `buildWhatsappUrl({ numero })` de ese
 * archivo, y por el mismo motivo: los llamados del navegador (el botón «Avisar»
 * del panel) no tienen a mano el contenido del sitio y siguen andando igual,
 * mientras que el servidor, que sí puede leerlo, pasa lo que está guardado.
 *
 * Los lee `datosDelCentro()` en `src/server/services/datos-centro.service.ts`,
 * donde está explicado por qué hacía falta.
 */
export type DatosDelCentroParaMensaje = {
  /** "Vuelta de Obligado 2443, Oficina 302, Buenos Aires", ya armado. */
  lugar?: string;
  /** El teléfono como se lee. Lo usa la firma del WhatsApp. */
  telefonoVisible?: string;
};

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
  centro?: DatosDelCentroParaMensaje,
): AppointmentMessage {
  const who = firstName(appointment.clientName);
  const when = whenPhrase(appointment.startsAt);
  const what = whatPhrase(appointment);
  const sesion = sessionPhrase(appointment);
  const place = centro?.lugar?.trim() || `${CONTACT.address}, ${CONTACT.city}`;

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
    /*
     * Lo primero que la clienta recibe, y el único mail que llega sin que nadie
     * del centro haya hecho nada.
     *
     * ── 6/9/2026: ESTE MAIL DECÍA LO CONTRARIO ─────────────────────────────
     *
     * Decía "Recibimos tu pedido" y "Todavía no está confirmado: lo revisamos y
     * te avisamos". Era cierto mientras un turno nacía en «pendiente» y alguien
     * del centro lo tenía que aceptar. Desde que la clienta reserva y el turno
     * queda confirmado en el acto, ese texto la dejaba esperando una segunda
     * respuesta que ya no va a llegar nunca — y peor, dudando de si tiene que
     * ir.
     *
     * Queda como evento aparte de "confirmed" aunque digan casi lo mismo: éste
     * lo dispara la clienta sobre su propio turno y el otro lo manda el centro.
     * Esa diferencia es la que sostiene los permisos de `notifyAppointment`, y
     * unificarlos sería dejar que cualquiera con cuenta le haga llegar a otra un
     * "tu turno quedó confirmado" firmado por Shiraf.
     *
     * El texto anterior:
     *
     *   subject: "Recibimos tu pedido de turno en Shiraf",
     *   `Recibimos tu pedido de turno ${when}.`,
     *   "Todavía no está confirmado: lo revisamos y te avisamos por este mismo medio.",
     */
    case "requested":
      return {
        subject: "Tu turno en Shiraf quedó reservado",
        lines: [
          `Hola ${who}, te escribimos de Shiraf.`,
          "",
          `Tu turno ${when} quedó reservado y confirmado.`,
          ...(what ? [what] : []),
          ...(sesion ? [sesion] : []),
          ...(avisoDeSerie ? [avisoDeSerie] : []),
          "",
          "No hace falta que hagas nada más. Si no vas a poder venir, avisanos.",
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

    /*
     * 6/9/2026 — decía "Nuevo turno pendiente", "está esperando confirmación" y
     * "Confirmalo desde el panel". Ya no hay nada que confirmar: el turno entró
     * confirmado. Lo que sí sigue habiendo es algo para MIRAR, y a eso apunta
     * ahora — a la pestaña «Sin ver», que es donde cae.
     */
    case "new-request":
      return {
        subject: `Turno nuevo — ${appointment.clientName}`,
        lines: [
          "Entró un turno por el sitio y ya está confirmado.",
          "",
          `${appointment.clientName}${appointment.clientPhone ? ` · ${appointment.clientPhone}` : ""}`,
          `Turno ${when}`,
          ...(what ? [what] : []),
          "",
          `Miralo desde el panel: ${CONTACT.siteUrl}/admin/turnos?estado=sin-ver`,
        ],
      };

    /*
     * 9/9/2026 — el alta desde el panel, contada al centro. Nace confirmado y
     * VISTO (lo cargó el equipo), así que el enlace va a la lista y no a
     * «Sin ver», y no hay nada que mirar: es para enterarse.
     */
    case "staff-created":
      return {
        subject: `Turno cargado desde el panel — ${appointment.clientName}`,
        lines: [
          appointment.actorName
            ? `${appointment.actorName} cargó un turno desde el panel. Ya está confirmado.`
            : "Se cargó un turno desde el panel. Ya está confirmado.",
          "",
          `${appointment.clientName}${appointment.clientPhone ? ` · ${appointment.clientPhone}` : ""}`,
          `Turno ${when}`,
          ...(what ? [what] : []),
          ...(sesion
            ? [`Sesión ${appointment.sessionNumber} de ${appointment.sessionsTotal}.`]
            : []),
          "",
          `La agenda: ${CONTACT.siteUrl}/admin/turnos`,
        ],
      };
  }
}

/**
 * El mismo hecho, contado a la profesional que atiende el turno.
 *
 * ── POR QUÉ ES UNA FUNCIÓN APARTE Y NO TRES EVENTOS NUEVOS ────────────────
 *
 * Porque no son hechos nuevos: son los mismos ocho, mirados desde la tercera
 * silla. Un turno que se cancela es UN evento; que le llegue a la clienta, al
 * centro y a la profesional no lo convierte en tres.
 *
 * Meterlos como `AppointmentEvent` nuevos —"pro-cancelled" y compañía— habría
 * obligado a inventarles plantillas de WhatsApp en `whatsapp-plantillas.ts`, que
 * tiene un registro por evento, y a sumarlos al `z.enum` de
 * notifications.functions.ts. Todo eso para avisos que hoy sólo salen por mail.
 *
 * ── POR QUÉ NO REUSA EL TEXTO DEL CENTRO ──────────────────────────────────
 *
 * Los tres avisos internos ya están escritos para quien mira la agenda, así que
 * la tentación es mandarle ésos y listo. No sirven: hablan desde el negocio —"el
 * horario quedó libre", "confirmalo desde el panel"— y la profesional no
 * confirma turnos ni vende el hueco. Lo que ella necesita saber es que SU día
 * cambió, y el enlace que le sirve es su agenda, no la lista general.
 *
 * ── LOS DOS QUE DEVUELVEN null, Y POR QUÉ ─────────────────────────────────
 *
 *   · "requested" · Es el mismo hecho que "new-request" —la clienta reservó—
 *     contado para el otro lado. Los dos se disparan juntos al reservar, así que
 *     mandar los dos serían dos mails por la misma reserva, con dos minutos de
 *     diferencia. Gana "new-request", que es el que está escrito para adentro.
 *
 *   · "reminder" · Sale una vez por turno del día siguiente. A la profesional
 *     con seis turnos le llegarían seis mails cada mañana diciéndole cosas que
 *     ya sabe. Lo que sirve ahí es un resumen del día, que es otra cosa y no
 *     existe todavía — mientras tanto tiene su agenda en el panel.
 *
 * Devuelve null también cuando el turno no tiene profesional asignada: no es un
 * error, es un turno que todavía no se le repartió a nadie.
 */
export function buildProfessionalMessage(
  event: AppointmentEvent,
  appointment: NotifiableAppointment,
): AppointmentMessage | null {
  if (event === "requested" || event === "reminder") return null;
  // "staff-created" sale del panel JUNTO con "confirmed", y "confirmed" ya le
  // dice a la profesional que tiene ese turno en la agenda. Mandarle los dos
  // serían dos mails por la misma carga, igual que el par requested/new-request.
  if (event === "staff-created") return null;
  if (!appointment.professionalName) return null;

  const pro = firstName(appointment.professionalName);
  const when = whenPhrase(appointment.startsAt);
  const agenda = `${CONTACT.siteUrl}/admin/mi-agenda`;

  /*
   * La sesión, dicha en tercera persona.
   *
   * No se usa `sessionPhrase` —que sería lo natural— porque está escrita para la
   * clienta y dice "de TU tratamiento". Acá la lee la profesional, y un mail que
   * le habla de su propio tratamiento se nota enseguida que es texto reciclado.
   */
  const sesion =
    appointment.sessionsTotal && appointment.sessionsTotal > 1 && appointment.sessionNumber
      ? `Sesión ${appointment.sessionNumber} de ${appointment.sessionsTotal}.`
      : null;

  /*
   * Quién viene, con el teléfono si está.
   *
   * A diferencia del mail de la clienta, acá el nombre va COMPLETO: la
   * profesional necesita reconocer a quién tiene en la agenda, y dos Marías en
   * el mismo día son perfectamente posibles.
   */
  const quien = `${appointment.clientName}${appointment.clientPhone ? ` · ${appointment.clientPhone}` : ""}`;

  /*
   * Qué se hace. Igual que `whatPhrase` pero sin el "con Micaela" del final:
   * este mail lo está leyendo Micaela.
   */
  const que = appointment.serviceName;

  /** El cierre, igual en los seis: dónde mirarlo. */
  const cierre = ["", `Tu agenda: ${agenda}`];

  switch (event) {
    /*
     * 6/9/2026 — decía "Turno nuevo para confirmar" y "Todavía está pendiente:
     * lo confirma el centro". Ese mail la dejaba sin saber si contar con el
     * horario: le avisaba de algo que todavía podía no pasar. Ahora la reserva
     * ya es el turno, así que el condicional se va —"Sería" pasa a "Queda"— y
     * el mail dice lo único que ella necesita: tenés esto en la agenda.
     */
    case "new-request":
      return {
        subject: `Turno nuevo — ${appointment.clientName}`,
        lines: [
          `Hola ${pro}, te reservaron un turno por el sitio.`,
          "",
          quien,
          `Queda ${when}`,
          ...(que ? [que] : []),
          ...(sesion ? [sesion] : []),
          ...cierre,
        ],
      };

    case "confirmed":
      return {
        subject: `Turno confirmado — ${appointment.clientName}`,
        lines: [
          `Hola ${pro}, se confirmó un turno en tu agenda.`,
          "",
          quien,
          `Queda ${when}`,
          ...(que ? [que] : []),
          ...(sesion ? [sesion] : []),
          ...cierre,
        ],
      };

    case "cancelled":
      return {
        subject: `Turno cancelado — ${appointment.clientName}`,
        lines: [
          `Hola ${pro}, se canceló un turno de tu agenda.`,
          "",
          quien,
          `Era ${when}`,
          ...(que ? [que] : []),
          ...(appointment.cancelReason ? ["", `Motivo: ${appointment.cancelReason}`] : []),
          "",
          "Ese horario te queda libre.",
          ...cierre,
        ],
      };

    // Los dos que siguen son el mismo hecho que los dos de arriba, pero
    // decididos por la clienta desde «Mi cuenta» en vez de por el centro. Para
    // la agenda de la profesional el efecto es idéntico; lo que cambia es que
    // acá nadie del equipo se enteró, y por eso el mail lo dice.
    case "client-cancelled":
      return {
        subject: `Turno cancelado por la clienta — ${appointment.clientName}`,
        lines: [
          `Hola ${pro}, te cancelaron un turno: lo dio de baja la clienta desde su cuenta.`,
          "",
          quien,
          `Era ${when}`,
          ...(que ? [que] : []),
          ...(appointment.cancelReason ? ["", `Motivo: ${appointment.cancelReason}`] : []),
          "",
          "Ese horario te queda libre.",
          ...cierre,
        ],
      };

    // Los dos de movimiento dicen sólo el horario NUEVO, por el mismo motivo
    // que el mail de la clienta: nombrar el viejo invita a confundir cuál vale.
    // Acá además el viejo ya no existe en la base cuando esto se arma.
    case "rescheduled":
      return {
        subject: `Turno movido — ${appointment.clientName}`,
        lines: [
          `Hola ${pro}, se movió un turno de tu agenda.`,
          "",
          quien,
          `Queda ${when}`,
          ...(que ? [que] : []),
          ...cierre,
        ],
      };

    case "client-rescheduled":
      return {
        subject: `Turno movido por la clienta — ${appointment.clientName}`,
        lines: [
          `Hola ${pro}, te movieron un turno: lo cambió la clienta desde su cuenta.`,
          "",
          quien,
          `Queda ${when}`,
          ...(que ? [que] : []),
          ...cierre,
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
/** Un turno de mañana, lo justo para listarlo en el resumen de la profesional. */
export type TurnoDelDia = {
  startsAt: string;
  clientName: string;
  clientPhone?: string | null;
  serviceName?: string | null;
  sessionNumber?: number | null;
  sessionsTotal?: number | null;
};

/**
 * El recordatorio del día antes, para la PROFESIONAL: un solo mail con todos
 * los turnos que atiende mañana, en orden. Lo manda la tarea del reloj, la
 * misma que le escribe a cada clienta (8/9/2026).
 *
 * Hasta ese día la profesional se enteraba de un turno cuando entraba —el
 * "te reservaron un turno"— y nada más: si lo reservaron hace tres semanas, el
 * día antes no le llegaba ningún aviso. La clienta lo pidió así: aviso al
 * reservar y aviso el día antes, para las dos puntas del mostrador.
 *
 * Un mail y no uno por turno, a propósito: los cuatro avisos de arriba son
 * sobre UN turno porque los dispara un hecho sobre ese turno. Esto es "cómo
 * viene tu día", y eso se lee de una vez. Las horas van sin el "el jueves 10
 * de septiembre a las" repetido: el día ya está en el asunto.
 */
export function buildProfessionalDayDigest(
  professionalName: string,
  turnos: TurnoDelDia[],
): AppointmentMessage {
  const pro = firstName(professionalName);
  const uno = turnos.length === 1;
  const primero = turnos[0];
  const dia = primero
    ? new Date(primero.startsAt).toLocaleDateString("es-AR", {
        weekday: "long",
        day: "2-digit",
        month: "long",
        timeZone: TIMEZONE,
      })
    : "mañana";

  return {
    subject: uno
      ? `Mañana tenés un turno — ${dia}`
      : `Mañana tenés ${turnos.length} turnos — ${dia}`,
    lines: [
      `Hola ${pro}, te recordamos tu agenda de mañana, ${dia}.`,
      "",
      ...turnos.flatMap((t) => {
        const hora = new Date(t.startsAt).toLocaleTimeString("es-AR", {
          hour: "2-digit",
          minute: "2-digit",
          hourCycle: "h23",
          timeZone: TIMEZONE,
        });
        const sesion =
          t.sessionsTotal && t.sessionsTotal > 1 && t.sessionNumber
            ? ` · sesión ${t.sessionNumber} de ${t.sessionsTotal}`
            : "";
        return [
          `${hora} · ${t.clientName}${t.clientPhone ? ` · ${t.clientPhone}` : ""}`,
          ...(t.serviceName ? [`${t.serviceName}${sesion}`] : sesion ? [sesion.slice(3)] : []),
          "",
        ];
      }),
      `Tu agenda: ${CONTACT.siteUrl}/admin/mi-agenda`,
    ],
  };
}

/**
 * El cierre de los avisos que salen por WhatsApp a una clienta.
 *
 * ── POR QUÉ EXISTE ────────────────────────────────────────────────────────
 *
 * Porque los avisos automáticos salen de un **chip aparte que no lee nadie**.
 * Sin esta línea, una clienta que conteste "gracias, ahí voy" —o peor, "no puedo
 * ir, cancelame"— le escribe a un teléfono guardado en un cajón. Del lado de
 * ella queda como que el centro la ignoró; del lado del centro, como una clienta
 * que no vino y no avisó.
 *
 * Es el precio de mandar desde un número que no es el de siempre (ver
 * `docs/whatsapp-automatico.md` §6-D), y esta línea es lo único que lo paga.
 * Pedido por el centro el 9/9/2026.
 *
 * ── DÓNDE VA Y DÓNDE NO ───────────────────────────────────────────────────
 *
 * Sólo en los avisos **a la clienta**, y sólo por **WhatsApp**:
 *
 *   · Al mail no se le agrega. La casilla del centro sí la lee alguien, así que
 *     ahí responder es lo correcto y decirle que no lo haga sería absurdo.
 *   · A los avisos internos tampoco: van al centro, que ya sabe.
 *
 * El número sale del panel, no de `contact.ts`. Es justamente el dato que puede
 * cambiar sin que nadie toque el código, y mandar a una clienta a un número
 * viejo es peor que no poner la línea.
 */
export function firmaDeWhatsapp(centro?: DatosDelCentroParaMensaje): string[] {
  const telefono = centro?.telefonoVisible?.trim() || CONTACT.phoneDisplay;
  return [
    "",
    `Este número solo envía avisos y no se lee. Si necesitás algo, escribinos al ${telefono}.`,
  ];
}

export function toWhatsappNumber(raw: string | null | undefined): string | null {
  const digits = (raw ?? "").replace(/\D/g, "");
  if (!digits) return null;

  // Ya viene con código de país y el 9 de celular.
  if (digits.startsWith("549") && digits.length >= 12) return digits;

  // Con código de país pero sin el 9: se lo agregamos.
  if (digits.startsWith("54") && digits.length >= 11) return `549${digits.slice(2)}`;

  // Sin código de país: el 0 de larga distancia y el 15 de celular no viajan al
  // formato internacional, así que se descartan antes de anteponer el 549.
  //   const local = digits.replace(/^0/, "").replace(/^(\d{2,4})15/, "$1");
  // ↑ Esto cubría "11 15 3385 2327" pero no "15 3385 2327" pelado, que es como
  //   la gente de Buenos Aires dicta su celular: sin el 11, porque nunca lo
  //   marca. Salía 549 15 3385 2327, un número que no existe, y el WhatsApp
  //   se perdía sin error (9/9/2026, dos clientas sin cuenta cargadas así).
  //   Ningún código de área argentino empieza con 15, así que diez dígitos
  //   que arrancan con 15 son siempre 15 + ocho de abonado del 11.
  //
  //   Y el recorte viejo tenía otro agujero, visto al probar esto: un número
  //   de diez dígitos —área más abonado, ya completo— no tiene ningún 15 que
  //   sacar, pero el regex igual lo buscaba y a "341 555 1234" le comía el
  //   "15" de adentro, dejando ocho dígitos y ningún número. Un 15 sólo puede
  //   estar de más cuando sobran dígitos, así que sólo se recorta con más de
  //   diez.
  const sinCero = digits.replace(/^0/, "");
  const local =
    sinCero.length === 10 && sinCero.startsWith("15")
      ? `11${sinCero.slice(2)}`
      : sinCero.length > 10
        ? sinCero.replace(/^(\d{2,4})15/, "$1")
        : sinCero;
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
