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
  /**
   * La pieza legible de la URL: "drenaje-linfatico".
   *
   * `null` sólo en una fila que haya entrado por fuera del panel y que
   * `scripts/rellenar-slugs.ts` todavía no haya tocado. Es opcional en la base
   * y por eso también acá: si el tipo dijera `string`, la pantalla armaría
   * `/servicios/null` sin que TypeScript dijera nada. Declarado así, el
   * compilador obliga a elegir el reemplazo — y el reemplazo es el `id`, que la
   * ficha sigue aceptando.
   */
  slug: string | null;
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

// ─────────────────────────────────────────────────────────────────────────────
// Clientas
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Una clienta en la lista del panel.
 *
 * `notes` viene en null si no hay nota o si no se tiene `clients_notes`, igual
 * que el costo en el stock. Y `total`/`done`/`last` vienen en cero para quien
 * no tiene `appointments`: es lo que hacía la policy, no un dato faltante.
 */
export type ClientaEnLista = {
  id: string;
  full_name: string | null;
  phone: string | null;
  created_at: string;
  notes: string | null;
  total: number;
  done: number;
  last?: string;
};

export type RtaClientas = { clientas: ClientaEnLista[] };

/** Los ids de las cuentas del centro, para no confundirlas con clientas. */
export type RtaEquipo = { ids: string[] };

export type MiFicha = {
  id: string;
  full_name: string | null;
  phone: string | null;
  /** "1990-05-23". Sólo la fecha: la columna es `date`. */
  birth_date: string | null;
  notes: string;
};

export type RtaMiCuenta = { ficha: MiFicha | null };

export type MiTurno = {
  id: string;
  starts_at: string;
  status: string;
  duration_minutes: number;
  client_notes: string | null;
  // `category` es null cuando el tratamiento ya no está en el catálogo. `name`
  // y `price` no: el turno los tiene congelados desde el día que se reservó.
  services: { name: string; price: number; category: string | null };
  professionals: { full_name: string } | null;
  /** Para «Reprogramar»: con éste se busca quién hace ese tratamiento. */
  service_id: string | null;
  /** La profesional actual, para dejarla preseleccionada. */
  professional_id: string | null;
};

export type RtaMisTurnos = { turnos: MiTurno[] };

// ─────────────────────────────────────────────────────────────────────────────
// Turnos
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Quién reservó, sin que la pantalla tenga que saber si tiene cuenta.
 *
 * Un turno puede ser de una clienta registrada o de una invitada que cargó el
 * centro por teléfono. Los dos casos llegan con la misma forma.
 */
export type PersonaDelTurno = { name: string; phone: string | null; isGuest: boolean };

export type TurnoDelPanel = {
  id: string;
  starts_at: string;
  status: string;
  duration_minutes: number;
  client_notes: string | null;
  client_id: string | null;
  guest_name: string | null;
  guest_phone: string | null;
  guest_email: string | null;
  services: { name: string; price: number };
  /** `is_active` en false: ya no atiende, y este turno hay que reasignarlo. */
  professionals: { full_name: string; is_active: boolean } | null;
  /**
   * El nombre de la profesional congelado en el turno.
   *
   * Es lo único que queda cuando la ficha del equipo se borró: ahí
   * `professionals` llega en null y esto sigue diciendo quién atendió. Null en
   * los turnos que nunca tuvieron a nadie asignado.
   */
  professional_name: string | null;
  person: PersonaDelTurno;
};

export type RtaTurnos = { turnos: TurnoDelPanel[] };

/**
 * Un turno solo, con todo lo que hace falta para decidir sobre él.
 *
 * Es lo mismo que una fila de la tabla más lo que ahí no entraba: el mail de
 * quien reservó, la duración, el precio congelado, cuándo se pidió el turno y
 * la nota interna del centro. Ninguno de esos campos es nuevo en la base —
 * `admin_notes` estaba escrito desde la primera migración y no se mostraba en
 * ninguna pantalla.
 *
 * El precio viaja como número: en la base es DECIMAL y Prisma lo entrega como
 * objeto. Lo convierte `comoNumero` en el controller, igual que en la lista.
 */
export type TurnoEnDetalle = {
  id: string;
  starts_at: string;
  status: string;
  duration_minutes: number;
  /** El precio del día en que se reservó, NO el actual del catálogo. */
  price: number;
  client_notes: string | null;
  admin_notes: string | null;
  created_at: string;
  client_id: string | null;
  guest_name: string | null;
  guest_phone: string | null;
  guest_email: string | null;
  /** El de la cuenta si la tiene; el de invitada si no. Puede no haber ninguno. */
  email: string | null;
  /**
   * El nombre SIEMPRE está: sale congelado del turno si el tratamiento ya no
   * está en el catálogo. `id` y `price` son los del catálogo, así que se van a
   * null cuando el tratamiento se borró — `price` acá es el de HOY, el que se
   * cobró está en `price` del turno.
   */
  services: { id: string | null; name: string; price: number | null };
  /** `is_active` en false: ya no atiende, y este turno hay que reasignarlo. */
  professionals: { id: string; full_name: string; is_active: boolean } | null;
  /** Ver `professional_name` en TurnoDelPanel: quién atendió, congelado. */
  professional_name: string | null;
  person: PersonaDelTurno;
};

