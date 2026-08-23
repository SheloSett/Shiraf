import { Prisma } from "@prisma/client";
import { prisma } from "@/server/db";
import { json, type Ctx } from "@/server/http";
import { slugLibre } from "@/server/services/catalogo.service";
import type { MediaAGuardar, RtaMediaSacada, RtaServiciosAdmin } from "@/lib/api-tipos";

/**
 * El catálogo de tratamientos, desde el panel. Permiso `catalog`.
 *
 * A diferencia de `publico.controller.ts`, acá se ven también los despublicados:
 * es la pantalla donde la dueña arma el catálogo antes de mostrarlo.
 */

// ─────────────────────────────────────────────────────────────────────────────
// Lectura
// ─────────────────────────────────────────────────────────────────────────────

export async function listar() {
  const servicios = await prisma.services.findMany({
    select: {
      id: true,
      // Lo pide `ServicioAdmin`, que extiende `ServicioPublico`. No lo usa
      // todavía ninguna pantalla del panel, pero es el dato con el que la tabla
      // de tratamientos podría mostrar "ver en el sitio" — y sacarlo del select
      // rompe el tipo, que es exactamente el aviso que uno querría.
      slug: true,
      name: true,
      category: true,
      description: true,
      duration_minutes: true,
      price: true,
      is_published: true,
      // La portada la mantiene el trigger sync_service_cover. Viene para la
      // miniatura de la tabla, que así no tiene que buscarla en la galería.
      image_url: true,
      media: {
        select: { id: true, url: true, kind: true, position: true },
        orderBy: [{ position: "asc" }, { created_at: "asc" }],
      },
    },
    orderBy: [{ category: "asc" }, { name: "asc" }],
  });

  const salida: RtaServiciosAdmin = {
    servicios: servicios.map(({ media, price, ...s }) => ({
      ...s,
      price: price.toNumber(),
      service_media: media,
    })),
  };
  return json(salida);
}

// ─────────────────────────────────────────────────────────────────────────────
// Alta y edición
// ─────────────────────────────────────────────────────────────────────────────

type Campos = {
  name: string;
  category: string;
  description: string | null;
  duration_minutes: number;
  price: number;
};

/**
 * Valida y arma los campos del tratamiento.
 *
 * ⚠️ `image_url` NO está y no puede estar: la portada la escribe
 * `trg_sync_service_cover` a partir de la galería. Mandarla desde el formulario
 * la pisaría con un valor viejo hasta que el trigger la recalcule.
 */
function camposDe(ctx: Ctx): Campos | string {
  const b = ctx.body;
  const name = typeof b["name"] === "string" ? b["name"].trim() : "";
  if (!name) return "Poné un nombre.";

  const duracion = Number(b["duration_minutes"]);
  if (!Number.isFinite(duracion) || duracion <= 0) return "La duración tiene que ser un número.";

  const precio = Number(b["price"]);
  if (!Number.isFinite(precio) || precio < 0) return "El precio tiene que ser un número.";

  const categoria = typeof b["category"] === "string" ? b["category"].trim() : "";
  const descripcion = typeof b["description"] === "string" ? b["description"].trim() : "";

  return {
    name,
    category: categoria || "Sin categoría",
    description: descripcion || null,
    duration_minutes: Math.round(duracion),
    price: precio,
  };
}

/** La galería tal como quedó en el formulario. Las nuevas no traen `id`. */
function mediaDe(ctx: Ctx): MediaAGuardar[] {
  const crudo = ctx.body["media"];
  if (!Array.isArray(crudo)) return [];
  return crudo.flatMap((item) => {
    const m = item as { id?: unknown; url?: unknown; kind?: unknown };
    if (typeof m.url !== "string" || (m.kind !== "image" && m.kind !== "video")) return [];
    return [{ ...(typeof m.id === "string" ? { id: m.id } : {}), url: m.url, kind: m.kind }];
  });
}

export async function crear(ctx: Ctx) {
  const campos = camposDe(ctx);
  if (typeof campos === "string") return json({ error: campos }, 400);
  const media = mediaDe(ctx);

  const id = await prisma.$transaction(async (tx) => {
    // Se crea publicado, como venía haciendo la pantalla.
    const servicio = await tx.services.create({
      // Comentada, no borrada: le faltaba el `slug`, y sin él el tratamiento
      // nuevo nacía sin URL legible y la ficha tenía que caer al UUID.
      //   data: { ...campos, is_published: true },
      //
      // El slug lo calcula el servidor y NO lo manda el formulario, por lo
      // mismo que `image_url`: es un dato derivado. Si lo mandara la pantalla,
      // habría que confiar en que lo arma igual que acá y en que se acuerda de
      // recalcularlo al renombrar — dos cosas que se olvidan.
      data: { ...campos, slug: await slugLibre(tx, campos.name), is_published: true },
      select: { id: true },
    });
    if (media.length > 0) {
      await tx.service_media.createMany({
        data: media.map((m, position) => ({
          service_id: servicio.id,
          url: m.url,
          kind: m.kind,
          position,
        })),
      });
    }
    return servicio.id;
  });

  return json({ id });
}

