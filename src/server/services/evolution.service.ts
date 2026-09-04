/**
 * El envío de WhatsApp por **Evolution API**, sobre un número descartable.
 * **Sólo servidor.**
 *
 * Es el tercer transporte de avisos del proyecto, al lado de `email.service.ts`
 * y `whatsapp.service.ts`, y comparte con ellos la forma del resultado
 * —`{ ok }` o `{ ok, motivo }`— y la regla de oro: **sin configurar no falla, no
 * manda y lo dice**. Un turno que se confirma no puede fracasar porque falte un
 * contenedor.
 *
 * ── 🔴 QUÉ ES ESTO Y POR QUÉ EXISTE ───────────────────────────────────────
 *
 * Evolution API es un servicio que se levanta en el VPS y habla WhatsApp
 * simulando un **dispositivo vinculado**, como el WhatsApp Web. No es la API
 * oficial de Meta: **va contra los términos de servicio de WhatsApp**, y el
 * castigo, cuando llega, es que **banean el número**. Sin apelación práctica.
 *
 * Está acá igual, y con los ojos abiertos, porque la dueña no va a pagar la vía
 * oficial (§3 de `docs/whatsapp-automatico.md`: entre 7 y 57 dólares por mes
 * según el camino) y la alternativa era seguir mandando los avisos a mano.
 *
 * ── 🔴 LA REGLA QUE HACE QUE ESTO SEA ACEPTABLE ───────────────────────────
 *
 * **Acá NUNCA va el número por el que el centro atiende clientas.**
 *
 * Va un chip aparte, comprado para esto, que no sirve para nada más. Si un día
 * WhatsApp lo banea —y hay que asumir que va a pasar, no que puede pasar—, se
 * pierde un prepago de dos mil pesos y se compra otro. El número del centro, que
 * está en el sitio, en el Instagram y en la agenda de cada clienta, nunca estuvo
 * expuesto.
 *
 * Ese es el trato completo. Si alguien alguna vez vincula acá el número real
 * para "aprovechar que ya está", el riesgo deja de ser un chip y pasa a ser el
 * negocio. No hay forma de impedirlo desde el código —Evolution vincula lo que
 * le escaneen el QR— así que queda escrito acá, que es donde se va a leer.
 *
 * ── POR QUÉ ESTE MANDA TEXTO Y EL DE META MANDA PLANTILLAS ────────────────
 *
 * Porque las plantillas son una exigencia de Meta, no de WhatsApp. Un
 * dispositivo vinculado manda lo que mandaría una persona: texto libre, con sus
 * saltos de línea.
 *
 * Eso tiene una consecuencia buena y vale aprovecharla: **este transporte usa
 * `buildAppointmentMessage()`**, el mismo texto que sale por mail, en vez de la
 * segunda redacción de `whatsapp-plantillas.ts`. O sea que por acá el mail y el
 * WhatsApp del mismo turno no pueden decir cosas distintas, que es justo lo que
 * ese archivo advierte que puede pasar por el camino de Meta.
 *
 * ── LAS VARIABLES ─────────────────────────────────────────────────────────
 *
 *   EVOLUTION_URL         Dónde escucha el contenedor. Adentro de compose es
 *                         `http://evolution:8080`; desde la máquina de
 *                         desarrollo, `http://localhost:8080`.
 *   EVOLUTION_API_KEY     La llave que se le puso al contenedor en
 *                         AUTHENTICATION_API_KEY. Es la que abre TODO Evolution
 *                         —incluido leer conversaciones—, así que no sale del
 *                         `.env` ni viaja al navegador.
 *   EVOLUTION_INSTANCIA   El nombre de la instancia vinculada al chip. Una sola
 *                         para este proyecto.
 *
 * Y una opcional:
 *
 *   EVOLUTION_DELAY_MS    Los milisegundos de "escribiendo…" antes de cada
 *                         mensaje. Ver abajo por qué no es cosmético.
 */

/** El mismo `Envio` de email.service y whatsapp.service. */
export type Envio = { ok: true } | { ok: false; motivo: string };

/**
 * Cuánto "escribe" antes de mandar, en milisegundos.
 *
 * No es un detalle de presentación: el recordatorio de la mañana recorre todos
 * los turnos del día siguiente en un `for` con `await`, y sin esta pausa serían
 * diez o quince mensajes en dos segundos, todos con la misma forma. Eso es
 * exactamente el patrón que hace que a un número lo miren de cerca.
 *
 * Con 1,2 segundos, doce recordatorios tardan quince segundos en salir. No hay
 * nadie esperando ese resultado —lo dispara el reloj, no una pantalla— así que
 * la demora no le cuesta nada a nadie.
 */
