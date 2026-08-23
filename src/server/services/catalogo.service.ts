import type { Prisma } from "@prisma/client";
import { prisma } from "@/server/db";
import { aSlug } from "@/lib/shiraf";

/**
 * El slug con el que este tratamiento va a vivir en la URL.
 *
 * ── SE REGENERA CON EL NOMBRE, Y ESO ES UNA DECISIÓN ──────────────────────
 *
 * Tanto el alta como la edición llaman a esto, así que renombrar "Drenaje
 * linfático" a "Drenaje linfático manual" cambia la URL de la ficha, y la
 * anterior deja de existir. La alternativa era congelar el slug del alta, pero
 * entonces un nombre corregido —una falta de ortografía, un tratamiento que se
 * renombró entero— queda con una URL que dice otra cosa para siempre.
 *
 * Nadie queda tirado igual: la ficha pública también acepta el UUID, que no
 * cambia nunca. Un enlace viejo con el id sigue abriendo. Ver `porIdOSlug` en
 * publico.controller.ts.
 *
 * ── EL SUFIJO ─────────────────────────────────────────────────────────────
 *
 * Nada impide dos tratamientos con el mismo nombre —`services.name` no es
 * único— y el slug SÍ lo es. El segundo "Masaje" queda "masaje-2". Sin esto el
 * alta fallaría con un error de Postgres que la pantalla mostraría como "error
 * interno", que es la peor manera de enterarse de que ya existe uno igual.
 *
 * El `exceptoId` es para la edición: al guardar un tratamiento sin tocarle el
 * nombre, el slug que le corresponde ya lo tiene él mismo. Sin excluirlo se
 * chocaría consigo mismo y se renombraría a "-2" en cada guardado.
 *
 * El bucle no tiene tope a propósito: cada vuelta descarta un slug que existe
 * de verdad en la tabla, así que corta como mucho a la cantidad de filas + 1.
 * Un tope arbitrario sólo agregaría una rama de error imposible de alcanzar.
 *
 * ⚠️ Dos altas simultáneas con el mismo nombre pueden elegir el mismo candidato
 * y la segunda choca contra el índice único. Se acepta: acá guarda una persona
 * por vez desde el panel, y el índice está justamente para que en ese caso la
 * escritura falle en vez de duplicar.
 */
export async function slugLibre(
  tx: Prisma.TransactionClient,
  nombre: string,
  exceptoId?: string,
): Promise<string> {
  // `aSlug` devuelve "" con un nombre hecho sólo de símbolos ("+++"). Una URL
  // vacía sería /servicios/ —el listado— así que cae a una palabra, y el sufijo
  // se encarga de que el segundo sea "tratamiento-2".
  const base = aSlug(nombre) || "tratamiento";

  for (let n = 1; ; n++) {
    const candidato = n === 1 ? base : `${base}-${n}`;
    const ocupado = await tx.services.findFirst({
      where: {
        slug: candidato,
        // Con spread y no `NOT: { id: exceptoId }` a secas: con
        // `exactOptionalPropertyTypes` una clave presente con valor `undefined`
        // no es lo mismo que ausente, y Prisma la interpretaría como un filtro.
        ...(exceptoId ? { NOT: { id: exceptoId } } : {}),
      },
      select: { id: true },
    });
    if (!ocupado) return candidato;
  }
}

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
