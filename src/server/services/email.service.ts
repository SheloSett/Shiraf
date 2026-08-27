import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { Transporter } from "nodemailer";
import { CONTACT } from "@/lib/contact";

/**
 * El único lugar por el que sale un mail.
 *
 * ── POR QUÉ SE FUE RESEND ─────────────────────────────────────────────────
 *
 * Resend pide un dominio propio verificado —SPF y DKIM cargados en el
 * registrador— y hasta que eso no esté, no manda nada. Ese trámite tenía
 * frenados los mails desde hacía semanas, y no por una razón técnica: falta
 * saber dónde está registrado `shiraf.com.ar`. Google, además, no deja que otro
 * proveedor firme por `gmail.com`, así que la casilla que el centro usa de
 * verdad tampoco servía de remitente.
 *
 * `Ecommerce_mm` no tiene ese problema porque no usa ningún servicio: manda con
 * **nodemailer por el SMTP de Gmail**, con una contraseña de aplicación
 * (`services/email.service.js`). Es lo mismo que hacemos acá ahora. Alcanza con
 * la casilla que el centro ya tiene, no hay cuenta nueva que crear ni dominio
 * que verificar, y el día que `shiraf.com.ar` esté configurado se cambian tres
 * variables de entorno y se manda desde ahí sin tocar una línea de código.
 *
 * ── UN SOLO TRANSPORTE PARA LOS DOS TIPOS DE MAIL ─────────────────────────
 *
 * Antes había dos: éste, para los mails de cuenta, y otro igual escrito aparte
 * adentro de `notifications.server.ts`, para los avisos de turno. Los dos
 * hablaban con Resend por su cuenta y los dos leían las mismas variables. Eso ya
 * costó una: cambiar de proveedor había que hacerlo en dos lados, y el que se
 * olvidara quedaba mandando por un servicio que ya no existe.
 *
 * Ahora `enviarMail` es de acá y los avisos de turno la llaman. Lo que sigue
 * viviendo allá es CÓMO se redacta cada aviso, que es lo suyo.
 *
 * ── SI NO HAY SMTP CONFIGURADO, NO SE ROMPE NADA ──────────────────────────
 *
 * Se devuelve `{ ok: false, motivo }` y quien llamó decide qué hacer. Es la
 * misma decisión de siempre: se tiene que poder trabajar sin el correo resuelto.
 * Lo que NO se hace es tragarse el fracaso en silencio — el motivo llega hasta
 * el panel o hasta el log, según quién haya llamado.
 */

export type Envio = { ok: true } | { ok: false; motivo: string };

/**
 * El transporte, creado una vez y reusado.
 *
 * `undefined` = todavía no se intentó. `null` = falta configuración, y no hay
 * por qué volver a preguntarlo en cada envío.
 *
 * El ecommerce lo crea en cada mail; acá se cachea porque nodemailer mantiene
 * el pool de conexiones adentro del transporte, y crear uno nuevo por mail
 * reabre el saludo TLS con Gmail cada vez.
 */
type Correo = { transport: Transporter; user: string };

let transporte: Correo | null | undefined;

/**
 * Una variable de entorno, con la cadena VACÍA contando como ausente.
 *
 * ── POR QUÉ NO ALCANZA CON `process.env[x] ?? default` ─────────────────────
 *
 * 27/8/2026: en el VPS, «recuperar contraseña» fallaba con
 * `connect ECONNREFUSED 127.0.0.1:587`. Se conectaba a localhost teniendo el
 * default `smtp.gmail.com` escrito dos líneas más abajo.
 *
 * El compose de producción mapea las seis del correo así:
 *
 *     SMTP_HOST: ${SMTP_HOST:-}
 *
 * y `:-` con nada a la derecha **no deja la variable sin definir: la define
 * vacía**. `??` cae al default con `null` y `undefined`, con `""` NO. Así que
 * `host` quedaba en `""`, nodemailer lo lee como falsy, se cae a su propio
 * default —localhost— y el síntoma no menciona ninguna variable de entorno.
 *
 * En desarrollo es invisible: ahí las variables que no están en el `.env` no
 * existen de verdad, así que el `??` funciona. Es un bug que SÓLO aparece
 * adentro del contenedor.
 *
 * ⚠️ La que más duele no es el host sino `MAIL_FROM`, que está sin definir a
 * propósito —ver `remitente()`— para que el remitente salga de `SMTP_USER`.
 * Con la cadena vacía, el mail se armaba con el `From` en blanco.
 *
 * Cualquier variable del correo que se lea de acá en más tiene que pasar por
 * esta función, no por `process.env` directo.
 */
function variable(nombre: string): string | undefined {
  const valor = process.env[nombre];
  return valor === undefined || valor === "" ? undefined : valor;
}

