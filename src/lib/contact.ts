/**
 * Datos de contacto en un solo lugar.
 *
 * Estaban repetidos entre la página de contacto y el footer, y ya habían
 * divergido: el cuerpo mostraba "+54 9 11 5555-5555" y el footer
 * "+54 11 5555-5555".
 *
 * ⚠️ `email` e `instagram` siguen siendo los de ejemplo del generador; hay que
 * reemplazarlos antes de publicar.
 */
export const CONTACT = {
  /** Sólo dígitos con código de país, sin +, espacios ni guiones: lo exige wa.me. */
  whatsappNumber: "5491154189624",
  phoneDisplay: "+54 9 11 5418-9624",
  email: "hola@shiraf.com",
  instagram: "@shiraf.estetica",
  instagramUrl: "https://instagram.com/shiraf.estetica",
  address: "Vuelta de Obligado 2443, Oficina 302",
  city: "Buenos Aires",
  /** La búsqueda va sin la oficina: Google ubica la puerta de calle. */
  mapsUrl: "https://www.google.com/maps/search/?api=1&query=Vuelta+de+Obligado+2443+Buenos+Aires",
  /** Misma dirección, en la variante que Google permite incrustar sin API key. */
  mapsEmbedUrl: "https://www.google.com/maps?q=Vuelta+de+Obligado+2443+Buenos+Aires&output=embed",
} as const;

export const OPENING_HOURS = [
  { days: "Lunes a viernes", hours: "9:00 — 18:00" },
  { days: "Sábados", hours: "Cerrado" },
  { days: "Domingos", hours: "Cerrado" },
] as const;

/** Arma el enlace de WhatsApp con el mensaje ya redactado. */
export function buildWhatsappUrl(parts: {
  name?: string;
  treatment?: string;
  message?: string;
}): string {
  const lines = [
    parts.name ? `Hola Shiraf, soy ${parts.name.trim()}.` : "Hola Shiraf.",
    parts.treatment ? `Me interesa: ${parts.treatment}.` : null,
    parts.message?.trim() || null,
  ].filter((line): line is string => Boolean(line));

  return `https://wa.me/${CONTACT.whatsappNumber}?text=${encodeURIComponent(lines.join("\n"))}`;
}
