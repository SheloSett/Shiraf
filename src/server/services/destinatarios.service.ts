import { prisma } from "@/server/db";
import { CONTACT } from "@/lib/contact";
import { toWhatsappNumber } from "@/lib/notifications";

/**
 * A quién le llegan los avisos del centro.
 *
 * ── QUÉ HABÍA ANTES ───────────────────────────────────────────────────────
 *
 * Una sola dirección, fija: `CONTACT.email`, el Gmail del centro. Cuando una
 * clienta reservaba, cancelaba o se movía el turno, el mail iba ahí y a nadie
 * más. La dueña le dio acceso a su secretaria (8/9/2026) y pidió que a ella y
 * a las dueñas les llegue el aviso: si nadie mira ese Gmail, nadie se entera.
 *
 * ── LA REGLA ──────────────────────────────────────────────────────────────
 *
 *   · Las dueñas (rol admin) reciben SIEMPRE. No hay casilla que destildar,
 *     por el mismo criterio que el resto del sistema de permisos: la dueña
 *     está por encima, no adentro.
 *   · Las empleadas, sólo con `users.receives_center_mail` tildado desde
 *     Accesos.
 *   · Las cuentas dadas de baja no reciben nada, tengan lo que tengan.
 *   · El Gmail del centro sigue recibiendo copia. Es lo que había, y sacarlo
 *     sin que nadie lo pida sería perder un canal que hoy funciona. Si algún
 *     día molesta, es borrar una línea acá.
 *
 * Se devuelve sin repetidos y en minúsculas: si el Gmail del centro es además
 * la cuenta de una dueña, le llega una vez.
 *
 * ── QUIÉN LO LLAMA ────────────────────────────────────────────────────────
 *
 * `deliverAppointmentEmail` para los tres eventos que van al centro y
 * `deliverOverdueDigest` para el resumen diario. Los dos viven en
 * notifications.server.ts y lo importan dinámico, como a prisma, para que no
 * viaje al bundle del navegador.
 *
 * ~~El WhatsApp al centro NO pasa por acá: sigue yendo al número fijo de
 * `CONTACT.whatsappNumber`. Un número por persona sería otra columna y otra
 * decisión; nadie la pidió.~~ → Lo pidió la dueña el 16/9/2026: ver
 * `telefonosDelCentro`, abajo. La columna ya existía —`profiles.phone`, que
 * desde el 9/9 se carga al dar el alta en Accesos— así que fue sólo la
 * decisión.
 */
export async function mailsDelCentro(): Promise<string[]> {
  const cuentas = await prisma.users.findMany({
    where: {
      is_active: true,
      OR: [{ roles: { some: { role: "admin" } } }, { receives_center_mail: true }],
    },
    select: { email: true },
  });

  const direcciones = new Set<string>();
  for (const c of cuentas) direcciones.add(c.email.trim().toLowerCase());
  direcciones.add(CONTACT.email.trim().toLowerCase());

  return [...direcciones];
}

/**
 * A qué WhatsApp les llegan los avisos del centro (16/9/2026).
 *
 * La misma regla que `mailsDelCentro`, teléfono en vez de casilla: las dueñas
 * siempre, las empleadas con la casilla de Accesos tildada, nadie dado de baja.
 * Y el número del centro sigue recibiendo copia, como el Gmail. La casilla se
 * llama "recibe los mails del centro" y ahora vale para los dos canales: es
 * una sola decisión —"a esta persona le llegan los avisos internos"— y tener
 * dos tildes sería preguntar dos veces lo mismo.
 *
 * Devuelve los números YA normalizados por `toWhatsappNumber` y sin repetidos,
 * porque la repetición se ve recién después de normalizar: "11 5418 9624" y
 * "5491154189624" son el mismo teléfono. Quien no tiene teléfono cargado, o lo
 * tiene mal, queda afuera en silencio: es el mismo trato que una clienta sin
 * teléfono, y el aviso le llega igual por mail.
 *
 * `numeroDelCentro` viene de quien llama porque el del panel se lee en
 * notifications.server.ts (`datosDelCentroSeguro`), y traerlo de nuevo acá
 * sería una segunda lectura por aviso.
 */
export async function telefonosDelCentro(numeroDelCentro: string | null | undefined) {
  const cuentas = await prisma.users.findMany({
    where: {
      is_active: true,
      OR: [{ roles: { some: { role: "admin" } } }, { receives_center_mail: true }],
    },
    select: { profile: { select: { phone: true } } },
  });

  const numeros = new Set<string>();
  const centro = toWhatsappNumber(numeroDelCentro ?? CONTACT.whatsappNumber);
  if (centro) numeros.add(centro);
  for (const c of cuentas) {
    const numero = toWhatsappNumber(c.profile?.phone);
    if (numero) numeros.add(numero);
  }

  return [...numeros];
}
