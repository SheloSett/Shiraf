import {
  estadoDeEvolution,
  evolutionConfigurada,
  reiniciarEvolution,
} from "@/server/services/evolution.service";

/**
 * El vigilante de la sesión de WhatsApp. **Sólo producción, sólo servidor.**
 *
 * ── POR QUÉ EXISTE (16/9/2026) ────────────────────────────────────────────
 *
 * Evolution habla WhatsApp como un dispositivo vinculado, y cuando el teléfono
 * del chip se apaga —o se queda sin batería, o "duerme" WhatsApp por ahorro de
 * energía— la sesión se cierra y **no se vuelve a abrir sola**. Pasó dos veces
 * en una semana:
 *
 *   · 14/9: apagado de viernes a lunes. Sesión perdida del todo: hubo que
 *     escanear el QR de nuevo.
 *   · 16/9: apagado un rato. Sesión cerrada pero viva: alcanzó con un
 *     `POST /instance/restart`, sin QR.
 *
 * Las dos veces se descubrió igual: cargando un turno y viendo el toast de
 * "Por WhatsApp no salió: Connection Closed". O sea, después de que un aviso ya
 * no había salido. Esto está para darlo vuelta: que la app se entere primero.
 *
 * ── QUÉ HACE, CADA DIEZ MINUTOS ───────────────────────────────────────────
 *
 *   1. Pregunta el estado. `open` → nada que hacer.
 *   2. Si no está `open`, reinicia la instancia y vuelve a preguntar a los
 *      treinta segundos. Es exactamente el segundo caso de arriba, y con esto
 *      se arregla solo sin que nadie se entere.
 *   3. Si después del reinicio sigue sin abrir, es el primer caso: hace falta
 *      una persona y un teléfono. Manda UN mail al centro —a las dueñas y a
 *      quien tenga tildado recibir los mails del centro— diciendo qué pasa y
 *      qué hacer, y no vuelve a mandarlo hasta que la sesión abra y se cierre
 *      de nuevo. Sin eso, un fin de semana con el teléfono apagado serían
 *      doscientos mails iguales.
 *
 * Los avisos a las clientas siguen saliendo **por mail** todo el tiempo que
 * esto dure: la caída de un canal no frena al otro. Y los WhatsApp que no
 * salieron se reenvían con `scripts/avisar-turnos.mjs --whatsapp` cuando la
 * sesión vuelva.
 *
 * ── LO QUE NO HACE ────────────────────────────────────────────────────────
 *
 * No puede volver a vincular el chip: eso exige escanear un QR desde el
 * teléfono, y no hay forma de hacerlo sin una persona. Tampoco reinicia el
 * contenedor de Evolution: si Evolution no contesta, no es cosa de la sesión y
 * el log lo va a decir con otro error.
 *
 * Sin `EVOLUTION_*` configurado no se programa y no dice nada: es la misma
 * regla que el transporte —sin configurar, no falla, no manda y lo dice—.
 */

const CADA = "*/10 * * * *";

/** Cuánto esperar después del reinicio antes de volver a preguntar. */
const ESPERA_TRAS_REINICIO_MS = 30_000;

let programado = false;

/**
 * Si ya se mandó el mail de "hay que vincular de nuevo" para ESTA caída. Se
 * limpia cuando la sesión vuelve a `open`, así la próxima caída avisa otra vez.
 * Vive en memoria a propósito: un reinicio del contenedor lo pierde y manda el
 * mail de nuevo, que para un problema que sigue ahí es lo correcto.
 */
let avisado = false;

export async function vigilarSesionDeWhatsapp(): Promise<void> {
  const estado = await estadoDeEvolution();

  if (estado === null) {
    // No se pudo ni preguntar: Evolution apagado o sin configurar. No es una
    // sesión cerrada y no hay nada que reiniciar; el motivo ya quedó en el log.
    return;
  }

  if (estado === "open") {
    if (avisado) {
      console.log("[whatsapp] La sesión volvió a abrir.");
      avisado = false;
    }
    return;
  }

  console.warn(`[whatsapp] La sesión está en "${estado}". Reiniciando la instancia…`);
  const reinicio = await reiniciarEvolution();
  if (!reinicio.ok) {
    console.error(`[whatsapp] No se pudo reiniciar la instancia: ${reinicio.motivo}`);
  }

  await new Promise((r) => setTimeout(r, ESPERA_TRAS_REINICIO_MS));
  const despues = await estadoDeEvolution();

  if (despues === "open") {
    console.log("[whatsapp] La sesión abrió después del reinicio. Nadie tuvo que hacer nada.");
    return;
  }

  console.error(
    `[whatsapp] La sesión sigue en "${despues ?? "desconocido"}" después del reinicio. Hace falta volver a vincular el chip.`,
  );

  if (avisado) return;

  const envio = await avisarAlCentro();
  if (envio.ok) {
    avisado = true;
    console.log("[whatsapp] Mail de aviso al centro enviado.");
  } else {
    console.error(`[whatsapp] El mail de aviso al centro no salió: ${envio.motivo}`);
  }
}

async function avisarAlCentro() {
  const { enviarMail } = await import("@/server/services/email.service");
  const { mailsDelCentro } = await import("@/server/services/destinatarios.service");
  const { buildWhatsappDownNotice } = await import("@/lib/notifications");
  const { renderEmailHtml } = await import("@/lib/notifications.server");

  const message = buildWhatsappDownNotice();

  return enviarMail({
    to: await mailsDelCentro(),
    subject: message.subject,
    text: message.lines.join("\n"),
    html: renderEmailHtml(message),
  });
}

export async function iniciarVigilanteDeWhatsapp(): Promise<void> {
  if (programado) return;

  if (typeof navigator !== "undefined" && navigator.userAgent === "Cloudflare-Workers") return;
  if (process.env["NODE_ENV"] !== "production") return;
  if (!evolutionConfigurada()) return;

  programado = true;

  const { schedule } = await import("node-cron");
  schedule(CADA, correr, { name: "whatsapp-vigilante" });

  console.log(`[whatsapp] Vigilante de la sesión programado: "${CADA}".`);
}

async function correr(): Promise<void> {
  try {
    await vigilarSesionDeWhatsapp();
  } catch (error) {
    console.error("[whatsapp] El vigilante falló entero:", error);
  }
}
