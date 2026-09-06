import {
  createFileRoute,
  Link,
  Outlet,
  redirect,
  useLocation,
  useNavigate,
} from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import {
  BellRing,
  CalendarCheck,
  CalendarDays,
  // 5/9/2026 — CalendarOff y FileText eran los íconos de «Días cerrados» y de
  // «Contenido del sitio» como secciones sueltas. Las dos se mudaron adentro
  // de Configuración, y sus íconos ahora salen de SECCIONES_DE_CONFIGURACION.
  // Quedan comentados y no borrados por la regla de este repo.
  // CalendarOff,
  ChevronDown,
  ClipboardList,
  // FileText,
  LayoutDashboard,
  LineChart,
  LogOut,
  Package,
  Settings,
  ShieldCheck,
  Sparkles,
  UserCog,
  Users,
  UserSquare,
} from "lucide-react";
import { Logo } from "@/components/logo";
import { Button } from "@/components/ui/button";
import { apiPost } from "@/lib/api";
import { useAccess } from "@/hooks/useAccess";
// 5/9/2026 — se suma el contador de los turnos en días cerrados. La línea vieja
// queda comentada por la regla de este repo.
// import { usePendingAppointments, useUnassignedAppointments } from "@/hooks/usePendingAppointments";
import {
  useAppointmentsOnClosedDays,
  usePendingAppointments,
  useUnassignedAppointments,
} from "@/hooks/usePendingAppointments";
import { SECCIONES_DE_CONFIGURACION } from "@/lib/configuracion";
import { permissionLabel, requiredAccessFor } from "@/lib/permissions";
import { puedeEntrarAlPanel } from "@/lib/sesion";

export const Route = createFileRoute("/_authenticated/admin")({
  /**
   * A la clienta se la rebota, no se le muestra una pared.
   *
   * Antes, escribir /admin en la barra estando conectada como clienta abría una
   * pantalla que decía «Acceso restringido». Técnicamente correcto y en la
   * práctica desconcertante: para quien no es del centro, /admin no es "una
   * sección que no te toca", es una dirección que no significa nada. Se la manda
   * a su cuenta, que es a donde quería llegar.
   *
   * ── POR QUÉ EN `beforeLoad` Y NO EN EL COMPONENTE ─────────────────────────
   *
   * Porque acá pasa ANTES de dibujar nada. Con un `useEffect` adentro del
   * componente, la pantalla alcanza a pintar el cartel y recién después salta —
   * un parpadeo que se lee como un error.
   *
   * La sesión ya viene resuelta por el `beforeLoad` de `_authenticated`, que es
   * el que además garantiza que acá abajo haya alguien conectada: sin sesión
   * nunca se llega hasta este punto.
   *
   * ⚠️ Esto NO es seguridad. Cada endpoint exige lo suyo del otro lado de la
   * API, y eso es lo que protege los datos. Esto es que la puerta lleve a algún
   * lado en vez de a una pared.
   */
  beforeLoad: ({ context }) => {
    if (!puedeEntrarAlPanel(context.user)) throw redirect({ to: "/mi-cuenta" });
  },
  head: () => ({
    meta: [
      { title: "Panel de administración — Shiraf" },
      {
        name: "description",
        content:
          "Gestión de turnos, servicios, profesionales, clientes y stock del centro de estética Shiraf.",
      },
      { property: "og:title", content: "Panel de administración — Shiraf" },
      {
        property: "og:description",
        content: "Administración interna de turnos, agenda, catálogo y stock.",
      },
    ],
  }),
  component: AdminLayout,
});

