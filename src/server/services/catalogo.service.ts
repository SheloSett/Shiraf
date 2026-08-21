import { prisma } from "@/server/db";

/**
 * El renombrado de categorías.
 *
 * ── POR QUÉ ESTO NO ES UN SIMPLE UPDATE ───────────────────────────────────
 *
 * `services.category` y `products.category` son TEXTO, no una clave foránea a
 * la tabla de categorías. Así está en la base desde el principio y se dejó
 * igual: cambiarlo es una migración de datos, no parte del traslado.
 *
 * La consecuencia es que renombrar una categoría son DOS escrituras —la fila de
 * la categoría y todas las filas que la nombran— y tienen que pasar juntas. Si
 * la segunda falla, quedan seis tratamientos apuntando a una categoría que ya
 * no se llama así: desaparecen del filtro del catálogo sin que nadie los haya
 * despublicado.
 *
 * En Postgres esto era una función plpgsql, que es transaccional por
 * naturaleza. Acá es `prisma.$transaction`, que hace lo mismo: o entran las dos
 * o no entra ninguna.
 *
 * ── UN DETALLE QUE YA MORDIÓ UNA VEZ ──────────────────────────────────────
 *
 * El chequeo de permiso lo hace quien llama, ANTES. En la versión de Supabase
 * estaba adentro de la función y con un motivo escrito en la migración
 * 20260816000000: en un UPDATE la RLS **filtra filas en vez de dar error**, así
 * que sin el chequeo explícito la operación "salía bien" sin haber hecho nada.
 *
 * Acá no hay RLS, así que ese modo de fallar concreto ya no existe — pero la
 * regla de fondo sí: sin permiso no se renombra, y eso lo tiene que decir el
 * route file antes de llegar hasta acá.
 */

async function renombrar(
  tabla: "service" | "product",
  id: string,
  nombreNuevo: string,
): Promise<void> {
  const nuevo = nombreNuevo.trim();
  if (!nuevo) throw new Error("El nombre no puede quedar vacío.");

  // Las dos ramas escritas enteras, y no un `const categorias = tabla === ...`
  // que las unifique. TypeScript no acepta llamar a la union de los dos
  // delegates de Prisma —"none of those signatures are compatible"— porque cada
  // uno tiene su propio tipo de argumentos. Repetir cuatro lineas es mas barato
  // que pelearse con eso a fuerza de `any`, que ademas apagaria justo el chequeo
  // que evita mezclar las tablas.
  await prisma.$transaction(async (tx) => {
    if (tabla === "service") {
      const actual = await tx.service_categories.findUnique({
        where: { id },
        select: { name: true },
      });
      if (!actual) throw new Error("Esa categoría no existe.");
      // Nada que hacer. Se corta acá y no se escriben dos UPDATE que no cambian
      // nada — y de paso se evita chocar contra el índice único con su propio
      // nombre.
      if (actual.name === nuevo) return;

      await tx.service_categories.update({ where: { id }, data: { name: nuevo } });
      await tx.services.updateMany({ where: { category: actual.name }, data: { category: nuevo } });
      return;
    }

    const actual = await tx.product_categories.findUnique({
      where: { id },
      select: { name: true },
    });
    if (!actual) throw new Error("Esa categoría no existe.");
    if (actual.name === nuevo) return;

    await tx.product_categories.update({ where: { id }, data: { name: nuevo } });
    await tx.products.updateMany({ where: { category: actual.name }, data: { category: nuevo } });
  });
}

/** Era `rename_service_category`. Pide el permiso 'catalog'. */
export function renombrarCategoriaDeServicio(id: string, nombre: string): Promise<void> {
  return renombrar("service", id, nombre);
}

/**
 * Era `rename_product_category`.
 *
 * ⚠️ Pide 'stock', NO 'catalog'. Es contraintuitivo y está bien: las categorías
 * de producto agrupan cremas e insumos internos que no salen en el sitio. Lo
 * decidió la migración 20260814000000; no lo vuelvas atrás.
 */
export function renombrarCategoriaDeProducto(id: string, nombre: string): Promise<void> {
  return renombrar("product", id, nombre);
}
