import { useMemo } from "react";
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
   * La galería sin la portada. YA NO SE USA — ver el bloque comentado más
   * abajo, donde está el porqué.
   *
   * Va acá y no después de los early returns de abajo porque es un hook: si
   * quedara ahí, se ejecutaría en unos renders y en otros no, que es lo único
   * que React no perdona.
   *
   * La portada se descarta por URL y no por posición: es lo que hace el trigger
   * de la base —la primera IMAGEN, salteando videos— y compararla así evita
   * tener que repetir esa regla acá y que las dos se desincronicen.
   */
  // Sin uso desde que se sacó «La galería». Se deja comentado con ella:
  //
  // const gallery = useMemo(() => {
  //   const media = service.data?.service_media ?? [];
  //   const cover = service.data?.image_url;
  //   return [...media].sort((a, b) => a.position - b.position).filter((m) => m.url !== cover);
  // }, [service.data]);

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

        {/* Mismo campo oliva con grano que el panel del home: acá también es
            donde entra la foto del tratamiento cuando la tengas. */}
        {/* La foto del tratamiento. Sin foto queda el campo oliva con grano,
            que era el marcador de posición desde el principio. */}
        {/* Columnas 8 a 11, con la 12 libre.

            A diferencia del hero del home, acá la foto NO sangra hasta el borde
            de la pantalla. Pegada al borde y con este ancho quedaba como una
            tira contra el margen; suelta, el margen derecho de una columna es
            el espejo del que ya tiene el texto sobre la izquierda, y la imagen
            se apoya en la grilla en vez de escaparse de ella. */}
        <div className="surface-olive grain relative hidden overflow-hidden lg:col-span-4 lg:col-start-8 lg:block">
          {s.image_url && (
            <img
              src={imageUrl(s.image_url, "hero") ?? undefined}
              alt={`Tratamiento de ${s.name} en Shiraf`}
              /* object-CONTAIN y no object-cover, que era lo que había.
                 `cover` llena el hueco recortando lo que sobre, y para una foto
                 de la camilla está bien: da igual dónde se corte. Pero acá lo
                 que se sube no siempre es una foto — el centro carga FLYERS, con
                 el nombre del tratamiento, el precio y la duración dibujados
                 adentro. A un flyer recortarlo le come justo eso.
                 `contain` lo muestra entero y lo que sobra queda del campo oliva
                 con grano, que ya estaba pensado como fondo. */
              className="absolute inset-0 h-full w-full object-contain"
            />
          )}
        </div>
      </section>

      {/* Pegada al borde inferior de la foto, igual que en el home: con margen
          la línea quedaba flotando en una franja de crema vacía, sin tocar ni
          el hero ni lo que sigue. En mobile la foto está oculta, así que ahí sí
          hace falta aire entre el botón y el filete. */}
      <OrganicRule className="mt-20 lg:mt-0" />

      {/* ── «La galería» SACADA (23/8/2026, decisión del centro) ─────────────
          Acá iba una sección que listaba el resto de las fotos y los videos del
          tratamiento, debajo del hero.

          Se saca porque no aporta: lo que el centro sube es UN flyer por
          tratamiento —con el nombre, la duración y el precio dibujados adentro—
          y ese flyer ya es la portada, que se ve arriba a media pantalla.
          La galería quedaba entonces como una segunda fila de imágenes sueltas,
          repitiendo o desordenando lo que la ficha ya dice.

          Lo que NO se toca, a propósito:
            · se pueden seguir cargando varias fotos y videos desde el panel;
            · el trigger sync_service_cover sigue eligiendo la portada;
            · si algún día se quiere mostrar de vuelta, es descomentar esto.

          El código queda comentado y no borrado para que se vea qué había y por
          qué se fue.

      {gallery.length > 0 && (
        <>
          … la sección entera, con su <Reveal>, la grilla de 3 columnas y el
          <video controls preload="none"> para los videos …
        </>
      )}
      ─────────────────────────────────────────────────────────────────────── */}

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
