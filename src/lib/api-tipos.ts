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
  /**
   * Los minutos de limpieza que este tratamiento pide después.
   *
   * Hace falta en la pantalla: sin él, `buildSlots` no sabe cada cuánto
   * encadenar los horarios. Ver `services.buffer_minutes`.
   */
  buffer_minutes: number;
  /**
   * Número, no Decimal: lo espera `formatMoney()`.
   *
   * Con variantes cargadas, éste es el precio del tratamiento "a secas" y lo
   * que se muestra es el más barato de las opciones, con un "desde" adelante.
   * Ver `precioDesde()` en src/lib/shiraf.ts.
   */
  price: number;
  image_url: string | null;
  /** Las opciones activas. Vacía en el tratamiento que no tiene. */
  variants: VarianteDeServicio[];
  /**
   * Cuántas sesiones son y cada cuántos días.
   *
   * 1 y 0 en casi todo el catálogo, y ahí no se muestra nada. Con más de una,
   * la clienta reserva la PRIMERA y el centro le agenda las siguientes: el
   * intervalo es lo que el panel propone, no un candado.
   *
   * El precio es el del tratamiento completo, no el de cada sesión.
   */
  sessions_count: number;
  session_interval_days: number;
};

/**
 * Una opción del tratamiento: "Solo espalda", "Cuerpo completo".
 *
 * La lista viene **vacía** en la enorme mayoría de los tratamientos, que no
 * tienen opciones. Vacía y no ausente: así ninguna pantalla tiene que preguntar
 * si el campo vino, y `variants.length > 0` es la única pregunta que hay que
 * hacerse en todos lados. Ver `service_variants` en el esquema.
 *
 * En el catálogo público salen **sólo las activas**: una opción apagada existe
 * para que el historial de turnos siga teniendo sentido, no para reservarla.
 */
export type VarianteDeServicio = {
  id: string;
  name: string;
  duration_minutes: number;
  buffer_minutes: number;
  /** Número, no Decimal: lo espera `formatMoney()`. */
  price: number;
};

/** La opción como la ve el panel: también las apagadas, y en su orden. */
export type VarianteAdmin = VarianteDeServicio & { is_active: boolean };

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
 * Un tramo en que una profesional no atiende, con los dos extremos incluidos.
 *
 * Las fechas son "YYYY-MM-DD" y no instantes: un día de ausencia es un día del
 * almanaque del centro. Así se comparan como texto, que ordena igual que como
 * fechas y no arrastra ninguna zona horaria. Ver `professional_absences`.
 */
export type AusenciaDeAgenda = {
  id: string;
  starts_on: string;
  ends_on: string;
  /** Interno: no sale en ningún mail ni en el sitio público. */
  reason: string | null;
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

/**
 * Un tratamiento como lo ve la dueña: incluye los despublicados.
 *
 * `Omit<…, "variants">` para poder pisar el tipo de la lista: el panel ve
 * también las opciones apagadas, y necesita el `is_active` de cada una para
 * poder prenderlas de nuevo.
 */
export type ServicioAdmin = Omit<ServicioPublico, "variants"> & {
  is_published: boolean;
  service_media: MediaDeServicio[];
  variants: VarianteAdmin[];
};

export type RtaServiciosAdmin = { servicios: ServicioAdmin[] };

/** Lo que manda el formulario. Las fotos nuevas todavía no tienen id. */
export type MediaAGuardar = { id?: string; url: string; kind: "image" | "video" };

/**
 * Una opción tal como quedó en el formulario. Las nuevas no traen `id`.
 *
 * El orden de la lista ES el orden en que se muestran: el servidor escribe
 * `position` por el índice, igual que hace con la galería.
 */
export type VarianteAGuardar = {
  id?: string;
  name: string;
  duration_minutes: number;
  buffer_minutes: number;
  price: number;
  is_active: boolean;
};

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
  /**
   * Los días que avisó que no viene, de hoy en adelante.
   *
   * Las viejas no vienen: la pantalla es para decidir qué se puede reservar,
   * y unas vacaciones de marzo ahí sólo son ruido. Quedan en la base igual.
   */
  professional_absences: AusenciaDeAgenda[];
};

export type RtaProfesionalesAdmin = { profesionales: ProfesionalAdmin[] };

/**
 * Lo que vuelve al cargar una ausencia.
 *
 * `turnos_en_pie` es la parte que importa: la ausencia SE GUARDA igual, y
 * estos son los turnos que ya estaban dados dentro del rango y que nadie tocó.
 * No se cancelan solos a propósito — son clientas con un turno confirmado por
 * mail, y cancelarlas en masa sin que la dueña lo pida no se puede deshacer.
 *
 * Viene vacío cuando no hay ninguno, que es el caso normal.
 */
