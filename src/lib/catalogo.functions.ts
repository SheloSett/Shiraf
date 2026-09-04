import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

/**
 * Lo mínimo de un tratamiento para armar el `<head>` de su ficha.
 *
 * ── POR QUÉ EXISTE, SI LA PANTALLA YA PIDE EL TRATAMIENTO ─────────────────
 *
 * Porque lo pide **desde el navegador**, con `useQuery`, y para el `<title>`
 * eso llega tarde. El HTML que sale del servidor —el que lee Google, y el que
 * se ve en la vista previa de un link de WhatsApp— se arma antes de que el
 * navegador ejecute nada.
 *
 * El resultado se veía en producción: las 21 fichas de tratamientos servían el
 * MISMO título, "Tratamiento — Shiraf", y la misma descripción. Para un
 * buscador eran 21 páginas indistinguibles, y ninguna podía aparecer buscando
 * su tratamiento por el nombre.
 *
 * ── POR QUÉ NO REEMPLAZA AL `useQuery` DE LA PANTALLA ─────────────────────
 *
 * Podría: un loader que traiga el tratamiento entero serviría para las dos
 * cosas. Pero eso cambia cómo carga una pantalla que hoy anda —los estados de
 * carga, el error, la galería, los horarios de cada profesional—, y el `<head>`
 * no necesita nada de eso. Esto trae tres campos y no toca el resto.
 *
 * El costo es una consulta más, de tres columnas, en el primer render de la
 * ficha. El beneficio es que cada tratamiento tenga su título de verdad.
 */
export type CabeceraDeTratamiento = {
  nombre: string;
  descripcion: string;
  /** Para el `canonical`: una ficha abierta con el UUID apunta a su URL legible. */
  slug: string | null;
};

// El mismo largo que acepta la ruta: lo que viene de la URL, sin confiar.
const Clave = z.string().trim().min(1).max(200);

export const cabeceraDelTratamiento = createServerFn({ method: "GET" })
  .validator((data: unknown) => Clave.parse(data))
  .handler(async ({ data }): Promise<CabeceraDeTratamiento | null> => {
    // Import dinámico por la misma razón que en el resto de las server
    // functions: este archivo es alcanzable desde el navegador y nada que
    // cuelgue de `src/server/` puede entrar al bundle del cliente.
    const { prisma } = await import("@/server/db");
    // `porIdOSlug` sale del controller y no se copia acá: es la regla de qué
    // es un UUID y qué es un slug, y tenerla en dos lugares es tenerla mal en
    // uno de los dos el día que cambie.
    const { porIdOSlug } = await import("@/server/controllers/publico.controller");

    // 🔴 `is_published: true`, igual que en publico.controller.ts y en
    // sitemap.ts. Sin ese filtro, el título de un tratamiento a medio cargar
    // —con el precio que la dueña todavía no decidió— viajaría en el HTML de
    // una página que cualquiera puede abrir.
    const servicio = await prisma.services.findFirst({
      where: { ...porIdOSlug(data), is_published: true },
      select: { name: true, description: true, slug: true },
    });

    if (!servicio) return null;

    return {
      nombre: servicio.name,
      descripcion: servicio.description ?? "",
      slug: servicio.slug,
    };
  });
