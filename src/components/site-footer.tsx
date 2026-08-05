import { Link } from "@tanstack/react-router";
import { Instagram, MapPin, Phone } from "lucide-react";
import { Logo } from "@/components/logo";

export function SiteFooter() {
  return (
    <footer className="mt-24 surface-olive">
      <div className="mx-auto grid max-w-6xl gap-10 px-5 py-16 sm:grid-cols-3">
        <div>
          <Logo className="h-14 w-14" />
          <p className="mt-4 font-display text-2xl tracking-[0.28em] text-primary-foreground">
            SHIRAF
          </p>
          <p className="mt-2 text-sm text-primary-foreground/70">Calma, belleza y bienestar.</p>
        </div>

        <div className="text-sm text-primary-foreground/80">
          <p className="text-eyebrow text-gold">Navegación</p>
          <div className="mt-4 flex flex-col gap-2">
            <Link to="/servicios">Servicios</Link>
            <Link to="/profesionales">Profesionales</Link>
            <Link to="/reservar">Reservar turno</Link>
            <Link to="/contacto">Contacto</Link>
          </div>
        </div>

        <div className="text-sm text-primary-foreground/80">
          <p className="text-eyebrow text-gold">Visitanos</p>
          <div className="mt-4 flex flex-col gap-3">
            <span className="flex items-center gap-2">
              <MapPin className="h-4 w-4 text-gold" /> Av. Siempreviva 1234, CABA
            </span>
            <span className="flex items-center gap-2">
              <Phone className="h-4 w-4 text-gold" /> +54 11 5555-5555
            </span>
            <span className="flex items-center gap-2">
              <Instagram className="h-4 w-4 text-gold" /> @shiraf.estetica
            </span>
          </div>
        </div>
      </div>
      <div className="border-t border-primary-foreground/15 py-6 text-center text-xs text-primary-foreground/60">
        © {new Date().getFullYear()} Shiraf. Todos los derechos reservados.
      </div>
    </footer>
  );
}