export type RtaAusenciaGuardada = {
  ausencia: AusenciaDeAgenda;
  turnos_en_pie: {
    id: string;
    starts_at: string;
    /** El nombre de la clienta, o el de la invitada que cargó el centro. */
    quien: string;
    tratamiento: string;
  }[];
};

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
 * `notes` viene en null si no hay nota o si no se tiene `clients_contact` —ni
 * `appointments`, que desde el 27/8/2026 también las alcanza—, igual
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

/**
 * El alta de una clienta hecha desde el panel.
 *
 * `avisoMail` sólo viene cuando el mail de confirmación NO salió. La cuenta
 * quedó creada igual y la clienta puede entrar —la contraseña se la dio el
 * centro—; lo que le falta es confirmar la dirección, que es lo que le suma los
 * turnos que haya sacado antes como invitada.
 */
export type RtaAltaDeClienta = {
  ok: true;
  id: string;
  email: string;
  avisoMail?: string;
};

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
  /**
   * El margen de limpieza, congelado en el turno.
   *
   * Lo necesita «Reprogramar», que arma los horarios con `buildSlots` y sin
   * esto no sabría cada cuánto encadenarlos.
   */
  buffer_minutes: number;
  client_notes: string | null;
  // `category` es null cuando el tratamiento ya no está en el catálogo. `name`
  // y `price` no: el turno los tiene congelados desde el día que se reservó.
  services: { name: string; price: number; category: string | null };
  professionals: { full_name: string } | null;
  /** Para «Reprogramar»: con éste se busca quién hace ese tratamiento. */
  service_id: string | null;
  /** La profesional actual, para dejarla preseleccionada. */
  professional_id: string | null;
  /**
   * Qué sesión es y de cuántas. 1 de 1 en un tratamiento normal.
   *
   * Con más de una, el precio de las que no son la primera es 0 —el paquete se
   * cobró entero en la primera— y la pantalla escribe "Incluida" en vez del
   * número, que se leería como un error.
   */
  session_number: number;
  sessions_total: number;
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
  /**
   * El id de la profesional y el margen del turno.
   *
   * No se muestran: los usa el buscador de horarios libres cuando desde esta
   * misma tabla se agenda la sesión siguiente. Sin el id no hay agenda a la que
   * preguntarle, y sin el margen los huecos saldrían más juntos de lo que la
   * cabina permite.
   */
  professional_id: string | null;
  buffer_minutes: number;
  person: PersonaDelTurno;
  /**
   * Qué sesión de la serie es, y de cuántas. 1 de 1 en un tratamiento normal.
   *
   * Con `sessions_total > 1` la fila lo muestra, y el precio de una sesión que
   * no es la primera va en 0 a propósito: el paquete se cobra una sola vez, en
   * la primera. Ver `validarTurno`.
   */
  session_number: number;
  sessions_total: number;
  /**
   * Si la sesión siguiente de esta serie ya está agendada.
   *
   * Lo resuelve el servidor, que es el único que puede mirar la serie entera de
   * una sin que la pantalla haga una consulta por fila. Es lo que decide si se
   * ofrece el botón de agendarla.
   */
  next_session_booked: boolean;
  /**
   * Cuándo caería la sesión siguiente, según el intervalo del tratamiento.
   *
   * Es una PROPUESTA, no una fecha reservada: el diálogo la trae escrita y el
   * centro la corrige si la clienta no puede. La calcula el servidor —fecha de
   * este turno más los días del tratamiento— para que el intervalo se lea de un
   * solo lugar. Null si el tratamiento se borró del catálogo o si no hay
   * intervalo cargado.
   */
  next_session_suggested_at: string | null;
};

export type RtaTurnos = { turnos: TurnoDelPanel[] };

/**
 * Un turno de mañana, en la pantalla de Avisos.
 *
 * Trae menos que `TurnoDelPanel` porque esta pantalla no decide nada sobre el
 * turno —no confirma, no cancela, no cobra—: sólo hay que poder redactar el
 * recordatorio y ver a quién se le manda. Por eso no viajan ni el precio ni el
 * estado: son todos confirmados, si no no estarían en la lista.
 *
 * La forma de `services`, `professionals` y `person` es la que espera
 * `toNotifiable()`, a propósito: así el mensaje lo arma la misma función que en
 * las otras dos pantallas y no hay una tercera redacción del mismo texto.
 */
