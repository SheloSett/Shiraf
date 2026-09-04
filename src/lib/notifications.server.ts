import { CONTACT } from "@/lib/contact";
import {
  buildAppointmentMessage,
  buildProfessionalMessage,
  buildOverdueDigest,
  type TurnoVencido,
  type AppointmentEvent,
  type AppointmentMessage,
  toWhatsappNumber,
  type NotifiableAppointment,
} from "@/lib/notifications";
import { PLANTILLAS } from "@/lib/whatsapp-plantillas";

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
 * Lo que devuelve `notifyAppointment`: cómo le fue al mail, más el WhatsApp.
 *
 * `sent` y `reason` son los del MAIL y siguen significando lo mismo que antes de
 * que existiera el segundo canal — de eso dependen los toasts del panel, que
 * dicen "por mail no salió". El WhatsApp va en su propio campo justamente para
 * no tocar eso: hoy el canal está apagado en las dos instalaciones, y si
 * entrara en el mismo booleano, cada aviso se reportaría como fallado aunque el
 * mail hubiera salido perfecto.
 *
 * Es opcional para que las pantallas que no lo miran compilen igual.
 *
 * `professional` entró el 4/9/2026 con el mismo criterio y por el mismo motivo:
 * la mayoría de las veces NO sale —el turno no tiene profesional, o la hizo ella
 * misma— y eso es normal, no un fallo. Metido en `sent`, cada turno sin
 * profesional asignada se reportaría en el panel como un aviso que falló.
 */
export type NotifyResult = DeliveryResult & {
  whatsapp?: DeliveryResult;
  professional?: DeliveryResult;
};

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
/**
 * El turno, ya en la forma que necesitan los avisos, más cómo se le escribe.
 *
 * Se separó de `deliverAppointmentEmail` cuando apareció el segundo canal: el
 * mail y el WhatsApp necesitan exactamente lo mismo —quién es, cuándo, de qué, y
 * su dirección o su teléfono— y con la consulta adentro de una de las dos
 * funciones, la otra tenía que escribirla de nuevo. Dos consultas al mismo turno
 * es cómo empiezan a divergir: una suma un campo y la otra no, y el mismo aviso
 * dice cosas distintas según el canal.
 */
type DatosDelAviso = {
  notifiable: NotifiableAppointment;
  /** Null cuando la clienta no tiene mail: la invitada que cargó el centro. */
  clientEmail: string | null;
  /**
   * La dirección de la profesional, o null si el turno no tiene una asignada o
   * su ficha no está vinculada a ninguna cuenta.
   */
  professionalEmail: string | null;
  /** La cuenta de la profesional, para no avisarle de lo que hizo ella misma. */
  professionalUserId: string | null;
};