/**
 * Edita el tratamiento y reconcilia la galería, todo en una transacción.
 *
 * ── POR QUÉ RECONCILIAR Y NO BORRAR TODO E INSERTAR DE NUEVO ──────────────
 *
 * Borrar todo y reinsertar le cambiaría el id a filas que nadie tocó, y
 * dispararía `trg_sync_service_cover` una vez por elemento. Se hace en tres
 * pasos —sacar las que se fueron, mover las que cambiaron de lugar, insertar las
 * nuevas— igual que lo hacía la pantalla.
 *
 * Lo que cambia es que ahora **es una sola transacción**. Antes eran hasta
 * cuatro viajes sueltos desde el navegador, y si el segundo fallaba la galería
 * quedaba a medio guardar.
 *
 * Devuelve las que se sacaron para que la pantalla borre los archivos de
 * Cloudinary **después**, con la base ya guardada. Si se borraran antes y esto
 * fallara, la galería apuntaría a archivos que ya no existen.
 */
export async function editar(ctx: Ctx) {
  const id = ctx.params["id"];
  if (!id) return json({ error: "Falta el tratamiento." }, 400);

  const campos = camposDe(ctx);
  if (typeof campos === "string") return json({ error: campos }, 400);
  const media = mediaDe(ctx);

  const sacadas = await prisma.$transaction(async (tx) => {
    // Comentada, no borrada: guardaba el nombre nuevo pero dejaba el slug
    // viejo, y la URL terminaba diciendo el nombre anterior.
    //   await tx.services.update({ where: { id }, data: campos });
    //
    // `slugLibre` se recalcula siempre, aunque el nombre no haya cambiado:
    // devuelve el mismo texto y el UPDATE escribe lo que ya estaba. Preguntar
    // antes "¿cambió el nombre?" pediría leer la fila para compararla, una
    // consulta más para ahorrar una escritura que no cuesta nada.
    await tx.services.update({
      where: { id },
      data: { ...campos, slug: await slugLibre(tx, campos.name, id) },
    });

    const antes = await tx.service_media.findMany({
      where: { service_id: id },
      select: { id: true, url: true, kind: true },
      orderBy: [{ position: "asc" }, { created_at: "asc" }],
    });

    const quedan = new Set(media.map((m) => m.id).filter(Boolean));
    const seFueron = antes.filter((m) => !quedan.has(m.id));

    if (seFueron.length > 0) {
      await tx.service_media.deleteMany({ where: { id: { in: seFueron.map((m) => m.id) } } });
    }

    // Dónde estaba cada una, para no mandar UPDATEs que no cambian nada.
    const posicionAnterior = new Map(antes.map((m, i) => [m.id, i]));

    const nuevas: { service_id: string; url: string; kind: "image" | "video"; position: number }[] =
      [];

    for (const [position, item] of media.entries()) {
      if (!item.id) {
        nuevas.push({ service_id: id, url: item.url, kind: item.kind, position });
      } else if (posicionAnterior.get(item.id) !== position) {
        await tx.service_media.update({ where: { id: item.id }, data: { position } });
      }
    }

    if (nuevas.length > 0) await tx.service_media.createMany({ data: nuevas });

    return seFueron.map(({ url, kind }) => ({ url, kind }));
  });

  const salida: RtaMediaSacada = { sacadas };
  return json(salida);
}

export async function publicar(ctx: Ctx) {
  const id = ctx.params["id"];
  if (!id) return json({ error: "Falta el tratamiento." }, 400);
  const valor = ctx.body["is_published"];
  if (typeof valor !== "boolean") return json({ error: "Falta el valor." }, 400);

  await prisma.services.update({ where: { id }, data: { is_published: valor } });
  return json({ ok: true });
}

/**
 * Da de baja el tratamiento y devuelve sus archivos para que la pantalla los
 * borre de Cloudinary.
 *
 * ⚠️ Las URLs se leen ANTES de borrar: después las filas ya no están —
 * `service_media` cae por CASCADE— y los archivos quedarían sin forma de
 * encontrarse. Y se devuelven sólo si la baja salió bien, porque puede fallar.
 */
export async function borrar(ctx: Ctx) {
  const id = ctx.params["id"];
  if (!id) return json({ error: "Falta el tratamiento." }, 400);

  const media = await prisma.service_media.findMany({
    where: { service_id: id },
    select: { url: true, kind: true },
  });

  try {
    await prisma.services.delete({ where: { id } });
  } catch (error) {
    // P2003 = clave foránea. Acá significa una cosa sola: hay turnos con este
    // tratamiento y la base lo frena, porque appointments.service_id es
    // ON DELETE RESTRICT.
    //
    // 🔴 La traducción va del lado del servidor porque el mensaje crudo de
    // Postgres YA NO LLEGA a la pantalla: el router sólo deja pasar el texto de
    // los errores que escribimos nosotros. Antes esta frase la armaba la
    // pantalla buscando "violates foreign key" adentro del mensaje, y con el
    // cambio habría quedado mostrando "Error interno del servidor".
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2003") {
      return json(
        {
          error: "No se puede eliminar: hay turnos con este tratamiento. Despublicalo en su lugar.",
        },
        409,
      );
    }
    throw error;
  }

  const salida: RtaMediaSacada = { sacadas: media };
  return json(salida);
}
