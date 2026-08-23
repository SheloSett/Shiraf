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
import type { RtaProfesionalesConHorarios, RtaServicio } from "@/lib/api-tipos";
import { imageUrl, videoPosterUrl, videoUrl } from "@/lib/cloudinary";
import { formatMoney, WEEKDAYS } from "@/lib/shiraf";

export const Route = createFileRoute("/servicios/$serviceId")({
  head: () => ({
    meta: [
      { title: "Tratamiento — Shiraf" },
      {
        name: "description",
        content:
          "Detalle del tratamiento: en qué consiste, cuánto dura, quién lo realiza y cómo reservar tu turno en Shiraf.",
      },
    ],
  }),
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

function ServiceDetail() {
  const { serviceId } = Route.useParams();

  const service = useQuery({
    queryKey: ["service", serviceId],
    queryFn: async () => (await api<RtaServicio>(`/api/publico/servicios/${serviceId}`)).servicio,
  });

  const team = useQuery({
    queryKey: ["service-professionals", serviceId],
    // El filtro por is_active ahora lo hace el servidor, en la consulta.
    queryFn: async () =>
      (await api<RtaProfesionalesConHorarios>(`/api/publico/servicios/${serviceId}/profesionales`))
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

  return (
    // `clip` en vez de `hidden`: `hidden` crea contenedor de scroll y anula el
    // `sticky` del header.
    <div className="min-h-screen overflow-x-clip">
      <SiteHeader />

      <section className="grid items-stretch gap-y-10 lg:grid-cols-12">
        <div className="px-5 pt-14 lg:col-span-5 lg:col-start-2 lg:flex lg:flex-col lg:justify-center lg:px-0 lg:py-24">
          <Reveal>
            <Link
              to="/servicios"
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
            <p className="mt-8 max-w-md text-[15px] leading-relaxed text-muted-foreground">
              {s.description}
            </p>

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
              <div className="surface-olive grain overflow-hidden rounded-sm">
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
                    className="block h-auto w-full"
                  />
                ) : (
                  <img
                    src={imageUrl(activo.url, "hero") ?? undefined}
                    alt={`${s.name} en Shiraf`}
                    className="block h-auto w-full"
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
                <ul className="mt-3 space-y-1 text-sm text-muted-foreground">
                  {[...p.professional_schedules]
                    .sort((a, b) => a.weekday - b.weekday)
                    .map((sch, index) => (
                      <li key={index}>
                        {WEEKDAYS[sch.weekday]} · {sch.start_time.slice(0, 5)} a{" "}
                        {sch.end_time.slice(0, 5)}
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
