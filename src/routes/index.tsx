import { useMemo, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import heroImage from "@/assets/hero-spa.jpg";
import { SiteHeader } from "@/components/site-header";
import { SiteFooter } from "@/components/site-footer";
import { OrganicRule } from "@/components/organic-rule";
import { Reveal } from "@/components/reveal";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
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
    ],
  }),
  component: Home,
});

function Home() {
  const services = useQuery({
    queryKey: ["services", "published", "featured"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("services")
        .select("id, name, description, category, duration_minutes, price, image_url")
        .eq("is_published", true)
        .order("category")
        .order("price", { ascending: true })
        .limit(6);
      if (error) throw error;
      return data;
    },
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
    queryFn: async () => {
      const { data, error } = await supabase
        .from("professionals")
        .select("id, full_name, specialty, bio")
        .eq("is_active", true)
        .limit(3);
      if (error) throw error;
      return data;
    },
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
      */}
      <section className="grid items-stretch gap-y-10 lg:min-h-[86vh] lg:grid-cols-12">
        <div className="px-5 pt-14 lg:col-span-5 lg:col-start-2 lg:flex lg:flex-col lg:justify-center lg:px-0 lg:py-20">
          <Reveal>
            <p className="text-eyebrow text-muted-foreground">Centro de estética</p>
          </Reveal>

          <Reveal delay={90}>
            {/* Sin una palabra en color de acento: ese recurso es la firma más
                reconocible de las landings generadas. El énfasis lo da el
                tamaño, no el color. */}
            <h1 className="display-hero mt-7 text-foreground">
              Calma,
              <br />
              belleza
              <br />y bienestar
            </h1>
          </Reveal>

          <Reveal delay={180}>
            <p className="mt-9 max-w-sm text-[15px] leading-relaxed text-muted-foreground">
              Tratamientos faciales, corporales y aparatología pensados uno por uno. Elegí tu
              servicio, el día, el horario y la profesional que te acompaña.
            </p>
          </Reveal>

          <Reveal delay={260}>
            <div className="mt-10 flex flex-wrap items-center gap-6">
              <Button asChild size="lg">
                <Link to="/reservar">Reservar turno</Link>
              </Button>
              <Link
                to="/servicios"
                className="text-eyebrow text-muted-foreground underline-offset-8 transition-colors hover:text-foreground hover:underline"
              >
                Ver tratamientos
              </Link>
            </div>
          </Reveal>
        </div>

        <div className="lg:col-span-5 lg:col-start-8">
          {/* object-position alto: el original es 4:3 y el contenedor es más
              alto que ancho, así que al recortar conviene privilegiar la parte
              superior de la escena en vez de centrarla. */}
          <img
            src={heroImage}
            alt="Sala de tratamientos de Shiraf con paredes verde oliva y detalles dorados"
            width={1408}
            height={1008}
            className="h-[58vh] w-full object-cover object-[50%_28%] lg:h-full"
          />
        </div>
      </section>

      {/* El filete que marcaste separando el hero del resto. */}
      <OrganicRule className="mt-20 lg:mt-28" />

      {/*
        Reemplaza la franja de tres íconos (Leaf / Clock / Star), que es el
        componente más reconocible de las landings generadas. Una sola frase
        grande, descentrada, dice lo mismo con más carácter.
      */}
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

      {/*
        Carta de tratamientos. El índice numerado a todo el ancho quedaba
        desparramado: nombre a la izquierda, precio contra el borde derecho y un
        vacío enorme en el medio.
        Acá se agrupa por categoría en dos columnas y el precio se ata al nombre
        con guía punteada — el recurso de las cartas de restaurante y los
        índices de libro. Más denso, más cálido y sin una sola caja.
      */}
      <section>
        <div className="grid lg:grid-cols-12">
          <div className="px-5 pt-20 lg:col-span-9 lg:col-start-2 lg:px-0 lg:pt-28">
            <Reveal className="flex flex-wrap items-end justify-between gap-6">
              <div>
                <p className="text-eyebrow text-muted-foreground">Nuestros tratamientos</p>
                <h2 className="display-section mt-5 text-foreground">Servicios</h2>
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
                              isActive ? "translate-x-1.5 text-foreground" : "text-muted-foreground"
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
                caja vacía — y está dimensionado en 4:5 justamente para que la
                foto del tratamiento entre acá cuando la tengas, sin rehacer
                nada: se agrega un <img> de fondo y el texto queda encima.
              */}
              {active && (
                <div className="surface-olive grain relative hidden aspect-4/5 flex-col justify-end overflow-hidden p-10 lg:sticky lg:top-28 lg:flex">
                  {active.image_url && (
                    <>
                      <img
                        src={active.image_url}
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

      {/*
        Campo de color a sangre con grano. El oliva deja de ser un detalle de
        acento y pasa a ocupar la pantalla completa.
      */}
      <section className="surface-olive grain mt-24 lg:mt-36">
        <div className="grid lg:grid-cols-12">
          <div className="px-5 py-24 lg:col-span-10 lg:col-start-2 lg:px-0 lg:py-32">
            <Reveal>
              <p className="text-eyebrow text-primary-foreground/60">El equipo</p>
              <h2 className="display-section mt-5 text-primary-foreground">Profesionales</h2>
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
                Conocer al equipo
              </Link>
            </Reveal>
          </div>
        </div>
      </section>

      <section className="grid lg:grid-cols-12">
        <Reveal className="px-5 py-28 lg:col-span-7 lg:col-start-2 lg:px-0 lg:py-40">
          <h2 className="display-section text-foreground">
            Reservá tu próximo
            <br />
            momento de calma.
          </h2>
          <p className="mt-8 max-w-sm text-[15px] leading-relaxed text-muted-foreground">
            Elegís el tratamiento, el día y la profesional. Nosotros confirmamos el turno.
          </p>
          <Button asChild size="lg" className="mt-10">
            <Link to="/reservar">Sacar turno</Link>
          </Button>
        </Reveal>
      </section>

      <SiteFooter />
    </div>
  );
}