async function datosDelAviso(appointmentId: string): Promise<DatosDelAviso | null> {
  const { prisma } = await import("@/server/db");
  // Dinámico igual que prisma, y por lo mismo: turnos.service lo importa arriba
  // de todo, así que un import estático acá lo arrastraría al bundle del
  // navegador y el guard de importación lo frenaría.
  const { nombreDelTratamiento } = await import("@/server/services/turnos.service");

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
      // La opción elegida, para que el mail diga "Masaje — cuerpo completo" y no
      // sólo "Masaje": con dos opciones de precio distinto, el nombre solo no
      // alcanza para saber qué reservó.
      variant: { select: { name: true } },
      variant_name: true,
      // En qué punto del tratamiento está, cuando son varias sesiones.
      session_number: true,
      sessions_total: true,
      // La profesional que atiende el turno, con su cuenta si la tiene.
      //
      // El mail sale de `user`, no de la ficha: `professionals` no guarda
      // direcciones, y la ficha existe sin cuenta —`user_id` es nullable— para
      // las que trabajan en el centro pero no entran al panel. A ésas no hay
      // dónde avisarles, y no es un error.
      //
      // `user_id` viaja además del mail porque con él se compara quién disparó
      // la acción: ver `deliverAppointmentToProfessional`.
      professional: {
        select: { full_name: true, user_id: true, user: { select: { email: true } } },
      },
      // El teléfono del profile entró con el WhatsApp: hasta entonces sólo
      // viajaba `guest_phone`, así que de una clienta CON cuenta no se sabía el
      // número. Para el mail eso se notaba poco —los avisos al centro decían el
      // teléfono sólo de las invitadas—; para el WhatsApp es la dirección misma,
      // sin ella no hay a dónde mandar.
      client: { select: { email: true, profile: { select: { full_name: true, phone: true } } } },
    },
  });

  if (!appointment) return null;

  // ── Quién es la clienta y cómo se le escribe ──────────────────────────────
  // Los datos de invitada son el respaldo: si hay cuenta, mandan los de la
  // cuenta. Es el mismo orden que antes.
  const clientName = appointment.client?.profile?.full_name ?? appointment.guest_name ?? "Clienta";
  const clientEmail = appointment.client?.email ?? appointment.guest_email ?? null;

  const notifiable: NotifiableAppointment = {
    startsAt: appointment.starts_at.toISOString(),
    clientName,
    // Igual que el nombre: si tiene cuenta manda el profile, y los datos de
    // invitada son el respaldo.
    clientPhone: appointment.client?.profile?.phone ?? appointment.guest_phone,
    // La misma función que arma el nombre en el panel y en la agenda: el
    // catálogo primero, el congelado como respaldo, y la opción pegada al final.
    // Escribirlo acá otra vez sería tener dos redacciones del mismo nombre.
    serviceName: nombreDelTratamiento(appointment),
    professionalName: appointment.professional?.full_name ?? null,
    cancelReason: appointment.cancel_reason,
    sessionNumber: appointment.session_number,
    sessionsTotal: appointment.sessions_total,
  };

  return {
    notifiable,
    clientEmail,
    professionalEmail: appointment.professional?.user?.email ?? null,
    professionalUserId: appointment.professional?.user_id ?? null,
  };
}

export async function deliverAppointmentEmail(
  appointmentId: string,
  event: AppointmentEvent,
): Promise<DeliveryResult> {
  const datos = await datosDelAviso(appointmentId);
  if (!datos) return { sent: false, reason: "El turno no existe." };

  const recipient = TO_CLIENT.includes(event) ? datos.clientEmail : CONTACT.email;

  if (!recipient) {
    // El caso real: una invitada cargada por teléfono, de la que el centro tiene
    // el celular y no el mail. No es un error — es el motivo por el que WhatsApp
    // sigue siendo el canal principal.
    return { sent: false, reason: "Esta clienta no tiene mail cargado." };
  }

  const message = buildAppointmentMessage(event, datos.notifiable);

  return sendEmail({
    to: recipient,
    subject: message.subject,
    text: message.lines.join("\n"),
    html: renderEmailHtml(message),
  });
}

/**
 * El mismo turno, avisado a la profesional que lo atiende. **Sólo por mail.**
 *
 * Es un tercer destinatario que se suma a los dos que ya había, y no reemplaza a
 * ninguno: la clienta sigue recibiendo lo suyo y el centro lo suyo. Decidido el
 * 4/9/2026 — hasta entonces, quien atendía el turno era la única que no se
 * enteraba de nada, aunque el sistema supiera perfectamente quién era.
 *
 * ── LO QUE DEVUELVE `{ sent: false }` Y NO ES UN PROBLEMA ─────────────────
 *
 * Casi todo, de hecho. Los cuatro casos normales:
 *
 *   · El turno no tiene profesional asignada.
 *   · La ficha de la profesional no está vinculada a ninguna cuenta, así que no
 *     hay dirección a dónde mandar.
 *   · El evento es "requested" o "reminder", que no le corresponden — el porqué
 *     está en `buildProfessionalMessage`.
 *   · La acción la hizo ella misma (ver abajo).
 *
 * Por eso esto NO se loguea como error en ningún lado y viaja en su propio campo
 * del resultado, igual que el WhatsApp: si entrara en el `sent` que miran los
 * toasts del panel, un turno sin profesional se reportaría como aviso fallado.
 *
 * ── POR QUÉ NO SE LE AVISA DE LO QUE HIZO ELLA ────────────────────────────
 *
 * Todas las profesionales manejan turnos, así que la que confirma un turno desde
 * el panel es muchas veces la misma que lo va a atender. Mandarle un mail
 * diciéndole lo que acaba de hacer es la forma más rápida de que estos avisos
 * terminen en una regla de "mover a la papelera", y con ellos los que sí
 * importan.
 *
 * `quienLoHizo` llega de `notifyAppointment`, que lo saca del middleware de
 * sesión. Cuando no viene —la tarea del reloj, que no la dispara nadie— no hay
 * nada que comparar y el aviso sale igual.
 */
