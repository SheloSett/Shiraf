import { CONTACT } from "@/lib/contact";
import { conDefaults, lista, texto, type ContenidoDelSitio } from "@/lib/contenido";

/**
 * Lo que le decimos a Google sobre el sitio, aparte de los textos de la página.
 *
 * ── QUÉ PROBLEMA RESUELVE ─────────────────────────────────────────────────
 *
 * Buscar "shiraf.com.ar" el 4/9/2026 devolvía el sitio primero, y arriba una
 * ficha de la IA de Google que decía —textual— que el dominio "parece referirse
 * a Distribuidora Sharif, una casa de juguetes de San Cristóbal". Google tenía
 * las páginas indexadas y **no sabía de quién eran**: nada en el HTML decía que
 * esto es un centro de estética, dónde queda ni cómo se llama la marca. Sin ese
 * dato lo adivina, y adivinó mal.
 *
 * Los datos estructurados son la forma de decírselo sin depender de que
 * interprete bien un párrafo: un JSON en el `<head>`, con un vocabulario que
 * define schema.org y que todos los buscadores leen igual.
 *
 * ── DE DÓNDE SALEN LOS DATOS ──────────────────────────────────────────────
 *
 * 🔴 Del contenido editable —«Datos del centro» del panel—, NO de las
 * constantes de `contact.ts`. Los dos existen y no dicen lo mismo: `contact.ts`
 * tiene la dirección con calle y número, y lo que la dueña publicó es "BARRIO
 * BELGRANO". Fue una decisión suya, así que es la que vale; poner la calle acá
 * sería filtrar por el `<head>` lo que ella sacó de la pantalla.
 *
 * `conDefaults` se encarga de que un campo que nunca se editó caiga igual en el
 * valor de `contact.ts`, así que esto nunca queda vacío.
 */

/** El nombre de la marca, tal cual queremos que Google lo entienda. */
export const NOMBRE = "Shiraf";

/**
 * La descripción del negocio para los buscadores. Es la misma que el `<head>`
 * del root, a propósito: dos textos distintos describiendo lo mismo es una
 * contradicción que Google termina resolviendo por su cuenta.
 */
export const DESCRIPCION =
  "Centro de estética en Buenos Aires: tratamientos faciales, corporales y aparatología. Reservá tu turno online.";

/** La dirección absoluta de una ruta del sitio. */
export function urlDe(ruta: string): string {
  return ruta === "/" ? `${CONTACT.siteUrl}/` : `${CONTACT.siteUrl}${ruta}`;
}

/**
 * Envuelve un objeto como `<script type="application/ld+json">`.
 *
 * ⚠️ El `replace` no es decorativo. TanStack inserta este contenido con
 * `dangerouslySetInnerHTML`, así que un `<` sin escapar —alcanza con que
 * alguien escriba "<3" en un texto del panel— cerraría la etiqueta antes de
 * tiempo y rompería el HTML de la página entera. `\u003c` es JSON válido y
 * significa lo mismo.
 */
