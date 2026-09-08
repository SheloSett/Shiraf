import { prisma } from "@/server/db";
import { CONTACT } from "@/lib/contact";

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
 * El WhatsApp al centro NO pasa por acá: sigue yendo al número fijo de
 * `CONTACT.whatsappNumber`. Un número por persona sería otra columna y otra
 * decisión; nadie la pidió.
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
