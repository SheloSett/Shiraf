import { useMemo } from "react";
import { useLoaderData } from "@tanstack/react-router";
import { conDefaults, type ContenidoDePagina } from "@/lib/contenido";

/**
 * Los textos de una página, listos para usar en el JSX.
 *
 * ── DE DÓNDE SALEN ────────────────────────────────────────────────────────
 *
 * Del `loader` de la ruta raíz, que trae el contenido guardado de las seis
 * páginas de una sola vez. **No hay un pedido por página ni un `useQuery` acá
 * adentro**: cuando este hook corre, el dato ya está.
 *
 * Eso es lo que permite que el pie de página lo use igual que una ruta. El pie
 * es un componente, no una ruta, así que no tiene loader propio; pero el de la
 * raíz lo abarca todo, y este hook lee de ahí.
 *
 * ── LO GUARDADO SE APOYA SOBRE LOS DEFAULTS ───────────────────────────────
 *
 * Lo hace `conDefaults`. Una página que nunca se editó devuelve exactamente el
 * texto original del sitio, así que **usar este hook nunca deja un hueco en
 * pantalla**, ni siquiera con la tabla vacía.
 *
 * @example
 *   const c = useContenido("inicio");
 *   <h1>{texto(c, "heroTitulo")}</h1>
 */
export function useContenido(pagina: string): ContenidoDePagina {
  // `from: "__root__"` es el id de la ruta raíz. Va explícito y no relativo
  // porque este hook lo llaman tanto rutas como componentes sueltos —el pie de
  // página, el botón flotante de WhatsApp—, y desde un componente no hay ruta
  // "actual" que TanStack pueda deducir.
  const guardado = useLoaderData({ from: "__root__" });

  return useMemo(() => conDefaults(pagina, guardado?.[pagina]), [pagina, guardado]);
}
