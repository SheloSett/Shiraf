/**
 * Datos de contacto en un solo lugar.
 *
 * Estaban repetidos entre la página de contacto y el footer, y ya habían
 * divergido: el cuerpo mostraba "+54 9 11 5555-5555" y el footer
 * "+54 11 5555-5555".
 *
 * ⚠️ Son los de ejemplo que dejó el generador. Hay que reemplazarlos por los
 * reales antes de publicar — sobre todo `whatsappNumber`, que es el que recibe
 * las consultas del formulario.
 */
export const CONTACT = {
  /** Sólo dígitos con código de país, sin +, espacios ni guiones: lo exige wa.me. */
  whatsappNumber: "5491155555555",
  phoneDisplay: "+54 9 11 5555-5555",
  email: "hola@shiraf.com",
  instagram: "@shiraf.estetica",
  instagramUrl: "https://instagram.com/shiraf.estetica",
  address: "Av. Siempreviva 1234",
  city: "Buenos Aires",
  mapsUrl: "https://www.google.com/maps/search/?api=1&query=Av.+Siempreviva+1234+Buenos+Aires",
} as const;

export const OPENING_HOURS = [
  { days: "Lunes a viernes", hours: "9:00 — 20:00" },
  { days: "Sábados", hours: "9:00 — 15:00" },
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
