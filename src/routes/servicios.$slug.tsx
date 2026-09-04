import { useMemo, useState } from "react";
import { Play } from "lucide-react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { SiteHeader } from "@/components/site-header";
import { SiteFooter } from "@/components/site-footer";
import { OrganicRule } from "@/components/organic-rule";
import { Reveal } from "@/components/reveal";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/api";
import { cabeceraDelTratamiento } from "@/lib/catalogo.functions";
import { recortar, tratamientoLd, urlDe } from "@/lib/seo";
import type { RtaProfesionalesConHorarios, RtaServicio } from "@/lib/api-tipos";
import { imageUrl, videoPosterUrl, videoUrl } from "@/lib/cloudinary";
import { agruparPorDia, aSlug, formatMoney, soloHoraYMinutos, WEEKDAYS } from "@/lib/shiraf";

// El archivo se llamaba `servicios.$serviceId.tsx` y la ruta era
// "/servicios/$serviceId". Cambió junto con lo que viaja en la URL: antes era
// el UUID del tratamiento y ahora es su slug —/servicios/drenaje-linfatico—,
// así que el parámetro dejó de llamarse como lo que ya no lleva.
//
// El endpoint sigue aceptando el UUID (ver `porIdOSlug` en
// publico.controller.ts), así que un enlace viejo con el id abre esta misma
// pantalla: lo que venga por acá se le pasa al servidor tal cual.
export const Route = createFileRoute("/servicios/$slug")({
  /**
   * El nombre del tratamiento, para el `<head>`.
   *
   * Corre en el servidor antes de renderizar, que es la única forma de que el
   * título esté en el HTML servido. Lo que dibuja la pantalla sigue viniendo
   * del `useQuery` de más abajo, sin cambios: ver `catalogo.functions.ts`.
   *
   * ⚠️ El catch no se puede sacar. Un loader que tira no deja la ficha sin
   * título: deja la pantalla de error, y por un dato que sólo sirve para el
   * buscador. Sin cabecera, el `<head>` cae al texto genérico —el mismo que
   * había hasta ahora— y la ficha se dibuja igual.
   *
   * ── POR QUÉ DEVUELVE `pudoLeerse` Y NO SÓLO LA CABECERA ─────────────────
   *
   * Porque "este tratamiento no existe" y "no se pudo preguntar" terminan los
   * dos sin cabecera, y de ahí abajo se toma una decisión que no es la misma
   * para los dos casos: si no existe, la página lleva `noindex`.
   *
   * Sin la distinción, un rato de base caída haría que TODAS las fichas se
   * sirvan pidiéndole a Google que las saque, y volver de eso no es inmediato:
   * hay que esperar a que las vuelva a rastrear una por una.
   */
  loader: async ({ params }) => {
    try {
      return { cabecera: await cabeceraDelTratamiento({ data: params.slug }), pudoLeerse: true };
    } catch (error) {
      console.error("[seo] La ficha queda con el título genérico:", error);
      return { cabecera: null, pudoLeerse: false };
    }
  },
  head: ({ params, loaderData }) => {
    const cabecera = loaderData?.cabecera ?? null;

    // Un tratamiento que la base dice que no existe. Pasa de verdad y no es un
    // error: el slug SE REGENERA cuando cambia el nombre (ver schema.prisma),
    // así que renombrar un tratamiento deja viva su dirección anterior, que
    // responde 200 con una pantalla de "no está disponible". Sin esta línea,
    // Google la indexa y la muestra en los resultados.
    //
    // Va sólo cuando la base contestó. Si no se pudo leer, la página no se
    // toca: ver el comentario del loader.
    const noExiste = loaderData?.pudoLeerse === true && cabecera === null;
    // El slug de la base y no el de la URL: quien entra con el UUID —un enlace
    // viejo, ver el comentario de arriba— declara como dirección buena la
    // legible, y Google cuenta las visitas de las dos en una sola página.
    const ruta = `/servicios/${cabecera?.slug ?? params.slug}`;
    const url = urlDe(ruta);

    const titulo = cabecera ? `${cabecera.nombre} — Shiraf` : "Tratamiento — Shiraf";
    const descripcion = cabecera?.descripcion
      ? recortar(cabecera.descripcion)
      : "Detalle del tratamiento: en qué consiste, cuánto dura, quién lo realiza y cómo reservar tu turno en Shiraf.";

    return {
      meta: [
        { title: titulo },
        { name: "description", content: descripcion },
        // Sin estos dos, la vista previa de WhatsApp de una ficha muestra el
        // título del sitio entero: el root los define y todo lo hereda.
        { property: "og:title", content: titulo },
        { property: "og:description", content: descripcion },
        { property: "og:url", content: url },
        ...(noExiste ? [{ name: "robots", content: "noindex, follow" }] : []),
      ],
      // Una página que le pide a Google que la saque no le declara además cuál
      // es su dirección buena: son dos instrucciones que se contradicen.
      links: noExiste ? [] : [{ rel: "canonical", href: url }],
      scripts: cabecera
        ? [
            tratamientoLd({
              nombre: cabecera.nombre,
              descripcion,
              ruta,
            }),
          ]
        : [],
    };
  },
  component: ServiceDetail,
});

