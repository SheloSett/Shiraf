import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { CLOUDINARY_FOLDER } from "@/lib/cloudinary";

/**
 * Lo que Cloudinary necesita del servidor: firmar.
 *
 * EL PROBLEMA QUE RESUELVE ESTE ARCHIVO:
 *
 * Con Supabase Storage, quién podía subir una foto lo decidía Postgres — la
 * policy pedía el permiso `catalog` y valía sin importar quién llamara.
 * Cloudinary no sabe nada de nuestros permisos, así que esa regla hay que
 * volver a sostenerla acá.
 *
 * Cloudinary ofrece "unsigned uploads", que evitarían este archivo entero. No
 * se usan a propósito: el nombre del preset viaja en el navegador y con eso
 * cualquiera sube lo que quiera a la cuenta del centro. Con subida firmada, el
 * navegador no puede subir nada sin pedir permiso acá primero, y acá se
 * verifica el permiso contra la base antes de firmar.
 *
 * El archivo igual viaja directo del navegador a Cloudinary: lo único que pasa
 * por nuestro servidor es la firma. Si la foto pasara por acá, se duplicaría el
 * tráfico y chocaría con el límite de tamaño de cuerpo de las funciones.
 */

/** SHA-1 con Web Crypto y no con node:crypto: así corre igual en Node, en Vercel y en Cloudflare. */
async function sha1Hex(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-1", bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * Firma al modo de Cloudinary: los parámetros ordenados alfabéticamente, unidos
 * como `clave=valor` con `&`, con el api secret pegado al final, todo en SHA-1.
 */
async function signParams(params: Record<string, string>, apiSecret: string): Promise<string> {
  const canonical = Object.keys(params)
    .sort()
    .map((key) => `${key}=${params[key]}`)
    .join("&");
  return sha1Hex(canonical + apiSecret);
}

function readConfig() {
  const cloudName = process.env["CLOUDINARY_CLOUD_NAME"];
  const apiKey = process.env["CLOUDINARY_API_KEY"];
  const apiSecret = process.env["CLOUDINARY_API_SECRET"];

  const missing = [
    !cloudName && "CLOUDINARY_CLOUD_NAME",
    !apiKey && "CLOUDINARY_API_KEY",
    !apiSecret && "CLOUDINARY_API_SECRET",
  ].filter(Boolean);

  if (missing.length > 0) {
    throw new Error(`Falta configurar Cloudinary: ${missing.join(", ")}. Ver .env.example.`);
  }
  return { cloudName: cloudName!, apiKey: apiKey!, apiSecret: apiSecret! };
}

/**
 * ¿Este usuario puede tocar el catálogo?
 *
 * Repite la lógica de has_permission() de la base en vez de llamarla: esa
 * función tiene EXECUTE sólo para `authenticated`, y acá se consulta con la
 * service role. La regla es la misma — el admin puede siempre, sin mirar la
 * tabla de permisos.
 */
async function canManageCatalog(userId: string): Promise<boolean> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

  const { data: roles, error: rolesError } = await supabaseAdmin
    .from("user_roles")
    .select("role")
    .eq("user_id", userId);
  if (rolesError) throw new Error("No se pudo verificar el permiso.");
  if ((roles ?? []).some((r) => r.role === "admin")) return true;

  const { data: permissions, error: permissionsError } = await supabaseAdmin
    .from("user_permissions")
    .select("permission")
    .eq("user_id", userId)
    .eq("permission", "catalog");
  if (permissionsError) throw new Error("No se pudo verificar el permiso.");

  return (permissions ?? []).length > 0;
}

/**
 * Devuelve una firma de un solo uso para subir una foto o un video.
 *
 * `folder` lo fija el servidor y no lo manda el cliente: si viajara desde el
 * navegador, alguien podría escribir en cualquier carpeta de la cuenta.
 *
 * Sirve para los dos tipos sin cambiar nada: lo que se firma es `folder` y
 * `timestamp`, y ninguno de los dos depende de si lo que sube es imagen o
 * video. Lo que cambia es el endpoint al que se postea, y eso lo elige quien
 * sube (ver uploadServiceMedia en storage.ts).
 */
export const signImageUpload = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    if (!(await canManageCatalog(context.userId))) {
      throw new Error("No tenés permiso para cargar fotos de tratamientos.");
    }

    const { cloudName, apiKey, apiSecret } = readConfig();
    const timestamp = Math.floor(Date.now() / 1000).toString();

    // Sólo lo que se firma. `file` y `api_key` no entran en la firma: lo dice
    // la documentación de Cloudinary y firmarlos la invalida.
    const toSign = { folder: CLOUDINARY_FOLDER, timestamp };
    const signature = await signParams(toSign, apiSecret);

    return { cloudName, apiKey, timestamp, folder: CLOUDINARY_FOLDER, signature };
  });

/**
 * Borra una foto o un video de Cloudinary.
 *
 * Va por el servidor porque destroy exige firma, y la firma exige el secreto.
 *
 * `resourceType` NO es opcional por un motivo concreto: el endpoint de destroy
 * es distinto para imagen y para video, y el de imagen contra un video devuelve
 * 200 con `{"result":"not found"}`. O sea que borrar un video con el endpoint
 * equivocado parece funcionar y deja el archivo ocupando la cuenta para
 * siempre. Quien llama sabe el tipo —está guardado en service_media.kind—, así
 * que lo manda y no se adivina acá.
 */
export const deleteImage = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((data: unknown) =>
    z
      .object({
        publicId: z.string().min(1),
        resourceType: z.enum(["image", "video"]),
      })
      .parse(data),
  )
  .handler(async ({ data, context }) => {
    if (!(await canManageCatalog(context.userId))) {
      throw new Error("No tenés permiso para borrar fotos de tratamientos.");
    }

    // Que sólo pueda borrar dentro de nuestra carpeta: sin esto, un public_id
    // cualquiera dejaría borrar assets de otro proyecto de la misma cuenta.
    if (!data.publicId.startsWith(`${CLOUDINARY_FOLDER}/`)) {
      throw new Error("Esa imagen no pertenece a Shiraf.");
    }

    const { cloudName, apiKey, apiSecret } = readConfig();
    const timestamp = Math.floor(Date.now() / 1000).toString();
    const signature = await signParams({ public_id: data.publicId, timestamp }, apiSecret);

    const body = new URLSearchParams({
      public_id: data.publicId,
      timestamp,
      api_key: apiKey,
      signature,
    });

    const response = await fetch(
      `https://api.cloudinary.com/v1_1/${cloudName}/${data.resourceType}/destroy`,
      { method: "POST", body },
    );

    if (!response.ok) {
      throw new Error(`Cloudinary rechazó el borrado (${response.status}).`);
    }

    // Cloudinary responde 200 con {"result":"not found"} si el id no existe.
    // No es un error para nosotros: el objetivo era que dejara de estar.
    const result = (await response.json()) as { result?: string };
    return { ok: result.result === "ok" || result.result === "not found" };
  });
