import { prisma } from "@/server/db";
import { json, type Ctx } from "@/server/http";
import type {
  HorarioDeAgenda,
  RtaProfesionales,
  RtaProfesionalesConDetalle,
  RtaProfesionalesConHorarios,
  RtaServicio,
  RtaServicios,
} from "@/lib/api-tipos";

/**
 * Lo que ve cualquiera, sin cuenta.
 *
 * El catálogo, las fichas del equipo y sus horarios. Es lo que en Supabase
 * cubrían las policies `TO anon`:
 *
 *   · `published services anon`       → sólo `is_published`
 *   · `active professionals anon`     → sólo `is_active`
 *   · `published service media anon`  → sólo si su tratamiento está publicado
 *   · `professional services public`  → abierta
 *   · `schedules public`              → abierta
 *
 * ── 🔴 EL FILTRO ES LA REGLA DE SEGURIDAD, NO UNA COMODIDAD ───────────────
 *
 * Cada `is_published: true` y cada `is_active: true` de este archivo **es** una
 * de esas policies. Sacar uno no muestra "un poco más de datos": publica el
 * catálogo que la dueña todavía está armando, con precios que no decidió.
 *
 * Por eso ninguna consulta de acá acepta un filtro que venga del pedido para
 * esas dos columnas. Los `limite` y `orden` que sí se aceptan sólo recortan y
 * ordenan lo que ya pasó el filtro.
 */

// ─────────────────────────────────────────────────────────────────────────────
// Serialización
// ─────────────────────────────────────────────────────────────────────────────

/**
 * ⚠️ Estas dos funciones existen para que las pantallas NO se enteren de que
 * cambió la base, y hay que usarlas siempre.
 *
 * supabase-js entregaba `numeric` como number y `time` como "09:00:00". Prisma
 * entrega `Decimal` y `Date`. Si sale tal cual:
 *
 *   · `formatMoney(price)` recibe un objeto y escribe "[object Object]";
 *   · `s.start_time.slice(0, 5)` explota, porque un Date no tiene `.slice`.
 *
 * Ninguna de las dos lo detecta TypeScript del otro lado —lo que viaja por
 * `fetch` es `any`—, así que el error aparece recién en la pantalla.
 */
function comoNumero(valor: { toNumber(): number }): number {
  return valor.toNumber();
}

/** Un `@db.Time` de Prisma es un Date en el epoch: lo que vale es la hora. */
function comoHora(valor: Date): string {
  return valor.toISOString().slice(11, 19);
}

const CAMPOS_DEL_CATALOGO = {
  id: true,
  name: true,
  description: true,
  category: true,
  duration_minutes: true,
  price: true,
  image_url: true,
} as const;

/**
 * Cuántas filas devolver.
 *
 * Siempre un número, nunca `undefined`: además de que `take: undefined` no
 * compila con `exactOptionalPropertyTypes`, un endpoint público sin techo es
 * una invitación a que alguien lo use de exportador. El tope es holgado —el
 * catálogo entero son 6 tratamientos— así que en la práctica no recorta nada.
 *
 * Un `?limite=` inválido se ignora en vez de fallar: es lo que le pasaría a
 * alguien que se equivocó tipeando la URL, y no amerita un error.
 */
const TOPE = 200;

function limiteDe(ctx: Ctx): number {
  const crudo = ctx.url.searchParams.get("limite");
  if (!crudo) return TOPE;
  const n = Number(crudo);
  return Number.isInteger(n) && n > 0 && n <= TOPE ? n : TOPE;
}

// ─────────────────────────────────────────────────────────────────────────────
// Catálogo
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Los tratamientos publicados.
 *
 * `orden=precio` existe para la portada, que muestra los seis más baratos de
 * cada categoría. El resto de las pantallas ordena por nombre.
 */
export async function listarServicios(ctx: Ctx) {
  const porPrecio = ctx.url.searchParams.get("orden") === "precio";

  const servicios = await prisma.services.findMany({
    where: { is_published: true },
    select: CAMPOS_DEL_CATALOGO,
    orderBy: porPrecio
      ? [{ category: "asc" }, { price: "asc" }]
      : [{ category: "asc" }, { name: "asc" }],
    take: limiteDe(ctx),
  });

  const salida: RtaServicios = {
    servicios: servicios.map((s) => ({ ...s, price: comoNumero(s.price) })),
  };
  return json(salida);
}

/**
 * Un tratamiento con su galería.
 *
 * Devuelve 404 y no 200-con-null si no existe o no está publicado: para quien
 * pregunta desde afuera, un tratamiento despublicado y uno inexistente tienen
 * que ser indistinguibles. Decir "existe pero no te lo muestro" filtra que la
 * dueña está preparando algo.
 */
export async function verServicio(ctx: Ctx) {
  const id = ctx.params["id"];
  if (!id) return json({ error: "Falta el tratamiento." }, 400);

  const servicio = await prisma.services.findFirst({
    where: { id, is_published: true },
    select: {
      ...CAMPOS_DEL_CATALOGO,
      media: {
        select: { id: true, url: true, kind: true, position: true },
        // El mismo orden que usa sync_service_cover para elegir la portada, así
        // la foto grande de arriba es siempre la primera de la galería.
        orderBy: [{ position: "asc" }, { created_at: "asc" }],
      },
    },
  });

  if (!servicio) return json({ error: "Ese tratamiento no está disponible." }, 404);

  const { media, ...resto } = servicio;
  const salida: RtaServicio = {
    servicio: {
      ...resto,
      price: comoNumero(servicio.price),
      // La pantalla lo lee como `service_media`, que es como lo nombraba el
      // select anidado de supabase-js. Se conserva el nombre para no tener que
      // tocar el JSX.
      service_media: media,
    },
  };
  return json(salida);
}

