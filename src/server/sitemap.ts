import { prisma } from "@/server/db";
import { CONTACT } from "@/lib/contact";

/**
 * El mapa del sitio para los buscadores: GET /sitemap.xml
 *
 * ── POR QUÉ NO ES UN ARCHIVO EN public/ ───────────────────────────────────
 *
 * Porque la mitad de las URLs no existen hasta que alguien las carga. Los
 * tratamientos viven en la base y su dirección sale del slug
 * —/servicios/drenaje-linfatico—, así que un XML escrito a mano quedaría viejo
 * el día que la dueña publique el séptimo tratamiento, sin que nada avise. Y
 * peor: el slug SE REGENERA cuando cambia el nombre (ver schema.prisma), o sea
 * que un archivo estático empezaría a listar direcciones que ya no existen.
 *
 * Generándolo acá, el mapa siempre dice lo que hay.
 *
 * ── EL FILTRO ES EL MISMO QUE EL DEL CATÁLOGO PÚBLICO ─────────────────────
 *
 * 🔴 `is_published: true` no es una comodidad. Sin ese filtro, este endpoint le
 * entregaría a Google la lista de tratamientos que la dueña todavía está
 * armando, con los precios que no decidió — y Google los indexaría. Es la misma
 * regla que vive en publico.controller.ts y por el mismo motivo.
 *
 * Las páginas que piden sesión —/admin, /mi-cuenta, /reservar— no van, igual
 * que en robots.txt. Un bot sin cookie sólo se come un redirect.
 */

/**
 * Las que no dependen de la base. `changefreq` y `priority` son sugerencias que
 * Google mira poco, pero cuestan una línea y Bing sí las usa.
 */
const PAGINAS_FIJAS = [
  { ruta: "/", priority: "1.0", changefreq: "weekly" },
  { ruta: "/servicios", priority: "0.9", changefreq: "weekly" },
  { ruta: "/profesionales", priority: "0.8", changefreq: "monthly" },
  { ruta: "/contacto", priority: "0.7", changefreq: "monthly" },
] as const;

/**
 * Escapa lo que va adentro de un <loc>.
 *
 * Los slugs los genera el servidor a partir del nombre, así que hoy no traen
 * ninguno de estos caracteres. Va igual: el día que alguien cargue un
 * tratamiento con un `&` en el nombre, un XML mal formado hace que Google
 * descarte el sitemap ENTERO, no esa sola línea.
 */
function escaparXml(valor: string): string {
  return valor
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function url(ruta: string, lastmod: string, changefreq: string, priority: string): string {
  return [
    "  <url>",
    `    <loc>${escaparXml(CONTACT.siteUrl + ruta)}</loc>`,
    `    <lastmod>${lastmod}</lastmod>`,
    `    <changefreq>${changefreq}</changefreq>`,
    `    <priority>${priority}</priority>`,
    "  </url>",
  ].join("\n");
}

export async function sitemap(): Promise<Response> {
  const servicios = await prisma.services.findMany({
    where: {
      is_published: true,
      // Sin slug no hay URL legible que publicar. La ficha igual abre con el
      // UUID, pero eso no es una dirección para darle a un buscador.
      slug: { not: null },
    },
    select: { slug: true, updated_at: true },
    orderBy: { name: "asc" },
  });

  const hoy = new Date().toISOString().slice(0, 10);

  const entradas = [
    ...PAGINAS_FIJAS.map((p) => url(p.ruta, hoy, p.changefreq, p.priority)),
    ...servicios.map((s) =>
      url(`/servicios/${s.slug}`, s.updated_at.toISOString().slice(0, 10), "monthly", "0.8"),
    ),
  ];

  const xml = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    ...entradas,
    "</urlset>",
  ].join("\n");

  return new Response(xml, {
    headers: {
      "content-type": "application/xml; charset=utf-8",
      // Una hora. Google lo pide como mucho una vez por día, así que el cache
      // no es por carga: es para que un bot mal educado no le haga una consulta
      // a la base por cada visita.
      "cache-control": "public, max-age=3600",
    },
  });
}
