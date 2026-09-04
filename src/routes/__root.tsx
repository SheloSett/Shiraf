import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  Outlet,
  Link,
  createRootRouteWithContext,
  useRouter,
  useRouterState,
  HeadContent,
  Scripts,
} from "@tanstack/react-router";
import { useEffect, type ReactNode } from "react";

import appCss from "../styles.css?url";
import { Toaster } from "@/components/ui/sonner";
import { WhatsappFab } from "@/components/whatsapp-fab";
import { CONTACT } from "@/lib/contact";
import { obtenerContenido } from "@/lib/contenido.functions";
import type { ContenidoDelSitio } from "@/lib/contenido";

function NotFoundComponent() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <p className="text-eyebrow text-muted-foreground">Shiraf</p>
        <h1 className="mt-4 text-5xl text-foreground">Página no encontrada</h1>
        <p className="mt-3 text-sm text-muted-foreground">
          La página que buscás no existe o fue movida.
        </p>
        <div className="mt-8">
          <Link
            to="/"
            className="inline-flex items-center justify-center rounded-md bg-primary px-5 py-2.5 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            Volver al inicio
          </Link>
        </div>
      </div>
    </div>
  );
}

function ErrorComponent({ error, reset }: { error: Error; reset: () => void }) {
  console.error(error);
  const router = useRouter();

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-3xl text-foreground">Algo no cargó bien</h1>
        <p className="mt-3 text-sm text-muted-foreground">
          Podés intentar de nuevo o volver al inicio.
        </p>
        <div className="mt-8 flex flex-wrap justify-center gap-2">
          <button
            onClick={() => {
              router.invalidate();
              reset();
            }}
            className="inline-flex items-center justify-center rounded-md bg-primary px-5 py-2.5 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            Intentar de nuevo
          </button>
          <a
            href="/"
            className="inline-flex items-center justify-center rounded-md border border-input bg-background px-5 py-2.5 text-sm font-medium text-foreground transition-colors hover:bg-accent/20"
          >
            Ir al inicio
          </a>
        </div>
      </div>
    </div>
  );
}

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  /**
   * El contenido editable del sitio, para TODAS las páginas de una vez.
   *
   * ── POR QUÉ ACÁ ARRIBA Y NO EN CADA RUTA ────────────────────────────────
   *
   * Porque el pie de página se dibuja en las siete páginas públicas y no es una
   * ruta: es un componente. Sin loader propio no tiene de dónde leer, y ponerle
   * un `useQuery` adentro haría que la dirección y el teléfono aparezcan medio
   * segundo después del resto — en el pie, que es donde alguien va a buscarlos.
   *
   * Cargado acá, el contenido está en el HTML que sale del servidor: lo indexa
   * Google y no parpadea nada. `useContenido()` lo lee de este loader.
   *
   * ── EL CATCH NO ES DESIDIA ──────────────────────────────────────────────
   *
   * Este loader corre en cada página. Si tira, no se rompe una sección: se
   * rompe el sitio entero, incluido el panel. Con `{}` de vuelta, todo muestra
   * los textos originales de `contenido.ts` — que es exactamente lo que se veía
   * antes de que existiera el editor. Degradar así es aceptable; una pantalla
   * de error para todo el mundo porque no se pudo leer un título, no.
   */
  loader: async () => {
    try {
      return await obtenerContenido();
    } catch (error) {
      console.error("[contenido] El sitio sigue con los textos por defecto:", error);
      return {} as ContenidoDelSitio;
    }
  },
  /**
   * Cinco minutos sin volver a preguntar.
   *
   * Sin esto el loader se vuelve a ejecutar en CADA navegación —el default de
   * TanStack es 0— y pasar de Inicio a Servicios dispararía un pedido más para
   * traer los mismos textos. Cinco minutos es el tiempo que puede tardar en
   * verse un cambio recién guardado para quien ya tenía el sitio abierto; el
   * panel no espera nada, porque después de guardar invalida el router a mano.
   */
  staleTime: 5 * 60 * 1000,
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { title: "Shiraf — Centro de estética" },
      {
        name: "description",
        content: "Calma, belleza y bienestar. Reservá tu turno en Shiraf.",
      },
      { name: "author", content: "Shiraf" },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },

      // ── La tarjetita del link ────────────────────────────────────────────
      //
      // Sin esto, pegar shiraf.com.ar en Instagram, en WhatsApp o en un mail
      // sale como un rectángulo gris con la URL pelada. `og:type` y
      // `twitter:card` ya estaban, pero solos no alcanzan: los que arman la
      // vista previa son el título, la descripción y sobre todo la imagen.
      //
      // ⚠️ `og:image` TIENE que ser una URL absoluta. Con "/logo_shiraf.jpeg"
      // a secas, Facebook y WhatsApp no la resuelven y la tarjeta sale sin
      // foto — es el error clásico y no da ningún mensaje. Por eso sale de
      // CONTACT.siteUrl, que es el mismo lugar de donde salen los mails.
      { property: "og:site_name", content: "Shiraf" },
      { property: "og:locale", content: "es_AR" },
      { property: "og:title", content: "Shiraf — Centro de estética" },
      {
        property: "og:description",
        content: "Calma, belleza y bienestar. Reservá tu turno en Shiraf.",
      },
      // 🔴 Acá había un `og:url` fijo a CONTACT.siteUrl y NO puede estar en el
      // root: este head lo heredan todas las páginas, así que la ficha de
      // /servicios/drenaje-linfatico también decía que su dirección es la
      // portada. Compartir una ficha por WhatsApp mostraba la vista previa del
      // sitio entero.
      //
      // Sin `og:url`, quien comparte usa la dirección que efectivamente pegó,
      // que es lo correcto. El día que se quiera uno de verdad, va en cada
      // ruta —al lado del og:title que cada una ya define— y no acá.
      // { property: "og:url", content: CONTACT.siteUrl },
      { property: "og:image", content: `${CONTACT.siteUrl}/logo_shiraf.jpeg` },
      { property: "og:image:alt", content: "Shiraf — centro de estética" },
      { name: "twitter:title", content: "Shiraf — Centro de estética" },
      {
        name: "twitter:description",
        content: "Calma, belleza y bienestar. Reservá tu turno en Shiraf.",
      },
      { name: "twitter:image", content: `${CONTACT.siteUrl}/logo_shiraf.jpeg` },
    ],
    links: [
      { rel: "stylesheet", href: appCss },
      // 🔴 Acá había un `canonical` fijo a CONTACT.siteUrl, y era un tiro en el
      // pie. Un canonical le dice a Google "la versión buena de ESTA página es
      // aquella"; puesto en el root lo heredan todas, así que las seis fichas
      // de tratamientos le estarían declarando a Google que son copias de la
      // portada. El resultado no es que se posicionen menos: es que Google las
      // saca de los resultados.
      //
      // El problema que venía a resolver —que shiraf.com.ar y
      // www.shiraf.com.ar sirven lo mismo y Google los cuenta como dos sitios—
      // se arregla mejor y en un solo lugar, redirigiendo el www al dominio
      // pelado en nginx. Ver DOCKER.md.
      //
      // Si algún día se quiere el canonical igual, va POR RUTA, con la
      // dirección de cada una, nunca acá.
      // { rel: "canonical", href: CONTACT.siteUrl },
      { rel: "icon", type: "image/png", href: "/favicon.png" },
      { rel: "preconnect", href: "https://fonts.googleapis.com" },
      { rel: "preconnect", href: "https://fonts.gstatic.com", crossOrigin: "anonymous" },
      {
        rel: "stylesheet",
        href: "https://fonts.googleapis.com/css2?family=Bodoni+Moda:opsz,wght@6..96,400..700&family=Karla:wght@300;400;500;600;700&display=swap",
      },
    ],
  }),
  shellComponent: RootShell,
  component: RootComponent,
  notFoundComponent: NotFoundComponent,
  errorComponent: ErrorComponent,
});

