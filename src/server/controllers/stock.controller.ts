import { prisma } from "@/server/db";
import { json, type Ctx } from "@/server/http";
import { accesoDe, puede } from "@/server/services/authz.service";
import type { ProductoAdmin, RtaProductos } from "@/lib/api-tipos";

/**
 * El stock: productos, costos y movimientos. Permiso `stock`.
 *
 * ── 🔴 EL COSTO ES OTRO PERMISO, Y ACÁ ES DONDE SE HACE CUMPLIR ───────────
 *
 * `product_costs` está en una tabla aparte de `products` desde la migración
 * `20260814010000`, y el motivo está escrito ahí: **la RLS protege filas, no
 * columnas**. Mientras el costo vivió en `products.cost`, cualquiera con el
 * permiso `stock` lo veía — o sea que "Ver costos de compra" era una casilla que
 * no cerraba nada.
 *
 * Con la RLS afuera, quien lo hace cumplir es este archivo. La pantalla
 * *también* pregunta `can("stock_costs")`, pero eso es para no mostrar un campo
 * vacío: **no es la protección**. Un pedido hecho a mano no pasa por la pantalla.
 *
 * Por eso el costo se filtra en la lectura y se ignora en la escritura cuando el
 * permiso falta, en vez de confiar en que el cliente no lo mande.
 */

async function puedeVerCostos(ctx: Ctx): Promise<boolean> {
  if (!ctx.user) return false;
  return puede(await accesoDe(ctx.user.id), "stock_costs");
}

function numero(valor: unknown, porDefecto = 0): number {
  const n = Number(valor);
  return Number.isFinite(n) ? n : porDefecto;
}

function texto(valor: unknown): string {
  return typeof valor === "string" ? valor.trim() : "";
}

// ─────────────────────────────────────────────────────────────────────────────
// Lectura
// ─────────────────────────────────────────────────────────────────────────────

export async function listar(ctx: Ctx) {
  const conCostos = await puedeVerCostos(ctx);

  const productos = await prisma.products.findMany({
    select: {
      id: true,
      name: true,
      brand: true,
      category: true,
      unit: true,
      stock: true,
      min_stock: true,
      // El costo se trae en el mismo viaje, pero SÓLO si corresponde. Antes eran
      // dos consultas desde el navegador y la segunda simplemente no se hacía.
      ...(conCostos ? { costs: { select: { cost: true } } } : {}),
    },
    orderBy: [{ category: "asc" }, { name: "asc" }],
  });

  const salida: RtaProductos = {
    productos: productos.map((p): ProductoAdmin => {
      const conCosto = p as typeof p & { costs?: { cost: unknown } | null };
      return {
        id: p.id,
        name: p.name,
        brand: p.brand,
        category: p.category,
        unit: p.unit,
        stock: p.stock.toNumber(),
        min_stock: p.min_stock.toNumber(),
        // `null` tanto si no hay costo cargado como si no se puede ver. La
        // pantalla ya distingue los dos casos por el permiso, que conoce.
        cost:
          conCostos && conCosto.costs?.cost != null ? Number(conCosto.costs.cost.toString()) : null,
      };
    }),
  };
  return json(salida);
}

// ─────────────────────────────────────────────────────────────────────────────
// Alta, edición y baja
// ─────────────────────────────────────────────────────────────────────────────

type Campos = {
  name: string;
  brand: string | null;
  category: string;
  unit: string;
  min_stock: number;
};

function camposDe(ctx: Ctx): Campos | string {
  const name = texto(ctx.body["name"]);
  if (!name) return "Poné un nombre.";
  return {
    name,
    brand: texto(ctx.body["brand"]) || null,
    category: texto(ctx.body["category"]) || "Sin categoría",
    unit: texto(ctx.body["unit"]) || "unidad",
    min_stock: numero(ctx.body["min_stock"]),
  };
}

/** El costo que manda el formulario, o `undefined` si no hay que tocarlo. */
function costoDe(ctx: Ctx): number | null | undefined {
  const crudo = ctx.body["cost"];
  if (crudo === undefined) return undefined;
  if (crudo === null || crudo === "") return null;
  const n = Number(crudo);
  return Number.isFinite(n) ? n : undefined;
}

