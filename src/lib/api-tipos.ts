/**
 * La forma de lo que viaja entre el servidor y las pantallas.
 *
 * ── POR QUÉ ESTE ARCHIVO ──────────────────────────────────────────────────
 *
 * supabase-js tipaba las consultas solo, a partir de `integrations/supabase/
 * types.ts`: si una pantalla leía una columna que no existía, TypeScript se
 * quejaba. Al pasar a `fetch`, eso se pierde entero — lo que vuelve de un
 * `await r.json()` es `any`, y `any` no se queja de nada.
 *
 * El agujero concreto que deja: el servidor cambia el nombre de un campo, la
 * pantalla sigue leyendo el viejo, todo compila, y en pantalla aparece
 * `undefined`. Es un error que sólo se encuentra mirando.
 *
 * Entonces la forma se declara **una vez, acá**, y la usan los dos lados:
 *
 *   · el controller la pone como tipo de retorno → si devuelve otra cosa, falla
 *     al compilar el servidor;
 *   · la pantalla se la pasa a `api<T>()` → si lee un campo que no está, falla
 *     al compilar la pantalla.
 *
 * ── LA REGLA DE ESTE ARCHIVO ──────────────────────────────────────────────
 *
 * **No importa nada.** Ni Prisma, ni el schema, ni nada de `@/server`. Lo
 * importan pantallas, y una pantalla que arrastre Prisma al bundle del navegador
 * rompe LA REGLA del plan. Son tipos escritos a mano y está bien que así sea:
 * es el contrato, no un reflejo de la base.
 *
 * Por eso las fechas son `string` y no `Date`: lo que sale de `JSON.parse` es
 * texto, siempre, por más que del otro lado haya sido un Date.
 */

// ─────────────────────────────────────────────────────────────────────────────
// Catálogo público
// ─────────────────────────────────────────────────────────────────────────────

/** Un tratamiento, como lo muestran el catálogo y la portada. */
export type ServicioPublico = {
  id: string;
  name: string;
  description: string | null;
  category: string;
  duration_minutes: number;
  /** Número, no Decimal: lo espera `formatMoney()`. */
  price: number;
  image_url: string | null;
};

export type MediaDeServicio = {
  id: string;
  url: string;
  kind: "image" | "video";
  position: number;
};

/** El detalle, con la galería. */
export type ServicioConGaleria = ServicioPublico & {
  /** El nombre viene del select anidado de supabase-js y se conserva. */
  service_media: MediaDeServicio[];
};

// ─────────────────────────────────────────────────────────────────────────────
// Equipo
// ─────────────────────────────────────────────────────────────────────────────

/** "09:00:00". Texto y no Date: es lo que la pantalla corta con `.slice(0, 5)`. */
export type HorarioDeAgenda = {
  weekday: number;
  start_time: string;
  end_time: string;
};

/**
 * Una ficha del equipo, como la muestra la portada.
 *
 * ── POR QUÉ TRES TIPOS Y NO UNO CON CAMPOS OPCIONALES ─────────────────────
 *
 * El primer intento fue un solo tipo con `professional_services?` y
 * `professional_schedules?`, porque no todos los endpoints los traen. El
 * resultado es que TypeScript obliga a preguntar `if (p.professional_schedules)`
 * en pantallas que SIEMPRE los piden, y esa pregunta se termina callando con un
 * `!` o un `?? []` — que es exactamente el tipo de silencio que hace que un
 * campo que dejó de venir se vea como una lista vacía en vez de como un error.
 *
 * Con un tipo por forma, cada pantalla declara qué pidió y lo que recibe está
 * garantizado.
 */
export type ProfesionalPublica = {
  id: string;
  full_name: string;
  specialty: string | null;
  bio: string | null;
  is_active: boolean;
};

/** La ficha con sus horarios de atención. La usa la página del tratamiento. */
export type ProfesionalConHorarios = ProfesionalPublica & {
  professional_schedules: HorarioDeAgenda[];
};

/** Todo: horarios y los tratamientos que hace. La usa la página del equipo. */
export type ProfesionalConDetalle = ProfesionalConHorarios & {
  /** El nombre anidado viene del select de supabase-js y se conserva. */
  professional_services: { services: { id: string; name: string } }[];
};

// ─────────────────────────────────────────────────────────────────────────────
// Las respuestas, tal cual salen
// ─────────────────────────────────────────────────────────────────────────────

