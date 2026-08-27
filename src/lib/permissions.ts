/**
 * Los accesos que la dueña puede tildarle a una empleada.
 *
 * Los `value` tienen que coincidir exactamente con el enum app_permission de la
 * migración 20260813070000: la base los valida y un typo acá se convierte en un
 * error de Postgres en pantalla.
 *
 * Sobre `enforcement`: los siete los sostiene la RLS, o sea que valen aunque
 * alguien le pegue directo a la API con la clave publishable (que es pública y
 * viaja en el bundle).
 *
 * Hasta la migración 20260814010000 dos de ellos no: 'clients_notes' y
 * 'stock_costs' escondían UNA COLUMNA —profiles.notes y products.cost— y la RLS
 * es row-level, puede decidir si ves un producto pero no si ves su costo.
 * Filtraban sólo en la interfaz, así que entrando por URL o pegándole a la API
 * el dato aparecía igual. Esa migración los mudó a client_notes y
 * product_costs: ahora lo protegido es una FILA, que es lo que la RLS sabe
 * hacer.
 *
 * El campo se deja aunque hoy todos digan "db": si mañana aparece un permiso
 * que sólo se pueda filtrar en pantalla, la etiqueta que lo avisa ya existe y
 * no se cuela sin que nadie lo note.
 */
export const PERMISSIONS = [
  {
    value: "appointments",
    label: "Gestionar turnos",
    description: "Ver la agenda completa, confirmar, cancelar y cargar turnos telefónicos.",
    enforcement: "db",
    // La policy de profiles acepta 'clients_contact' O 'appointments': la
    // pantalla de turnos muestra el nombre y el teléfono de quien reservó, y
    // sin eso la agenda sería una lista de "—". O sea que gestionar turnos ya
    // da acceso a la ficha, con o sin la otra casilla tildada.
    //
    // Se declara acá para que la pantalla lo muestre en vez de ofrecer una
    // casilla que promete un candado inexistente.
    implies: ["clients_contact"],
  },
  {
    value: "clients_contact",
    label: "Ver datos de clientas",
    description:
      "La ficha completa: teléfono, historial y las notas clínicas — alergias, embarazos y antecedentes.",
    enforcement: "db",
  },
  /*
   * 27/8/2026 — 'clients_notes' se absorbió adentro de 'clients_contact'.
   *
   * Eran dos casillas y ahora es una sola, decidido por la dueña. En la
   * práctica nadie tenía una sin la otra por un motivo pensado: la ficha de una
   * clienta se abre entera o no se abre, y la dueña tenía que acordarse de
   * tildar dos cosas para dar un acceso que ella piensa como uno.
   *
   * ⚠️ Y con esto las notas clínicas pasan a estar al alcance de quien tiene
   * 'appointments', por el `implies` de arriba. Es deliberado y lo decidió la
   * dueña: quien maneja la agenda ve todo de la clienta. Antes las notas tenían
   * candado propio. Si algún día hay que volver a separarlas —una recepcionista
   * que atiende el teléfono no necesita saber quién está embarazada— lo que hay
   * que hacer es desactivar esta entrada y devolver los chequeos de
   * `veNotas` a `puede(acceso, "clients_notes")`.
   *
   * El valor NO se borró del enum app_permission de Postgres ni del
   * schema.prisma: sacar un valor de un enum en Postgres es una migración
   * pesada y no gana nada. Queda ahí, sin usarse. Las filas que lo tenían se
   * migraron a 'clients_contact', para que nadie perdiera lo que ya tenía.
   *
   *   {
   *     value: "clients_notes",
   *     label: "Ver notas clínicas",
   *     description: "Alergias, embarazos y antecedentes que dejó la clienta.",
   *     enforcement: "db",
   *   },
   */
  {
    value: "catalog",
    label: "Editar catálogo y precios",
    description: "Tratamientos, precios, fotos y categorías.",
    enforcement: "db",
  },
  {
    value: "stock",
    label: "Mover stock",
    description: "Cargar productos y registrar ingresos y consumos.",
    enforcement: "db",
  },
  {
    value: "stock_costs",
    label: "Ver costos de compra",
    description: "Cuánto sale cada producto.",
    enforcement: "db",
  },
  {
    value: "team",
    label: "Gestionar profesionales",
    description: "Altas, horarios de atención y qué tratamiento hace cada una.",
    enforcement: "db",
  },
] as const;

export type Permission = (typeof PERMISSIONS)[number]["value"];

/**
 * Permisos que otro permiso ya arrastra por cómo está escrita la policy.
 *
 * Sirve para que la pantalla no mienta: si tildar "Gestionar turnos" ya da
 * acceso a las fichas, la casilla "Ver datos de clientas" tiene que aparecer
 * tildada y sin poder destildarse, en vez de sugerir que el dato está tapado.
 */
