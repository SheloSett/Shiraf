import { createFileRoute, redirect } from "@tanstack/react-router";

/**
 * /admin/contenido → /admin/configuracion/contenido.
 *
 * «Contenido del sitio» vivió en esta dirección desde que existe hasta el
 * 5/9/2026, cuando se mudó adentro de Configuración (la pantalla está ahora en
 * `admin.configuracion.contenido.tsx`, con su historia entera). Esta ruta se
 * queda sólo para que un marcador viejo siga llegando: no dibuja nada, redirige
 * antes de cargar.
 *
 * `beforeLoad` y no un `useEffect`, por lo mismo que el rebote de la clienta
 * en admin.tsx: pasa antes de pintar nada, sin parpadeo. Y `replace: true` para
 * que «atrás» no vuelva a caer acá y rebote otra vez.
 *
 * Se puede borrar el día que nadie tenga la dirección vieja guardada.
 */
export const Route = createFileRoute("/_authenticated/admin/contenido")({
  beforeLoad: () => {
    throw redirect({ to: "/admin/configuracion/contenido", replace: true });
  },
});