export async function deliverAppointmentToProfessional(
  appointmentId: string,
  event: AppointmentEvent,
  quienLoHizo?: string,
): Promise<DeliveryResult> {
  // Se pregunta ANTES de ir a la base, igual que en el WhatsApp: para los dos
  // eventos que no le corresponden a la profesional, esto ahorra una consulta
  // por cada recordatorio del día.
  if (event === "requested" || event === "reminder") {
    return { sent: false, reason: "Este aviso no le corresponde a la profesional." };
  }

  const datos = await datosDelAviso(appointmentId);
  if (!datos) return { sent: false, reason: "El turno no existe." };

  if (!datos.professionalEmail) {
    return {
      sent: false,
      reason: datos.notifiable.professionalName
        ? "La profesional no tiene cuenta vinculada."
        : "El turno no tiene profesional asignada.",
    };
  }

  if (quienLoHizo && datos.professionalUserId === quienLoHizo) {
    return { sent: false, reason: "Lo hizo ella misma." };
  }

  const message = buildProfessionalMessage(event, datos.notifiable);

  // No debería pasar: los eventos sin mensaje se filtraron arriba y el nombre de
  // la profesional existe si tiene cuenta. Está igual porque la función puede
  // devolver null por más de un motivo y el día que se agregue otro, esto tiene
  // que seguir siendo un aviso que no sale y no una excepción en medio de un
  // turno que se está confirmando.
  if (!message) {
    return { sent: false, reason: "Este aviso no le corresponde a la profesional." };
  }

  return sendEmail({
    to: datos.professionalEmail,
    subject: message.subject,
    text: message.lines.join("\n"),
    html: renderEmailHtml(message),
  });
}

/** Por dónde salen los WhatsApp, si es que sale alguno. */
export type TransporteWhatsapp = "evolution" | "meta";

/**
 * Cuál de los dos transportes está encendido, o null si ninguno.
 *
 * **Evolution tiene prioridad**, y el orden no es un detalle: si algún día se
 * configuran los dos —porque la dueña terminó pagando la vía oficial y nadie se
 * acordó de sacar las variables del chip— el que gana es el que se eligió último
 * a mano, y sacar tres variables del `.env` es más fácil que descubrir por qué
 * los avisos salen por el canal viejo.
 *
 * Los dos empiezan apagados y ahí no falla nada: los avisos salen sólo por mail,
 * que es como estuvo el proyecto hasta hoy.
 *
 * Está exportada porque `reminders.service.ts` la necesita para una cosa
 * distinta que mandar: decidir si un WhatsApp que no salió es un problema que
 * hay que loguear o el estado normal de un canal apagado.
 */
export async function transporteWhatsapp(): Promise<TransporteWhatsapp | null> {
  const { evolutionConfigurada } = await import("@/server/services/evolution.service");
  if (evolutionConfigurada()) return "evolution";

  const { whatsappConfigurado } = await import("@/server/services/whatsapp.service");
  if (whatsappConfigurado()) return "meta";

  return null;
}

