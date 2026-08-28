import { IDIOMA_POR_DEFECTO } from "@/lib/whatsapp-plantillas";

/**
 * El envío de WhatsApp por la Cloud API de Meta. **Sólo servidor.**
 *
 * Es el gemelo de `email.service.ts`: la única función del proyecto que habla
 * con WhatsApp, con la misma forma de resultado —`{ ok }` o `{ ok, motivo }`— y
 * la misma regla de oro: **sin configurar no falla, no manda y lo dice**. Un
 * turno que se confirma no puede fracasar porque falte un token.
 *
 * ── 🔴 ESTO NACE APAGADO ──────────────────────────────────────────────────
 *
 * Hoy, en las dos instalaciones —la local y el VPS— no hay ninguna de las
 * variables puestas, así que todo esto devuelve "todavía no está configurado" y
 * el único canal que sale es el mail. Es a propósito: encenderlo depende de un
 * trámite con Meta y de una decisión de la dueña que todavía no se tomó. Ver
 * `docs/whatsapp-automatico.md`.
 *
 * Para encenderlo hacen falta dos variables, y ninguna se puede inventar:
 *
 *   WHATSAPP_TOKEN      El token permanente de la app de Meta. NO el temporal
 *                       de 24 horas que muestra el panel al principio: ése
 *                       vence y los avisos dejan de salir de un día para el
 *                       otro, sin que cambie nada en el código.
 *   WHATSAPP_PHONE_ID   El **id** del número, no el número. Es una tira de
 *                       dígitos que da el panel de Meta; poner ahí el
 *                       "+54 9 11…" es el error que más se comete y da un 404
 *                       que no explica nada.
 *
 * Y dos opcionales:
 *
 *   WHATSAPP_LANG          El idioma con el que se registraron las plantillas.
 *                          Por defecto `es_AR`; si en el panel quedaron como
 *                          `es`, hay que ponerlo o Meta contesta que la
 *                          plantilla no existe.
 *   WHATSAPP_API_VERSION   La versión de la Graph API. Se pisa sólo si Meta
 *                          discontinúa la que está fijada abajo.
 *
 * ── POR QUÉ SÓLO MANDA PLANTILLAS ─────────────────────────────────────────
 *
 * Porque es lo único que se puede mandar sin que la clienta haya escrito en las
 * últimas 24 horas, y un aviso de turno nunca cae adentro de esa ventana. No hay
 * una función para mandar texto libre y no es un olvido: existiendo, alguien la
 * usaría y el mensaje se rechazaría en producción, de noche, sin que nadie lo
 * vea.
 */

/** El mismo `Envio` de email.service, para que los dos canales se lean igual. */
export type Envio = { ok: true } | { ok: false; motivo: string };

/**
 * La versión de la Graph API contra la que se llama.
 *
 * Fijada y no "la última": Meta rompe cosas entre versiones y una URL sin
 * versión sigue la que ellos decidan. Cuando ésta se discontinúe, el aviso llega
 * como un error de la API y se sube a mano después de leer el changelog.
 */
const VERSION_POR_DEFECTO = "v21.0";

/** Igual que en email.service: la cadena vacía es lo mismo que no estar. */
function variable(nombre: string): string | undefined {
  const valor = process.env[nombre];
  return valor === undefined || valor === "" ? undefined : valor;
}

/** ¿Está configurado el canal? Lo usan los avisos para no intentar al pedo. */
export function whatsappConfigurado(): boolean {
  return Boolean(variable("WHATSAPP_TOKEN") && variable("WHATSAPP_PHONE_ID"));
}

/**
 * Manda una plantilla a un número.
 *
 * `to` va en formato internacional y sólo dígitos —"5491154189624"—, que es lo
 * que devuelve `toWhatsappNumber()` de notifications.ts. Meta acepta el `+`
 * adelante, pero no siempre: mandarlo sin él funciona en los dos casos.
 */
export async function enviarWhatsapp(mensaje: {
  to: string;
  plantilla: string;
  params: string[];
}): Promise<Envio> {
  const token = variable("WHATSAPP_TOKEN");
  const phoneId = variable("WHATSAPP_PHONE_ID");

  if (!token || !phoneId) {
    return { ok: false, motivo: "El envío de WhatsApp todavía no está configurado." };
  }

  // Un parámetro vacío hace que Meta rechace el mensaje entero con un error de
  // formato bastante oscuro. Las plantillas ya están escritas para que no pase
  // —ver `oSinDato`— pero el chequeo va igual: es la clase de bug que aparece
  // recién con el turno raro, seis meses después, y de noche.
  const vacio = mensaje.params.findIndex((p) => p.trim() === "");
  if (vacio !== -1) {
    return {
      ok: false,
      motivo: `El parámetro ${vacio + 1} de la plantilla "${mensaje.plantilla}" vino vacío.`,
    };
  }

  const version = variable("WHATSAPP_API_VERSION") ?? VERSION_POR_DEFECTO;
  const idioma = variable("WHATSAPP_LANG") ?? IDIOMA_POR_DEFECTO;

  try {
    // Timeout corto, con el mismo criterio que los del SMTP: si Meta no
    // contesta, es mejor cortar en diez segundos que dejar colgado el pedido
    // que disparó el aviso — que del otro lado es una clienta esperando que la
    // pantalla le diga que su turno quedó reservado.
    const respuesta = await fetch(`https://graph.facebook.com/${version}/${phoneId}/messages`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      signal: AbortSignal.timeout(10_000),
      body: JSON.stringify({
        messaging_product: "whatsapp",
        to: mensaje.to,
        type: "template",
        template: {
          name: mensaje.plantilla,
          language: { code: idioma },
          components: [
            {
              type: "body",
              parameters: mensaje.params.map((text) => ({ type: "text", text })),
            },
          ],
        },
      }),
    });

    if (!respuesta.ok) {
      // El cuerpo del error de Meta es lo único que distingue "la plantilla no
      // existe" de "el token venció" de "ese número no tiene WhatsApp", y desde
      // afuera los tres se ven igual: el aviso no llegó. Se devuelve entero.
      const detalle = await respuesta.text().catch(() => "");
      return {
        ok: false,
        motivo: `WhatsApp respondió ${respuesta.status}: ${detalle.slice(0, 300) || "sin detalle"}`,
      };
    }

    return { ok: true };
  } catch (error) {
    // Acá caen el timeout y la red cortada. `AbortSignal.timeout` tira un
    // `TimeoutError`, cuyo mensaje por sí solo no dice qué se estaba haciendo.
    return {
      ok: false,
      motivo:
        error instanceof Error
          ? `No se pudo llamar a WhatsApp: ${error.message}`
          : "Falló el envío.",
    };
  }
}
