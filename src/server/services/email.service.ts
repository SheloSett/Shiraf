import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { CONTACT } from "@/lib/contact";

/**
 * Los mails de cuenta: confirmar el mail y recuperar la contraseña.
 *
 * ── ESTO DESTRABA UN BLOQUEO VIEJO ────────────────────────────────────────
 *
 * Las dos plantillas están escritas en castellano desde hace semanas, en
 * `emails/`, y no se podían usar: Supabase no deja editar sus
 * plantillas hasta que no configures SMTP propio, así que a la clienta le
 * llegaba un mail en inglés desde `noreply@mail.app.supabase.io`. Estaba
 * anotado en el TODO como pendiente.
 *
 * Ahora las manda la app por Resend y el bloqueo desaparece: son archivos
 * nuestros, en el repo, y se editan como cualquier otro.
 *
 * El único reemplazo que hacían las plantillas era `{{ .ConfirmationURL }}`,
 * que es sintaxis de Go —de Supabase—. Acá se reemplaza igual, para no tener
 * que tocar los 509 renglones de HTML.
 *
 * ── SI NO HAY RESEND CONFIGURADO, NO SE ROMPE NADA ────────────────────────
 *
 * Es la misma decisión que ya está tomada en notifications.functions.ts, y por
 * el mismo motivo: se tiene que poder trabajar sin el correo resuelto. Lo que
 * cambia acá es que estos mails SÍ son imprescindibles para entrar —sin el de
 * recuperar contraseña, quien la olvida queda afuera— así que cuando no se
 * puede mandar, se avisa a quien llamó en vez de tragárselo.
 */

export type Envio = { ok: true } | { ok: false; motivo: string };

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
  const apiKey = process.env["RESEND_API_KEY"];
  const from = process.env["MAIL_FROM"];

  if (!apiKey || !from) {
    return { ok: false, motivo: "El envío de mails todavía no está configurado." };
  }

  let html: string;
  try {
    html = (await plantilla(tipo)).replaceAll("{{ .ConfirmationURL }}", enlace);
  } catch {
    return { ok: false, motivo: "No se encontró la plantilla del mail." };
  }

  const respuesta = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: "Bearer " + apiKey, "Content-Type": "application/json" },
    body: JSON.stringify({
      from,
      to: [destinatario],
      reply_to: process.env["MAIL_REPLY_TO"] ?? CONTACT.email,
      subject: ASUNTOS[tipo],
      html,
      // Alternativa en texto plano: el enlace y nada más. Algunos clientes de
      // correo la prefieren, y sin ella el mail puntúa peor como spam.
      text: "Entrá a este enlace: " + enlace,
    }),
  });

  if (!respuesta.ok) {
    const detalle = await respuesta.text().catch(() => "");
    return { ok: false, motivo: ("Resend respondió " + respuesta.status + ". " + detalle).trim() };
  }

  return { ok: true };
}