export type TurnoParaAvisar = {
  id: string;
  starts_at: string;
  duration_minutes: number;
  /** Alergias, embarazos, lo que la clienta dejó escrito. */
  client_notes: string | null;
  /**
   * Cuándo salió el recordatorio **por mail**, o null si todavía no salió.
   *
   * ⚠️ No dice nada del WhatsApp. Esa marca no existe: el WhatsApp se manda a
   * mano y nadie puede saber desde acá si la persona apretó enviar.
   */
  reminded_at: string | null;
  services: { name: string } | null;
  professionals: { full_name: string } | null;
  person: PersonaDelTurno;
};

/** `dia` en AAAA-MM-DD y hora de Buenos Aires, para poder escribirlo en pantalla. */
export type RtaAvisosDeManana = { dia: string; turnos: TurnoParaAvisar[] };

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
  /**
   * El margen de limpieza congelado en el turno.
   *
   * Lo pide el buscador de horarios de «Reprogramar»: sin él los huecos
   * saldrían más juntos de lo que la cabina permite.
   */
  buffer_minutes: number;
  /** El precio del día en que se reservó, NO el actual del catálogo. */
  price: number;
  client_notes: string | null;
  admin_notes: string | null;
  /**
   * Por qué se canceló. Sólo tiene algo si el turno está cancelado y quien lo
   * canceló escribió el motivo — es opcional en las dos puntas.
   *
   * ⚠️ NO es una nota interna: cuando cancela el centro, este texto es el que
   * la clienta recibió en el mail. La ficha lo dice al mostrarlo, para que
   * nadie lo lea como algo que quedó puertas adentro.
   */
  cancel_reason: string | null;
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
  /**
   * Todas las sesiones de la serie, para la línea de tiempo — este turno
   * incluido. Vacía en un tratamiento de una sola sesión, que es la enorme
   * mayoría: mismo patrón que `variants: []` en el catálogo, para no tener que
   * preguntar si la clave vino.
   */
  sesiones: SesionDeLaSerie[];
};