const DELAY_POR_DEFECTO = 1200;

/** Igual que en los otros dos: la cadena vacía es lo mismo que no estar. */
function variable(nombre: string): string | undefined {
  const valor = process.env[nombre];
  return valor === undefined || valor === "" ? undefined : valor;
}

/** ¿Está configurado este transporte? Lo usa el selector de canal. */
export function evolutionConfigurada(): boolean {
  return Boolean(
    variable("EVOLUTION_URL") && variable("EVOLUTION_API_KEY") && variable("EVOLUTION_INSTANCIA"),
  );
}

/**
 * Manda un texto a un número.
 *
 * `to` va en formato internacional y sólo dígitos —"5491154189624"—, que es lo
 * que devuelve `toWhatsappNumber()` de notifications.ts. Es el mismo formato que
 * espera el transporte de Meta, así que quien llama no tiene que saber cuál de
 * los dos está encendido.
 */
export async function enviarPorEvolution(mensaje: { to: string; texto: string }): Promise<Envio> {
  const url = variable("EVOLUTION_URL");
  const apiKey = variable("EVOLUTION_API_KEY");
  const instancia = variable("EVOLUTION_INSTANCIA");

  if (!url || !apiKey || !instancia) {
    return { ok: false, motivo: "El envío por Evolution todavía no está configurado." };
  }

  if (mensaje.texto.trim() === "") {
    // No debería pasar nunca —`buildAppointmentMessage` siempre devuelve
    // líneas— pero mandar un mensaje vacío por un canal no oficial es la clase
    // de cosa que llama la atención de WhatsApp sin darle ningún valor a nadie.
    return { ok: false, motivo: "El texto del aviso vino vacío." };
  }

  // Un `EVOLUTION_DELAY_MS` con cualquier cosa adentro daría NaN, y NaN viaja
  // en el JSON como `null`. Evolution no lo rechaza: manda igual, sin pausa —o
  // sea que el error se paga como una ráfaga de mensajes, que es justo lo que
  // este parámetro existe para evitar, y sin que nadie vea un error en el medio.
  const pedido = Number(variable("EVOLUTION_DELAY_MS"));
  const delay = Number.isFinite(pedido) && pedido >= 0 ? pedido : DELAY_POR_DEFECTO;

  try {
    // El timeout es más generoso que los diez segundos del SMTP y los de Meta:
    // acá el propio `delay` ya se come más de un segundo antes de que el
    // contenedor intente nada, y una sesión de WhatsApp que está
    // reconectándose tarda. Aun así tiene tope: si Evolution se colgó, el
    // pedido que disparó el aviso no puede quedarse esperando para siempre.
    const respuesta = await fetch(
      `${url.replace(/\/+$/, "")}/message/sendText/${encodeURIComponent(instancia)}`,
      {
        method: "POST",
        headers: {
          // Evolution autentica con un header propio, `apikey`, y no con
          // Authorization/Bearer. Es el error más fácil de cometer viniendo del
          // servicio de Meta, que está al lado y usa Bearer.
          apikey: apiKey,
          "Content-Type": "application/json",
        },
        signal: AbortSignal.timeout(30_000),
        body: JSON.stringify({
          number: mensaje.to,
          text: mensaje.texto,
          delay,
        }),
      },
    );

    if (!respuesta.ok) {
      // Igual que con Meta: desde afuera "la instancia está desconectada", "ese
      // número no tiene WhatsApp" y "la llave está mal" se ven todos igual —el
      // aviso no llegó—. El cuerpo del error es lo único que los distingue.
      //
      // El más frecuente y el que más confunde: un 404 casi siempre es que el
      // nombre de la instancia no coincide con la que está vinculada, no que la
      // URL esté mal.
      const detalle = await respuesta.text().catch(() => "");
      return {
        ok: false,
        motivo: `Evolution respondió ${respuesta.status}: ${detalle.slice(0, 300) || "sin detalle"}`,
      };
    }

    return { ok: true };
  } catch (error) {
    // Acá caen el timeout y el contenedor apagado. Este último es el caso
    // cotidiano —Evolution es un servicio más que se puede caer— y por eso el
    // mensaje nombra el servicio: "fetch failed" a secas no le dice nada a quien
    // lo lee en el panel seis meses después.
    return {
      ok: false,
      motivo:
        error instanceof Error
          ? `No se pudo llamar a Evolution: ${error.message}`
          : "Falló el envío.",
    };
  }
}