export type RtaTurnoEnDetalle = { turno: TurnoEnDetalle };
/**
 * Los contadores del panel.
 *
 * `total` son los turnos sin contestar; `sinProfesional`, los que se van a
 * atender y no tienen a quién — ni asignada, ni una que siga atendiendo. El
 * segundo es trabajo pendiente del centro, no un aviso: hasta que no se
 * resuelva, ese día no hay nadie para atender a la clienta.
 */
export type RtaPendientes = { total: number; sinProfesional: number };

export type TurnoDelCalendario = {
  id: string;
  starts_at: string;
  status: string;
  /** Siempre está: si el tratamiento se borró, sale el nombre congelado. */
  services: { name: string };
  /** `is_active` en false: ya no atiende, y este turno hay que reasignarlo. */
  professionals: { full_name: string; is_active: boolean } | null;
  /** Ver `professional_name` en TurnoDelPanel: quién atendió, congelado. */
  professional_name: string | null;
  /** De quién es el turno: con cuenta o invitada, la misma forma para las dos. */
  person: PersonaDelTurno;
};

export type RtaCalendario = { turnos: TurnoDelCalendario[] };

/**
 * Una fila de «Mi agenda».
 *
 * Los nombres son los que devolvía la función `my_agenda()` de la base y se
 * conservan para no tener que tocar el JSX de esa pantalla.
 */
export type FilaDeMiAgenda = {
  appointment_id: string;
  appointment_start: string;
  appointment_minutes: number;
  appointment_state: string;
  service_name: string;
  client_name: string | null;
  client_phone: string | null;
  clinical_notes: string | null;
  booking_note: string | null;
  client_is_guest: boolean;
};

export type RtaMiAgenda = { turnos: FilaDeMiAgenda[] };

/**
 * Lo que hace falta para dibujar los horarios libres de un día.
 *
 * ⚠️ De los turnos ajenos viaja **sólo cuándo empiezan y cuánto duran**. Nunca
 * de quién son ni de qué. Es la misma frontera que ponía la función
 * `professional_busy_slots` en la base.
 */
export type RtaDisponibilidad = {
  schedules: HorarioDeAgenda[];
  busy: { starts_at: string; duration_minutes: number }[];
};

export type RtaClientasParaElegir = {
  clientas: { id: string; full_name: string | null; phone: string | null }[];
};

/** Los tratamientos del formulario del panel: vienen TODOS, con la marca. */
export type RtaServiciosParaTurno = {
  servicios: {
    id: string;
    name: string;
    category: string;
    duration_minutes: number;
    price: number;
    is_published: boolean;
  }[];
};

/** A qué turnos alcanza corregir los datos de una invitada. */
export type RtaAlcanceInvitada = { ids: string[] };

/** Cuántos turnos tocó la operación. */
export type RtaCorreccion = { count: number };

/** Una empleada, con sus accesos tildados. */
export type RtaEmpleadas = {
  empleadas: {
    id: string;
    full_name: string;
    phone: string | null;
    email: string;
    /** Si está en false, la cuenta está dada de baja y no puede entrar. */
    is_active: boolean;
    permissions: string[];
  }[];
};

/**
 * Las profesionales a las que se le puede pasar un turno.
 *
 * `libre` dice si tiene ese horario disponible. Es una ayuda para elegir, no la
 * regla: la superposición la decide la base al escribir, dentro de la misma
 * transacción. Ver `profesionalesParaElTurno`.
 */
export type RtaProfesionalesParaElTurno = {
  profesionales: { id: string; full_name: string; libre: boolean }[];
};

/**
 * La ficha completa de una clienta, para el panel lateral de Clientes.
 *
 * `puedeVerNotas` y `puedeVerTurnos` los decide el SERVIDOR y viajan para que la
 * pantalla sepa distinguir «no hay nada anotado» de «no te corresponde verlo».
 * Sin esa diferencia, una empleada con el contacto pero sin las notas vería una
 * ficha que dice "sin notas" y creería que la clienta no tiene ninguna.
 */
export type FichaDeClienta = {
  id: string;
  full_name: string | null;
  phone: string | null;
  /** "1990-05-23". Sólo la fecha: la columna es `date`. */
  birth_date: string | null;
  created_at: string;
  /** null si la clienta no tiene cuenta (la cargó el centro como invitada). */
  email: string | null;
  /** null sin cuenta; false si la cuenta está dada de baja. */
  cuentaActiva: boolean | null;
  notes: string | null;
  puedeVerNotas: boolean;
  puedeVerTurnos: boolean;
  turnos: {
    id: string;
    starts_at: string;
    status: string;
    price: number;
    /** Congelado: sigue diciendo qué fue aunque el tratamiento ya no exista. */
    service: string;
    professional: string | null;
  }[];
};

export type RtaFichaDeClienta = { clienta: FichaDeClienta };
