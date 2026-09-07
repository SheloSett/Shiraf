import { useEffect, useState } from "react";
import { ArrowUp } from "lucide-react";

/**
 * Botón flotante para volver al principio de la página.
 *
 * ── DE DÓNDE SALIÓ ────────────────────────────────────────────────────────
 *
 * De /reservar, que es la página larga del sitio: elegir un tratamiento la
 * baja sola hasta el paso 2, y volver a la lista para corregir obligaba a
 * subir a mano pasando por la profesional y el calendario. Con el pulgar en un
 * teléfono eso son varios raspados de pantalla.
 *
 * ── Y SÍ, VA EN TODAS LAS PÁGINAS (6/9/2026) ────────────────────
 *
 * Al principio lo puse sólo en /reservar, con el argumento de que un botón
 * flotante ocupa lugar y que en una página corta no resuelve nada. La dueña
 * pidió lo contrario: que esté siempre, para poder volver arriba en cualquier
 * momento sin buscar cómo. Así que se monta una sola vez en `__root.tsx`, al
 * lado del de WhatsApp.
 *
 * El argumento viejo no era falso, y por eso el botón no aparece hasta haber
 * bajado una pantalla entera: en las páginas cortas efectivamente nunca llega
 * a verse, que es lo mismo que buscaba ponerlo página por página — pero
 * decidido por el scroll y no por una lista que hay que mantener a mano.
 *
 * ── DÓNDE SE PLANTA ───────────────────────────────────────────────────────
 *
 * Justo encima del botón de WhatsApp, en la misma columna: ése está a 1.25rem
 * del piso y mide 3.5rem, así que éste arranca a 5.5rem — los 0.75rem de aire
 * entre los dos. Comparte el `env(safe-area-inset-bottom)` por el mismo motivo
 * (la barra de gestos del iPhone) y el mismo `z-40`.
 *
 * En el panel de admin el de WhatsApp no se monta, asi que ahi este baja al
 * lugar de abajo: quedarse a 5.5rem del piso lo dejaria flotando sobre un hueco
 * vacio. De eso se encarga `sobreElDeWhatsapp`.
 *
 * En crema con borde y no en dorado: el dorado es del CTA de WhatsApp y del de
 * "Reservar turno". Dos botones dorados flotando uno arriba del otro se leen
 * como un solo bloque y ninguno de los dos se distingue. Éste es una ayuda de
 * navegación, no una acción del centro, y tiene que verse secundario.
 */
export function VolverArriba({
  /**
   * Cuántos píxeles hay que haber bajado para que aparezca.
   *
   * Por defecto una pantalla entera: mientras se ve el principio, un botón que
   * dice "volver al principio" es ruido. `100vh` y no un número fijo porque la
   * altura de un teléfono y la de un monitor no se parecen en nada.
   */
  desdeQue = typeof window === "undefined" ? 800 : window.innerHeight,
  /**
   * Si abajo de este boton hay otro (el de WhatsApp) y hay que dejarle el
   * lugar. En false se apoya en el piso.
   */
  sobreElDeWhatsapp = true,
}: {
  desdeQue?: number;
  sobreElDeWhatsapp?: boolean;
}) {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    // Sin `passive: true` el navegador tiene que esperar a que este handler
    // termine antes de pintar cada scroll, por si llama a preventDefault. Es la
    // diferencia entre un scroll suave y uno que se traba en un teléfono.
    const alScrollear = () => setVisible(window.scrollY > desdeQue);

    // Una vez al montar: se puede llegar a mitad de página con el navegador
    // restaurando la posición al volver atrás, y ahí no hay ningún scroll que
    // dispare el handler.
    alScrollear();

    window.addEventListener("scroll", alScrollear, { passive: true });
    return () => window.removeEventListener("scroll", alScrollear);
  }, [desdeQue]);

  return (
    <button
      type="button"
      aria-label="Volver al principio de la página"
      title="Volver arriba"
      /* `hidden` y no desmontarlo: así el botón puede aparecer y desaparecer
         con una transición en vez de saltar. Ver `opacity` abajo. */
      tabIndex={visible ? 0 : -1}
      aria-hidden={!visible}
      onClick={() =>
        window.scrollTo({
          top: 0,
          /* Respeta a quien pidió menos movimiento en el sistema operativo: un
             desplazamiento largo y suave es justo lo que marea a quien lo
             configuró. Las clases de Tailwind no alcanzan acá, porque el
             `behavior` lo decide JavaScript y no el CSS. */
          behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches
            ? "auto"
            : "smooth",
        })
      }
      className={`fixed right-5 z-40 flex h-11 w-11 items-center justify-center rounded-full border border-border bg-card text-foreground shadow-lg shadow-black/15 transition-[opacity,transform,background-color] duration-300 hover:bg-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary motion-reduce:transition-none motion-reduce:hover:scale-100 ${
        sobreElDeWhatsapp
          ? "bottom-[calc(5.5rem+env(safe-area-inset-bottom,0px))]"
          : "bottom-[calc(1.25rem+env(safe-area-inset-bottom,0px))]"
      } ${visible ? "opacity-100" : "pointer-events-none translate-y-2 opacity-0"}`}
    >
      <ArrowUp className="h-5 w-5" />
    </button>
  );
}
