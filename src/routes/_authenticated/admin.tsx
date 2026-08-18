import { createFileRoute, Link, Outlet, useLocation, useNavigate } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import {
  CalendarDays,
  ChevronDown,
  ClipboardList,
  LogOut,
  Package,
  ShieldCheck,
  Sparkles,
  UserCog,
  Users,
  UserSquare,
} from "lucide-react";
import { Logo } from "@/components/logo";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { useAccess } from "@/hooks/useAccess";
import { usePendingAppointments } from "@/hooks/usePendingAppointments";
import { permissionLabel, requiredAccessFor } from "@/lib/permissions";

export const Route = createFileRoute("/_authenticated/admin")({
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

// Cada sección declara qué permiso la habilita, para que una empleada sólo vea
// en el menú lo que realmente puede abrir. `adminOnly` es para lo que no se
// delega: repartir accesos.
const nav = [
  {
    to: "/admin",
    label: "Calendario",
    icon: CalendarDays,
    exact: true,
    permission: "appointments",
    adminOnly: false,
    children: [],
  },
  {
    to: "/admin/turnos",
    label: "Turnos",
    icon: ClipboardList,
    exact: false,
    permission: "appointments",
    adminOnly: false,
    children: [],
  },
  {
    to: "/admin/servicios",
    label: "Servicios",
    icon: Sparkles,
    exact: false,
    permission: "catalog",
    adminOnly: false,
    children: [{ to: "/admin/categorias-servicios", label: "Categorías" }],
  },
  {
    to: "/admin/profesionales",
    label: "Profesionales",
    icon: UserSquare,
    exact: false,
    permission: "team",
    adminOnly: false,
    children: [],
  },
  {
    to: "/admin/clientes",
    label: "Clientes",
    icon: Users,
    exact: false,
    permission: "clients_contact",
    adminOnly: false,
    children: [],
  },
  {
    to: "/admin/productos",
    label: "Productos",
    icon: Package,
    exact: false,
    permission: "stock",
    adminOnly: false,
    children: [{ to: "/admin/categorias-productos", label: "Categorías" }],
  },
  {
    to: "/admin/equipo",
    label: "Equipo",
    icon: ShieldCheck,
    exact: false,
    permission: "appointments", // ignorado: manda adminOnly
    adminOnly: true,
    children: [],
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
    await supabase.auth.signOut();
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
  const { isAdmin, canEnterPanel, can, loading } = useAccess();

  // Secciones que la persona abrió o cerró a mano con la flechita. Lo que no
  // esté acá se decide solo: la sección abierta muestra sus subsecciones.
  const [openSections, setOpenSections] = useState<Record<string, boolean>>({});

  // Turnos esperando respuesta. Se pide sólo si la persona puede verlos: sin el
  // acceso, la RLS devuelve cero igual y la consulta sería al pedo.
  const pendingCount = usePendingAppointments(can("appointments"));

  // Sólo el menú: quién puede hacer qué lo decide la RLS, no esta lista.
  const visibleNav = nav.filter((item) => (item.adminOnly ? isAdmin : can(item.permission)));

  // Guard de la sección abierta. Va acá y no en cada ruta hija porque todas
  // renderizan dentro de este <Outlet />: en un solo lugar no hay forma de
  // olvidarse de ponerlo en una pantalla nueva.
  const required = requiredAccessFor(location.pathname);
  // "panel" no es un permiso: es lo que puede abrir cualquiera del equipo sin
  // que le hayan tildado nada, como su propia contraseña.
  const allowed =
    required === "admin" ? isAdmin : required === "panel" ? canEnterPanel : can(required);

  if (loading) {
    return <p className="p-10 text-sm text-muted-foreground">Verificando permisos…</p>;
  }

  if (!canEnterPanel) {
    return (
      <div className="mx-auto max-w-md px-5 py-24 text-center">
        <h1 className="font-display text-3xl text-foreground">Acceso restringido</h1>
        <p className="mt-3 text-sm text-muted-foreground">
          Esta sección es sólo para el equipo de Shiraf.
        </p>
        <Button asChild className="mt-6">
          <Link to="/mi-cuenta">Ir a mi cuenta</Link>
        </Button>
      </div>
    );
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
        <nav className="flex gap-1 overflow-x-auto px-3 pb-4 lg:flex-col lg:overflow-visible">
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

            return (
              <div key={item.to} className="contents lg:block">
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
                    {/* El contador de turnos por responder. Va en el menú y no
                        sólo adentro de la sección para que se vea desde
                        cualquier pantalla del panel: un turno pendiente es
                        alguien esperando una respuesta. */}
                    {item.to === "/admin/turnos" && pendingCount > 0 && (
                      <span className="ml-auto min-w-5 rounded-full bg-gold px-1.5 py-0.5 text-center text-xs font-semibold text-primary tabular-nums">
                        {pendingCount > 99 ? "99+" : pendingCount}
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
