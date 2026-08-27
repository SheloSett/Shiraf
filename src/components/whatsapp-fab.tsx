import { WhatsappIcon } from "@/components/whatsapp-icon";
import { buildWhatsappUrl, CONTACT } from "@/lib/contact";

/**
 * Botón flotante de WhatsApp al número del centro.
 *
 * Se monta una sola vez, en `__root.tsx`, y no página por página: hoy las
 * vistas del cliente son siete y la lista crece. Ahí también está la única
 * exclusión — el panel de admin.
 *
 * Va en `bg-gold` y no en el verde de WhatsApp ni en oliva, por dos razones
 * distintas:
 *
 * - El verde de la marca (#25D366) no existe en esta paleta y al lado del
 *   oliva del sitio se ve como un plugin pegado encima.
 * - El oliva sí es de la paleta, pero el botón flota sobre el footer, que es
 *   un campo oliva a sangre: al llegar al final de la página el botón
 *   desaparecería dentro del fondo. El dorado se despega de los dos, del
 *   crema del cuerpo y del oliva del footer.
 *
 * Es además el mismo par de clases que ya usa el CTA dorado del header
 * (`bg-gold text-accent-foreground hover:bg-gold/85`), así que no inventa un
 * color de botón nuevo.
 */
export function WhatsappFab() {
  return (
    <a
      href={buildWhatsappUrl({})}
      target="_blank"
      rel="noopener noreferrer"
      /* El `aria-label` dice a quién se le escribe, no "abrir WhatsApp": es lo
         único que va a leer un lector de pantalla, porque adentro sólo hay un
         SVG marcado como decorativo. */
      aria-label={`Escribile a Shiraf por WhatsApp al ${CONTACT.phoneDisplay}`}
      title="Escribinos por WhatsApp"
      /* `bottom` con `env(safe-area-inset-bottom)`: en iPhone la barra de
         gestos del navegador se come la franja de abajo y el botón queda
         medio tapado. El fallback `0px` es para los navegadores donde la
         variable no existe.

         `z-40` es el mismo nivel que el header sticky —nunca se cruzan, uno
         vive arriba y el otro abajo— y queda por debajo de los diálogos
         (z-50), que sí tienen que taparlo. */
      className="fixed right-5 bottom-[calc(1.25rem+env(safe-area-inset-bottom,0px))] z-40 flex h-14 w-14 items-center justify-center rounded-full bg-gold text-accent-foreground shadow-lg shadow-black/25 transition-[transform,background-color] duration-300 hover:scale-105 hover:bg-gold/85 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary motion-reduce:transition-none motion-reduce:hover:scale-100"
    >
      <WhatsappIcon className="h-7 w-7" />
    </a>
  );
}