export async function crear(ctx: Ctx) {
  const campos = camposDe(ctx);
  if (typeof campos === "string") return json({ error: campos }, 400);

  const conCostos = await puedeVerCostos(ctx);
  const costo = costoDe(ctx);

  const id = await prisma.$transaction(async (tx) => {
    const producto = await tx.products.create({
      data: { ...campos, stock: numero(ctx.body["stock"]) },
      select: { id: true },
    });

    // Sólo si hay costo cargado: no tiene sentido una fila vacía en
    // product_costs por cada producto sin costo.
    if (conCostos && costo != null) {
      await tx.product_costs.create({ data: { product_id: producto.id, cost: costo } });
    }
    return producto.id;
  });

  return json({ id });
}

/**
 * Edita el producto.
 *
 * ── 🔴 EL STOCK NO SE ESCRIBE, SE MUEVE ───────────────────────────────────
 *
 * La ficha deja editar el stock, pero la columna no se toca a mano: se calcula
 * la diferencia contra el valor actual y se registra como movimiento. El trigger
 * `apply_stock_movement` aplica el saldo, igual que con los botones + / −, y así
 * el historial nunca se separa del stock real.
 *
 * **La diferencia se calcula acá adentro y no en la pantalla**, que es como
 * estaba. Antes la pantalla leía el stock, restaba y mandaba el movimiento: si
 * entre esas dos cosas alguien descontaba un consumo en cabina, ese consumo se
 * perdía. Adentro de la transacción no puede pasar.
 */
export async function editar(ctx: Ctx) {
  const id = ctx.params["id"];
  if (!id) return json({ error: "Falta el producto." }, 400);

  const campos = camposDe(ctx);
  if (typeof campos === "string") return json({ error: campos }, 400);

  const conCostos = await puedeVerCostos(ctx);
  const costo = costoDe(ctx);
  const stockPedido = ctx.body["stock"];
  const userId = ctx.user?.id ?? null;

  await prisma.$transaction(async (tx) => {
    await tx.products.update({ where: { id }, data: campos });

    if (stockPedido !== undefined) {
      const actual = await tx.products.findUniqueOrThrow({
        where: { id },
        select: { stock: true },
      });
      const delta = numero(stockPedido) - actual.stock.toNumber();

      if (delta !== 0) {
        await tx.stock_movements.create({
          data: {
            product_id: id,
            quantity: delta,
            reason: "Ajuste desde la ficha del producto",
            created_by: userId,
          },
        });
      }
    }

    // Sin el permiso no se toca el costo, aunque venga en el cuerpo: el campo
    // no se le mostró a esa persona, así que lo que mande no significa nada — y
    // guardarlo borraría el costo que ya estaba.
    if (conCostos && costo !== undefined) {
      await tx.product_costs.upsert({
        where: { product_id: id },
        create: { product_id: id, cost: costo },
        update: { cost: costo },
      });
    }
  });

  return json({ ok: true });
}

export async function borrar(ctx: Ctx) {
  const id = ctx.params["id"];
  if (!id) return json({ error: "Falta el producto." }, 400);
  await prisma.products.delete({ where: { id } });
  return json({ ok: true });
}

/**
 * Un ingreso o un consumo.
 *
 * ⚠️ `created_by` sale de la sesión y **nunca del cuerpo del pedido**. Es la
 * traducción de `auth.uid()`: el valor que decía quién hizo el movimiento no
 * puede venir de quien lo pide, o cualquiera firma a nombre de otra.
 */
export async function mover(ctx: Ctx) {
  const id = ctx.params["id"];
  if (!id) return json({ error: "Falta el producto." }, 400);

  const cantidad = Number(ctx.body["quantity"]);
  if (!Number.isFinite(cantidad) || cantidad === 0) {
    return json({ error: "Poné una cantidad distinta de cero." }, 400);
  }

  await prisma.stock_movements.create({
    data: {
      product_id: id,
      quantity: cantidad,
      reason: cantidad > 0 ? "Ingreso de mercadería" : "Consumo en cabina",
      created_by: ctx.user?.id ?? null,
    },
  });

  return json({ ok: true });
}
