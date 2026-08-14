import { createFileRoute, Link, Outlet, useLocation } from "@tanstack/react-router";
import {
  CalendarDays,
  ClipboardList,
  Package,
  ShieldCheck,
  Sparkles,
  Users,
  UserSquare,
} from "lucide-react";
import { Logo } from "@/components/logo";
import { Button } from "@/components/ui/button";
import { useAccess } from "@/hooks/useAccess";
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

  // Sólo el menú: quién puede hacer qué lo decide la RLS, no esta lista.
  const visibleNav = nav.filter((item) => (item.adminOnly ? isAdmin : can(item.permission)));

  // Guard de la sección abierta. Va acá y no en cada ruta hija porque todas
  // renderizan dentro de este <Outlet />: en un solo lugar no hay forma de
  // olvidarse de ponerlo en una pantalla nueva.
  const required = requiredAccessFor(location.pathname);
  const allowed = required === "admin" ? isAdmin : can(required);

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
      <aside className="surface-olive lg:w-60 lg:shrink-0">
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

            return (
              <div key={item.to} className="contents lg:block">
                <Link
                  to={item.to}
                  className={`flex items-center gap-3 whitespace-nowrap rounded-sm px-3 py-2 text-sm transition-colors ${
                    active
                      ? "bg-primary-foreground/15 text-primary-foreground"
                      : "text-primary-foreground/65 hover:text-primary-foreground"
                  }`}
                >
                  <item.icon className="h-4 w-4" />
                  {item.label}
                </Link>

                {item.children.length > 0 && sectionActive && (
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
                )}
              </div>
            );
          })}
        </nav>
        <div className="hidden px-3 pb-6 lg:block">
          <Link
            to="/"
            className="block rounded-sm px-3 py-2 text-xs text-primary-foreground/50 hover:text-primary-foreground"
          >
            ← Volver al sitio
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