// Cada sección declara qué hace falta para abrirla, con el mismo vocabulario
// que requiredAccessFor: los siete permisos más "admin" (lo que no se delega),
// "panel" y "own_agenda". Antes esto era `permission` + un booleano `adminOnly`
// que obligaba a poner un permiso de mentira al lado —"appointments // ignorado:
// manda adminOnly"—, y no tenía dónde entrar un tercer nivel.
//
// "Mi agenda" va primera a propósito: para una profesional es su única sección,
// así que es también su pantalla de entrada al panel.
const nav = [
  {
    // Primera de la lista a pedido de la dueña.
    //
    // No se pisa con la nota de acá abajo sobre "Mi agenda": pide `metrics`, que
    // una profesional no tiene, así que a ella el menú le sigue abriendo en su
    // agenda. Si algún día se le tilda `metrics` a una profesional, esa persona
    // va a entrar al Dashboard — y ahí habrá que decidir cuál de las dos manda.
    to: "/admin/dashboard",
    label: "Dashboard",
    icon: LayoutDashboard,
    exact: false,
    access: "metrics",
    children: [],
  },
  {
    to: "/admin/mi-agenda",
    label: "Mi agenda",
    icon: CalendarCheck,
    exact: false,
    access: "own_agenda",
    children: [],
  },
  {
    to: "/admin",
    label: "Calendario",
    icon: CalendarDays,
    exact: true,
    access: "appointments",
    children: [],
  },
  {
    to: "/admin/turnos",
    label: "Turnos",
    icon: ClipboardList,
    exact: false,
    access: "appointments",
    children: [],
  },
  {
    // Va pegada a Turnos porque es lo mismo mirado de otra forma: la agenda de
    // mañana, ordenada para ir mandando los WhatsApp de a uno.
    to: "/admin/avisos",
    label: "Avisos",
    icon: BellRing,
    exact: false,
    access: "appointments",
    children: [],
  },
  // 5/9/2026 — «Días cerrados» nació como sección propia, acá, cerrando el
  // bloque de la agenda. El mismo día la dueña pidió una sección Configuración
  // que la agrupe con «Contenido del sitio», así que se mudó ahí abajo (y su
  // ruta pasó a /admin/configuracion/dias-cerrados). La entrada queda comentada
  // y no borrada por la regla de este repo.
  //
  //   {
  //     // Los días que el centro no abre: feriados, vacaciones de todo el equipo.
  //     // Cierra el bloque de la agenda —Calendario, Turnos, Avisos— porque es
  //     // parte de la misma decisión: qué días se puede reservar. Pide lo mismo
  //     // que Turnos y no `team`, como las ausencias de una profesional: lo que
  //     // deja en pie lo resuelve quien gestiona turnos.
  //     to: "/admin/dias-cerrados",
  //     label: "Días cerrados",
  //     icon: CalendarOff,
  //     exact: false,
  //     access: "appointments",
  //     children: [],
  //   },
  {
    to: "/admin/servicios",
    label: "Servicios",
    icon: Sparkles,
    exact: false,
    access: "catalog",
    // 5/9/2026 — cada subsección declara su acceso, porque en Configuración
    // (más abajo) piden accesos distintos entre sí y el menú las filtra de a
    // una. Acá piden lo mismo que la sección. La línea vieja, comentada:
    //   children: [{ to: "/admin/categorias-servicios", label: "Categorías" }],
    children: [{ to: "/admin/categorias-servicios", label: "Categorías", access: "catalog" }],
  },
  {
    to: "/admin/profesionales",
    label: "Profesionales",
    icon: UserSquare,
    exact: false,
    access: "team",
    children: [],
  },
  {
    to: "/admin/clientes",
    label: "Clientes",
    icon: Users,
    exact: false,
    access: "clients_contact",
    children: [],
  },
  {
    // Arriba de Productos, como se pidió. Queda además después de Clientes, que
    // es de dónde salen la mitad de estos números.
    to: "/admin/metricas",
    label: "Métricas",
    icon: LineChart,
    exact: false,
    access: "metrics",
    children: [],
  },
  {
    to: "/admin/productos",
    label: "Productos",
    icon: Package,
    exact: false,
    access: "stock",
    // Ídem Servicios: la subsección declara su acceso. La línea vieja:
    //   children: [{ to: "/admin/categorias-productos", label: "Categorías" }],
    children: [{ to: "/admin/categorias-productos", label: "Categorías", access: "stock" }],
  },
  // 5/9/2026 — «Contenido del sitio» se mudó adentro de Configuración, acá
  // abajo, y su ruta pasó a /admin/configuracion/contenido (la vieja redirige).
  // La entrada queda comentada y no borrada por la regla de este repo.
  //
  //   {
  //     // Los textos y las fotos del sitio público. Va pegada a Accesos porque es
  //     // de la misma familia: las dos cosas que no se delegan con una casilla.
  //     to: "/admin/contenido",
  //     label: "Contenido del sitio",
  //     icon: FileText,
  //     exact: false,
  //     access: "admin",
  //     children: [],
  //   },
  // 5/9/2026, más tarde — Configuración estuvo acá, entre Productos y Accesos,
  // unas horas. La dueña la vio en producción y pidió bajarla al fondo del
  // menú, pegada al pie donde está la cuenta. Ahora es la ÚLTIMA entrada de
  // esta lista (después de Accesos), y el menú la manda al fondo con `mt-auto`.
  // La entrada queda comentada y no borrada por la regla de este repo:
  //
  //   {
  //     to: "/admin/configuracion",
  //     label: "Configuración",
  //     icon: Settings,
  //     exact: true,
  //     access: "panel",
  //     children: SECCIONES_DE_CONFIGURACION.map((s) => ({
  //       to: s.to,
  //       label: s.label,
  //       access: s.access,
  //     })),
  //   },
  {
    to: "/admin/accesos",
    label: "Accesos",
    icon: ShieldCheck,
    exact: false,
    access: "admin",
    children: [],
  },
  {
    // Lo que el centro decide una vez y vale para todo (5/9/2026): qué días no
    // se abre, qué dice el sitio. Por ahora esas dos; lo que siga entra acá.
    //
    // ⚠️ Tiene que ser la ÚLTIMA de la lista. Va al fondo del menú, pegada al
    // pie donde está la cuenta y separada de las secciones del negocio por el
    // espacio que sobre: es lo que se decide una vez, no lo que se usa todo el
    // día. Lo pidió la dueña mirando la primera versión, que la tenía entre
    // Productos y Accesos. Quién la manda al fondo es el `mt-auto` del menú, y
    // eso sólo funciona si en el DOM viene última.
    //
    // Las subsecciones piden accesos DISTINTOS —Días cerrados, `appointments`;
    // Contenido, `admin`— y por eso cada una declara el suyo (la lista vive en
    // SECCIONES_DE_CONFIGURACION, compartida con la portada). La sección se
    // muestra si la persona puede abrir al menos una, y sólo se le dibujan las
    // que puede: ver visibleNav. La portada (/admin/configuracion) pide
    // «panel» y hace el mismo filtro con sus tarjetas.
    //
    // `exact: true` como Servicios y Productos: adentro de una subsección se
    // resalta la subsección, no la sección — que igual queda desplegada.
    to: "/admin/configuracion",
    label: "Configuración",
    icon: Settings,
    exact: true,
    access: "panel",
    children: SECCIONES_DE_CONFIGURACION.map((s) => ({
      to: s.to,
      label: s.label,
      access: s.access,
    })),
  },
] as const;

