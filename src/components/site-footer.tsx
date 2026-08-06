import { Link } from "@tanstack/react-router";
import { Instagram, MapPin, Phone } from "lucide-react";
import { LogoLockup } from "@/components/logo";
import { buildWhatsappUrl, CONTACT } from "@/lib/contact";

export function SiteFooter() {
  return (
    <footer className="mt-24 surface-olive">
      <div className="mx-auto grid max-w-6xl gap-10 px-5 py-16 sm:grid-cols-3">
        {/* Lockup completo: el fondo oliva del archivo se funde con la
            superficie, así que no hace falta repetir el nombre ni la bajada. */}
        <div>
          <LogoLockup className="w-40" />
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
          {/* Mismos datos que la página de contacto, desde una sola fuente. */}
          <div className="mt-4 flex flex-col gap-3">
            <a
              href={CONTACT.mapsUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-2 underline-offset-4 hover:underline"
            >
              <MapPin className="h-4 w-4 shrink-0 text-gold" /> {CONTACT.address}, {CONTACT.city}
            </a>
            <a
              href={buildWhatsappUrl({})}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-2 underline-offset-4 hover:underline"
            >
              <Phone className="h-4 w-4 shrink-0 text-gold" /> {CONTACT.phoneDisplay}
            </a>
            <a
              href={CONTACT.instagramUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-2 underline-offset-4 hover:underline"
            >
              <Instagram className="h-4 w-4 shrink-0 text-gold" /> {CONTACT.instagram}
            </a>
          </div>
        </div>
      </div>
      <div className="border-t border-primary-foreground/15 py-6 text-center text-xs text-primary-foreground/60">
        © {new Date().getFullYear()} Shiraf. Todos los derechos reservados.
      </div>
    </footer>
  );
}