/** Pasos del flujo de reserva, explicados antes de mandar a la clienta al form. */
const STEPS = [
  {
    title: "Elegís la profesional",
    text: "Sólo aparecen las que realizan este tratamiento, con su especialidad.",
  },
  {
    title: "Elegís día y horario",
    text: "El calendario muestra los horarios libres según la agenda de cada profesional.",
  },
  {
    title: "Confirmamos el turno",
    text: "Queda pendiente hasta que el centro lo confirma. El pago se realiza en el centro.",
  },
] as const;

/**
 * La descripción, partida en párrafos.
 *
 * En el panel se escribe en un textarea, así que los renglones y las líneas en
 * blanco existen en el dato; el HTML los colapsa, y metida en un solo <p> la
 * descripción salía como un ladrillo de veinte renglones sin respiro.
 *
 * Se corta por línea en blanco, que es como separa párrafos quien escribe. Si
 * no hay ninguna —alguien escribió todo seguido apretando Enter una sola vez—
 * se cae al salto suelto, que es lo único que queda para inferir el corte.
 */
function enParrafos(texto: string): string[] {
  const limpiar = (partes: string[]) => partes.map((p) => p.trim()).filter(Boolean);
  const porBloque = limpiar(texto.split(/\n\s*\n/));
  return porBloque.length > 1 ? porBloque : limpiar(texto.split("\n"));
}

