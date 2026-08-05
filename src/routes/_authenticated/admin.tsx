import { createFileRoute, Link, Outlet, useLocation } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { CalendarDays, ClipboardList, Package, Sparkles, Users, UserSquare } from "lucide-react";
import { Logo } from "@/components/logo";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";

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

const nav = [
  { to: "/admin", label: "Calendario", icon: CalendarDays, exact: true },
  { to: "/admin/turnos", label: "Turnos", icon: ClipboardList, exact: false },
  { to: "/admin/servicios", label: "Servicios", icon: Sparkles, exact: false },
  { to: "/admin/profesionales", label: "Profesionales", icon: UserSquare, exact: false },
  { to: "/admin/clientes", label: "Clientes", icon: Users, exact: false },
  { to: "/admin/stock", label: "Stock", icon: Package, exact: false },
] as const;

function AdminLayout() {
  const location = useLocation();

  const isAdmin = useQuery({
    queryKey: ["is-admin"],
    queryFn: async () => {
      const { data: auth } = await supabase.auth.getUser();
      const { data, error } = await supabase
        .from("user_roles")
        .select("role")
        .eq("user_id", auth.user!.id);
      if (error) throw error;
      return (data ?? []).some((r) => r.role === "admin");
    },
  });

  if (isAdmin.isLoading) {
    return <p className="p-10 text-sm text-muted-foreground">Verificando permisos…</p>;
  }

  if (!isAdmin.data) {
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
          {nav.map((item) => {
            const active = item.exact
              ? location.pathname === item.to
              : location.pathname.startsWith(item.to);
            return (
              <Link
                key={item.to}
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
        <Outlet />
      </main>
    </div>
  );
}