// ─────────────────────────────────────────────────────────────────────────────
// Equipo
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Las profesionales activas.
 *
 * Sin `detalle`, sólo la ficha —es lo que muestra la portada—. Con
 * `detalle=1` suma los tratamientos que hace y sus horarios, que es lo que
 * necesita la página de Profesionales.
 *
 * ⚠️ Nunca sale `user_id`. No lo pide ninguna pantalla pública y publicarlo
 * diría qué profesional tiene cuenta en el panel.
 */
export async function listarProfesionales(ctx: Ctx) {
  const conDetalle = ctx.url.searchParams.get("detalle") === "1";
  const where = { is_active: true } as const;
  const orderBy = { full_name: "asc" } as const;
  const take = limiteDe(ctx);

  // Cada rama arma y devuelve su propia respuesta, en vez de compartir una
  // consulta y decidir después. Escrito al revés —una constante con el
  // resultado de un ternario, y un `if` abajo— TypeScript no puede saber que
  // adentro del `if` está la forma con detalle, y sólo se sale de eso con un
  // `as` que apaga justamente la verificación que este archivo quiere tener.
  if (conDetalle) {
    const fichas = await prisma.professionals.findMany({
      where,
      select: {
        ...CAMPOS_DE_LA_FICHA,
        services: { select: { service: { select: { id: true, name: true } } } },
        schedules: {
          select: HORARIO,
          // Inline y no una constante compartida: con `as const` queda
          // readonly y Prisma no lo acepta, y el error que da habla de campos
          // inexistentes en vez del orderBy.
          orderBy: [{ weekday: "asc" }, { start_time: "asc" }],
        },
      },
      orderBy,
      take,
    });

    const salida: RtaProfesionalesConDetalle = {
      profesionales: fichas.map(({ services, schedules, ...ficha }) => ({
        ...ficha,
        professional_schedules: comoHorarios(schedules),
        professional_services: services.map((s) => ({ services: s.service })),
      })),
    };
    return json(salida);
  }

  const fichas = await prisma.professionals.findMany({
    where,
    select: CAMPOS_DE_LA_FICHA,
    orderBy,
    take,
  });

  const salida: RtaProfesionales = { profesionales: fichas };
  return json(salida);
}

/**
 * Quiénes hacen este tratamiento.
 *
 * Sólo las activas: una profesional dada de baja no tiene que seguir apareciendo
 * en la ficha de un tratamiento que hacía.
 */
export async function profesionalesDelServicio(ctx: Ctx) {
  const id = ctx.params["id"];
  if (!id) return json({ error: "Falta el tratamiento." }, 400);

  const filas = await prisma.professional_services.findMany({
    where: { service_id: id, professional: { is_active: true } },
    select: {
      professional: {
        select: {
          ...CAMPOS_DE_LA_FICHA,
          schedules: {
            select: HORARIO,
            // Inline y no una constante compartida: con `as const` queda
            // readonly y Prisma no lo acepta, y el error que da habla de campos
            // inexistentes en vez del orderBy.
            orderBy: [{ weekday: "asc" }, { start_time: "asc" }],
          },
        },
      },
    },
  });

  const salida: RtaProfesionalesConHorarios = {
    profesionales: filas
      .map(({ professional: { schedules, ...ficha } }) => ({
        ...ficha,
        professional_schedules: comoHorarios(schedules),
      }))
      // El orden va acá y no en un orderBy: el tipo de professional_services no
      // acepta ordenar por un campo de la relación. Son cuatro fichas.
      .sort((a, b) => a.full_name.localeCompare(b.full_name, "es")),
  };
  return json(salida);
}

/**
 * Los campos públicos de una ficha del equipo.
 *
 * ⚠️ Enumerados uno por uno, y nunca un `select` completo con un spread del
 * resultado. Es a propósito: agregarle mañana una columna a `professionals`
 * —una nota interna, un teléfono— la publicaría sola, sin que nadie lo decida.
 * Acá publicar un campo nuevo es una línea que alguien tiene que escribir.
 *
 * Y por eso tampoco está `user_id`: diría qué profesional tiene cuenta.
 */
const CAMPOS_DE_LA_FICHA = {
  id: true,
  full_name: true,
  specialty: true,
  bio: true,
  is_active: true,
} as const;

const HORARIO = { weekday: true, start_time: true, end_time: true } as const;

/** Los horarios con la hora como texto "09:00:00", que es lo que lee la pantalla. */
function comoHorarios(
  schedules: { weekday: number; start_time: Date; end_time: Date }[],
): HorarioDeAgenda[] {
  return schedules.map((h) => ({
    weekday: h.weekday,
    start_time: comoHora(h.start_time),
    end_time: comoHora(h.end_time),
  }));
}
