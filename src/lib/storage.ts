import { supabase } from "@/integrations/supabase/client";
import { publicIdFromUrl } from "@/lib/cloudinary";
import { deleteImage, signImageUpload } from "@/lib/cloudinary.functions";

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

  const { blob } = await compress(file);

  // ── Camino anterior: Supabase Storage ─────────────────────────────────────
  // Se deja comentado y no borrado porque el bucket sigue existiendo con las
  // fotos ya cargadas, y volver acá es cambiar tres líneas.
  //
  // Se movió a Cloudinary porque las fotos se muestran en tres tamaños muy
  // distintos (48px en la tabla del panel, ~400px en la tarjeta, pantalla
  // completa en la ficha) y desde Storage bajaban siempre el mismo archivo de
  // 1600px. Supabase sabe redimensionar por URL, pero es función de plan Pro y
  // el proyecto está en Free.
  //
  //   const { blob, extension, type } = await compress(file);
  //   const path = `${crypto.randomUUID()}.${extension}`;
  //   const { error } = await supabase.storage
  //     .from(SERVICE_IMAGES_BUCKET)
  //     .upload(path, blob, { contentType: type, cacheControl: "31536000" });
  //   if (error) throw error;
  //   const { data } = supabase.storage.from(SERVICE_IMAGES_BUCKET).getPublicUrl(path);
  //   return data.publicUrl;

  // La firma la da el servidor, que antes verifica el permiso `catalog` contra
  // la base. El archivo NO pasa por nuestro servidor: va directo del navegador
  // a Cloudinary, y lo único que viaja por acá es la autorización.
  const { cloudName, apiKey, timestamp, folder, signature } = await signImageUpload();

  const form = new FormData();
  form.append("file", blob);
  form.append("api_key", apiKey);
  form.append("timestamp", timestamp);
  form.append("folder", folder);
  form.append("signature", signature);

  const response = await fetch(`https://api.cloudinary.com/v1_1/${cloudName}/image/upload`, {
    method: "POST",
    body: form,
  });

  if (!response.ok) {
    // El cuerpo de error de Cloudinary explica el motivo real (firma vencida,
    // formato no permitido, cuota). Sin esto sólo se veía "400".
    const detail = await response.text().catch(() => "");
    throw new Error(`Cloudinary rechazó la subida (${response.status}). ${detail}`.trim());
  }

  const result = (await response.json()) as { secure_url?: string };
  if (!result.secure_url) throw new Error("Cloudinary no devolvió la URL de la imagen.");

  // Se guarda la URL "pelada", sin transformaciones: los tamaños se arman al
  // mostrar, con imageUrl(). Si acá se guardara ya transformada, quedaría
  // congelada al tamaño que se eligió el día de la subida.
  return result.secure_url;
}

/** Extrae la ruta dentro del bucket a partir de la URL pública. */
export function servicePathFromUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  const marker = `/storage/v1/object/public/${SERVICE_IMAGES_BUCKET}/`;
  const index = url.indexOf(marker);
  return index === -1 ? null : url.slice(index + marker.length);
}

/**
 * Borra una foto. No lanza si falla: un archivo huérfano no es motivo para
 * frenar el guardado del tratamiento, que es lo que importa.
 *
 * Atiende las dos procedencias porque conviven: las fotos cargadas antes de la
 * migración siguen en el bucket de Supabase y las nuevas están en Cloudinary.
 * Se distingue por la forma de la URL, no por una fecha ni una bandera en la
 * base — es el único dato que siempre está.
 */
export async function removeServiceImage(url: string | null | undefined): Promise<void> {
  if (!url) return;

  const publicId = publicIdFromUrl(url);
  if (publicId) {
    try {
      await deleteImage({ data: { publicId } });
    } catch (error) {
      console.warn(
        "[cloudinary] no se pudo borrar la imagen:",
        error instanceof Error ? error.message : error,
      );
    }
    return;
  }

  // Foto vieja, todavía en Supabase Storage.
  const path = servicePathFromUrl(url);
  if (!path) return;
  const { error } = await supabase.storage.from(SERVICE_IMAGES_BUCKET).remove([path]);
  if (error) console.warn("[storage] no se pudo borrar la imagen anterior:", error.message);
}
