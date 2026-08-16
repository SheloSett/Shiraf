/**
 * Entrega de imágenes por Cloudinary.
 *
 * Este archivo NO tiene secretos: se compila para el navegador. El cloud name
 * es público (viaja en cada URL de imagen). Lo que sí es secreto —la API key y
 * el api secret— vive sólo en cloudinary.functions.ts, del lado servidor.
 *
 * POR QUÉ CLOUDINARY Y NO SUPABASE STORAGE:
 *
 * Las fotos se muestran en tres tamaños muy distintos —48px en la tabla del
 * panel, ~400px en la tarjeta del catálogo y pantalla completa en la ficha— y
 * hasta acá las tres bajaban el MISMO archivo de 1600px. Para dibujar un
 * cuadradito de 48px se bajaban ~200 KB; con 20 tratamientos, 4 MB de miniaturas.
 *
 * Supabase Storage sabe transformar imágenes por URL, pero es una función de
 * plan Pro y el proyecto está en Free. Cloudinary lo hace en el plan gratuito,
 * y además negocia el formato (AVIF o WebP según el navegador) y recorta
 * detectando caras, que es lo que hace falta para los retratos de las
 * profesionales.
 */

/** Público por diseño: aparece en la URL de toda imagen servida. */
export const CLOUDINARY_CLOUD_NAME = import.meta.env["VITE_CLOUDINARY_CLOUD_NAME"] ?? "";

/** Carpeta dentro de Cloudinary, para no mezclar con otros proyectos de la cuenta. */
export const CLOUDINARY_FOLDER = "shiraf/servicios";

/**
 * Presets de entrega.
 *
 * `f_auto` y `q_auto` van en todos y son los que más pesan en el resultado:
 * el primero sirve AVIF o WebP según lo que soporte el navegador, el segundo
 * elige la compresión mirando el contenido de la imagen.
 *
 * `g_auto` recorta hacia donde está lo importante en vez del centro geométrico;
 * `g_face` va sólo en retratos, donde encuadrar la cara sí es lo correcto.
 */
export const IMAGE_PRESETS = {
  /** Miniatura de la tabla del panel. 96 y no 48: pantallas retina. */
  thumb: "f_auto,q_auto,w_96,h_96,c_fill,g_auto",
  /** Tarjeta del catálogo público. */
  card: "f_auto,q_auto,w_800,c_fill",
  /** Portada de la ficha, a pantalla completa. */
  hero: "f_auto,q_auto,w_1600",
  /** Retrato de profesional: cuadrado y encuadrando la cara. */
  portrait: "f_auto,q_auto,w_600,h_600,c_fill,g_face",
} as const;

export type ImagePreset = keyof typeof IMAGE_PRESETS;

/**
 * Devuelve la URL de la imagen en el tamaño pedido.
 *
 * Tolera que la URL no sea de Cloudinary y la devuelve intacta. Eso no es
 * defensivo porque sí: los tratamientos cargados antes de esta migración
 * apuntan a Supabase Storage, y tienen que seguir viéndose mientras no se
 * vuelvan a subir. Sin esto, el catálogo viejo quedaba con las fotos rotas.
 */
export function imageUrl(url: string | null | undefined, preset: ImagePreset): string | null {
  if (!url) return null;

  const marker = "/image/upload/";
  const at = url.indexOf(marker);
  if (at === -1) return url; // no es de Cloudinary: se sirve tal cual

  const before = url.slice(0, at + marker.length);
  const after = url.slice(at + marker.length);
  return `${before}${IMAGE_PRESETS[preset]}/${after}`;
}

/**
 * Extrae el public_id de una URL de Cloudinary, que es lo que pide la API para
 * borrar. Devuelve null si la URL no es de Cloudinary.
 *
 * De https://res.cloudinary.com/demo/image/upload/v1712345678/shiraf/servicios/abc.webp
 * saca "shiraf/servicios/abc": sin el prefijo de versión (`v` + dígitos) y sin
 * la extensión, que no forman parte del identificador.
 */
export function publicIdFromUrl(url: string | null | undefined): string | null {
  if (!url) return null;

  const marker = "/image/upload/";
  const at = url.indexOf(marker);
  if (at === -1) return null;

  let path = url.slice(at + marker.length);

  // Si quedó alguna transformación en la URL, descartarla: es el segmento
  // anterior a la versión y contiene comas o guiones bajos de parámetros.
  const segments = path.split("/");
  while (segments.length > 1 && /[,=]/.test(segments[0] ?? "")) {
    segments.shift();
  }
  // El prefijo de versión tampoco es parte del id.
  if (/^v\d+$/.test(segments[0] ?? "")) segments.shift();

  path = segments.join("/");
  return path.replace(/\.[^./]+$/, "") || null;
}
