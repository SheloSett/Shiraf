import { supabase } from "@/integrations/supabase/client";

export const SERVICE_IMAGES_BUCKET = "servicios";

const MAX_BYTES = 15 * 1024 * 1024;
const ALLOWED = ["image/jpeg", "image/png", "image/webp", "image/avif"];

/** Ancho máximo servido. Alcanza para el panel del home y la ficha a pantalla completa. */
const MAX_WIDTH = 1600;
const WEBP_QUALITY = 0.82;

/**
 * Reduce y comprime la imagen en el navegador antes de subirla.
 *
 * Una foto de celular ronda los 6 MB y 4000px de ancho. Subida tal cual, come
 * el espacio del bucket y —más importante— tarda muchísimo en cargar con datos
 * móviles. A 1600px y WebP la misma foto queda en ~200 KB sin diferencia
 * visible en pantalla.
 *
 * Si el navegador no puede procesarla, devuelve el archivo original: es mejor
 * subir algo pesado que fallar.
 */
async function compress(file: File): Promise<{ blob: Blob; extension: string; type: string }> {
  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, MAX_WIDTH / bitmap.width);
    const width = Math.round(bitmap.width * scale);
    const height = Math.round(bitmap.height * scale);

    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;

    const context = canvas.getContext("2d");
    if (!context) throw new Error("sin contexto 2d");

    context.drawImage(bitmap, 0, 0, width, height);
    bitmap.close();

    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, "image/webp", WEBP_QUALITY),
    );

    // Safari viejo devuelve null para webp; ahí se reintenta en jpeg.
    if (blob) return { blob, extension: "webp", type: "image/webp" };

    const jpeg = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, "image/jpeg", WEBP_QUALITY),
    );
    if (jpeg) return { blob: jpeg, extension: "jpg", type: "image/jpeg" };

    throw new Error("el navegador no pudo convertir la imagen");
  } catch {
    const extension = file.name.split(".").pop()?.toLowerCase() || "jpg";
    return { blob: file, extension, type: file.type };
  }
}

/**
 * Sube una foto de tratamiento y devuelve su URL pública.
 *
 * El nombre lo genera randomUUID en vez de usar el del archivo: evita choques
 * entre dos "limpieza.jpg", saca de la URL los acentos y espacios que traen los
 * nombres reales, y hace que al reemplazar una foto no se sirva la anterior
 * desde la caché.
 */
export async function uploadServiceImage(file: File): Promise<string> {
  if (!ALLOWED.includes(file.type)) {
    throw new Error("El archivo tiene que ser una imagen JPG, PNG, WebP o AVIF.");
  }
  if (file.size > MAX_BYTES) {
    throw new Error(
      `La imagen pesa ${(file.size / 1024 / 1024).toFixed(1)} MB. El máximo es 15 MB.`,
    );
  }

  const { blob, extension, type } = await compress(file);
  const path = `${crypto.randomUUID()}.${extension}`;

  const { error } = await supabase.storage
    .from(SERVICE_IMAGES_BUCKET)
    .upload(path, blob, { contentType: type, cacheControl: "31536000" });

  if (error) throw error;

  const { data } = supabase.storage.from(SERVICE_IMAGES_BUCKET).getPublicUrl(path);
  return data.publicUrl;
}

/** Extrae la ruta dentro del bucket a partir de la URL pública. */
export function servicePathFromUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  const marker = `/storage/v1/object/public/${SERVICE_IMAGES_BUCKET}/`;
  const index = url.indexOf(marker);
  return index === -1 ? null : url.slice(index + marker.length);
}

/**
 * Borra una foto del bucket. No lanza si falla: un archivo huérfano no es
 * motivo para frenar el guardado del tratamiento, que es lo que importa.
 */
export async function removeServiceImage(url: string | null | undefined): Promise<void> {
  const path = servicePathFromUrl(url);
  if (!path) return;
  const { error } = await supabase.storage.from(SERVICE_IMAGES_BUCKET).remove([path]);
  if (error) console.warn("[storage] no se pudo borrar la imagen anterior:", error.message);
}
