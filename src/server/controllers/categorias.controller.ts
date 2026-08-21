import { Prisma } from "@prisma/client";
import { prisma } from "@/server/db";
import { json, type Ctx } from "@/server/http";
import {
  renombrarCategoriaDeProducto,
  renombrarCategoriaDeServicio,
} from "@/server/services/catalogo.service";
import type { RtaCategorias, RtaUsoDeCategorias } from "@/lib/api-tipos";

/**
 * Las categorías del catálogo y las del stock.
 *
 * Son dos tablas con la misma forma y dos pantallas casi idénticas, pero
 * **piden permisos distintos**, y ahí está lo único que hay que mirar con
 * cuidado en este archivo:
 *
 *   · `service_categories` → permiso `catalog`
 *   · `product_categories` → permiso `stock`   ← NO `catalog`
 *
 * Es contraintuitivo y por eso está escrito dos veces: las categorías de
 * producto agrupan cremas e insumos internos que no salen en el sitio. Lo
 * arregló la migración `20260814000000` y no hay que volverlo atrás. Los
 * permisos se exigen en `categorias.routes.ts`, que es donde se pueden leer los
 * dos juntos.
 *
 * ── UNA COLUMNA DE TEXTO, NO UNA CLAVE FORÁNEA ────────────────────────────
 *
 * `services.category` y `products.category` son TEXTO: guardan el nombre, no el
 * id. Por eso renombrar es delicado —hay que tocar las dos tablas— y por eso
 * existen `renombrarCategoriaDeServicio` y `renombrarCategoriaDeProducto`, que
 * lo hacen en una transacción. **No lo reimplementes acá.**
 *
 * Y por eso borrar una categoría NO toca los tratamientos que la usaban: quedan
 * con el nombre viejo escrito. Es el comportamiento que ya tenía y se conserva;
 * la pantalla avisa cuántos la usan antes de dejar borrar.
 */

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function nombreDe(ctx: Ctx): string | null {
  const crudo = ctx.body["name"];
  if (typeof crudo !== "string") return null;
  const limpio = crudo.trim();
  return limpio === "" ? null : limpio;
}

/**
 * `name` es UNIQUE en las dos tablas. Sin esto, el choque sale como "Error
 * interno del servidor" y la persona no se entera de que ya existe una con ese
 * nombre — que es un caso normal, no una falla.
 */
async function conNombreLibre(accion: () => Promise<unknown>, ctx: string): Promise<Response> {
  try {
    await accion();
    return json({ ok: true });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return json({ error: `Ya existe una categoría de ${ctx} con ese nombre.` }, 409);
    }
    throw error;
  }
}

/** Cuántas filas usan cada categoría, contadas por la base y no en memoria. */
async function contarUso(agrupar: { category: string; _count: { _all: number } }[]) {
  const uso: Record<string, number> = {};
  for (const fila of agrupar) uso[fila.category] = fila._count._all;
  const salida: RtaUsoDeCategorias = { uso };
  return json(salida);
}

// ─────────────────────────────────────────────────────────────────────────────
// Tratamientos — permiso `catalog`
// ─────────────────────────────────────────────────────────────────────────────

export async function listarDeServicios() {
  const categorias = await prisma.service_categories.findMany({
    select: { id: true, name: true },
    orderBy: { name: "asc" },
  });
  const salida: RtaCategorias = { categorias };
  return json(salida);
}

export async function usoDeServicios() {
  // `groupBy` y no traerse todos los tratamientos para contarlos en JS, que es
  // lo que hacía la pantalla. Con 6 filas da igual; la diferencia es que esto no
  // empeora si el catálogo crece.
  //
  // En dos pasos y no anidado: pasándoselo directo a `contarUso`, el tipo del
  // parámetro le llega a `groupBy` como contexto y la inferencia se va a
  // cualquier lado — el error habla de que a un objeto le falta `push`.
  const porCategoria = await prisma.services.groupBy({
    by: ["category"],
    _count: { _all: true },
  });
  return contarUso(porCategoria);
}

export async function crearDeServicios(ctx: Ctx) {
  const name = nombreDe(ctx);
  if (!name) return json({ error: "Poné un nombre." }, 400);
  return conNombreLibre(() => prisma.service_categories.create({ data: { name } }), "tratamientos");
}

export async function renombrarDeServicios(ctx: Ctx) {
  const id = ctx.params["id"];
  const name = nombreDe(ctx);
  if (!id) return json({ error: "Falta la categoría." }, 400);
  if (!name) return json({ error: "Poné un nombre." }, 400);
  return conNombreLibre(() => renombrarCategoriaDeServicio(id, name), "tratamientos");
}

export async function borrarDeServicios(ctx: Ctx) {
  const id = ctx.params["id"];
  if (!id) return json({ error: "Falta la categoría." }, 400);
  await prisma.service_categories.delete({ where: { id } });
  return json({ ok: true });
}

// ─────────────────────────────────────────────────────────────────────────────
// Productos — permiso `stock`, NO `catalog`
// ─────────────────────────────────────────────────────────────────────────────

export async function listarDeProductos() {
  const categorias = await prisma.product_categories.findMany({
    select: { id: true, name: true },
    orderBy: { name: "asc" },
  });
  const salida: RtaCategorias = { categorias };
  return json(salida);
}

export async function usoDeProductos() {
  const porCategoria = await prisma.products.groupBy({
    by: ["category"],
    _count: { _all: true },
  });
  return contarUso(porCategoria);
}

export async function crearDeProductos(ctx: Ctx) {
  const name = nombreDe(ctx);
  if (!name) return json({ error: "Poné un nombre." }, 400);
  return conNombreLibre(() => prisma.product_categories.create({ data: { name } }), "productos");
}

export async function renombrarDeProductos(ctx: Ctx) {
  const id = ctx.params["id"];
  const name = nombreDe(ctx);
  if (!id) return json({ error: "Falta la categoría." }, 400);
  if (!name) return json({ error: "Poné un nombre." }, 400);
  return conNombreLibre(() => renombrarCategoriaDeProducto(id, name), "productos");
}

export async function borrarDeProductos(ctx: Ctx) {
  const id = ctx.params["id"];
  if (!id) return json({ error: "Falta la categoría." }, 400);
  await prisma.product_categories.delete({ where: { id } });
  return json({ ok: true });
}
