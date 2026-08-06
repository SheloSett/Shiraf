import { useMemo } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { SiteHeader } from "@/components/site-header";
import { SiteFooter } from "@/components/site-footer";
import { Reveal } from "@/components/reveal";
import { supabase } from "@/integrations/supabase/client";
import { formatMoney } from "@/lib/shiraf";

export const Route = createFileRoute("/servicios/")({
  head: () => ({
    meta: [
      { title: "Servicios y tratamientos — Shiraf" },
      {
        name: "description",
        content:
          "Limpieza facial, peelings, masajes, drenaje linfático, depilación definitiva y aparatología. Precios y duración de cada tratamiento.",
      },
      { property: "og:title", content: "Servicios y tratamientos — Shiraf" },
      {
        property: "og:description",
        content: "Conocé todos los tratamientos faciales, corporales y de aparatología de Shiraf.",
      },
    ],
  }),
  component: ServicesPage,
});

function ServicesPage() {
  const services = useQuery({
    queryKey: ["services", "published"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("services")
        .select("id, name, description, category, duration_minutes, price")
        .eq("is_published", true)
        .order("category")
        .order("name");
      if (error) throw error;
      return data;
    },
  });

  const grouped = useMemo(() => {
    const groups = new Map<string, NonNullable<typeof services.data>>();
    for (const service of services.data ?? []) {
      const bucket = groups.get(service.category);
      if (bucket) bucket.push(service);
      else groups.set(service.category, [service]);
    }
    return [...groups.entries()];
  }, [services.data]);

  return (
    <div className="min-h-screen">
      <SiteHeader />

      <section className="grid lg:grid-cols-12">
        <div className="px-5 pt-16 lg:col-span-8 lg:col-start-2 lg:px-0 lg:pt-24">
          <Reveal>
            <p className="text-eyebrow text-muted-foreground">Carta de tratamientos</p>
            {/*
              El título replantea el catálogo alrededor de lo que le pasa a la
              clienta en vez de listar el inventario del centro.
            */}
            <h1 className="display-hero mt-6 text-foreground">
              ¿Qué necesita
              <br />
              tu piel hoy?
            </h1>
            <div className="gold-rule mt-10 w-24" />
            <p className="mt-8 max-w-lg text-[15px] leading-relaxed text-muted-foreground">
              Cada tratamiento se realiza con cosmética profesional y una evaluación previa de la
              piel. Los precios pueden ajustarse según la zona a tratar.
            </p>
          </Reveal>
        </div>
      </section>

      <section className="grid lg:grid-cols-12">
        <div className="px-5 pt-20 pb-24 lg:col-span-10 lg:col-start-2 lg:px-0 lg:pt-28">
          {grouped.map(([category, items], groupIndex) => (
            <Reveal key={category} delay={groupIndex * 60} className="mb-16">
              <p className="text-eyebrow border-b border-border pb-3 text-gold">{category}</p>

              <ul>
                {items.map((s) => (
                  <li key={s.id}>
                    <Link
                      to="/servicios/$serviceId"
                      params={{ serviceId: s.id }}
                      className="group grid grid-cols-1 items-baseline gap-x-8 gap-y-2 border-b border-border py-7 sm:grid-cols-[1fr_auto]"
                    >
                      <div>
                        <h2 className="font-display text-[30px] leading-tight text-foreground transition-all duration-500 ease-out group-hover:translate-x-1.5">
                          {s.name}
                        </h2>
                        <p className="mt-2 max-w-xl text-sm leading-relaxed text-muted-foreground">
                          {s.description}
                        </p>
                      </div>

                      <div className="flex items-baseline gap-6 sm:flex-col sm:items-end sm:gap-2">
                        <span className="font-display text-2xl tabular-nums text-foreground">
                          {formatMoney(s.price)}
                        </span>
                        <span className="text-eyebrow text-muted-foreground/70">
                          {s.duration_minutes} min
                        </span>
                        <span className="text-eyebrow hidden text-gold underline-offset-8 group-hover:underline sm:mt-2 sm:block">
                          Ver tratamiento →
                        </span>
                      </div>
                    </Link>
                  </li>
                ))}
              </ul>
            </Reveal>
          ))}

          {services.isLoading && (
            <p className="text-sm text-muted-foreground">Cargando servicios…</p>
          )}
        </div>
      </section>

      <SiteFooter />
    </div>
  );
}