export type RtaServicios = { servicios: ServicioPublico[] };
export type RtaServicio = { servicio: ServicioConGaleria };
export type RtaProfesionales = { profesionales: ProfesionalPublica[] };
export type RtaProfesionalesConHorarios = { profesionales: ProfesionalConHorarios[] };
export type RtaProfesionalesConDetalle = { profesionales: ProfesionalConDetalle[] };

// ─────────────────────────────────────────────────────────────────────────────
// Categorías
// ─────────────────────────────────────────────────────────────────────────────

export type Categoria = { id: string; name: string };

export type RtaCategorias = { categorias: Categoria[] };

/**
 * Cuántos tratamientos (o productos) usa cada categoría, por nombre.
 *
 * ⚠️ Un objeto y no un `Map`, que es lo que la pantalla venía usando: los Map
 * no sobreviven a `JSON.stringify` — salen como `{}`, sin error y sin aviso.
 * La pantalla lo vuelve a convertir en Map para no tener que tocar el
 * componente que lo consume.
 */
export type RtaUsoDeCategorias = { uso: Record<string, number> };

// ─────────────────────────────────────────────────────────────────────────────
// Catálogo desde el panel
// ─────────────────────────────────────────────────────────────────────────────

/** Un tratamiento como lo ve la dueña: incluye los despublicados. */
export type ServicioAdmin = ServicioPublico & {
  is_published: boolean;
  service_media: MediaDeServicio[];
};

export type RtaServiciosAdmin = { servicios: ServicioAdmin[] };

/** Lo que manda el formulario. Las fotos nuevas todavía no tienen id. */
export type MediaAGuardar = { id?: string; url: string; kind: "image" | "video" };

/**
 * Los archivos que dejaron de estar referenciados.
 *
 * Los devuelve el servidor **después** de guardar, para que la pantalla recién
 * entonces los borre de Cloudinary. Al revés —borrar el archivo y después
 * guardar— una falla dejaría la galería apuntando a archivos inexistentes.
 */
export type RtaMediaSacada = { sacadas: { url: string; kind: "image" | "video" }[] };

// ─────────────────────────────────────────────────────────────────────────────
// Stock
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Un producto del depósito.
 *
 * `cost` viene en `null` por dos motivos distintos que la pantalla sí sabe
 * distinguir —porque conoce el permiso— pero el tipo no: o no hay costo cargado,
 * o quien pregunta no tiene `stock_costs`. **El servidor no dice cuál de los
 * dos**, y es a propósito: contestar "hay un costo pero no te lo muestro" ya es
 * contar algo.
 */
export type ProductoAdmin = {
  id: string;
  name: string;
  brand: string | null;
  category: string;
  unit: string;
  stock: number;
  min_stock: number;
  cost: number | null;
};

export type RtaProductos = { productos: ProductoAdmin[] };

// ─────────────────────────────────────────────────────────────────────────────
// Equipo, desde el panel
// ─────────────────────────────────────────────────────────────────────────────

/** Un horario con su id, que la pantalla necesita para poder editarlo. */
export type HorarioConId = HorarioDeAgenda & { id: string };

/**
 * La ficha completa, como la ve quien tiene `team`.
 *
 * Incluye `user_id`, al revés que `ProfesionalPublica`: la pantalla lo usa para
 * saber si ya se le dio acceso al panel. En el sitio público no va, porque diría
 * qué profesional tiene cuenta.
 */
export type ProfesionalAdmin = {
  id: string;
  full_name: string;
  specialty: string | null;
  bio: string | null;
  is_active: boolean;
  user_id: string | null;
  professional_services: {
    id: string;
    service_id: string;
    services: { id: string; name: string };
  }[];
  professional_schedules: HorarioConId[];
};

export type RtaProfesionalesAdmin = { profesionales: ProfesionalAdmin[] };

/** El selector de tratamientos del formulario del equipo. */
export type RtaServiciosParaElegir = {
  servicios: { id: string; name: string; category: string }[];
};

/**
 * Turnos futuros por profesional.
 *
 * ⚠️ Viene **vacío** —y no con un error— para quien no tiene el permiso
 * `appointments`. Es lo que pasaba con la RLS y la pantalla ya lo contempla: sin
 * ese permiso el aviso simplemente no aparece.
 */
export type RtaTurnosProximos = { turnos: Record<string, number> };