export function comoScriptLd(objeto: unknown): { type: string; children: string } {
  return {
    type: "application/ld+json",
    children: JSON.stringify(objeto).replace(/</g, "\\u003c"),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Los horarios, de texto libre a lo que entiende schema.org
// ─────────────────────────────────────────────────────────────────────────────
//
// Los horarios se editan como dos textos sueltos por renglón —"Lunes a viernes"
// y "9:00 — 18:00"—, porque así se leen en la pantalla. schema.org los quiere
// como días en inglés y horas en 24h.
//
// 🔴 La regla de todo lo que sigue: **si no se entiende, no se publica**. Un
// horario mal traducido le dice a Google que el centro abre cuando está
// cerrado, y eso es peor que no decirle nada: quien lo lea en la ficha del
// buscador va a llegar a una puerta cerrada.

/**
 * Los días, en orden y emparejados.
 *
 * Van en una sola tabla y no en dos listas paralelas: dos listas se
 * desincronizan en cuanto alguien agrega algo en el medio de una sola, y el
 * error resultante —el martes traducido como miércoles— no lo ve nadie hasta
 * que Google publica el horario equivocado.
 */
const DIAS = [
  { es: "lunes", en: "Monday" },
  { es: "martes", en: "Tuesday" },
  { es: "miercoles", en: "Wednesday" },
  { es: "jueves", en: "Thursday" },
  { es: "viernes", en: "Friday" },
  { es: "sabado", en: "Saturday" },
  { es: "domingo", en: "Sunday" },
] as const;

/** "Miércoles" → "miercoles". Los días se escriben con acento y con mayúscula. */
function sinAcentos(valor: string): string {
  return valor
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

/**
 * "Lunes a viernes" → los cinco días. "Sábados y domingos" → esos dos.
 *
 * Busca los días nombrados en el orden en que aparecen en el texto. Dos días
 * con un "a" en el medio son un rango; cualquier otra cosa son los días
 * mencionados y nada más. Un rango al revés —"viernes a lunes"— devuelve null
 * en vez de inventar: no sabemos si quiso decir el fin de semana o se equivocó.
 *
 * El `indexOf` alcanza para los plurales, que es como están escritos por
 * default: "sabados" contiene "sabado".
 */
function diasDe(valor: string): string[] | null {
  const limpio = sinAcentos(valor);

  const nombrados = DIAS.map((dia, indice) => ({
    indice,
    en: dia.en,
    posicion: limpio.indexOf(dia.es),
  }))
    .filter((d) => d.posicion >= 0)
    .sort((a, b) => a.posicion - b.posicion);

  const primero = nombrados[0];
  const ultimo = nombrados[nombrados.length - 1];
  if (!primero || !ultimo) return null;

  const esRango = nombrados.length === 2 && /\sa\s/.test(limpio);
  if (esRango) {
    if (primero.indice > ultimo.indice) return null;
    return DIAS.slice(primero.indice, ultimo.indice + 1).map((d) => d.en);
  }

  return nombrados.map((d) => d.en);
}

/**
 * "9:00 — 18:00" → { abre: "09:00", cierra: "18:00" }.
 *
 * "Cerrado" devuelve null y ese renglón no se publica, que es exactamente lo
 * que schema.org espera: los días cerrados se omiten, no se declaran.
 */
function horasDe(valor: string): { abre: string; cierra: string } | null {
  if (/cerrad/i.test(valor)) return null;

  const encontradas = [...valor.matchAll(/(\d{1,2})(?::(\d{2}))?/g)];
  const desde = encontradas[0];
  const hasta = encontradas[1];
  if (!desde || !hasta) return null;

  const aHora = (m: RegExpMatchArray): string | null => {
    const hora = Number(m[1]);
    const minutos = Number(m[2] ?? "0");
    if (hora > 23 || minutos > 59) return null;
    return `${String(hora).padStart(2, "0")}:${String(minutos).padStart(2, "0")}`;
  };

  const abre = aHora(desde);
  const cierra = aHora(hasta);
  if (!abre || !cierra) return null;

  return { abre, cierra };
}

function horariosLd(renglones: Record<string, string>[]) {
  return renglones.flatMap((renglon) => {
    const dias = diasDe(renglon["dias"] ?? "");
    const horas = horasDe(renglon["horas"] ?? "");
    if (!dias || !horas) return [];

    return [
      {
        "@type": "OpeningHoursSpecification",
        dayOfWeek: dias,
        opens: horas.abre,
        closes: horas.cierra,
      },
    ];
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Las fichas
// ─────────────────────────────────────────────────────────────────────────────

/** El identificador del negocio. Fijo, para que otras fichas puedan apuntarle. */
export const ID_DEL_NEGOCIO = `${CONTACT.siteUrl}/#negocio`;

/**
 * La ficha del centro: qué es, cómo se llama, dónde queda y cuándo abre.
 *
 * `BeautySalon` y no `LocalBusiness` a secas porque es un tipo que schema.org
 * ya define, y le dice a Google el rubro en una palabra en vez de hacérselo
 * deducir de los tratamientos.
 *
 * `sameAs` son las redes: es lo que conecta este dominio con la cuenta de
 * Instagram que ya tiene seguidores y publicaciones. Para una marca nueva es de
 * lo poco que Google puede usar para confirmar que existe de verdad.
 */
export function negocioLd(guardado: ContenidoDelSitio | undefined) {
  const datos = conDefaults("datos", guardado?.["datos"]);

  const direccion = texto(datos, "direccion");
  const ciudad = texto(datos, "ciudad");
  const telefono = texto(datos, "telefonoVisible");
  const email = texto(datos, "email");
  const mapa = texto(datos, "mapsUrl");
  const redes = [texto(datos, "instagramUrl"), texto(datos, "tiktokUrl")].filter(Boolean);
  const horarios = horariosLd(lista(datos, "horarios"));

  return {
    "@type": "BeautySalon",
    "@id": ID_DEL_NEGOCIO,
    name: NOMBRE,
    description: DESCRIPCION,
    url: urlDe("/"),
    image: `${CONTACT.siteUrl}/logo_shiraf.jpeg`,
    logo: `${CONTACT.siteUrl}/logo_shiraf.jpeg`,
    ...(telefono ? { telephone: telefono } : {}),
    ...(email ? { email } : {}),
    address: {
      "@type": "PostalAddress",
      ...(direccion ? { streetAddress: direccion } : {}),
      ...(ciudad ? { addressLocality: ciudad } : {}),
      addressCountry: "AR",
    },
    ...(ciudad ? { areaServed: ciudad } : {}),
    ...(mapa ? { hasMap: mapa } : {}),
    ...(redes.length ? { sameAs: redes } : {}),
    ...(horarios.length ? { openingHoursSpecification: horarios } : {}),
  };
}

/**
 * La ficha del sitio.
 *
 * Existe por una razón puntual: que la palabra "Shiraf" quede declarada como el
 * NOMBRE de este sitio. Buscando "shiraf" a secas, compite con una marca
 * japonesa de agua mineral y con un token de criptomonedas, y la única forma de
 * que Google entienda que acá hay otra marca con ese nombre es decírselo.
 */
export function sitioLd() {
  return {
    "@type": "WebSite",
    "@id": `${CONTACT.siteUrl}/#sitio`,
    name: NOMBRE,
    url: urlDe("/"),
    inLanguage: "es-AR",
    publisher: { "@id": ID_DEL_NEGOCIO },
  };
}

/**
 * Las dos fichas, en un solo `<script>`.
 *
 * `@graph` es la forma que define schema.org para varias fichas juntas, y la
 * que permite que la del sitio apunte a la del negocio por `@id` en vez de
 * repetir adentro la dirección y los horarios.
 */
export function fichaDelSitio(guardado: ContenidoDelSitio | undefined) {
  return comoScriptLd({
    "@context": "https://schema.org",
    "@graph": [negocioLd(guardado), sitioLd()],
  });
}

/**
 * La ficha de un tratamiento.
 *
 * Va sin precio a propósito. schema.org permite declararlo con `offers` y
 * Google lo muestra, pero un precio en los resultados del buscador es un precio
 * que la dueña no controla cuándo se actualiza: cambiarlo en el panel es
 * inmediato, que Google lo relea no. Un precio viejo en Google es una discusión
 * en el mostrador.
 */
export function tratamientoLd(datos: { nombre: string; descripcion: string; ruta: string }) {
  return comoScriptLd({
    "@context": "https://schema.org",
    "@type": "Service",
    name: datos.nombre,
    ...(datos.descripcion ? { description: datos.descripcion } : {}),
    url: urlDe(datos.ruta),
    serviceType: datos.nombre,
    provider: { "@id": ID_DEL_NEGOCIO },
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Textos del <head>
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Una descripción larga, recortada para el `<meta description>`.
 *
 * Google corta alrededor de los 160 caracteres. Cortar nosotros en el espacio
 * anterior evita que el corte caiga en la mitad de una palabra, que es la
 * diferencia entre "…drenaje linf" y "…drenaje".
 */
export function recortar(valor: string, largo = 155): string {
  const plano = valor.replace(/\s+/g, " ").trim();
  if (plano.length <= largo) return plano;

  const cortado = plano.slice(0, largo);
  const ultimoEspacio = cortado.lastIndexOf(" ");
  return `${(ultimoEspacio > 40 ? cortado.slice(0, ultimoEspacio) : cortado).trimEnd()}…`;
}