function RootShell({ children }: { children: ReactNode }) {
  return (
    // suppressHydrationWarning por el script de abajo: agrega `js` al <html>
    // antes de que React hidrate, así que el atributo class del cliente nunca
    // va a coincidir con el del servidor. Es a propósito — la clase NO puede
    // venir del SSR, porque entonces quien no tenga JS se queda con el
    // contenido en opacity:0 para siempre. Sin esto, React tira un warning de
    // mismatch en cada carga y tapa los que sí son bugs.
    <html lang="es" suppressHydrationWarning>
      <head>
        {/* Marca que hay JS antes del primer pintado. Las animaciones de
            revelado cuelgan de `.js`, así que sin JS el contenido se muestra
            estático en vez de quedar en opacity:0. */}
        <script
          dangerouslySetInnerHTML={{
            __html: "document.documentElement.classList.add('js')",
          }}
        />
        <HeadContent />
      </head>
      <body>
        {children}
        <Scripts />
      </body>
    </html>
  );
}

function RootComponent() {
  const { queryClient } = Route.useRouteContext();
  const router = useRouter();

  // Acá había un suscriptor a onAuthStateChange que invalidaba el router y las
  // consultas cuando la sesión cambiaba. Con una cookie no hay a quién
  // suscribirse, y tampoco hace falta: entrar y salir son acciones nuestras, y
  // las dos llaman a olvidarSesion() y navegan. Lo que antes llegaba por un
  // evento ahora pasa en la línea de al lado.

  /*
   * El botón flotante de WhatsApp se monta acá, una sola vez, en vez de
   * agregarlo a cada página pública. Son siete las que hoy muestran el footer
   * y la lista crece: puesto página por página, la que se agregue mañana nace
   * sin el botón y nadie se entera.
   *
   * La única exclusión es el panel. `/admin` es de quien trabaja en el centro,
   * no de la clienta, y un botón para escribirle a Shiraf desde adentro de
   * Shiraf no tiene sentido. Va por prefijo y no por lista de rutas para que
   * las pantallas nuevas del panel queden afuera solas.
   *
   * SÍ aparece en /auth y /recuperar, que también son de la clienta: si alguien
   * no puede entrar o no le llega el mail de recuperación, ese es justo el
   * momento en que quiere escribir. Si molesta, se suma al chequeo de abajo.
   */
  const pathname = useRouterState({ select: (estado) => estado.location.pathname });
  const esPanel = pathname === "/admin" || pathname.startsWith("/admin/");

  return (
    <QueryClientProvider client={queryClient}>
      {/* Required: nested routes render here. Removing <Outlet /> breaks all child routes. */}
      <Outlet />
      {!esPanel && <WhatsappFab />}
      <Toaster />
    </QueryClientProvider>
  );
}