/** Una sesión dentro de la línea de tiempo de un turno de varias. */
export type SesionDeLaSerie = {
  id: string;
  session_number: number;
  starts_at: string;
  /** La necesita `EstadoTurno` para calcular "Vencido": hace falta saber cuándo TERMINA. */
  duration_minutes: number;
  status: string;
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
  /**
   * Cuánto dura. No lo usa la grilla para dibujar —las pastillas son todas del
   * mismo alto— sino `estadoVisible`, que necesita saber cuándo TERMINA el turno
   * para no marcarlo vencido mientras está pasando. Ver `yaVencio`.
   */
  duration_minutes: number;
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

// ───────────────────────────────────────────────────────────────────────
// Métricas
// ───────────────────────────────────────────────────────────────────────

/** Una fila de ranking: cuántas veces y cuánta plata. */
export type FilaConTotal = { nombre: string; cantidad: number; total: number };

/**
 * Lo que devuelve `/api/metricas`. Lo dibujan el Dashboard y la sección
 * Métricas: el Dashboard es un recorte de esto con el rango puesto en el mes.
 *
 * Vive acá y no en `metricas.service.ts` por la misma razón que el resto de este
 * archivo: es el contrato entre las dos puntas. El servicio lo importa y lo
 * cumple con `satisfies`, así que si alguien le agrega un campo al cálculo sin
 * declararlo acá —o al revés— no compila. Al derecho no se puede: el servicio
 * importa Prisma, y con la flecha apuntando para allá una pantalla terminaría
 * arrastrando el cliente de la base a su grafo de imports.
 */
export type RtaMetricas = {
  rango: { desde: string; hasta: string };
  plata: {
    /** Cobrado: sólo los turnos en estado `completed` del rango. */
    facturado: number;
    /** Lo que viene: turnos futuros sin cancelar. Todavía no es plata. */
    agendado: number;
    ticketPromedio: number;
    turnosRealizados: number;
    porTratamiento: FilaConTotal[];
    porProfesional: FilaConTotal[];
    porMes: { mes: string; facturado: number; turnos: number }[];
  };
  agenda: {
    /**
     * Minutos vendidos sobre minutos de agenda abierta.
     *
     * `minutosDisponibles` en 0 NO es 0% de ocupación: es una profesional sin
     * horarios cargados. La pantalla los distingue, porque son dos problemas
     * distintos y uno de los dos se arregla en Profesionales.
     */
    ocupacion: {
      nombre: string;
      minutosVendidos: number;
      minutosDisponibles: number;
      porcentaje: number;
    }[];
    /** Cuándo se piden turnos. `dia`: 0 = domingo. `hora`: 0..23. */
    mapaDiaHora: { dia: number; hora: number; cantidad: number }[];
    /** Cuántos días antes reservan, en promedio. Null si no hubo turnos. */
    anticipacionPromedioDias: number | null;
  };
  clientas: {
    frecuentes: {
      nombre: string;
      telefono: string | null;
      visitas: number;
      ultima: string;
      total: number;
    }[];
    /** Cuenta CLIENTAS y no turnos: la que vino tres veces en el mes es una. */
    nuevasPorMes: { mes: string; nuevas: number; repetidas: number }[];
    /** Habituales que dejaron de venir y no tienen nada agendado. */
    enRiesgo: {
      nombre: string;
      telefono: string | null;
      visitas: number;
      ultima: string;
      diasSinVenir: number;
    }[];
    cancelacion: {
      total: number;
      canceladas: number;
      porcentaje: number;
      motivos: { motivo: string; cantidad: number }[];
    };
  };
  /**
   * Turnos del período cuya hora ya pasó y que siguen en pendiente o confirmado.
   *
   * No es una métrica del negocio: es una advertencia sobre las demás. Todo lo
   * que dice "facturado" y "visitas" cuenta sólo turnos en Realizado, así que
   * cada turno que se atendió y nadie cerró es plata que el panel no ve. Sin
   * este aviso, el número bajo se lee como "vendimos poco" en vez de "falta
   * cerrar turnos", que es una conclusión muy distinta y muy cara.
   */
  alertas: {
    vencidosSinCerrar: number;
    /** Cuánta plata representan esos turnos, si se cerraran. */
    montoSinCerrar: number;
  };
  /** Los ocho que vienen. Ignoran el rango: la pregunta es "qué viene ahora". */
  proximosTurnos: {
    id: string;
    empiezaEn: string;
    tratamiento: string;
    clienta: string | null;
    profesional: string | null;
    estado: string;
  }[];
};

/**
 * Lo que hace falta para dibujar los horarios libres de un día.
 *
 * ⚠️ De los turnos ajenos viaja **sólo cuándo empiezan y cuánto duran**. Nunca
 * de quién son ni de qué. Es la misma frontera que ponía la función
 * `professional_busy_slots` en la base.
 */
export type RtaDisponibilidad = {
  schedules: HorarioDeAgenda[];
  /**
   * Cuándo, cuánto y con cuánto margen — y nada más. Ver el 🔴 de
   * `disponibilidad()`: quién reservó y de qué no son asunto de quien está
   * eligiendo horario.
   *
   * `buffer_minutes` es el DEL TURNO, congelado, no el del tratamiento que se
   * está por reservar: entre dos turnos manda el margen del que termina.
   */
  busy: { starts_at: string; duration_minutes: number; buffer_minutes: number }[];
  /**
   * Los días que esa profesional no está, dentro de la ventana consultada.
   *
   * Van aparte de `schedules` a propósito: el horario semanal sigue diciendo
   * que trabaja los martes, y esto es la excepción que lo tapa. Mezclarlos haría
   * imposible distinguir "ese día no trabaja nunca" de "ese día no viene".
   */
  ausencias: { starts_on: string; ends_on: string }[];
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
    /** El margen de limpieza, para que el panel encadene igual que /reservar. */
    buffer_minutes: number;
    price: number;
    is_published: boolean;
    /** Cuántas sesiones son y cada cuántos días. 1 y 0 en casi todo el catálogo. */
    sessions_count: number;
    session_interval_days: number;
    /**
     * Las opciones activas del tratamiento. Vacía en el que no tiene.
     *
     * El panel las necesita por lo mismo que la reserva: con opciones cargadas,
     * el turno no tiene precio ni duración hasta que se elige una, y el
     * servidor rechaza el alta que no la traiga.
     */
    variants: VarianteDeServicio[];
  }[];
};

/** A qué turnos alcanza corregir los datos de una invitada. */
export type RtaAlcanceInvitada = { ids: string[] };

/** Cuántos turnos tocó la operación. */
export type RtaCorreccion = {
  count: number;
  /**
   * Cuántos de esos turnos, además de corregirse, pasaron al historial de una
   * clienta con cuenta. Sólo puede ser > 0 en `corregirInvitada`, y sólo cuando
   * el mail corregido es el de una cuenta con el mail ya confirmado.
   */
  vinculados?: number;
};

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
