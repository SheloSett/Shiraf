import { useMemo, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { MapPin, MessageCircle } from "lucide-react";
import heroImage from "@/assets/hero-spa.jpg";
import { SiteHeader } from "@/components/site-header";
import { SiteFooter } from "@/components/site-footer";
import { OrganicRule } from "@/components/organic-rule";
import { Reveal } from "@/components/reveal";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/api";
import type { RtaProfesionales, RtaServicios } from "@/lib/api-tipos";
import { imageUrl } from "@/lib/cloudinary";
// CONTACT y OPENING_HOURS ya no se leen acá: la dirección, el WhatsApp y los
// horarios salen del panel (Contenido del sitio → Datos del centro), y los
// valores de ese archivo son ahora los defaults del editor. `buildWhatsappUrl`
// sí sigue: es la que arma el mensaje, y ahora recibe el número editado.
//   import { buildWhatsappUrl, CONTACT, OPENING_HOURS } from "@/lib/contact";
import { buildWhatsappUrl } from "@/lib/contact";
import { lista, renglones, texto } from "@/lib/contenido";
import { useContenido } from "@/hooks/useContenido";
import { urlDe } from "@/lib/seo";
import { formatMoney } from "@/lib/shiraf";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Shiraf — Centro de estética | Calma, belleza y bienestar" },
      {
        name: "description",
        content:
          "Tratamientos faciales, corporales y aparatología en Shiraf. Reservá tu turno online y elegí a tu profesional.",
      },
      { property: "og:title", content: "Shiraf — Centro de estética" },
      {
        property: "og:description",
        content: "Tratamientos faciales, corporales y aparatología. Reservá tu turno online.",
      },
      { property: "og:url", content: urlDe("/") },
    ],
    /**
     * El `canonical` de esta página, y de acá en más el de cada una.
     *
     * Es el que se había descartado en el root —ver el comentario largo allá—:
     * puesto arriba lo heredan todas las páginas y cada ficha de tratamiento
     * termina declarándose copia de la portada. Puesto acá, ruta por ruta,
     * cada una dice su propia dirección, que es lo que un canonical significa.
     *
     * Sirve para lo mismo que el redirect del www: que una página a la que se
     * puede llegar por más de una dirección —con `?utm_source=` de una campaña,
     * por ejemplo— cuente como una sola en vez de como varias parecidas.
     */
    links: [{ rel: "canonical", href: urlDe("/") }],
  }),
  component: Home,
});

/*
 * Sección "Nuestros tratamientos" del home: apagada a pedido del centro.
 *
 * No la borré. Tampoco la envolví en un comentario JSX, que sería lo obvio: el
 * bloque tiene cuatro comentarios adentro y los comentarios de JSX no se
 * anidan — el primer cierre interno terminaría el de afuera y el resto del
 * archivo quedaría suelto en medio del JSX. Con la bandera el código queda
 * intacto, sin tocar una línea, y volver a mostrar la sección es poner true.
 *
 * El tipo va anotado como boolean a propósito: sin la anotación TypeScript la
 * toma como el literal `false` y marca el bloque entero como inalcanzable.
 */
const MOSTRAR_TRATAMIENTOS: boolean = false;