async function obtenerTransporte(): Promise<Correo | null> {
  if (transporte !== undefined) return transporte;

  const user = process.env["SMTP_USER"];
  const pass = process.env["SMTP_PASS"];

  // Sin usuario y contraseña no hay nada que intentar. Los otros dos tienen
  // default porque el caso normal es Gmail.
  if (!user || !pass) {
    transporte = null;
    return null;
  }

  // const host = process.env["SMTP_HOST"] ?? "smtp.gmail.com";
  // const port = Number(process.env["SMTP_PORT"] ?? "587");
  const host = variable("SMTP_HOST") ?? "smtp.gmail.com";
  const port = Number(variable("SMTP_PORT") ?? "587");

  // El import va acá adentro y no arriba del archivo por lo mismo que
  // `node-cron` en reminders.service.ts: nodemailer abre sockets TCP y sólo
  // tiene sentido en un proceso Node. Cargándolo recién cuando hay SMTP
  // configurado, el build que apunta a Cloudflare nunca lo evalúa.
  const { createTransport } = await import("nodemailer");

  const transport = createTransport({
    host,
    port,
    // 465 es TLS implícito; 587 es STARTTLS, que es el que usa Gmail.
    secure: port === 465,
    auth: { user, pass },
    // Timeouts cortos, copiados del ecommerce: si el proveedor bloquea el
    // puerto de salida, es mejor fallar en diez segundos que dejar colgado el
    // pedido que disparó el mail.
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
    socketTimeout: 10_000,
  });

  transporte = { transport, user };
  return transporte;
}

/**
 * De quién sale el mail.
 *
 * ⚠️ **Con Gmail esto no es libre.** Su SMTP sólo deja mandar como la casilla
 * autenticada o como un alias que esa casilla tenga confirmado en «Enviar
 * como»; cualquier otra dirección la reescribe o la rechaza. Por eso el default
 * es `SMTP_USER` y no una dirección inventada: si `MAIL_FROM` apunta a un
 * dominio que Gmail no reconoce, los mails dejan de salir sin que el código se
 * entere.
 *
 * El día que `shiraf.com.ar` tenga su propio servidor de correo, esto se
 * resuelve poniendo las credenciales de allá en `SMTP_*` y `MAIL_FROM` con la
 * dirección del dominio.
 */
function remitente(user: string): string {
  // return process.env["MAIL_FROM"] ?? `Shiraf <${user}>`;
  return variable("MAIL_FROM") ?? `Shiraf <${user}>`;
}

/**
 * Manda un mail. Es la única función del proyecto que habla con un servidor de
 * correo.
 */
export async function enviarMail(mail: {
  to: string;
  subject: string;
  text: string;
  html: string;
}): Promise<Envio> {
  const correo = await obtenerTransporte();

  if (!correo) {
    return { ok: false, motivo: "El envío de mails todavía no está configurado." };
  }

  try {
    await correo.transport.sendMail({
      from: remitente(correo.user),
      to: mail.to,
      // La casilla que el centro mira de verdad. Cuando el remitente sea una
      // dirección de `shiraf.com.ar` que nadie lee, esto es lo que hace que la
      // respuesta de la clienta caiga donde hay alguien.
      // replyTo: process.env["MAIL_REPLY_TO"] ?? CONTACT.email,
      replyTo: variable("MAIL_REPLY_TO") ?? CONTACT.email,
      subject: mail.subject,
      text: mail.text,
      html: mail.html,
    });
    return { ok: true };
  } catch (error) {
    // El mensaje de nodemailer es bastante claro y conviene que llegue entero:
    // "Invalid login" es contraseña de aplicación mal puesta, "Connection
    // timeout" es el puerto 587 bloqueado en el servidor. Son diagnósticos
    // distintos y desde afuera se parecen.
    return { ok: false, motivo: error instanceof Error ? error.message : "Falló el envío." };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Los mails de cuenta: confirmar el mail y recuperar la contraseña
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Las dos plantillas están escritas en castellano en `emails/`, y durante
 * semanas no se pudieron usar: Supabase no dejaba editar las suyas sin SMTP
 * propio, así que a la clienta le llegaba un mail en inglés desde
 * `noreply@mail.app.supabase.io`.
 *
 * El único reemplazo que hacían era `{{ .ConfirmationURL }}`, que es sintaxis de
 * Go —de Supabase—. Se reemplaza igual, para no tener que tocar los 509
 * renglones de HTML.
 */
type Plantilla = "confirmar-cuenta" | "recuperar-contrasena";

const ASUNTOS: Record<Plantilla, string> = {
  "confirmar-cuenta": "Confirmá tu cuenta en Shiraf",
  "recuperar-contrasena": "Recuperá tu contraseña de Shiraf",
};

/**
 * Las plantillas se leen del disco en cada envío, no se hornean en el bundle.
 *
 * Son dos mails por semana en el peor de los casos, así que el costo de leer un
 * archivo es irrelevante, y a cambio se pueden corregir sin reconstruir la
 * imagen. La caché evita releerlas dentro de un mismo arranque.
 */
const cache = new Map<Plantilla, string>();

async function plantilla(nombre: Plantilla): Promise<string> {
  const guardada = cache.get(nombre);
  if (guardada) return guardada;
  const html = await readFile(join(process.cwd(), "emails", nombre + ".html"), "utf8");
  cache.set(nombre, html);
  return html;
}

export async function enviarMailDeCuenta(
  tipo: Plantilla,
  destinatario: string,
  enlace: string,
): Promise<Envio> {
  let html: string;
  try {
    html = (await plantilla(tipo)).replaceAll("{{ .ConfirmationURL }}", enlace);
  } catch {
    return { ok: false, motivo: "No se encontró la plantilla del mail." };
  }

  return enviarMail({
    to: destinatario,
    subject: ASUNTOS[tipo],
    html,
    // Alternativa en texto plano: el enlace y nada más. Algunos clientes de
    // correo la prefieren, y sin ella el mail puntúa peor como spam.
    text: "Entrá a este enlace: " + enlace,
  });
}