function AdminLayout() {
  const location = useLocation();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  // Mismo cierre de sesión que el header del sitio: se vacía la caché de
  // react-query ANTES de desloguear, para que la próxima persona que entre en
  // esta misma computadora no vea por un instante los datos de la anterior.
  async function signOut() {
    await queryClient.cancelQueries();
    queryClient.clear();
    // El logout es un pedido al servidor porque la cookie es httpOnly: el
    // navegador no puede borrarla solo. Si falla igual se navega al login —
    // dejar a alguien atrapado adentro porque se cortó la red sería peor que
    // una cookie que sigue viva un rato.
    await apiPost("/api/auth/logout").catch(() => {});
    navigate({ to: "/auth", replace: true });
  }

  // Antes acá vivía una consulta propia `["is-admin"]` que sólo miraba si el
  // usuario tenía el rol admin. Se reemplaza por useAccess, que además trae los
  // permisos: con el rol 'staff' el panel dejó de ser de una sola persona, y
  // con la consulta vieja una secretaria rebotaba en "Acceso restringido"
  // aunque tuviera accesos tildados.
  //
  //   const isAdmin = useQuery({
  //     queryKey: ["is-admin"],
  //     queryFn: async () => {
  //       const { data: auth } = await supabase.auth.getUser();
  //       const { data, error } = await supabase
  //         .from("user_roles")
  //         .select("role")
  //         .eq("user_id", auth.user!.id);
  //       if (error) throw error;
  //       return (data ?? []).some((r) => r.role === "admin");
  //     },
  //   });
  const { canEnterPanel, can, allows, loading, isAdmin, isStaff, professionalId, nombre, email } =
    useAccess();

  /**
   * Cómo se presenta la cuenta abajo del menú.
   *
   * Se nombran TODAS las que apliquen y no sólo la de más alcance, porque son
   * cosas distintas y conviven: Camila es empleada del centro **y** tiene ficha
   * de profesional, y eso explica por qué el menú le muestra su agenda. Decir
   * sólo una de las dos deja la mitad de la pantalla sin explicación.
   *
   * El rol de clienta no se nombra: lo tiene cualquiera que alguna vez sacó un
   * turno — la dueña inclusive — y acá adentro no significa nada.
   */
  const rotuloDeRol =
    [isAdmin && "Dueña", isStaff && "Empleada", professionalId && "Profesional"]
      .filter(Boolean)
      .join(" · ") || null;

  // Secciones que la persona abrió o cerró a mano con la flechita. Lo que no
  // esté acá se decide solo: la sección abierta muestra sus subsecciones.
  const [openSections, setOpenSections] = useState<Record<string, boolean>>({});

  // Turnos esperando respuesta. Se pide sólo si la persona puede verlos: sin el
  // acceso, la RLS devuelve cero igual y la consulta sería al pedo.
  const pendingCount = usePendingAppointments(can("appointments"));
  // Turnos que se van a atender y no tienen a quién. Es trabajo pendiente del
  // centro, no un aviso: si nadie los resuelve, ese día no hay profesional.
  const unassignedCount = useUnassignedAppointments(can("appointments"));
  // Turnos dados en días que después el centro cerró. Es de la misma familia
  // que el de arriba: la clienta tiene la confirmación y ese día no va a haber
  // nadie. Sale del mismo endpoint, así que se refresca con los otros dos.
  const closedDaysCount = useAppointmentsOnClosedDays(can("appointments"));

  // Sólo el menú: quién puede hacer qué lo decide la RLS, no esta lista.
  //
  // 5/9/2026 — una sección cuyas subsecciones piden accesos distintos
  // (Configuración) se muestra sólo si la persona puede abrir AL MENOS UNA:
  // sin esto, una profesional que sólo tiene su agenda vería un «Configuración»
  // vacío. Y adentro se le dibujan sólo las que puede. Se filtra acá y no al
  // dibujar, para que el resto del menú siga leyendo `item.children` sin tener
  // que preguntarse nada. La línea vieja, comentada por la regla de este repo:
  //
  //   const visibleNav = nav.filter((item) => allows(item.access));
  const visibleNav = nav
    .filter(
      (item) =>
        allows(item.access) &&
        (item.children.length === 0 || item.children.some((child) => allows(child.access))),
    )
    .map((item) => ({
      ...item,
      children: item.children.filter((child) => allows(child.access)),
    }));

  // Guard de la sección abierta. Va acá y no en cada ruta hija porque todas
  // renderizan dentro de este <Outlet />: en un solo lugar no hay forma de
  // olvidarse de ponerlo en una pantalla nueva.
  const required = requiredAccessFor(location.pathname);
  const allowed = allows(required);

  // /admin es el calendario, que pide "Gestionar turnos". Quien entra al panel
  // sin ese acceso —una profesional que sólo tiene su agenda, o una empleada de
  // stock— aterrizaba en "No tenés acceso a esta sección" apenas se logueaba,
  // como si algo estuviera roto. Se la manda a su primera sección.
  //
  // Sólo desde /admin pelado: si escribió una URL a mano, la respuesta tiene que
  // ser el cartel que explica qué le falta, no una redirección silenciosa.
  const landing = visibleNav[0]?.to;
  useEffect(() => {
    if (!loading && !allowed && location.pathname === "/admin" && landing) {
      navigate({ to: landing, replace: true });
    }
  }, [loading, allowed, location.pathname, landing, navigate]);

  /**
   * El respaldo del `beforeLoad` de arriba.
   *
   * Ese es el que rebota a la clienta antes de dibujar nada, y en la práctica es
   * el que actúa siempre. Éste cubre el caso raro que aquél no puede ver: que la
   * cuenta pierda el acceso MIENTRAS la pantalla está abierta —le dan de baja la
   * ficha de profesional, la sacan del equipo—. Ahí no hay navegación nueva, así
   * que `beforeLoad` no vuelve a correr, y sin esto el panel se quedaría
   * dibujado para alguien que ya no debería verlo.
   */
  useEffect(() => {
    if (!loading && !canEnterPanel) navigate({ to: "/mi-cuenta", replace: true });
  }, [loading, canEnterPanel, navigate]);

  if (loading) {
    return <p className="p-10 text-sm text-muted-foreground">Verificando permisos…</p>;
  }

  if (!canEnterPanel) {
    // Ya se está yendo: lo dispara el efecto de acá arriba. Se dibuja una línea
    // de paso y no el cartel de «Acceso restringido», que se alcanzaba a ver un
    // instante antes de saltar y se leía como un error.
    //
    // ⬇️ El cartel viejo. Se comenta y no se borra porque es el rastro de por
    //    qué esto cambió: para quien no es del centro, /admin no es "una sección
    //    que no te toca", es una dirección que no significa nada. Decirle que
    //    tiene el acceso restringido es contestarle una pregunta que no hizo.
    //
    //    <div className="mx-auto max-w-md px-5 py-24 text-center">
    //      <h1 className="font-display text-3xl text-foreground">Acceso restringido</h1>
    //      <p className="mt-3 text-sm text-muted-foreground">
    //        Esta sección es sólo para el equipo de Shiraf.
    //      </p>
    //      <Button asChild className="mt-6">
    //        <Link to="/mi-cuenta">Ir a mi cuenta</Link>
    //      </Button>
    //    </div>
    return <p className="p-10 text-sm text-muted-foreground">Te llevamos a tu cuenta…</p>;
  }

  return (
    <div className="flex min-h-screen flex-col lg:flex-row">
      {/* La barra se queda quieta: en escritorio se pega arriba y mide una
          pantalla, con su propio scroll si el menú no entra. Antes era
          `lg:w-60 lg:shrink-0` a secas y, al ser una columna más del flex,
          se estiraba hasta la altura del documento: en pantallas largas
          (como "Mi cuenta") el pie del menú quedaba al fondo de la página y
          había que scrollear todo para llegar a "Cerrar sesión".

          className vieja:
          "surface-olive flex flex-col lg:w-60 lg:shrink-0" */}
      <aside className="surface-olive flex flex-col lg:sticky lg:top-0 lg:h-screen lg:w-60 lg:shrink-0 lg:overflow-y-auto">
        <div className="flex items-center gap-3 p-6">
          <Logo className="h-9 w-9" />
          <span className="font-display text-lg tracking-[0.25em] text-primary-foreground">
            SHIRAF
          </span>
        </div>
        {/* 5/9/2026 — `lg:flex-1`: en escritorio el menú ocupa todo el alto que
            queda entre el logo y el pie, para que Configuración pueda irse al
            fondo con un `mt-auto` (ver el envoltorio de cada sección, abajo).
            Sin esto el menú mide lo que miden sus entradas y no hay "fondo" al
            que mandarla. className vieja:
            "flex gap-1 overflow-x-auto px-3 pb-4 lg:flex-col lg:overflow-visible" */}
        <nav className="flex gap-1 overflow-x-auto px-3 pb-4 lg:flex-1 lg:flex-col lg:overflow-visible">
          {visibleNav.map((item) => {
            const active = item.exact
              ? location.pathname === item.to
              : location.pathname.startsWith(item.to);
            // La sección se despliega si estás en el padre o en cualquier hijo.
            const sectionActive =
              active || item.children.some((child) => location.pathname.startsWith(child.to));
            // …salvo que la hayas abierto o cerrado vos con la flechita: esa
            // decisión manda sobre la automática.
            const open = openSections[item.to] ?? sectionActive;

            // Configuración va al FONDO del menú, pegada al pie donde está la
            // cuenta y separada de las secciones del negocio por el espacio que
            // sobre y una línea (pedido de la dueña, 5/9/2026): es lo que se
            // decide una vez, no lo que se usa todo el día. Sólo en escritorio:
            // en el celular el menú es una tira horizontal, el envoltorio es
            // `contents` (no pinta nada) y ahí simplemente va última. className
            // vieja, la misma para todas: "contents lg:block"
            const alFondo = item.to === "/admin/configuracion";

            return (
              <div
                key={item.to}
                className={
                  alFondo
                    ? "contents lg:mt-auto lg:block lg:border-t lg:border-primary-foreground/10 lg:pt-3"
                    : "contents lg:block"
                }
              >
                {/* El link y la flechita van en la misma fila pero separados:
                    tocar el nombre navega, tocar la flecha sólo despliega. Si
                    fuera un botón solo, no se podría entrar a "Servicios". */}
                <div className="relative flex items-center">
                  <Link
                    to={item.to}
                    className={`flex flex-1 items-center gap-3 whitespace-nowrap rounded-sm px-3 py-2 text-sm transition-colors ${
                      item.children.length > 0 ? "pr-9" : ""
                    } ${
                      active
                        ? "bg-primary-foreground/15 text-primary-foreground"
                        : "text-primary-foreground/65 hover:text-primary-foreground"
                    }`}
                  >
                    <item.icon className="h-4 w-4" />
                    {item.label}
                    {/* Los dos contadores de Turnos. Van en el menú y no sólo
                        adentro de la sección para que se vean desde cualquier
                        pantalla del panel.

                        El rojo va PRIMERO, y es el de los turnos sin profesional
                        asignada. Un turno pendiente es alguien esperando una
                        respuesta; uno sin profesional es un turno que va a
                        llegar sin que haya nadie para atenderlo. El segundo no
                        se resuelve solo ni salta a la vista, así que se le da el
                        color que no se puede ignorar. */}
                    {item.to === "/admin/turnos" && (unassignedCount > 0 || pendingCount > 0) && (
                      <span className="ml-auto flex items-center gap-1">
                        {unassignedCount > 0 && (
                          <span
                            title={`${unassignedCount} sin profesional asignada`}
                            className="min-w-5 rounded-full bg-destructive px-1.5 py-0.5 text-center text-xs font-semibold text-white tabular-nums"
                          >
                            {unassignedCount > 99 ? "99+" : unassignedCount}
                          </span>
                        )}
                        {pendingCount > 0 && (
                          <span
                            title={`${pendingCount} esperando respuesta`}
                            className="min-w-5 rounded-full bg-gold px-1.5 py-0.5 text-center text-xs font-semibold text-primary tabular-nums"
                          >
                            {pendingCount > 99 ? "99+" : pendingCount}
                          </span>
                        )}
                      </span>
                    )}
                    {/* El contador de Días cerrados (5/9/2026). Rojo, como el
                        de sin profesional y por lo mismo: un turno dado en un
                        día que después se cerró es una clienta que va a llegar
                        y no va a encontrar a nadie. No se resuelve solo y no
                        salta a la vista en ninguna otra pantalla, así que se
                        ve desde todas.

                        Desde que «Días cerrados» vive adentro de Configuración,
                        el número va sobre «Configuración» mientras la sección
                        está PLEGADA —que es como se la ve desde cualquier otra
                        pantalla— y sobre la subsección cuando está desplegada
                        (más abajo, en las hijas). Lo de antes, cuando era una
                        sección propia, comentado por la regla de este repo:

                        {item.to === "/admin/dias-cerrados" && closedDaysCount > 0 && (
                          <span
                            title={`${closedDaysCount} ${closedDaysCount === 1 ? "turno dado en un día cerrado" : "turnos dados en días cerrados"}`}
                            className="ml-auto min-w-5 rounded-full bg-destructive px-1.5 py-0.5 text-center text-xs font-semibold text-white tabular-nums"
                          >
                            {closedDaysCount > 99 ? "99+" : closedDaysCount}
                          </span>
                        )}
                    */}
                    {item.to === "/admin/configuracion" && closedDaysCount > 0 && !open && (
                      <span
                        title={`${closedDaysCount} ${closedDaysCount === 1 ? "turno dado en un día cerrado" : "turnos dados en días cerrados"}`}
                        className="ml-auto min-w-5 rounded-full bg-destructive px-1.5 py-0.5 text-center text-xs font-semibold text-white tabular-nums"
                      >
                        {closedDaysCount > 99 ? "99+" : closedDaysCount}
                      </span>
                    )}
                  </Link>

                  {item.children.length > 0 && (
                    <button
                      type="button"
                      aria-expanded={open}
                      aria-label={`${open ? "Ocultar" : "Mostrar"} las subsecciones de ${item.label}`}
                      onClick={() => setOpenSections((prev) => ({ ...prev, [item.to]: !open }))}
                      className="absolute right-1 rounded-sm p-1.5 text-primary-foreground/55 transition-colors hover:bg-primary-foreground/10 hover:text-primary-foreground"
                    >
                      <ChevronDown
                        className={`h-4 w-4 transition-transform duration-300 ease-out ${
                          open ? "rotate-180" : ""
                        }`}
                      />
                    </button>
                  )}
                </div>

                {/* Antes las subsecciones aparecían y desaparecían de golpe con
                    `{sectionActive && (…)}`. Ahora el bloque siempre está en el
                    DOM y lo que se anima es su alto: el truco de la grilla de
                    0fr a 1fr deja que el alto lo calcule el navegador, así la
                    transición es suave sin tener que hardcodear un max-height.
                    En mobile además se achica el ancho, para que cerrado no
                    deje un hueco en la fila horizontal del menú. */}
                {item.children.length > 0 && (
                  <div
                    className={`grid transition-all duration-300 ease-out ${
                      open
                        ? "grid-rows-[1fr] opacity-100"
                        : "pointer-events-none max-w-0 grid-rows-[0fr] opacity-0 lg:max-w-none"
                    }`}
                  >
                    {/* Este div de en medio es el que recorta: con
                        `overflow-hidden` el navegador acepta achicarlo hasta 0
                        y por eso la grilla puede animar el alto. Los márgenes y
                        el borde van adentro, para que cerrado no quede
                        ocupando lugar. */}
                    <div className="overflow-hidden">
                      <div className="flex gap-1 lg:mt-1 lg:ml-4 lg:flex-col lg:border-l lg:border-primary-foreground/20 lg:pl-3">
                        {item.children.map((child) => {
                          const childActive = location.pathname.startsWith(child.to);
                          return (
                            <Link
                              key={child.to}
                              to={child.to}
                              className={`whitespace-nowrap rounded-sm px-3 py-2 text-sm transition-colors lg:px-2 lg:py-1.5 ${
                                childActive
                                  ? "bg-primary-foreground/15 text-primary-foreground lg:bg-transparent"
                                  : "text-primary-foreground/55 hover:text-primary-foreground"
                              }`}
                            >
                              {child.label}
                              {/* El número de Días cerrados cuando la sección
                                  está desplegada; plegada, va sobre
                                  «Configuración» (arriba). */}
                              {child.to === "/admin/configuracion/dias-cerrados" &&
                                closedDaysCount > 0 && (
                                  <span
                                    title={`${closedDaysCount} ${closedDaysCount === 1 ? "turno dado en un día cerrado" : "turnos dados en días cerrados"}`}
                                    className="ml-2 inline-block min-w-5 rounded-full bg-destructive px-1.5 py-0.5 text-center text-xs font-semibold text-white tabular-nums"
                                  >
                                    {closedDaysCount > 99 ? "99+" : closedDaysCount}
                                  </span>
                                )}
                            </Link>
                          );
                        })}
                      </div>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </nav>
        {/* Pie de la barra. Antes acá sólo había "Volver al sitio" y estaba
            oculto en mobile (`hidden lg:block`), lo que dejaba al panel sin
            ninguna salida en el celular.

            "Mi cuenta" y "Cerrar sesión" viven acá y no en el menú de arriba
            porque no son secciones del negocio: son de la persona. Y tienen que
            estar, porque las cuentas del centro ya no entran a /mi-cuenta —
            antes se cerraba sesión desde el header del sitio público. */}
        <div className="mt-auto flex items-center gap-1 overflow-x-auto border-t border-primary-foreground/10 px-3 py-3 lg:block lg:py-4">
          {/* Con qué cuenta se está mirando esto.
              Arriba de «Mi cuenta» porque es de quién son las dos cosas que
              siguen. El rótulo del rol sólo en pantalla grande: en el celular
              esta barra es una tira que se desplaza a lo ancho y dos renglones
              la parten. El nombre sí va siempre — es lo que se vino a saber. */}
          {(nombre ?? email) && (
            <div className="min-w-0 shrink-0 px-3 lg:mb-3 lg:px-3">
              <p
                className="truncate text-sm font-medium text-primary-foreground"
                title={email ?? undefined}
              >
                {nombre ?? email}
              </p>
              {rotuloDeRol && (
                <p className="hidden text-xs text-primary-foreground/50 lg:block">{rotuloDeRol}</p>
              )}
            </div>
          )}
          <Link
            to="/admin/cuenta"
            className={`flex items-center gap-3 rounded-sm px-3 py-2 text-sm transition-colors ${
              location.pathname.startsWith("/admin/cuenta")
                ? "bg-primary-foreground/15 text-primary-foreground"
                : "text-primary-foreground/65 hover:text-primary-foreground"
            }`}
          >
            <UserCog className="h-4 w-4" />
            Mi cuenta
          </Link>
          <button
            type="button"
            onClick={signOut}
            className="flex w-full items-center gap-3 rounded-sm px-3 py-2 text-left text-sm text-primary-foreground/65 transition-colors hover:text-primary-foreground"
          >
            <LogOut className="h-4 w-4" />
            Cerrar sesión
          </button>
          <Link
            to="/"
            className="mt-1 block rounded-sm px-3 py-2 text-xs text-primary-foreground/50 hover:text-primary-foreground"
          >
            ← Ver el sitio
          </Link>
        </div>
      </aside>

      <main className="flex-1 bg-background px-5 py-10 lg:px-10">
        {/* El bloqueo va adentro del layout, con el menú a la vista: así se ve
            qué secciones sí están disponibles en vez de quedar en una pantalla
            muerta. Esto es cortesía, no seguridad — el candado real es la RLS. */}
        {allowed ? (
          <Outlet />
        ) : (
          <div className="mx-auto max-w-md py-20 text-center">
            <h1 className="font-display text-3xl text-foreground">
              No tenés acceso a esta sección
            </h1>
            <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
              {required === "admin"
                ? "Es una sección reservada a la dueña del centro."
                : `Necesitás el acceso "${permissionLabel(required)}". Pedíselo a la dueña.`}
            </p>
            {visibleNav.length > 0 && (
              <Button asChild className="mt-6">
                <Link to={visibleNav[0]!.to}>Ir a {visibleNav[0]!.label}</Link>
              </Button>
            )}
          </div>
        )}
      </main>
    </div>
  );
}