export function impliedPermissions(granted: Iterable<Permission>): Set<Permission> {
  const implied = new Set<Permission>();
  for (const value of granted) {
    const definition = PERMISSIONS.find((p) => p.value === value);
    for (const child of (definition as { implies?: readonly Permission[] })?.implies ?? []) {
      implied.add(child);
    }
  }
  return implied;
}

/** Quién arrastra a este permiso, entre los que están tildados. */
export function impliedBy(
  permission: Permission,
  granted: Iterable<Permission>,
): Permission | undefined {
  for (const value of granted) {
    const definition = PERMISSIONS.find((p) => p.value === value);
    const children = (definition as { implies?: readonly Permission[] })?.implies ?? [];
    if (children.includes(permission)) return value;
  }
  return undefined;
}

export const PERMISSION_VALUES = PERMISSIONS.map((p) => p.value) as readonly Permission[];

export function permissionLabel(value: string): string {
  return PERMISSIONS.find((p) => p.value === value)?.label ?? value;
}

/**
 * ¿Este permiso sólo filtra en pantalla, sin respaldo en la base?
 *
 * Hoy ninguno: los siete los sostiene la RLS. Recibe `{ enforcement: string }`
 * a propósito y no el tipo literal, porque con `as const` TypeScript estrecha
 * el campo a "db" y marcaría la comparación como imposible — el chequeo
 * desaparecería justo cuando vuelva a hacer falta.
 */
export function isUiOnly(permission: { enforcement: string }): boolean {
  return permission.enforcement === "ui";
}

/**
 * Lo que hace falta para abrir una sección.
 *
 * Además de los siete permisos hay tres niveles que no son permisos:
 *
 *   "admin"  la dueña y nadie más. Es lo que no se delega.
 *   "panel"  cualquiera que trabaje en el centro, sin pedirle ninguna casilla.
 *            Sólo para lo que es de la persona y no del negocio: su propia
 *            contraseña. Una empleada a la que todavía no le tildaron nada
 *            igual tiene que poder cambiar la que le dictaron.
 *   "own_agenda"  quien tenga una ficha de profesional vinculada a su cuenta.
 *            No es una casilla que se tilde: se gana atando la ficha con la
 *            cuenta desde Accesos, y se pierde desactivando la ficha. Es el
 *            único nivel que la dueña NO pasa automáticamente — no por
 *            candado, sino porque sin ficha propia no hay agenda que mostrar.
 */
export type AccessRequirement = Permission | "admin" | "panel" | "own_agenda";

/**
 * Qué exige cada sección del panel.
 *
 * Existe porque esconder el link del menú no alcanza: escribiendo la URL a mano
 * se entraba igual. La RLS igual devolvía vacío y rechazaba las escrituras, así
 * que no era una fuga de datos, pero la empleada terminaba en una pantalla rota
 * sin saber por qué — y en los dos permisos que hoy no tienen respaldo en la
 * base ('clients_notes' y 'stock_costs') sí llegaba a ver el dato.
 *
 * El orden no importa: ninguna ruta es prefijo de otra.
 */
const ADMIN_ROUTES = [
  { path: "/admin/turnos", access: "appointments" },
  { path: "/admin/servicios", access: "catalog" },
  { path: "/admin/categorias-servicios", access: "catalog" },
  { path: "/admin/profesionales", access: "team" },
  { path: "/admin/clientes", access: "clients_contact" },
  { path: "/admin/productos", access: "stock" },
  // Internas del stock, no del catálogo público: agrupan cremas e insumos que
  // no aparecen en el sitio. Ver migración 20260814000000.
  { path: "/admin/categorias-productos", access: "stock" },
  { path: "/admin/accesos", access: "admin" },
  // Su contraseña, no el negocio: no depende de ninguna casilla.
  { path: "/admin/cuenta", access: "panel" },
  // Sus propios turnos. Tampoco depende de una casilla: depende de que la ficha
  // de la profesional esté atada a esta cuenta. Ver 20260818020000.
  { path: "/admin/mi-agenda", access: "own_agenda" },
] as const satisfies readonly { path: string; access: AccessRequirement }[];

export function requiredAccessFor(pathname: string): AccessRequirement {
  const match = ADMIN_ROUTES.find(
    (route) => pathname === route.path || pathname.startsWith(`${route.path}/`),
  );
  if (match) return match.access;

  // El calendario vive en /admin exacto, sin sufijo.
  if (pathname === "/admin" || pathname === "/admin/") return "appointments";

  // Fail-closed a propósito: una sección nueva que nadie mapeó queda sólo para
  // la dueña hasta que se decida a qué permiso pertenece. Es preferible a que
  // se abra sola para todo el equipo por el olvido de agregarla acá.
  return "admin";
}
