import { randomBytes } from "node:crypto";
import { prisma } from "@/server/db";
import { CONTACT } from "@/lib/contact";
import { toWhatsappNumber } from "@/lib/notifications";

/**
 * Quien reserva sin cuenta: su teléfono, su enlace y sus turnos (5/10/2026).
 *
 * Una invitada no tiene `users` ni `profiles`. Lo único que la identifica es el
 * teléfono que dejó, y todo este archivo gira alrededor de eso. El porqué del
 * enlace —y de que no alcance con tipear el número— está en `guest_links`, en
 * el esquema.
 */

/**
 * Cuántos turnos por venir puede tener abiertos un mismo teléfono.
 *
 * Es el freno a que alguien llene la agenda de turnos falsos: sin cuenta no hay
 * mail confirmado ni nada que cueste crear, así que el tope va sobre lo único
 * que hay. Tres alcanza para la clienta real —un tratamiento, otro, y la
 * sesión que sigue de un tercero— y deja a quien quiera hacer daño con muy
 * poco para hacer. Quien necesite más los saca con el centro.
 */
export const MAX_TURNOS_ABIERTOS_POR_TELEFONO = 3;

/**
 * La clave de un teléfono: área más número, diez dígitos — "1133852327".
 *
 * Sale de `toWhatsappNumber()` y no de `normalizarTelefono()` a propósito. Las
 * dos se quedan con los últimos diez dígitos, pero sólo la primera entiende el
 * "15 3385 2327" pelado —que es como dicta su celular la gente de Buenos Aires—
 * y lo lleva a "11 3385 2327". Con la otra, la misma persona escribiendo su
 * número de las dos formas tendría dos enlaces y medio historial en cada uno.
 *
 * Null cuando el número no da para un celular argentino: sin eso no hay a
 * dónde mandarle el WhatsApp, que es justo por donde le llega el enlace.
 */
export function claveDeTelefono(crudo: string | null | undefined): string | null {
  const numero = toWhatsappNumber(crudo);
  if (!numero) return null;
  const clave = numero.slice(-10);
  return clave.length === 10 ? clave : null;
}

/**
 * Los turnos de invitada anotados con ese teléfono.
 *
 * Se traen los candidatos y se filtra acá porque el criterio es sobre el número
 * normalizado, no sobre la columna: "11 3385-2327", "1533852327" y
 * "+54 9 11 3385 2327" son la misma persona. Es el mismo camino que
 * `vincularTurnosDeInvitada`, y por lo mismo: son los turnos sin cuenta de un
 * centro de estética, no una tabla que haya que paginar.
 *
 * `soloAbiertos` deja los confirmados por venir, que es lo que cuenta el tope
 * de arriba.
 */
export async function turnosDelTelefono(
  clave: string,
  opciones: { soloAbiertos?: boolean } = {},
): Promise<string[]> {
  const candidatos = await prisma.appointments.findMany({
    where: {
      client_id: null,
      guest_phone: { not: null },
      ...(opciones.soloAbiertos ? { status: "confirmed", starts_at: { gt: new Date() } } : {}),
    },
    select: { id: true, guest_phone: true },
  });

  return candidatos.filter((t) => claveDeTelefono(t.guest_phone) === clave).map((t) => t.id);
}

/** De dónde cuelgan los enlaces: la misma variable con la que se arman los de los mails. */
export function urlDelSitio(): string {
  return (process.env["APP_URL"] ?? CONTACT.siteUrl).replace(/\/+$/, "");
}

/**
 * El enlace personal de ese teléfono, creándolo si todavía no tiene.
 *
 * ⚠️ **Lo que devuelve esto sólo puede viajar adentro de un mensaje mandado A
 * ESE TELÉFONO.** Nunca en la respuesta de un endpoint: quien reserva
 * escribiendo el número de otra persona recibiría la llave de su historial.
 *
 * Null si el teléfono no sirve — no hay a quién dárselo.
 */
export async function enlaceDeInvitada(
  telefono: string | null | undefined,
): Promise<string | null> {
  const clave = claveDeTelefono(telefono);
  if (!clave) return null;

  // `upsert` y no "buscar y si no crear": dos avisos del mismo turno salen casi
  // juntos —el mail y el WhatsApp— y los dos pasan por acá.
  const { token } = await prisma.guest_links.upsert({
    where: { phone: clave },
    create: { phone: clave, token: randomBytes(18).toString("base64url") },
    update: {},
    select: { token: true },
  });

  return `${urlDelSitio()}/mis-turnos/${token}`;
}

/** De qué teléfono es ese enlace, o null si no existe. */
export async function telefonoDelEnlace(token: string): Promise<string | null> {
  if (!token) return null;
  const enlace = await prisma.guest_links.findUnique({
    where: { token },
    select: { phone: true },
  });
  return enlace?.phone ?? null;
}