function Home() {
  // Los textos de la portada y los datos del centro, editables desde el panel.
  // Vienen del loader de la raíz, así que ya están cuando esto se dibuja: no
  // hay un estado de carga que atender ni un parpadeo del titular.
  const c = useContenido("inicio");
  const datos = useContenido("datos");

  const services = useQuery({
    queryKey: ["services", "published", "featured"],
    queryFn: async () =>
      (await api<RtaServicios>("/api/publico/servicios?orden=precio&limite=6")).servicios,
    // Atado a la bandera: con la sección apagada el home no tiene por qué pedir
    // servicios que no va a mostrar. Se reactiva solo al prender MOSTRAR_TRATAMIENTOS.
    enabled: MOSTRAR_TRATAMIENTOS,
  });

  // El hover manda, pero antes de que el usuario toque nada mostramos el
  // primero — el panel nunca aparece vacío.
  const [activeId, setActiveId] = useState<string | undefined>();
  const active = useMemo(
    () => services.data?.find((s) => s.id === activeId) ?? services.data?.[0],
    [services.data, activeId],
  );

  const professionals = useQuery({
    queryKey: ["professionals", "active", "home"],
    queryFn: async () =>
      (await api<RtaProfesionales>("/api/publico/profesionales?limite=3")).profesionales,
  });

  return (
    // `clip` en vez de `hidden`: `hidden` crea contenedor de scroll y anula el
    // `sticky` del header.
    <div className="min-h-screen overflow-x-clip">
      <SiteHeader />

      {/*
        Hero asimétrico a sangre. El texto arranca en la columna 2 y termina en
        la 6; la foto va de la 8 al borde derecho. La columna 7 queda vacía a
        propósito: ese respiro descentrado es lo que separa "ordenado" de
        "compuesto".

        `items-stretch` + `h-full` en la foto: con `items-end` la imagen se
        alineaba abajo y dejaba un hueco de fondo crema arriba, contra el
        header.

        Altura: antes era `lg:min-h-[86vh]` (comentado abajo). El problema es que
        el header mide h-20 (5rem) y ocupa lugar en el flujo, así que el hero
        terminaba midiendo 5rem + 86vh y la foto se cortaba por debajo del borde
        inferior de la pantalla. Ahora se descuenta el header y se usa `svh` en
        vez de `vh` para que en mobile no cuente la barra del navegador que
        aparece y desaparece al scrollear.
      */}
      {/* <section className="grid items-stretch gap-y-10 lg:min-h-[86vh] lg:grid-cols-12"> */}
      <section className="grid items-stretch gap-y-10 lg:min-h-[calc(100svh_-_5rem)] lg:grid-cols-12">
        {/* py-20 → py-16: con la altura ya ajustada al viewport, 20 de padding
            arriba y abajo hacía que en notebooks de pantalla baja el texto
            empujara la sección más allá de la pantalla otra vez. */}
        <div className="px-5 pt-14 lg:col-span-5 lg:col-start-2 lg:flex lg:flex-col lg:justify-center lg:px-0 lg:py-16">
          <Reveal>
            {/* Antes: <p ...>Centro de estética</p> */}
            <p className="text-eyebrow text-muted-foreground">{texto(c, "heroEyebrow")}</p>
          </Reveal>

          <Reveal delay={90}>
            {/* Sin una palabra en color de acento: ese recurso es la firma más
                reconocible de las landings generadas. El énfasis lo da el
                tamaño, no el color.

                El titular estaba escrito acá, partido a mano en tres líneas:

                  <h1 className="display-hero mt-7 text-foreground">
                    Calma,
                    <br />
                    belleza
                    <br />y bienestar
                  </h1>

                Ese corte es una decisión de diseño y por eso el campo del panel
                es un textarea: cada renglón que escriban ahí sale en su propia
                línea, tal como acá. Si escriben todo seguido, es UNA línea y el
                navegador la parte donde le toque. */}
            <h1 className="display-hero mt-7 text-foreground">
              {renglones(texto(c, "heroTitulo")).map((linea, i) => (
                <span key={i}>
                  {i > 0 && <br />}
                  {linea}
                </span>
              ))}
            </h1>
          </Reveal>

          {/*
            Acá estaba el párrafo "Tratamientos faciales, corporales y
            aparatología…". No lo borré: se mudó al encabezado de Servicios,
            donde había una franja vacía a la derecha del título y donde además
            viene mejor a cuento.

            <Reveal delay={180}>
              <p className="mt-9 max-w-sm text-[15px] leading-relaxed text-muted-foreground">
                Tratamientos faciales, corporales y aparatología pensados uno por uno. Elegí tu
                servicio, el día, el horario y la profesional que te acompaña.
              </p>
            </Reveal>

            En su lugar sube la frase que antes vivía sola en una sección propia.
            Como subtítulo del h1 tiene a qué agarrarse y deja de flotar; el
            filete dorado hace de bisagra entre las dos.

            El tamaño es la clave para que "Calma, belleza y bienestar" no pierda
            peso: el h1 llega a 10rem y esto no pasa de 2rem. Cinco veces más
            chico — el orden de lectura queda fuera de discusión.
          */}

          {/*
            Y acá estaba esa frase, "Cada piel es distinta. / El tratamiento
            también.". La saco a pedido del centro. Comentada y no borrada por
            si la quieren de vuelta, o por si aparece en otra sección como pasó
            antes con el párrafo de tratamientos.

            Me llevé también el filete dorado que tenía encima: su único trabajo
            era hacer de bisagra entre el h1 y esta frase, y solo, con el titular
            arriba y los botones abajo, quedaba colgado sin nada que presentar.

            <Reveal delay={180}>
              <div className="gold-rule mt-9 w-20" />
              <p className="mt-7 max-w-sm font-display text-[clamp(1.5rem,2.1vw,2rem)] leading-[1.12] text-foreground">
                Cada piel es distinta.
                <br />
                <span className="text-muted-foreground">El tratamiento también.</span>
              </p>
            </Reveal>

            Los botones quedan entonces a mt-9 del titular, que es exactamente la
            separación que tenía el filete respecto del h1. El aire de arriba del
            bloque no cambia.
          */}

          <Reveal delay={260}>
            <div className="mt-9 flex flex-wrap items-center gap-6">
              {/* Antes los dos textos estaban fijos: "Reservar turno" y "Ver
                  tratamientos". A dónde llevan NO se edita —son rutas del
                  sitio, no texto— y eso es a propósito: un enlace apuntando a
                  una página que no existe no se arregla desde el panel. */}
              <Button asChild size="lg">
                <Link to="/reservar">{texto(c, "heroBotonPrimario")}</Link>
              </Button>
              <Link
                to="/servicios"
                className="text-eyebrow text-muted-foreground underline-offset-8 transition-colors hover:text-foreground hover:underline"
              >
                {texto(c, "heroBotonSecundario")}
              </Link>
            </div>
          </Reveal>
        </div>

        <div className="lg:col-span-5 lg:col-start-8">
          {/* object-position alto: el original es 4:3 y el contenedor es más
              alto que ancho, así que al recortar conviene privilegiar la parte
              superior de la escena en vez de centrarla. */}
          {/* 58vh → 58svh por el mismo motivo que la sección: en mobile `vh`
              mide la pantalla sin la barra del navegador y la foto se pasaba.
              Valor anterior: className="h-[58vh] w-full object-cover object-[50%_28%] lg:h-full" */}
          {/* La foto se puede cambiar desde el panel. Si el campo está vacío
              —que es como nace— se usa `heroImage`, el archivo que viene con el
              sitio: la portada nunca queda sin foto.

              Antes: src={heroImage} y el alt escrito acá.

              `width`/`height` se dejan fijos aunque la foto cambie. No son el
              tamaño con el que se muestra —eso lo manda el CSS— sino la
              proporción que el navegador reserva antes de bajarla, para que el
              texto de al lado no salte cuando aparece. Una foto de otra
              proporción hace saltar un poco menos de lo que saltaría sin nada. */}
          <img
            src={texto(c, "heroImagen") || heroImage}
            alt={texto(c, "heroImagenAlt")}
            width={1408}
            height={1008}
            className="h-[58svh] w-full object-cover object-[50%_28%] lg:h-full"
          />
        </div>
      </section>

      {/*
        El filete que marcaste separando el hero del resto.

        Antes: `<OrganicRule className="mt-20 lg:mt-28" />`. Con ese margen la
        línea quedaba flotando en medio de una franja de crema vacía, sin tocar
        ni el hero ni lo que sigue — "en el aire". Después pasó a ir pegada al
        borde inferior de la foto, para leerse como el subrayado del hero.

        Ahora va atado a MOSTRAR_TRATAMIENTOS, por lo mismo que el margen de la
        banda oliva: el filete funcionaba de subrayado mientras abajo seguía
        más crema (la carta de tratamientos). Apagada la carta, lo que sigue es
        el oliva a sangre, y el filete quedaba de sándwich entre la foto y el
        verde — sus 12px de alto se veían como una tirita clara suelta, sobre
        todo en mobile, donde el hero termina en el borde de la foto.

        El trazo no se perdió: bajó adentro de la banda oliva, en dorado. Ahí
        separa sin abrir crema. Ver más abajo.
      */}
      {MOSTRAR_TRATAMIENTOS && <OrganicRule />}

      {/*
        Reemplaza la franja de tres íconos (Leaf / Clock / Star), que es el
        componente más reconocible de las landings generadas. Una sola frase
        grande, descentrada, dice lo mismo con más carácter.

        Bloque anterior (comentado, no borrado): era una sección aparte con
        `py-24 lg:py-36` y todo apilado en la columna izquierda, así que ocupaba
        una pantalla entera con la mitad derecha vacía.

        <section className="grid lg:grid-cols-12">
          <Reveal className="px-5 py-24 lg:col-span-7 lg:col-start-2 lg:px-0 lg:py-36">
            <p className="display-section text-foreground">
              Cada piel es distinta.
              <br />
              <span className="text-muted-foreground">El tratamiento también.</span>
            </p>
            <div className="gold-rule mt-10 w-24" />
            <p className="mt-8 max-w-md text-[15px] leading-relaxed text-muted-foreground">
              Trabajamos con cosmética profesional de línea dermatológica y una evaluación previa
              antes de cada sesión. Nada de protocolos genéricos.
            </p>
          </Reveal>
        </section>

        El intento intermedio (banda a dos columnas pegada al filete) tampoco
        funcionó y por eso también queda comentado:

        <section className="grid gap-y-8 px-5 py-14 lg:grid-cols-12 lg:gap-x-10 lg:px-0 lg:py-16">
          <Reveal className="lg:col-span-5 lg:col-start-2">
            <p className="font-display text-[clamp(1.75rem,3vw,2.5rem)] leading-[1.06] text-foreground">
              Cada piel es distinta.
              <br />
              <span className="text-muted-foreground">El tratamiento también.</span>
            </p>
          </Reveal>
          <Reveal delay={90} className="lg:col-span-4 lg:col-start-8">
            <div className="gold-rule mb-6 w-16" />
            <p className="max-w-md text-[15px] leading-relaxed text-muted-foreground">
              Trabajamos con cosmética profesional de línea dermatológica y una evaluación previa
              antes de cada sesión. Nada de protocolos genéricos.
            </p>
          </Reveal>
        </section>

        Achicar los márgenes no alcanzaba: mientras siguiera siendo una sección
        propia, con crema arriba y crema abajo, la frase no tenía a qué
        agarrarse. Por eso ahora está dentro del hero (arriba, debajo del h1) y
        el párrafo de apoyo pasó al encabezado de Servicios. La página va
        directo del hero a los tratamientos, sin escala intermedia.
      */}

      {/*
        Carta de tratamientos. El índice numerado a todo el ancho quedaba
        desparramado: nombre a la izquierda, precio contra el borde derecho y un
        vacío enorme en el medio.
        Acá se agrupa por categoría en dos columnas y el precio se ata al nombre
        con guía punteada — el recurso de las cartas de restaurante y los
        índices de libro. Más denso, más cálido y sin una sola caja.
      */}
      {MOSTRAR_TRATAMIENTOS && (
        <section>
          <div className="grid lg:grid-cols-12">
            <div className="px-5 pt-20 lg:col-span-9 lg:col-start-2 lg:px-0 lg:pt-28">
              {/*
              Antes era `flex flex-wrap items-end justify-between`: título a la
              izquierda, "Ver todos" contra el borde derecho y un vacío enorme
              en el medio.

              <Reveal className="flex flex-wrap items-end justify-between gap-6">
                <div>
                  <p className="text-eyebrow text-muted-foreground">Nuestros tratamientos</p>
                  <h2 className="display-section mt-5 text-foreground">Servicios</h2>
                </div>
                <Link to="/servicios" className="…">Ver todos</Link>
              </Reveal>

              Intento 2 (también comentado): mandar el texto a la columna
              derecha, alineado con la lista de abajo.

              <Reveal className="grid gap-8 lg:grid-cols-[1fr_1.05fr] lg:items-end lg:gap-16">
                <div>
                  <p className="text-eyebrow text-muted-foreground">Nuestros tratamientos</p>
                  <h2 className="display-section mt-5 text-foreground">Servicios</h2>
                </div>
                <div>
                  <p className="max-w-md text-[15px] leading-relaxed text-muted-foreground">…</p>
                  <p className="mt-4 max-w-md text-[15px] leading-relaxed text-muted-foreground">…</p>
                  <Link to="/servicios" className="…">Ver todos</Link>
                </div>
              </Reveal>

              No servía: un bloque de texto chico solo en la mitad derecha, con
              crema alrededor y el título lejos a la izquierda, flota igual que
              antes. Alinearlo con una grilla no lo ata a nada — lo que ata es
              estar pegado a algo.

              Versión final: el texto va debajo del h2, en la misma columna,
              como bajada del título. Ahí no puede flotar porque cuelga de él.
              "Ver todos" vuelve al borde derecho, alineado abajo con el bloque.
            */}
              <Reveal className="flex flex-wrap items-end justify-between gap-x-10 gap-y-6">
                <div>
                  <p className="text-eyebrow text-muted-foreground">Nuestros tratamientos</p>
                  <h2 className="display-section mt-5 text-foreground">Servicios</h2>
                  <p className="mt-7 max-w-lg text-[15px] leading-relaxed text-muted-foreground">
                    Tratamientos faciales, corporales y aparatología pensados uno por uno. Elegí tu
                    servicio, el día, el horario y la profesional que te acompaña. Trabajamos con
                    cosmética profesional de línea dermatológica y una evaluación previa antes de
                    cada sesión. Nada de protocolos genéricos.
                  </p>
                </div>
                <Link
                  to="/servicios"
                  className="text-eyebrow text-muted-foreground underline-offset-8 transition-colors hover:text-foreground hover:underline"
                >
                  Ver todos
                </Link>
              </Reveal>

              <Reveal className="mt-16 grid gap-10 lg:grid-cols-[1fr_1.05fr] lg:gap-16">
                {/* Índice. En desktop sólo los nombres: el detalle vive en el
                  panel. En mobile no hay hover, así que cada ítem se despliega
                  con su descripción y su precio. */}
                <ul>
                  {services.data?.map((s) => {
                    const isActive = s.id === active?.id;
                    return (
                      <li key={s.id}>
                        <Link
                          to="/reservar"
                          search={{ service: s.id }}
                          onMouseEnter={() => setActiveId(s.id)}
                          onFocus={() => setActiveId(s.id)}
                          className="block border-t border-border py-5 lg:py-6"
                        >
                          <span className="flex items-baseline justify-between gap-5">
                            <span
                              className={`font-display text-[28px] leading-tight transition-all duration-500 ease-out lg:text-[32px] ${
                                isActive
                                  ? "translate-x-1.5 text-foreground"
                                  : "text-muted-foreground"
                              }`}
                            >
                              {s.name}
                            </span>
                            <span className="numeral whitespace-nowrap text-gold lg:hidden">
                              {formatMoney(s.price)}
                            </span>
                          </span>
                          <span className="mt-2 block text-sm leading-relaxed text-muted-foreground lg:hidden">
                            {s.description}
                          </span>
                        </Link>
                      </li>
                    );
                  })}

                  {services.isLoading &&
                    Array.from({ length: 6 }).map((_, i) => (
                      <li key={i} className="border-t border-border py-6">
                        <div className="h-8 animate-pulse rounded-sm bg-muted" />
                      </li>
                    ))}
                </ul>

                {/*
                Panel de detalle. Es un campo de color con grano en vez de una
                caja vacía, con la foto del tratamiento de fondo y el texto
                encima.

                Antes tenía `aspect-4/5` fijo. Ese es el problema que marcaste:
                el alto salía del ancho de la columna, y en pantalla ancha esa
                columna mide ~700px, así que la tarjeta terminaba midiendo ~875
                de alto. Sumado a los 7rem del `sticky top-28`, no entraba en la
                pantalla y quedaba siempre cortada abajo — justo donde están el
                precio y el botón de reservar.

                Ahora el alto sale de la pantalla, no del ancho: lo que queda
                libre debajo del header, menos un respiro. Entra completa
                siempre y la foto se sigue recortando sola con `object-cover`.

                Clase anterior:
                className="surface-olive grain relative hidden aspect-4/5 flex-col justify-end overflow-hidden p-10 lg:sticky lg:top-28 lg:flex"
              */}
                {active && (
                  <div className="surface-olive grain relative hidden flex-col justify-end overflow-hidden p-10 lg:sticky lg:top-28 lg:flex lg:h-[calc(100svh_-_9rem)]">
                    {active.image_url && (
                      <>
                        <img
                          src={imageUrl(active.image_url, "hero") ?? undefined}
                          alt=""
                          className="absolute inset-0 h-full w-full object-cover"
                        />
                        {/* Degradado desde abajo: sin esto el texto crema se pierde
                          sobre las zonas claras de la foto. */}
                        <div className="absolute inset-0 bg-gradient-to-t from-primary via-primary/75 to-primary/20" />
                      </>
                    )}
                    <div key={active.id} className="panel-in relative">
                      <p className="text-eyebrow text-gold">{active.category}</p>
                      <h3 className="mt-5 font-display text-5xl leading-[1.02] text-primary-foreground">
                        {active.name}
                      </h3>
                      <p className="mt-6 max-w-sm text-[15px] leading-relaxed text-primary-foreground/75">
                        {active.description}
                      </p>

                      <div className="mt-9 flex items-center justify-between border-t border-primary-foreground/20 pt-5">
                        <span className="text-eyebrow text-primary-foreground/60">
                          {active.duration_minutes} min
                        </span>
                        <span className="font-display text-3xl tabular-nums text-primary-foreground">
                          {formatMoney(active.price)}
                        </span>
                      </div>

                      <Link
                        to="/reservar"
                        search={{ service: active.id }}
                        className="text-eyebrow mt-8 inline-flex items-center gap-3 text-primary-foreground underline-offset-8 hover:underline"
                      >
                        Reservar este tratamiento
                        <span aria-hidden="true">→</span>
                      </Link>
                    </div>
                  </div>
                )}
              </Reveal>
            </div>
          </div>
        </section>
      )}

      {/*
        Campo de color a sangre con grano. El oliva deja de ser un detalle de
        acento y pasa a ocupar la pantalla completa.
      */}
      {/*
        El margen de arriba va atado a MOSTRAR_TRATAMIENTOS. Ese `mt-24
        lg:mt-36` no era aire de esta sección: era la separación contra el final
        de la carta de tratamientos, que es texto sobre crema. Con la carta
        apagada no queda nada arriba de lo que separarse y eran 144px de crema
        vacía entre el filete del hero y el oliva — el hueco que se veía en el
        sitio.

        En cero, la foto del hero entrega directo al oliva y el corte lo marca
        el trazo dorado de acá abajo, ya sobre el verde. Es como abren las otras
        secciones oliva del sitio (contacto.tsx y servicios.$slug.tsx tampoco le
        ponen margen). Si vuelve la carta de tratamientos, vuelven juntos el
        margen y el filete crema del hero.
      */}
      <section className={`surface-olive grain ${MOSTRAR_TRATAMIENTOS ? "mt-24 lg:mt-36" : ""}`}>
        {/*
          El mismo trazo a mano que venía arriba, pero apoyado DENTRO del oliva
          y en dorado en vez de `text-border`. Así el corte sigue estando
          dibujado — no es un choque seco de foto contra verde — pero no abre
          los 12px de crema que se veían como hueco entre las dos secciones: el
          alto lo pone la banda, que ya era verde de todos modos.

          `/35` porque a opacidad plena compite con los numerales dorados de
          cada profesional, que son el acento real de la sección. Acá tiene que
          ser un susurro.

          No va atado a MOSTRAR_TRATAMIENTOS: esto ya no es el cierre del hero,
          es el borde de arriba de la banda oliva, y le corresponde esté lo que
          esté arriba.
        */}
        <OrganicRule className="text-gold/35" />

        <div className="grid lg:grid-cols-12">
          <div className="px-5 py-24 lg:col-span-10 lg:col-start-2 lg:px-0 lg:py-32">
            <Reveal>
              {/* Antes: "El equipo" y "Profesionales", escritos acá. Los
                  nombres y las bios que van abajo NO: ésos salen de la ficha de
                  cada profesional, que se carga en su propia sección. */}
              <p className="text-eyebrow text-primary-foreground/60">{texto(c, "equipoEyebrow")}</p>
              <h2 className="display-section mt-5 text-primary-foreground">
                {texto(c, "equipoTitulo")}
              </h2>
            </Reveal>

            <div className="mt-16 grid gap-x-10 gap-y-14 sm:grid-cols-2 lg:grid-cols-3">
              {professionals.data?.map((p, i) => (
                <Reveal key={p.id} delay={i * 80}>
                  <span className="numeral text-gold">{String(i + 1).padStart(2, "0")}</span>
                  <h3 className="mt-5 font-display text-4xl leading-tight text-primary-foreground">
                    {p.full_name}
                  </h3>
                  <p className="text-eyebrow mt-4 text-gold">{p.specialty}</p>
                  <p className="mt-5 text-sm leading-relaxed text-primary-foreground/70">{p.bio}</p>
                </Reveal>
              ))}
            </div>

            <Reveal delay={240} className="mt-16">
              <Link
                to="/profesionales"
                className="text-eyebrow text-primary-foreground/70 underline-offset-8 transition-colors hover:text-primary-foreground hover:underline"
              >
                {/* Antes: Conocer al equipo */}
                {texto(c, "equipoLink")}
              </Link>
            </Reveal>
          </div>
        </div>
      </section>

      {/*
        Cierre. El texto ocupaba de la columna 2 a la 8 y el tercio derecho
        quedaba vacío a lo largo de `py-40`: el mismo hueco que ya se había
        corregido dos veces más arriba en esta página.

        Lo que va al costado no es relleno decorativo: es lo que pregunta
        alguien que está por sacar turno —si abren cuando puede ir, dónde
        queda, cómo escribir— y hasta ahora había que irse a /contacto para
        saberlo. Sale todo de `src/lib/contact.ts`, así que no puede divergir
        del footer ni de la página de contacto.
      */}
      <section className="grid gap-y-14 lg:grid-cols-12">
        <Reveal className="px-5 pt-28 lg:col-span-6 lg:col-start-2 lg:px-0 lg:py-40">
          {/* El cierre estaba escrito acá:

                <h2 ...>Reservá tu próximo<br />momento de calma.</h2>
                <p ...>Elegís el tratamiento, el día y la profesional. Nosotros
                confirmamos el turno.</p>
                <Link to="/reservar">Sacar turno</Link>

              Mismo criterio que el titular del hero: el corte de línea lo
              decide quien escribe, renglón por renglón. */}
          <h2 className="display-section text-foreground">
            {renglones(texto(c, "cierreTitulo")).map((linea, i) => (
              <span key={i}>
                {i > 0 && <br />}
                {linea}
              </span>
            ))}
          </h2>
          <p className="mt-8 max-w-sm text-[15px] leading-relaxed text-muted-foreground">
            {texto(c, "cierreTexto")}
          </p>
          <Button asChild size="lg" className="mt-10">
            <Link to="/reservar">{texto(c, "cierreBoton")}</Link>
          </Button>
        </Reveal>

        {/* `self-center`: contra un bloque tan alto, arrancar arriba del todo
            volvería a dejar un vacío, ahora abajo. */}
        <Reveal
          delay={120}
          className="px-5 pb-28 lg:col-span-3 lg:col-start-9 lg:self-center lg:px-0 lg:pb-0"
        >
          <p className="text-eyebrow text-muted-foreground">{texto(c, "antesEyebrow")}</p>
          <div className="gold-rule mt-5 w-16" />

          {/* Los horarios salían de OPENING_HOURS, la constante de contact.ts:

                {OPENING_HOURS.map((day) => (... day.days ... day.hours ...))}

              Ahora son una lista editable en el panel, donde el centro puede
              agregar o sacar renglones —un sábado que abre, un feriado— sin que
              nadie toque el código. La clave sigue siendo el texto del día
              porque no hay id: si dos renglones dicen lo mismo React se queja,
              y decir dos veces "Lunes a viernes" ya sería un error de carga. */}
          <dl className="mt-8 space-y-2 text-[15px] leading-relaxed">
            {lista(datos, "horarios").map((dia, i) => (
              <div
                key={`${dia["dias"]}-${i}`}
                className="flex items-baseline justify-between gap-4"
              >
                <dt className="text-foreground">{dia["dias"]}</dt>
                {/* Los días cerrados van más apagados: son dos de las tres
                    líneas y con el mismo peso tapan el horario que importa.
                    Se compara sin distinguir mayúsculas ni espacios de más:
                    quien lo escribe en el panel puede poner "cerrado". */}
                <dd
                  className={
                    dia["horas"]?.trim().toLowerCase() === "cerrado"
                      ? "text-muted-foreground/60"
                      : "text-muted-foreground"
                  }
                >
                  {dia["horas"]}
                </dd>
              </div>
            ))}
          </dl>

          {/* Antes: {CONTACT.address} / {CONTACT.city} */}
          <p className="mt-8 text-[15px] leading-relaxed text-foreground">
            {texto(datos, "direccion")}
            <br />
            {texto(datos, "ciudad")}
          </p>

          {/*
            Antes los dos eran texto subrayado y no se leían como algo para
            apretar. Ahora son botones `outline`: se ven clickeables sin
            pelearle al "Sacar turno" de al lado, que es el primario oliva y
            tiene que seguir siendo la acción principal de la sección.

            La dirección quedó como texto plano arriba: con el botón de Maps
            debajo, tenerla también linkeada era ofrecer dos veces lo mismo.
          */}
          <div className="mt-6 flex flex-col items-start gap-3">
            {/* Antes el enlace salía de CONTACT y el texto estaba fijo:
                  <a href={CONTACT.mapsUrl}>… Ver en Google Maps</a>
                  <a href={buildWhatsappUrl({})}>… Escribir por WhatsApp</a> */}
            <Button asChild variant="outline" className="w-full">
              <a href={texto(datos, "mapsUrl")} target="_blank" rel="noopener noreferrer">
                <MapPin /> {texto(c, "antesBotonMapa")}
              </a>
            </Button>
            <Button asChild variant="outline" className="w-full">
              <a
                href={buildWhatsappUrl({ numero: texto(datos, "whatsappNumero") })}
                target="_blank"
                rel="noopener noreferrer"
              >
                <MessageCircle /> {texto(c, "antesBotonWhatsapp")}
              </a>
            </Button>
          </div>
        </Reveal>
      </section>

      <SiteFooter />
    </div>
  );
}