function ServiceDetail() {
  //   const { serviceId } = Route.useParams();
  const { slug } = Route.useParams();

  const service = useQuery({
    // La clave de caché es lo que vino en la URL, no el id del tratamiento: si
    // fuera el id, entrar por el slug y entrar por el UUID compartirían entrada
    // pero la primera tendría que esperar la respuesta para saber cuál es.
    queryKey: ["service", slug],
    queryFn: async () => (await api<RtaServicio>(`/api/publico/servicios/${slug}`)).servicio,
  });

  const team = useQuery({
    queryKey: ["service-professionals", slug],
    // El filtro por is_active ahora lo hace el servidor, en la consulta.
    queryFn: async () =>
      (await api<RtaProfesionalesConHorarios>(`/api/publico/servicios/${slug}/profesionales`))
        .profesionales,
  });

  /**
   * Todas las fotos y videos del tratamiento, en orden, con la portada primera.
   *
   * Va acá y no después de los early returns de abajo porque es un hook: si
   * quedara ahí, se ejecutaría en unos renders y en otros no, que es lo único
   * que React no perdona.
   *
   * La portada se identifica por URL y no por posición: es lo que hace el
   * trigger de la base —la primera IMAGEN, salteando videos— y compararla así
   * evita repetir esa regla acá y que las dos se desincronicen.
   */
  const medios = useMemo(() => {
    const todos = [...(service.data?.service_media ?? [])].sort((a, b) => a.position - b.position);
    const portada = service.data?.image_url;
    // La portada al frente aunque no sea la primera de la lista: puede haber un
    // video en position 0, y el trigger igual eligió la primera imagen.
    return todos.sort((a, b) => Number(b.url === portada) - Number(a.url === portada));
  }, [service.data]);

  /**
   * Cuál se está mirando.
   *
   * Se guarda el índice y no el objeto para que al recargar los datos —cambió
   * una foto desde el panel— siga apuntando a un lugar válido de la lista en vez
   * de a un elemento que ya no está.
   */
  const [mirando, setMirando] = useState(0);
  const activo = medios[Math.min(mirando, Math.max(medios.length - 1, 0))];

  if (service.isLoading) {
    return (
      <div className="min-h-screen">
        <SiteHeader />
        <p className="px-5 py-32 text-center text-sm text-muted-foreground">
          Cargando tratamiento…
        </p>
        <SiteFooter />
      </div>
    );
  }

  if (!service.data) {
    return (
      <div className="min-h-screen">
        <SiteHeader />
        <div className="mx-auto max-w-md px-5 py-32 text-center">
          <h1 className="display-section text-foreground">Tratamiento no encontrado</h1>
          <p className="mt-5 text-sm text-muted-foreground">
            Puede que ya no esté disponible o que el enlace sea viejo.
          </p>
          <Button asChild className="mt-8">
            <Link to="/servicios">Ver todos los tratamientos</Link>
          </Button>
        </div>
        <SiteFooter />
      </div>
    );
  }

  const s = service.data;

  // Una descripción de dos renglones entra entera en el hero; una de veinte
  // no, y ahí hace falta la sección de abajo. El corte por largo es para el
  // caso de un solo párrafo largísimo, que en párrafos no se puede detectar.
  const parrafos = enParrafos(s.description ?? "");
  const hayMas = parrafos.length > 1 || (parrafos[0]?.length ?? 0) > 320;

  return (
    // `clip` en vez de `hidden`: `hidden` crea contenedor de scroll y anula el
    // `sticky` del header.
    <div className="min-h-screen overflow-x-clip">
      <SiteHeader />

      <section className="grid items-stretch gap-y-10 lg:grid-cols-12">
        <div className="px-5 pt-14 lg:col-span-5 lg:col-start-2 lg:flex lg:flex-col lg:justify-center lg:px-0 lg:py-24">
          <Reveal>
            {/* Vuelve al catálogo FILTRADO por la categoría de este
                tratamiento. El «atrás» del navegador ya conserva el filtro
                —ahora vive en la URL— pero este enlace es la otra forma de
                volver, y llevaba siempre al catálogo entero: se perdía el grupo
                que se estaba mirando. */}
            <Link
              to="/servicios"
              search={s.category ? { categoria: aSlug(s.category) } : {}}
              className="text-eyebrow text-muted-foreground underline-offset-8 hover:text-foreground hover:underline"
            >
              ← Tratamientos
            </Link>
          </Reveal>

          <Reveal delay={80}>
            <p className="text-eyebrow mt-10 text-gold">{s.category}</p>
            {/* Dos renglones reservados, entre o no en uno.

                La foto de la derecha no tiene alto propio: la sección es una
                grilla con items-stretch, así que la fila mide lo que mide esta
                columna y la imagen se estira hasta ahí. Como lo único que varía
                entre un tratamiento y otro es si el nombre entra en un renglón
                ("Peeling químico") o en dos ("Radiofrecuencia facial"), esa
                línea de diferencia era toda la diferencia de tamaño entre las
                fotos.

                Reservando el alto acá salen todas iguales solas, a cualquier
                ancho de pantalla — que es lo que no daría clavarle un alto fijo
                en píxeles a la imagen: en una ventana angosta los títulos
                wrapean más, el texto pasaría a ser más alto que la foto y
                volvería el hueco debajo. La unidad `lh` es el alto de renglón
                de este mismo h1, así que sigue a la tipografía si cambia.

                Un nombre de tres renglones volvería a desalinearse; con estos
                seis no pasa, y si aparece se sube el 2 a 3. */}
            <h1 className="display-section mt-5 min-h-[2lh] text-foreground">{s.name}</h1>
          </Reveal>

          <Reveal delay={160}>
            {/* Sólo el arranque, y cortado a seis renglones.

                Lo que sube el centro no es una bajada de dos líneas: son
                descripciones de veinte renglones, con beneficios y frecuencia
                recomendada adentro. Enteras acá, la columna de texto crecía muy
                por debajo del flyer —que tiene su tope en 70vh— y quedaba media
                pantalla de crema vacía al lado, con el precio y el botón de
                reservar empujados fuera de la vista.

                El texto no se pierde: completo y en párrafos, más abajo.

                ── POR QUÉ VA LA DESCRIPCIÓN ENTERA Y NO EL PRIMER PÁRRAFO ──

                Porque el primer párrafo puede no ser una bajada. "Pulidos
                corporales" arranca con "Categoría recomendada:" —una nota que
                quedó pegada del texto que sube el centro— y con eso solo, el
                hero mostraba un renglón suelto, sin sentido, y media pantalla
                vacía debajo del título.

                Unida y cortada a seis renglones, el corte cae donde tenga que
                caer y siempre se lee texto de verdad. Los párrafos siguen
                existiendo abajo, que es donde se leen como párrafos. */}
            {parrafos.length > 0 && (
              <p className="mt-8 line-clamp-6 max-w-md text-[15px] leading-relaxed text-muted-foreground">
                {parrafos.join(" ")}
              </p>
            )}

            {hayMas && (
              <a
                href="#descripcion"
                className="text-eyebrow mt-4 inline-block text-foreground underline-offset-8 hover:underline"
              >
                Seguir leyendo ↓
              </a>
            )}

            {/* Con opciones, la tabla de abajo dice el precio de cada una y
                este bloque sería un tercer número compitiendo con esos dos. Sin
                opciones, es lo de siempre. */}
            {s.variants.length === 0 ? (
              <div className="mt-10 flex items-baseline gap-10 border-t border-border pt-6">
                <div>
                  <p className="text-eyebrow text-muted-foreground/70">Duración</p>
                  <p className="mt-2 font-display text-3xl text-foreground">
                    {s.duration_minutes} min
                  </p>
                </div>
                <div>
                  <p className="text-eyebrow text-muted-foreground/70">Valor</p>
                  <p className="mt-2 font-display text-3xl tabular-nums text-foreground">
                    {formatMoney(s.price)}
                  </p>
                </div>
              </div>
            ) : (
              /* `max-w-md`, el mismo ancho que la bajada de arriba: sin eso la
                 lista se estiraba hasta el borde de la columna y el precio
                 quedaba pegado al canto de la foto, sin aire — se leía como si
                 estuviera cortado. Con el tope queda una franja de crema entre
                 el texto y el flyer, y la lista respeta la misma medida que el
                 resto de la columna. */
              <div className="mt-10 max-w-md border-t border-border pt-6">
                <p className="text-eyebrow text-muted-foreground/70">Opciones</p>
                {/* Cada opción con su duración y su precio, una debajo de la
                    otra. La elección se hace al reservar, no acá: este es el
                    lugar donde se compara, y meter botones sería empezar la
                    reserva en la mitad de la ficha. */}
                <ul className="mt-4">
                  {s.variants.map((v) => (
                    <li
                      key={v.id}
                      className="flex flex-wrap items-baseline justify-between gap-x-5 gap-y-0.5 border-b border-border/60 py-2.5 last:border-0 last:pb-0"
                    >
                      <span className="text-[15px] text-foreground">{v.name}</span>
                      <span className="flex items-baseline gap-3">
                        <span className="text-xs text-muted-foreground/70">
                          {v.duration_minutes} min
                        </span>
                        {/* Un escalón más chico que el precio único de un
                            tratamiento sin opciones: son dos o tres números
                            repetidos, y en el cuerpo grande competían con el
                            título en vez de leerse como una lista. */}
                        <span className="font-display text-xl tabular-nums text-foreground">
                          {formatMoney(v.price)}
                        </span>
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {/* Que son varias sesiones se dice ACÁ, arriba del botón, y no en
                la letra chica de más abajo: es parte de lo que la clienta está
                comprando —tres visitas, no una— y enterarse después de reservar
                es enterarse tarde. Con una sola sesión no aparece nada. */}
            {s.sessions_count > 1 && (
              <p className="mt-8 max-w-md rounded-sm border border-gold/40 bg-gold/5 px-4 py-3 text-sm leading-relaxed text-foreground">
                Este tratamiento son{" "}
                <strong className="font-medium">{s.sessions_count} sesiones</strong>
                {s.session_interval_days > 0
                  ? ` con ${s.session_interval_days} días entre una y otra`
                  : ""}
                . El valor es por el tratamiento completo. Reservás la primera y las siguientes las
                coordinamos con vos en el centro.
              </p>
            )}

            <Button asChild size="lg" className="mt-10 w-fit">
              <Link to="/reservar" search={{ service: s.id }}>
                Reservar este tratamiento
              </Link>
            </Button>
          </Reveal>
        </div>

        {/*
          La imagen del tratamiento, y todo lo que se aprendió mirándola con una
          real cargada:

          · **No se recorta.** Lo que el centro sube son FLYERS, con el nombre,
            la duración y el precio dibujados adentro. `object-cover` —que es lo
            que había— le comía justo eso.
          · **No se encaja en un alto ajeno.** El primer intento fue
            `object-contain` sobre el alto de la columna de texto, y quedó una
            estampilla flotando entre dos franjas de oliva. Ahora la imagen manda:
            se muestra a su ancho completo y la columna crece con ella.
          · **Se ve en el celular.** Antes era `hidden lg:block`, o sea que en un
            teléfono no se veía nunca. Con un flyer eso es esconder el contenido,
            no un adorno.
          · **Las demás se alcanzan.** Antes vivían en una sección aparte, «La
            galería», que era una segunda pantalla repitiendo lo que la ficha ya
            decía. Ahora son miniaturas debajo: se cambia la grande al tocarlas,
            que es como funciona cualquier ficha de producto.

          Columnas 7 a 11: una más que antes, porque un flyer con texto adentro
          necesita ancho para leerse.
        */}
        <div className="mt-12 px-5 lg:col-span-5 lg:col-start-7 lg:mt-0 lg:px-0">
          {activo ? (
            <>
              {/* Este div sigue ocupando el ancho entero de la columna —eso no
                  cambia con `flex`—, pero ya no tiene `surface-olive`: lo que
                  sobra a los costados de la imagen (`max-h-[70vh]` la achica
                  sin estirarla, así que rara vez llena el ancho) queda
                  TRANSPARENTE en vez de pintado. Se ve la crema de la página
                  de fondo, que es el mismo color de todo alrededor, así que no
                  se nota que hay un sobrante.

                  Antes ese sobrante se rellenaba con `surface-olive` —el
                  oliva del header y el footer— y con un flyer cuadrado se
                  notaba: era un verde parecido pero no igual al del fondo que
                  el flyer ya trae dibujado, y esa costura entre los dos
                  verdes se veía como un marco de más. Sacando el color de
                  relleno en vez de intentar igualarlo, no hay costura que
                  pueda desentonar con ningún flyer futuro. */}
              <div className="flex justify-center">
                {activo.kind === "video" ? (
                  /* `controls` y nada de autoplay: un video que arranca solo con
                     sonido es molesto, y en celular se come los datos de alguien
                     que quizás sólo quería el precio. `preload="none"` va por lo
                     mismo — hasta que no le den play sólo baja el poster. */
                  <video
                    src={videoUrl(activo.url, "hero") ?? undefined}
                    poster={videoPosterUrl(activo.url, "hero") ?? undefined}
                    controls
                    preload="none"
                    playsInline
                    /* `max-h-[70vh] w-auto`: la imagen se achica hasta entrar
                       en pantalla manteniendo su proporción, y se ve ENTERA.
                       Antes decía `h-auto w-full`, que la estiraba al ancho de
                       la columna — y con un flyer vertical eso la volvía
                       enorme: había que scrollear dos pantallas para verla. */
                    className="block max-h-[70vh] w-auto max-w-full rounded-sm"
                  />
                ) : (
                  <img
                    src={imageUrl(activo.url, "hero") ?? undefined}
                    alt={`${s.name} en Shiraf`}
                    /* `max-h-[70vh] w-auto`: la imagen se achica hasta entrar
                       en pantalla manteniendo su proporción, y se ve ENTERA.
                       Antes decía `h-auto w-full`, que la estiraba al ancho de
                       la columna — y con un flyer vertical eso la volvía
                       enorme: había que scrollear dos pantallas para verla. */
                    className="block max-h-[70vh] w-auto max-w-full rounded-sm"
                  />
                )}
              </div>

              {/* Las miniaturas sólo si hay más de una: con una sola sería una
                  fila de un elemento señalando lo que ya se está mirando. */}
              {medios.length > 1 && (
                <div className="mt-3 flex flex-wrap gap-3">
                  {medios.map((m, i) => (
                    <button
                      key={m.id}
                      type="button"
                      onClick={() => setMirando(i)}
                      aria-label={`Ver ${m.kind === "video" ? "el video" : "la foto"} ${i + 1}`}
                      aria-current={i === mirando}
                      className={`surface-olive grain relative h-20 w-20 shrink-0 overflow-hidden rounded-sm transition-opacity ${
                        i === mirando
                          ? "ring-2 ring-gold ring-offset-2 ring-offset-background"
                          : "opacity-70 hover:opacity-100"
                      }`}
                    >
                      <img
                        /* Del video se muestra un fotograma: bajar el archivo
                           entero para pintar un cuadradito de 80px no tiene
                           sentido. Cloudinary lo devuelve desde la misma URL. */
                        src={
                          (m.kind === "video"
                            ? videoPosterUrl(m.url, "thumb")
                            : imageUrl(m.url, "thumb")) ?? undefined
                        }
                        alt=""
                        loading="lazy"
                        className="h-full w-full object-cover"
                      />
                      {m.kind === "video" && (
                        <span
                          className="absolute inset-0 flex items-center justify-center bg-black/25"
                          aria-hidden="true"
                        >
                          <Play className="h-5 w-5 fill-white text-white" />
                        </span>
                      )}
                    </button>
                  ))}
                </div>
              )}
            </>
          ) : (
            /* Sin ninguna foto queda el campo oliva con grano, que era el
               marcador de posición desde el principio del diseño. */
            <div className="surface-olive grain hidden aspect-[3/4] rounded-sm lg:block" />
          )}
        </div>
      </section>

      {/* Pegada al borde inferior de la foto, igual que en el home: con margen
          la línea quedaba flotando en una franja de crema vacía, sin tocar ni
          el hero ni lo que sigue. En mobile la foto está oculta, así que ahí sí
          hace falta aire entre el botón y el filete. */}
      <OrganicRule className="mt-20 lg:mt-0" />

      {/* La descripción completa, en párrafos y en una medida de lectura.
          Sólo aparece cuando no entró entera en el hero: con un tratamiento de
          dos renglones sería repetir arriba y abajo lo mismo.

          `scroll-mt-28` porque el header es sticky: sin eso el enlace «Seguir
          leyendo» deja el título justo debajo de la barra. */}
      {hayMas && (
        <section id="descripcion" className="grid scroll-mt-28 lg:grid-cols-12">
          <div className="px-5 py-20 lg:col-span-7 lg:col-start-2 lg:px-0 lg:py-24">
            <Reveal>
              <p className="text-eyebrow text-muted-foreground">En qué consiste</p>
              <h2 className="display-section mt-5 text-foreground">El tratamiento</h2>
            </Reveal>

            <Reveal delay={80}>
              <div className="mt-10 max-w-prose space-y-5 text-[15px] leading-relaxed text-muted-foreground">
                {parrafos.map((p, i) => (
                  <p key={i}>{p}</p>
                ))}
              </div>
            </Reveal>
          </div>
        </section>
      )}

      {/* Acá iba «La galería»: una sección aparte que listaba el resto de las
          fotos y los videos debajo del hero, con su propio título a media
          pantalla. Se sacó porque repetía lo que la ficha ya dice y obligaba a
          scrollear para ver una segunda foto.

          Esas fotos no se perdieron: ahora son las miniaturas de arriba, al pie
          de la imagen grande. */}

      {/* Quién lo realiza. Los horarios que se muestran son los de atención de
          cada profesional — datos públicos de professional_schedules — no la
          disponibilidad real, que se calcula recién en el formulario. */}
      <section className="grid lg:grid-cols-12">
        <div className="px-5 py-20 lg:col-span-9 lg:col-start-2 lg:px-0 lg:py-28">
          <Reveal>
            <p className="text-eyebrow text-muted-foreground">Quién lo realiza</p>
            <h2 className="display-section mt-5 text-foreground">Profesionales</h2>
          </Reveal>

          <div className="mt-14 grid gap-x-12 gap-y-12 sm:grid-cols-2">
            {team.data?.map((p, i) => (
              <Reveal key={p.id} delay={i * 80}>
                <span className="numeral text-gold">{String(i + 1).padStart(2, "0")}</span>
                <h3 className="mt-4 font-display text-3xl leading-tight text-foreground">
                  {p.full_name}
                </h3>
                <p className="text-eyebrow mt-3 text-gold">{p.specialty}</p>
                <p className="mt-4 text-sm leading-relaxed text-muted-foreground">{p.bio}</p>

                <p className="text-eyebrow mt-6 text-muted-foreground/70">Atiende</p>
                {/* Un renglón por DÍA con todos sus tramos, igual que en
                    /profesionales y que en el panel. Este lugar se me había
                    pasado: acá seguía saliendo "Lunes · 09:00 a 13:00" y
                    "Lunes · 15:00 a 17:00" en dos renglones, que se lee como dos
                    lunes distintos. */}
                <ul className="mt-3 space-y-1 text-sm text-muted-foreground">
                  {agruparPorDia(p.professional_schedules).map(({ weekday, tramos }) => (
                    <li key={weekday}>
                      {WEEKDAYS[weekday]} ·{" "}
                      {tramos
                        .map(
                          (t) =>
                            `${soloHoraYMinutos(t.start_time)} a ${soloHoraYMinutos(t.end_time)}`,
                        )
                        .join(" y ")}
                    </li>
                  ))}
                </ul>

                <Link
                  to="/reservar"
                  search={{ service: s.id, professional: p.id }}
                  className="text-eyebrow mt-6 inline-block text-foreground underline-offset-8 hover:underline"
                >
                  Reservar con {p.full_name.split(" ")[0]} →
                </Link>
              </Reveal>
            ))}

            {team.data?.length === 0 && (
              <p className="text-sm text-muted-foreground">
                Todavía no hay profesionales asignadas a este tratamiento.
              </p>
            )}
          </div>
        </div>
      </section>

      {/* Los pasos de la reserva, explicados antes de entrar al formulario. */}
      <section className="surface-olive grain">
        <div className="grid lg:grid-cols-12">
          <div className="px-5 py-24 lg:col-span-9 lg:col-start-2 lg:px-0 lg:py-32">
            <Reveal>
              <p className="text-eyebrow text-primary-foreground/60">Cómo se reserva</p>
              <h2 className="display-section mt-5 text-primary-foreground">Tres pasos</h2>
            </Reveal>

            <ol className="mt-14 grid gap-10 sm:grid-cols-3">
              {STEPS.map((step, i) => (
                <Reveal as="li" key={step.title} delay={i * 90}>
                  <span className="numeral text-gold">{String(i + 1).padStart(2, "0")}</span>
                  <h3 className="mt-4 font-display text-2xl leading-tight text-primary-foreground">
                    {step.title}
                  </h3>
                  <p className="mt-3 text-sm leading-relaxed text-primary-foreground/70">
                    {step.text}
                  </p>
                </Reveal>
              ))}
            </ol>

            <Reveal delay={280}>
              <Button asChild size="lg" variant="secondary" className="mt-14">
                <Link to="/reservar" search={{ service: s.id }}>
                  Reservar {s.name}
                </Link>
              </Button>
            </Reveal>
          </div>
        </div>
      </section>

      {/* La sección de acá arriba es oliva, así que el footer va pegado. */}
      <SiteFooter flush />
    </div>
  );
}
