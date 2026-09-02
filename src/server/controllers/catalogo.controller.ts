import { Prisma } from "@prisma/client";
import { prisma } from "@/server/db";
import { json, type Ctx } from "@/server/http";
import { slugLibre } from "@/server/services/catalogo.service";
import type {
  MediaAGuardar,
  RtaMediaSacada,
  RtaServiciosAdmin,
  VarianteAGuardar,
} from "@/lib/api-tipos";

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
      // Lo pide la agenda y lo edita el formulario de tratamientos.
      buffer_minutes: true,
      price: true,
      // Las sesiones del tratamiento: las edita el mismo formulario.
      sessions_count: true,
      session_interval_days: true,
      is_published: true,
      // La portada la mantiene el trigger sync_service_cover. Viene para la
      // miniatura de la tabla, que así no tiene que buscarla en la galería.
      image_url: true,
      media: {
        select: { id: true, url: true, kind: true, position: true },
        orderBy: [{ position: "asc" }, { created_at: "asc" }],
      },
      // TODAS, también las apagadas: acá es donde se vuelven a prender. En el
      // catálogo público, en cambio, sólo salen las activas.
      variants: {
        select: {
          id: true,
          name: true,
          duration_minutes: true,
          buffer_minutes: true,
          price: true,
          is_active: true,
        },
        orderBy: [{ position: "asc" }, { created_at: "asc" }],
      },
    },
    orderBy: [{ category: "asc" }, { name: "asc" }],
  });

  const salida: RtaServiciosAdmin = {
    servicios: servicios.map(({ media, variants, price, ...s }) => ({
      ...s,
      price: price.toNumber(),
      service_media: media,
      variants: variants.map((v) => ({ ...v, price: v.price.toNumber() })),
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
  buffer_minutes: number;
  price: number;
  sessions_count: number;
  session_interval_days: number;
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

  /*
   * El margen SÍ puede ser 0, a diferencia de la duración: un tratamiento que
   * no deja nada que limpiar es un caso legítimo, y era el comportamiento del
   * sistema hasta el 18/8/2026. Lo que no puede es faltar ni ser negativo.
   *
   * Sin tope por arriba a propósito: un margen enorme no rompe nada, sólo
   * deja huecos grandes, y el centro lo ve en la pantalla de reserva al toque.
   */
  const margen = Number(b["buffer_minutes"]);
  if (!Number.isFinite(margen) || margen < 0) {
    return "El tiempo entre turnos tiene que ser un número de 0 para arriba.";
  }

  const precio = Number(b["price"]);
  if (!Number.isFinite(precio) || precio < 0) return "El precio tiene que ser un número.";

  /*
   * Las sesiones. Mínimo 1 —un tratamiento de cero sesiones no es nada— y el
   * intervalo desde 0, que quiere decir "sin espera sugerida".
   *
   * Sin tope por arriba: si alguien carga 12 sesiones cada 7 días es un
   * tratamiento largo, no un error, y el panel lo muestra igual.
   */
  const sesiones = Number(b["sessions_count"] ?? 1);
  if (!Number.isFinite(sesiones) || sesiones < 1) {
    return "Las sesiones tienen que ser un número de 1 para arriba.";
  }

  const intervalo = Number(b["session_interval_days"] ?? 0);
  if (!Number.isFinite(intervalo) || intervalo < 0) {
    return "Los días entre sesiones tienen que ser un número de 0 para arriba.";
  }

  const categoria = typeof b["category"] === "string" ? b["category"].trim() : "";
  const descripcion = typeof b["description"] === "string" ? b["description"].trim() : "";

  return {
    name,
    category: categoria || "Sin categoría",
    description: descripcion || null,
    duration_minutes: Math.round(duracion),
    buffer_minutes: Math.round(margen),
    price: precio,
    sessions_count: Math.round(sesiones),
    // El intervalo de un tratamiento de UNA sesión no significa nada, y
    // guardarlo dejaría un número que reaparece si mañana se le suben las
    // sesiones. Se normaliza acá para que la base no guarde combinaciones que
    // no quieren decir nada.
    session_interval_days: sesiones > 1 ? Math.round(intervalo) : 0,
  };
}

/**
 * Las opciones tal como quedaron en el formulario. Las nuevas no traen `id`.
 *
 * Se descarta en silencio la que venga sin nombre —una fila que se agregó y no
 * se llenó— porque una opción sin nombre no se puede ni mostrar ni elegir, y
 * hacerla fallar obligaría a la dueña a buscar cuál de las cinco filas está
 * vacía. Los números sí se validan: un precio en blanco entra como 0, pero
 * "abc" tiene que rebotar en vez de guardarse como 0 sin avisar.
 */
function variantesDe(ctx: Ctx): VarianteAGuardar[] | string {
  const crudo = ctx.body["variants"];
  if (!Array.isArray(crudo)) return [];

  const salida: VarianteAGuardar[] = [];
  for (const item of crudo) {
    const v = item as Record<string, unknown>;
    const name = typeof v["name"] === "string" ? v["name"].trim() : "";
    if (!name) continue;

    const duracion = Number(v["duration_minutes"]);
    if (!Number.isFinite(duracion) || duracion <= 0) {
      return `La duración de "${name}" tiene que ser un número mayor a 0.`;
    }
    const margen = Number(v["buffer_minutes"]);
    if (!Number.isFinite(margen) || margen < 0) {
      return `El tiempo entre turnos de "${name}" tiene que ser un número de 0 para arriba.`;
    }
    const precio = Number(v["price"]);
    if (!Number.isFinite(precio) || precio < 0) {
      return `El precio de "${name}" tiene que ser un número.`;
    }

    salida.push({
      ...(typeof v["id"] === "string" ? { id: v["id"] } : {}),
      name,
      duration_minutes: Math.round(duracion),
      buffer_minutes: Math.round(margen),
      price: precio,
      // Sólo `false` apaga: lo que no venga se toma por activa, que es lo que
      // quiere decir una opción recién cargada.
      is_active: v["is_active"] !== false,
    });
  }
  return salida;
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

/**
 * Deja las opciones del tratamiento tal como vinieron del formulario.
 *
 * Reconcilia en vez de borrar todo e insertar de nuevo, por el mismo motivo que
 * la galería y por uno más grave: el id de una variante lo tienen guardado los
 * turnos que la reservaron (`appointments.variant_id`). Borrar y reinsertar les
 * cortaría el vínculo a todos —quedarían en NULL, apoyados sólo en el nombre
 * congelado— sin que nadie haya tocado esa opción.
 *
 * `position` sale del índice en la lista: el orden de la pantalla ES el orden.
 */
async function guardarVariantes(
  tx: Prisma.TransactionClient,
  serviceId: string,
  variantes: VarianteAGuardar[],
): Promise<void> {
  const antes = await tx.service_variants.findMany({
    where: { service_id: serviceId },
    select: { id: true },
  });

  const quedan = new Set(variantes.map((v) => v.id).filter(Boolean));
  const seFueron = antes.filter((v) => !quedan.has(v.id));
  if (seFueron.length > 0) {
    await tx.service_variants.deleteMany({ where: { id: { in: seFueron.map((v) => v.id) } } });
  }

  const nuevas: {
    service_id: string;
    name: string;
    duration_minutes: number;
    buffer_minutes: number;
    price: number;
    is_active: boolean;
    position: number;
  }[] = [];

  for (const [position, v] of variantes.entries()) {
    const datos = {
      name: v.name,
      duration_minutes: v.duration_minutes,
      buffer_minutes: v.buffer_minutes,
      price: v.price,
      is_active: v.is_active,
      position,
    };
    // Se actualiza siempre, sin comparar contra lo que había: son cinco campos
    // y no vale un SELECT extra por fila para ahorrar un UPDATE que no cuesta.
    if (v.id) await tx.service_variants.update({ where: { id: v.id }, data: datos });
    else nuevas.push({ service_id: serviceId, ...datos });
  }

  if (nuevas.length > 0) await tx.service_variants.createMany({ data: nuevas });
}

export async function crear(ctx: Ctx) {
  const campos = camposDe(ctx);
  if (typeof campos === "string") return json({ error: campos }, 400);
  const variantes = variantesDe(ctx);
  if (typeof variantes === "string") return json({ error: variantes }, 400);
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
    if (variantes.length > 0) await guardarVariantes(tx, servicio.id, variantes);
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
  const variantes = variantesDe(ctx);
  if (typeof variantes === "string") return json({ error: variantes }, 400);
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

    await guardarVariantes(tx, id, variantes);

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
 * ── QUÉ FRENA EL BORRADO Y QUÉ NO ─────────────────────────────────────────
 *
 * Antes lo frenaba la base: `appointments.service_id` era ON DELETE RESTRICT, y
 * eso quiere decir que un tratamiento tomado UNA sola vez, aunque fuera hace dos
 * años y aunque ese turno estuviera cancelado, no se podía borrar nunca más. El
 * catálogo se llenaba de cosas que ya no se hacen y la única salida era
 * despublicarlas.
 *
 * Ahora se mira el ESTADO de los turnos, que es la diferencia que importa:
 *
 *   · pendientes o confirmados → **no se borra**. Son turnos que se van a
 *     atender: sacarles el tratamiento de abajo deja a la clienta con una hora
 *     reservada para nada.
 *   · realizados o cancelados  → **se borra**. Son historial, y el historial no
 *     se pierde: `service_id` queda en NULL y el turno se sigue leyendo con
 *     `service_name` y `price`, que están congelados en la fila.
 *
 * La cuenta y el borrado van en la misma transacción. Entre "no hay turnos por
 * venir" y "borralo" alguien puede estar reservando justo ese tratamiento.
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

  // `porVenir` sale de la transacción para poder armar el mensaje afuera: acá
  // adentro sólo se decide si se borra o no.
  let porVenir = 0;

  try {
    await prisma.$transaction(async (tx) => {
      porVenir = await tx.appointments.count({
        where: { service_id: id, status: { in: ["pending", "confirmed"] } },
      });
      // Se corta la transacción tirando: así el borrado no llega a pasar y no
      // hay dos caminos que puedan quedar desincronizados.
      if (porVenir > 0) throw new ErrorDeTurnosPorVenir();

      await tx.services.delete({ where: { id } });
    });
  } catch (error) {
    if (error instanceof ErrorDeTurnosPorVenir) {
      return json(
        {
          error:
            porVenir === 1
              ? "No se puede eliminar: hay 1 turno pendiente o confirmado con este tratamiento. Esperá a que pase o cancelalo. Mientras tanto podés despublicarlo."
              : `No se puede eliminar: hay ${porVenir} turnos pendientes o confirmados con este tratamiento. Esperá a que pasen o cancelalos. Mientras tanto podés despublicarlo.`,
        },
        409,
      );
    }
    // P2003 = clave foránea. Ya no lo puede tirar `appointments` —esa relación
    // pasó a SET NULL— pero se deja: si mañana otra tabla apunta acá con
    // RESTRICT, este error saldría igual y sin esto se vería como "Error interno
    // del servidor".
    //
    // 🔴 La traducción va del lado del servidor porque el mensaje crudo de
    // Postgres YA NO LLEGA a la pantalla: el router sólo deja pasar el texto de
    // los errores que escribimos nosotros. Antes esta frase la armaba la
    // pantalla buscando "violates foreign key" adentro del mensaje, y con el
    // cambio habría quedado mostrando "Error interno del servidor".
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2003") {
      return json(
        {
          error: "No se puede eliminar: hay otros datos que dependen de este tratamiento.",
        },
        409,
      );
    }
    throw error;
  }

  const salida: RtaMediaSacada = { sacadas: media };
  return json(salida);
}

/**
 * Sólo sirve para cortar la transacción de arriba: no lleva mensaje porque el
 * mensaje se arma afuera, con la cuenta a la vista.
 */
class ErrorDeTurnosPorVenir extends Error {}
