import { useMemo, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { SiteHeader } from "@/components/site-header";
import { SiteFooter } from "@/components/site-footer";
import { Reveal } from "@/components/reveal";
import { supabase } from "@/integrations/supabase/client";
import { imageUrl } from "@/lib/cloudinary";
import { formatMoney } from "@/lib/shiraf";
import { cn } from "@/lib/utils";

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

/** Ancla estable para cada categoría: "Depilación" → "depilacion". */
function categorySlug(category: string): string {
  return category
    .normalize("NFD") // separa la tilde de la letra para poder descartarla
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

function CategoryPill({
  label,
  count,
  active,
  onClick,
}: {
  label: string;
  count: number;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        "group inline-flex items-center gap-2.5 rounded-full border px-5 py-2.5 shadow-soft transition-colors",
        active
          ? "border-gold bg-gold/10"
          : "border-border bg-card hover:border-gold hover:bg-gold/10",
      )}
    >
      <span className="text-eyebrow text-foreground">{label}</span>
      <span
        className={cn(
          "numeral transition-colors",
          active ? "text-gold" : "text-muted-foreground group-hover:text-gold",
        )}
      >
        {count}
      </span>
    </button>
  );
}

function ServicesPage() {
  /* `null` = "Todos". Es el estado inicial, así la primera vista sigue siendo
     el catálogo completo como hasta ahora. */
  const [activeCategory, setActiveCategory] = useState<string | null>(null);

  const services = useQuery({
    queryKey: ["services", "published"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("services")
        .select("id, name, description, category, duration_minutes, price, image_url")
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

  /* Si la categoría elegida deja de existir (se despublicó el último
     tratamiento del grupo), cae a "Todos" en vez de dejar la página vacía. */
  const visibleGroups = useMemo(() => {
    if (!activeCategory) return grouped;
    const match = grouped.filter(([category]) => category === activeCategory);
    return match.length > 0 ? match : grouped;
  }, [grouped, activeCategory]);

  return (
    <div className="min-h-screen">
      <SiteHeader />

      {/*
        Cabecera compacta. En hero ocupaba casi una pantalla entera antes del
        primer tratamiento: acá el titular y la bajada comparten fila, y el
        espacio que sobra lo usa el filtro de categorías, que deja en pantalla
        sólo el grupo elegido en vez de obligar a scrollear todo el catálogo.
      */}
      <section className="grid lg:grid-cols-12">
        <div className="px-5 pt-14 lg:col-span-10 lg:col-start-2 lg:px-0 lg:pt-20">
          <Reveal>
            <p className="text-eyebrow text-muted-foreground">Carta de tratamientos</p>

            <div className="mt-6 grid gap-6 lg:grid-cols-[1.1fr_1fr] lg:items-end lg:gap-16">
              {/*
                El título replantea el catálogo alrededor de lo que le pasa a la
                clienta en vez de listar el inventario del centro.
              */}
              <div>
                {/* `text-balance`: sin eso el quiebre dejaba "hoy?" solo en la
                    segunda línea. */}
                <h1 className="display-section text-balance text-foreground">
                  ¿Qué necesita tu piel hoy?
                </h1>
                <div className="gold-rule mt-6 w-24" />
              </div>
              <p className="max-w-lg text-[15px] leading-relaxed text-muted-foreground lg:pb-2">
                Cada tratamiento se realiza con cosmética profesional y una evaluación previa de la
                piel. Los precios pueden ajustarse según la zona a tratar.
              </p>
            </div>

            {/* Como texto suelto no se leían como categorías: parecían una
                bajada más. En cápsula, con borde y con la cantidad de
                tratamientos al lado, se entiende que son botones. */}
            {grouped.length > 1 && (
              <div
                role="group"
                aria-label="Filtrar por categoría"
                className="mt-10 border-t border-border pt-7"
              >
                <p className="text-eyebrow text-muted-foreground/70">Ver por categoría</p>
                <ul className="mt-4 flex flex-wrap gap-2.5">
                  {/* "Todos" primero y activo por defecto: sin él no había forma
                      de volver al catálogo completo después de filtrar. */}
                  <li>
                    <CategoryPill
                      label="Todos"
                      count={services.data?.length ?? 0}
                      active={activeCategory === null}
                      onClick={() => setActiveCategory(null)}
                    />
                  </li>
                  {grouped.map(([category, items]) => (
                    <li key={category}>
                      <CategoryPill
                        label={category}
                        count={items.length}
                        active={activeCategory === category}
                        onClick={() => setActiveCategory(category)}
                      />
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </Reveal>
        </div>
      </section>

      <section className="grid lg:grid-cols-12">
        <div className="px-5 pt-14 pb-24 lg:col-span-10 lg:col-start-2 lg:px-0 lg:pt-16">
          {visibleGroups.map(([category, items], groupIndex) => (
            <Reveal key={category} delay={groupIndex * 60} className="mb-16">
              {/* `scroll-mt-28`: el header es sticky y si no se le descuenta el
                  alto, al saltar desde el índice tapa el nombre de la categoría. */}
              <p
                id={categorySlug(category)}
                className="text-eyebrow scroll-mt-28 border-b border-border pb-3 text-gold"
              >
                {category}
              </p>

              {/* Ficha por tratamiento en vez de renglones: la lista de texto
                  corrido no dejaba mirar un tratamiento a la vez. */}
              <ul className="mt-8 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
                {items.map((s) => (
                  <li key={s.id}>
                    <Link
                      to="/servicios/$serviceId"
                      params={{ serviceId: s.id }}
                      className="group flex h-full flex-col overflow-hidden rounded-sm border border-border bg-card shadow-soft transition-shadow duration-500 hover:shadow-lift"
                    >
                      <div className="relative aspect-[4/3] overflow-hidden bg-primary">
                        {s.image_url ? (
                          <img
                            src={imageUrl(s.image_url, "card") ?? undefined}
                            alt=""
                            loading="lazy"
                            className="h-full w-full object-cover transition-transform duration-700 ease-out group-hover:scale-105"
                          />
                        ) : (
                          /* Sin foto cargada: inicial del tratamiento sobre el
                             oliva con grano, para que el hueco se lea como
                             decisión y no como imagen rota. */
                          <div className="grain absolute inset-0 flex items-center justify-center">
                            <span className="font-display text-7xl text-primary-foreground/25">
                              {s.name.charAt(0)}
                            </span>
                          </div>
                        )}
                      </div>

                      <div className="flex flex-1 flex-col p-6">
                        <h2 className="font-display text-2xl leading-tight text-foreground">
                          {s.name}
                        </h2>
                        <p className="mt-3 line-clamp-2 flex-1 text-sm leading-relaxed text-muted-foreground">
                          {s.description}
                        </p>

                        <div className="mt-6 flex items-baseline justify-between border-t border-border pt-4">
                          <span className="font-display text-2xl tabular-nums text-foreground">
                            {formatMoney(s.price)}
                          </span>
                          <span className="text-eyebrow text-muted-foreground/70">
                            {s.duration_minutes} min
                          </span>
                        </div>

                        <span className="text-eyebrow mt-4 text-gold underline-offset-8 group-hover:underline">
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