/**
 * El mismo aviso, por WhatsApp.
 *
 * Sale por uno de dos transportes, y quien llama no sabe por cuál —ni tiene que
 * saberlo—. Lo decide `transporteWhatsapp()` mirando el `.env`:
 *
 *   · **evolution** · Un dispositivo vinculado a un chip aparte, corriendo en el
 *     VPS. No es oficial, no cuesta nada, y el número que vincula es descartable
 *     a propósito. Manda **texto libre**, o sea el mismo mensaje que el mail.
 *   · **meta** · La Cloud API oficial. Cuesta plata y exige plantillas
 *     aprobadas; lo que viaja es el NOMBRE de la plantilla y los valores de sus
 *     huecos, y el texto lo arma Meta. Por eso ese camino no usa
 *     `buildAppointmentMessage` sino `PLANTILLAS` de `whatsapp-plantillas.ts`.
 *
 * Los dos caminos, y por qué se terminó eligiendo el primero, están en
 * `docs/whatsapp-automatico.md`.
 *
 * ── A QUIÉN LE LLEGA ──────────────────────────────────────────────────────
 *
 * El mismo reparto que el mail, con la otra libreta: los cinco avisos de
 * `TO_CLIENT` van al teléfono de la clienta; los tres internos, al WhatsApp del
 * centro. Y como en el mail, quien llama nunca dice a qué número mandar — manda
 * el id del turno y el destinatario sale de la base. Si el número viajara en el
 * pedido, esto sería un formulario abierto para mandar WhatsApp a nombre del
 * centro.
 */
export async function deliverAppointmentWhatsapp(
  appointmentId: string,
  event: AppointmentEvent,
): Promise<DeliveryResult> {
  const transporte = await transporteWhatsapp();

  // Se pregunta ANTES de ir a la base: sin canal encendido, buscar el turno para
  // después no mandar nada es una consulta por cada confirmación de turno.
  if (!transporte) {
    return { sent: false, reason: "El envío de WhatsApp todavía no está configurado." };
  }

  const datos = await datosDelAviso(appointmentId);
  if (!datos) return { sent: false, reason: "El turno no existe." };

  const crudo = TO_CLIENT.includes(event) ? datos.notifiable.clientPhone : CONTACT.whatsappNumber;

  // La misma normalización que usa el enlace `wa.me` del panel: agrega el 9 de
  // los celulares argentinos y descarta el 0 y el 15, que no viajan al formato
  // internacional. Devuelve null cuando el número no da para nada confiable.
  const numero = toWhatsappNumber(crudo);

  if (!numero) {
    return {
      sent: false,
      reason: crudo
        ? "El teléfono cargado no tiene forma de número argentino."
        : "Esta clienta no tiene teléfono cargado.",
    };
  }

  // Por Evolution viaja el texto entero; por Meta, el nombre de una plantilla y
  // los valores de sus huecos. La diferencia está explicada en cada servicio; lo
  // que importa acá es que el destinatario y el reparto se resolvieron una sola
  // vez, arriba, y valen para los dos.
  if (transporte === "evolution") {
    const { enviarPorEvolution } = await import("@/server/services/evolution.service");

    // El mismo texto que el mail, sin segunda redacción. Es la ventaja de que
    // este canal acepte texto libre; ver el comentario de evolution.service.ts.
    const { lines } = buildAppointmentMessage(event, datos.notifiable);
    const envio = await enviarPorEvolution({ to: numero, texto: lines.join("\n") });

    return envio.ok ? { sent: true } : { sent: false, reason: envio.motivo };
  }

  const { enviarWhatsapp } = await import("@/server/services/whatsapp.service");

  const plantilla = PLANTILLAS[event];
  const envio = await enviarWhatsapp({
    to: numero,
    plantilla: plantilla.nombre,
    params: plantilla.params(datos.notifiable),
  });

  return envio.ok ? { sent: true } : { sent: false, reason: envio.motivo };
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
