import { Link } from "@tanstack/react-router";
import { Instagram, MapPin, Phone } from "lucide-react";
import { LogoLockup } from "@/components/logo";
import { TiktokIcon } from "@/components/tiktok-icon";
import { WhatsappIcon } from "@/components/whatsapp-icon";
import { buildWhatsappUrl, CONTACT } from "@/lib/contact";

/**
 * Crédito del programador. Va HARDCODEADO acá y no en `src/lib/contact.ts`, que
 * es donde vive todo lo demás que se muestra en el footer: eso son los datos del
 * centro y éstos no. Mezclarlos invita a que alguien edite el mail equivocado.
 *
 * Tampoco sale de la base ni del panel: no tiene que poder cambiarse desde
 * Accesos ni desde ninguna pantalla de admin. Para tocarlo se edita este objeto.
 *
 * Mismos datos que el footer de los otros dos sitios (Ecommerce_mm e
 * Inmobiliaria_Manhattan). Ahí el mail está escrito de dos formas distintas
 * —`shelosettdev@` y `shelosettDev@`—; Gmail ignora las mayúsculas del usuario,
 * así que las dos llegan, y acá va en minúscula por prolijidad.
 */
const DEV_CREDIT = {
  name: "SheloSettDev",
  instagramUrl: "https://instagram.com/shelosettdev",
  email: "shelosettdev@gmail.com",
  /** Sólo dígitos con código de país, igual que `CONTACT.whatsappNumber`. */
  whatsapp: "5491136557290",
} as const;

/**
 * @param flush Sin el aire de arriba, para las páginas que terminan en una
 *   sección oliva. El `mt-24` por defecto es la separación entre el contenido y
 *   el footer, y contra un fondo crema es justamente eso; pero cuando lo de
 *   arriba también es oliva, ese margen deja de ser aire y pasa a ser una
 *   franja de crema partiendo dos campos del mismo color al medio. Ahí los dos
 *   olivas tienen que tocarse.
 */
export function SiteFooter({ flush = false }: { flush?: boolean } = {}) {
  return (
    <footer className={flush ? "surface-olive" : "mt-24 surface-olive"}>
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
            <a
              href={CONTACT.tiktokUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-2 underline-offset-4 hover:underline"
            >
              <TiktokIcon className="h-4 w-4 shrink-0 text-gold" /> TikTok
            </a>
          </div>
        </div>
      </div>
      {/* `px-5` porque el mail del crédito es largo y en pantallas angostas
          quedaba tocando los dos bordes.

          `text-sm` (14px) y no `text-xs` (12px): el crédito a 12px y con el
          color al 45% se leía apretado. Sube toda la barra y no sólo la línea
          del crédito, porque las dos son letra chica del mismo rango — si
          agrandaba una sola, el crédito pasaba a ser lo más grande de la barra
          y quedaba pesando más que el copyright del centro. */}
      <div className="border-t border-primary-foreground/15 px-5 py-6 text-center text-sm text-primary-foreground/60">
        <p>© {new Date().getFullYear()} Shiraf. Todos los derechos reservados.</p>

        {/*
          Los íconos van en `text-gold`, igual que los de la columna "Visitanos".
          Primero los había dejado en el color heredado para que el crédito no
          pesara lo mismo que las redes del centro; la dueña pidió el dorado, así
          que van dorados. Queda igual que en el resto del footer.

          El texto sí sigue un escalón más apagado que el copyright (/45 contra
          /60): con los íconos dorados alcanza para que la línea se vea, y es lo
          que mantiene al crédito como pie de página. `flex-wrap` porque en
          mobile los tres datos no entran en una línea.
        */}
        <p className="mt-2 flex flex-wrap items-center justify-center gap-x-2.5 gap-y-1 text-primary-foreground/45">
          <span>Desarrollado por</span>
          <a
            href={DEV_CREDIT.instagramUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1.5 underline-offset-4 transition-colors hover:text-primary-foreground/80 hover:underline"
          >
            <Instagram className="h-4 w-4 shrink-0 text-gold" />
            {DEV_CREDIT.name}
          </a>
          <span aria-hidden="true">·</span>
          <a
            href={`mailto:${DEV_CREDIT.email}`}
            className="underline-offset-4 transition-colors hover:text-primary-foreground/80 hover:underline"
          >
            {DEV_CREDIT.email}
          </a>
          <span aria-hidden="true">·</span>
          <a
            href={`https://wa.me/${DEV_CREDIT.whatsapp}`}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1.5 underline-offset-4 transition-colors hover:text-primary-foreground/80 hover:underline"
          >
            <WhatsappIcon className="h-4 w-4 shrink-0 text-gold" />
            WhatsApp
          </a>
        </p>
      </div>
    </footer>
  );
}
