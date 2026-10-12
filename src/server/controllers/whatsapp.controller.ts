import { json, type Ctx } from "@/server/http";
import {
  desvincularEvolution,
  estadoDeEvolution,
  evolutionConfigurada,
  nombreDeLaInstancia,
  qrDeEvolution,
  reiniciarEvolution,
} from "@/server/services/evolution.service";
import type { RtaWhatsappEstado, RtaWhatsappQr } from "@/lib/api-tipos";

/**
 * La conexión del chip de avisos, manejada desde el panel. **Sólo la dueña.**
 *
 * ── POR QUÉ EXISTE (11/10/2026) ───────────────────────────────────────────
 *
 * El chip de WhatsApp se vincula a Evolution como un dispositivo más, igual
 * que WhatsApp Web, y cuando el teléfono pasa días apagado la sesión se pierde
 * y hay que escanear el QR de nuevo. Hasta hoy eso se hacía desde la terminal
 * del VPS, con la llave de Evolution a mano, y dibujando el QR en la consola.
 * O sea: lo hacía el desarrollador, y la dueña dependía de él para que sus
 * clientas volvieran a recibir avisos.
 *
 * La decisión del 11/10 fue que el chip lo maneja la dueña, y entonces
 * reconectarlo también. Esta pantalla es eso: el estado, un botón para
 * reiniciar la conexión, y el QR en la pantalla para escanearlo desde el
 * teléfono. Lo que antes eran tres comandos y una llave, ahora es un clic.
 *
 * ── LO QUE NO HACE ────────────────────────────────────────────────────────
 *
 * No manda mensajes ni lee conversaciones: sólo habla con los cuatro
 * endpoints de Evolution que manejan la sesión. La llave de Evolution no sale
 * del servidor —abre TODO, incluidas las conversaciones— y por eso esto es un
 * controlador y no una llamada directa desde el navegador.
 *
 * Es sólo para la dueña porque el QR vincula el número a este sistema: quien
 * lo escanea con OTRO teléfono se lleva el canal de avisos del centro.
 */

/** El estado de la conexión, para la pantalla. */
export async function estado() {
  const { transporteWhatsapp } = await import("@/lib/notifications.server");
  const transporte = await transporteWhatsapp();

  const salida: RtaWhatsappEstado = {
    transporte,
    estado: transporte === "evolution" ? await estadoDeEvolution() : null,
    instancia: nombreDeLaInstancia(),
  };
  return json(salida);
}

/**
 * Reinicia la instancia. Es lo que reabre una sesión cerrada pero todavía
 * válida —el caso del 16/9: el teléfono estuvo apagado un rato—. No pide QR.
 */
export async function reconectar() {
  if (!evolutionConfigurada()) {
    return json({ error: "El WhatsApp de avisos no está configurado en este servidor." }, 400);
  }
  const reinicio = await reiniciarEvolution();
  if (!reinicio.ok) return json({ error: reinicio.motivo }, 502);
  return json({ ok: true });
}

/**
 * El QR para vincular el chip de nuevo.
 *
 * Si la sesión está abierta no hay nada que vincular y lo dice. Si Evolution
 * no devuelve QR a la primera —pasa cuando la sesión vieja quedó colgada—, se
 * reinicia la instancia y se pide otra vez: es exactamente lo que hubo que
 * hacer a mano el 14/9.
 *
 * El QR vence a los pocos segundos y Evolution genera uno nuevo cada vez que
 * se le pide; la pantalla lo vuelve a pedir sola mientras está a la vista.
 */
export async function qr(_ctx: Ctx) {
  if (!evolutionConfigurada()) {
    return json({ error: "El WhatsApp de avisos no está configurado en este servidor." }, 400);
  }

  const antes = await estadoDeEvolution();
  if (antes === "open") {
    const salida: RtaWhatsappQr = { estado: "open", base64: null, pairingCode: null };
    return json(salida);
  }

  let codigo = await qrDeEvolution();
  if (!codigo.ok || !codigo.base64) {
    await reiniciarEvolution();
    await new Promise((r) => setTimeout(r, 3_000));
    codigo = await qrDeEvolution();
  }

  if (!codigo.ok) return json({ error: codigo.motivo }, 502);

  const salida: RtaWhatsappQr = {
    estado: await estadoDeEvolution(),
    base64: codigo.base64,
    pairingCode: codigo.pairingCode,
  };
  return json(salida);
}

/**
 * Cierra la sesión del chip del lado de Evolution. Para cuando hay que
 * empezar de cero: el teléfono ya no muestra el dispositivo vinculado pero
 * Evolution sigue creyendo que lo tiene, y no genera QR nuevo.
 */
export async function desvincular() {
  if (!evolutionConfigurada()) {
    return json({ error: "El WhatsApp de avisos no está configurado en este servidor." }, 400);
  }
  const salida = await desvincularEvolution();
  if (!salida.ok) return json({ error: salida.motivo }, 502);
  return json({ ok: true });
}
