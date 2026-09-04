import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireAuth } from "@/lib/serverfn-auth";
import { CLAVES_DE_PAGINA, type ContenidoDelSitio, type ContenidoDePagina } from "@/lib/contenido";
// Sólo el tipo: `import type` desaparece al compilar, así que esto NO mete a
// Prisma en el bundle del navegador. El cliente de verdad se importa adentro
// del handler, como en el resto de las server functions.
import type { Prisma } from "@prisma/client";

/**
 * Leer y guardar el contenido del sitio.
 *
 * ── POR QUÉ SERVER FUNCTIONS Y NO UNA RUTA `/api/contenido` ───────────────
 *
 * Por el SSR, que es el motivo entero. Todo lo demás del sitio público —el
 * catálogo, el equipo— se pide con `useQuery` desde el navegador, y eso está
 * bien para una lista que se dibuja abajo del hero. Pero **el título de la
 * portada no puede llegar después**:
 *
 *   · Google indexa el HTML que sale del servidor. Con `useQuery`, ese HTML
 *     llevaría los textos por defecto y el texto verdadero aparecería recién
 *     con el JavaScript. Justo ahora que el sitemap sale de la base, sería
 *     dispararse en el pie.
 *   · Y para quien mira, el titular cambiaría de golpe medio segundo después de
 *     cargar. Eso no es un detalle: es la primera línea de la página.
 *
 * Una server function llamada desde el `loader` de la ruta raíz corre **en el
 * servidor, antes de renderizar**, así que el contenido ya está en el HTML.
 *
 * ── EL IMPORT DE PRISMA VA ADENTRO DEL HANDLER ────────────────────────────
 *
 * Igual que en `team.functions.ts` y por lo mismo: este archivo es alcanzable
 * desde el navegador (lo importa el sitio público) y TanStack prohíbe que el
 * bundle del cliente importe nada que cuelgue de `src/server/`. Adentro del
 * handler no hay problema, porque ese código sólo existe del lado servidor.
 */

/**
 * Todo el contenido guardado, en un solo viaje.
 *
 * Devuelve el mapa entero —las seis páginas— y no la que pide quien llama,
 * porque quien llama es el `loader` de la raíz y **el pie de página se dibuja
 * en todas**. Pedir "inicio" y después "datos" y después "footer" serían tres
 * viajes para traer, entre las tres, menos de lo que pesa una foto.
 *
 * ⚠️ Devuelve lo GUARDADO, sin mezclar con los defaults. El merge lo hace
 * `conDefaults()` del lado de la pantalla, que es donde vive el esquema. Así el
 * servidor no tiene que saber qué campos existen: sólo guarda y devuelve.
 *
 * Es público a propósito: es el texto del sitio, que cualquiera puede leer
 * simplemente entrando.
 */
export const obtenerContenido = createServerFn({ method: "GET" }).handler(
  async (): Promise<ContenidoDelSitio> => {
    const { prisma } = await import("@/server/db");

    // ⚠️ Si esto tira, se cae el sitio ENTERO: lo llama el loader de la raíz,
    // que corre en todas las páginas. Un problema con la base dejaría a quien
    // entra en la pantalla de error en vez de mostrarle el sitio con los textos
    // originales, que es una degradación perfectamente aceptable para un CMS de
    // textos. Por eso este es de los pocos catch que se tragan el error: queda
    // en el log del servidor y la página se dibuja igual.
    let filas: { page: string; content: unknown }[] = [];
    try {
      filas = await prisma.page_content.findMany({
        select: { page: true, content: true },
      });
    } catch (error) {
      console.error("[contenido] No se pudo leer el contenido del sitio:", error);
      return {};
    }

    const mapa: ContenidoDelSitio = {};
    for (const fila of filas) {
      // Una fila con un `content` que no sea un objeto —alguien tocó la base a
      // mano, o quedó de una versión vieja— se ignora en vez de tumbar el
      // render de TODAS las páginas: sin esto, un JSON raro en una fila deja el
      // sitio entero en blanco, que es lo peor que puede hacer un CMS.
      if (fila.content && typeof fila.content === "object" && !Array.isArray(fila.content)) {
        mapa[fila.page] = fila.content as ContenidoDelSitio[string];
      }
    }
    return mapa;
  },
);

/**
 * El cuerpo que acepta `guardarContenido`.
 *
 * Un campo es texto o es una lista de ítems de texto. No hay un tercer caso, y
 * declararlo así evita que por la puerta del JSON entre cualquier cosa: sin
 * esto, `content` es un `Json` de Postgres y aceptaría un objeto anidado de
 * cinco niveles que después ninguna pantalla sabe dibujar.
 */
const GuardarInput = z.object({
  pagina: z.string(),
  contenido: z.record(z.union([z.string(), z.array(z.record(z.string()))])),
});

/**
 * Guarda el contenido de UNA página. **Sólo la dueña.**
 *
 * ── POR QUÉ ADMIN Y NO UN PERMISO TILDABLE ────────────────────────────────
 *
 * Porque esto cambia lo que ve el público. Los siete permisos reparten trabajo
 * adentro del centro —la agenda, el stock, el catálogo—; esto es la cara del
 * negocio, y de la misma familia que repartir accesos: no se delega con una
 * casilla. Si algún día hace falta delegarlo, se agrega un permiso `content` al
 * enum de la base y se cambia esta línea, que es el único lugar que decide.
 *
 * El chequeo lee la base en cada llamada (`accesoDe`) y no el rol del token,
 * por el motivo de siempre: el token dura siete días y una decisión tiene que
 * valer en el acto.
 *
 * ── SE MERGEA CONTRA LO QUE HAY, NO SE PISA ───────────────────────────────
 *
 * Si dos pestañas del panel están abiertas en la misma página, la que guarda
 * segunda no borra los campos que la primera cambió y ella no tocó. Es barato y
 * evita la pérdida silenciosa de un texto que alguien ya había escrito.
 */
export const guardarContenido = createServerFn({ method: "POST" })
  .middleware([requireAuth])
  .validator((data: unknown) => GuardarInput.parse(data))
  .handler(async ({ data, context }) => {
    const { prisma } = await import("@/server/db");
    const { accesoDe, exigirAdmin } = await import("@/server/services/authz.service");

    exigirAdmin(await accesoDe(context.userId));

    // La página tiene que ser una de las que declara el esquema. Sin esto,
    // `page` es un texto libre y la tabla se llena de filas fantasma que nada
    // lee — y como `page` es único, una sola llamada equivocada se queda con
    // ese nombre para siempre.
    if (!CLAVES_DE_PAGINA.includes(data.pagina)) {
      throw new Error("Esa página del sitio no existe.");
    }

    const actual = await prisma.page_content.findUnique({
      where: { page: data.pagina },
      select: { content: true },
    });

    const previo: ContenidoDePagina =
      actual?.content && typeof actual.content === "object" && !Array.isArray(actual.content)
        ? (actual.content as ContenidoDePagina)
        : {};

    // El `as` es sólo para Prisma: `content` es una columna Json y su tipo de
    // entrada (`InputJsonValue`) es una unión recursiva que TypeScript no logra
    // emparejar con un objeto concreto, aunque la forma sea exactamente válida.
    // Lo que garantiza que acá adentro no entre cualquier cosa es el zod de
    // arriba, no este cast.
    const fusionado = { ...previo, ...data.contenido } as Prisma.InputJsonObject;

    await prisma.page_content.upsert({
      where: { page: data.pagina },
      update: { content: fusionado },
      create: { page: data.pagina, content: fusionado },
    });

    return { ok: true as const };
  });
