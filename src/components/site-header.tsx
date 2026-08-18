import { Link, useNavigate } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { Menu } from "lucide-react";
import { LogoWordmark } from "@/components/logo";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";

const links = [
  { to: "/", label: "Inicio" },
  { to: "/servicios", label: "Servicios" },
  { to: "/profesionales", label: "Profesionales" },
  { to: "/contacto", label: "Contacto" },
] as const;

// Los botones de shadcn asumen fondo claro. Sobre el oliva del header hay que
// reescribirles el borde, el texto y el hover.
const onOliveOutline =
  "hidden border-primary-foreground/30 bg-transparent text-primary-foreground shadow-none hover:bg-primary-foreground/10 hover:text-primary-foreground sm:inline-flex";
const onOliveGhost =
  "hidden text-primary-foreground/80 hover:bg-primary-foreground/10 hover:text-primary-foreground sm:inline-flex";

export function SiteHeader() {
  // isTeam en lugar de isAdmin: el panel dejó de ser de una sola persona, y con
  // isAdmin una empleada navegaba el sitio sin ninguna puerta de entrada al
  // panel — el motivo por el que este header se cambió.
  const { user, isTeam } = useAuth();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  async function signOut() {
    await queryClient.cancelQueries();
    queryClient.clear();
    await supabase.auth.signOut();
    navigate({ to: "/auth", replace: true });
  }

  return (
    // Barra en oliva: sobre el crema del cuerpo el header se confundía con la
    // página. El fondo va con algo de alfa + blur para que el contenido se
    // insinúe al pasar por debajo.
    <header className="sticky top-0 z-40 border-b border-primary-foreground/15 bg-primary/95 text-primary-foreground backdrop-blur">
      <div className="mx-auto flex h-20 max-w-6xl items-center justify-between px-5">
        <Link to="/" className="shrink-0">
          <LogoWordmark tone="light" />
        </Link>

        <nav className="hidden items-center gap-9 md:flex">
          {links.map((l) => (
            <Link
              key={l.to}
              to={l.to}
              activeOptions={{ exact: l.to === "/" }}
              activeProps={{ className: "text-primary-foreground" }}
              inactiveProps={{ className: "text-primary-foreground/65" }}
              className="text-[13px] tracking-wide transition-colors hover:text-primary-foreground"
            >
              {l.label}
            </Link>
          ))}
        </nav>

        <div className="flex items-center gap-2">
          {/* Al lado del botón dorado, que es la acción principal, va lo de la
              sesión. Cuánto hay para poner ahí depende de quién esté:

              El equipo no tiene páginas de clienta — la cuenta del centro no
              reserva turnos ni tiene historial, y ofrecérselo la mandaba a
              pantallas que ahora la rebotan. Descontando el panel, que ya es el
              botón dorado, lo único que le queda es salir. Un desplegable con
              un solo ítem adentro es un clic de más para nada, así que va el
              botón directo.

              La clienta sí tiene a dónde ir además de reservar, y ahí el
              desplegable se gana el lugar. */}
          {!user ? (
            <Button asChild variant="ghost" size="sm" className={onOliveGhost}>
              <Link to="/auth">Ingresar</Link>
            </Button>
          ) : isTeam ? (
            <Button variant="outline" size="sm" className={onOliveOutline} onClick={signOut}>
              Cerrar sesión
            </Button>
          ) : (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="sm" className={onOliveOutline}>
                  Mi cuenta
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-52">
                <DropdownMenuItem asChild>
                  <Link to="/mi-cuenta">Mi perfil y turnos</Link>
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={signOut}>Cerrar sesión</DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          )}

          {/* El botón por defecto es oliva sobre oliva: acá manda el dorado.
              A la gente del centro se le muestra el panel en su lugar: ese
              formulario no es el suyo y /reservar la desvía igual. */}
          {isTeam ? (
            <Button
              asChild
              size="sm"
              className="bg-gold text-accent-foreground shadow-none hover:bg-gold/85"
            >
              <Link to="/admin">Ir al panel</Link>
            </Button>
          ) : (
            <Button
              asChild
              size="sm"
              className="bg-gold text-accent-foreground shadow-none hover:bg-gold/85"
            >
              <Link to="/reservar">Reservar turno</Link>
            </Button>
          )}

          <Sheet>
            <SheetTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="text-primary-foreground hover:bg-primary-foreground/10 hover:text-primary-foreground md:hidden"
                aria-label="Abrir menú"
              >
                <Menu className="h-5 w-5" />
              </Button>
            </SheetTrigger>
            <SheetContent side="right" className="w-72">
              <nav className="mt-10 flex flex-col gap-5">
                {links.map((l) => (
                  <Link key={l.to} to={l.to} className="text-base text-foreground">
                    {l.label}
                  </Link>
                ))}
                <div className="my-2 h-px bg-border" />
                {user ? (
                  <>
                    {isTeam ? (
                      <Link to="/admin" className="text-base">
                        Ir al panel
                      </Link>
                    ) : (
                      <Link to="/mi-cuenta" className="text-base">
                        Mi perfil y turnos
                      </Link>
                    )}
                    <button onClick={signOut} className="text-left text-base text-muted-foreground">
                      Cerrar sesión
                    </button>
                  </>
                ) : (
                  <Link to="/auth" className="text-base">
                    Ingresar
                  </Link>
                )}
              </nav>
            </SheetContent>
          </Sheet>
        </div>
      </div>
    </header>
  );
}
