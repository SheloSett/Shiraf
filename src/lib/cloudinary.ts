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
 * Presets de video.
 *
 * `f_auto` acá elige el contenedor (mp4 o webm) según el navegador, igual que
 * con las imágenes elige AVIF o WebP. `q_auto` mira el contenido para decidir
 * la compresión, que en video es lo que más pesa en el resultado.
 *
 * No hay recorte: un video de tratamiento se filma como se filma y recortarlo a
 * un cuadrado le corta las manos a la profesional. Se sirve con el alto que
 * traiga y la galería lo acomoda.
 */
export const VIDEO_PRESETS = {
  /** El de la galería de la ficha. */
  card: "f_auto,q_auto,w_800",
  /** A pantalla completa. */
  hero: "f_auto,q_auto,w_1600",
} as const;

export type VideoPreset = keyof typeof VIDEO_PRESETS;

/** Los dos tipos de asset que sirve Cloudinary, y el marcador de cada uno. */
const MARKERS = ["/image/upload/", "/video/upload/"] as const;

/** Encuentra cuál de los dos marcadores tiene la URL, y dónde. */
function splitAtMarker(url: string): { before: string; after: string } | null {
  for (const marker of MARKERS) {
    const at = url.indexOf(marker);
    if (at !== -1) {
      return { before: url.slice(0, at + marker.length), after: url.slice(at + marker.length) };
    }
  }
  return null;
}

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

  const parts = splitAtMarker(url);
  if (!parts) return url; // no es de Cloudinary: se sirve tal cual

  return `${parts.before}${IMAGE_PRESETS[preset]}/${parts.after}`;
}

/** El video, servido en el tamaño pedido. Misma tolerancia que imageUrl(). */
export function videoUrl(url: string | null | undefined, preset: VideoPreset): string | null {
  if (!url) return null;

  const parts = splitAtMarker(url);
  if (!parts) return url;

  return `${parts.before}${VIDEO_PRESETS[preset]}/${parts.after}`;
}

/**
 * Un fotograma del video, como imagen fija.
 *
 * Sirve para dos cosas: el `poster` del <video>, que es lo que se ve antes de
 * que la persona le dé play, y la miniatura del video en la tira de la galería.
 * Sin esto el primero es un rectángulo negro y la segunda tendría que cargar el
 * video entero para mostrar un cuadradito.
 *
 * `so_0` es el segundo del que se saca el cuadro, y la extensión cambiada a
 * .jpg es lo que le dice a Cloudinary que entregue imagen y no video: los dos
 * son parte de la misma URL, no hay una API aparte.
 */
export function videoPosterUrl(url: string | null | undefined, preset: ImagePreset): string | null {
  if (!url) return null;

  const parts = splitAtMarker(url);
  if (!parts) return null; // sin Cloudinary no hay de dónde sacar el cuadro

  const stillFrame = parts.after.replace(/\.[^./]+$/, ".jpg");
  return `${parts.before}so_0,${IMAGE_PRESETS[preset]}/${stillFrame}`;
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

  const parts = splitAtMarker(url);
  if (!parts) return null;

  let path = parts.after;

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
