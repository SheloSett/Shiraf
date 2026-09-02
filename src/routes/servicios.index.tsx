import { useMemo } from "react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { SiteHeader } from "@/components/site-header";
import { SiteFooter } from "@/components/site-footer";
import { Reveal } from "@/components/reveal";
import { api } from "@/lib/api";
import type { RtaServicios } from "@/lib/api-tipos";
import { imageUrl } from "@/lib/cloudinary";
import { aSlug, formatMoney, precioYDuracion } from "@/lib/shiraf";
import { cn } from "@/lib/utils";

/**
 * El filtro de categoría, en la URL: /servicios?categoria=cejas-y-pestanas
 *
 * Vivía en un `useState`, y ahí se perdía al navegar: filtrar por Facial, entrar
 * a un tratamiento y volver con el botón «atrás» devolvía el catálogo entero,
 * porque la pantalla se monta de nuevo y el estado arranca vacío. En la URL, el
 * «atrás» del navegador vuelve a la dirección filtrada y el filtro sigue puesto.
 *
 * De paso, la vista filtrada se puede compartir por link.
 *
 * Viaja el slug y no el nombre —"cejas-y-pestanas" y no "Cejas y pestañas"—
 * porque es lo que se lee en una URL sin escaparse, y es el mismo cálculo que ya
 * usan las anclas de cada grupo.
 *
 * Clave opcional y no obligatoria en `undefined`: con `exactOptionalPropertyTypes`
 * esa diferencia obliga a pasar `search` en cada <Link to="/servicios">.
 */
type Search = { categoria?: string };

export const Route = createFileRoute("/servicios/")({
  // Pasa por `aSlug` lo que venga: el `?categoria=` lo puede escribir cualquiera
  // a mano, y así "Facial" o "FACIAL" encuentran igual a "facial". Una categoría
  // inventada no rompe nada — abajo cae al catálogo completo.
  validateSearch: (search: Record<string, unknown>): Search => {
    const crudo = search["categoria"];
    if (typeof crudo !== "string" || !crudo.trim()) return {};
    return { categoria: aSlug(crudo) };
  },
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

/**
 * Ancla estable para cada categoría: "Depilación" → "depilacion".
 *
 * El cuerpo se mudó a `aSlug` en src/lib/shiraf.ts y quedó comentado acá abajo,
 * no borrado, para que se vea que es EXACTAMENTE el mismo cálculo y no una
 * versión parecida. Se mudó porque ahora también lo necesita el servidor, que
 * es quien escribe el slug de cada tratamiento: dos copias de esta función es
 * la forma segura de que un día el enlace de la pantalla apunte a una URL que
 * el servidor nunca guardó.
 *
 *   function categorySlug(category: string): string {
 *     return category
 *       .normalize("NFD") // separa la tilde de la letra para poder descartarla
 *       .replace(/\p{Diacritic}/gu, "")
 *       .toLowerCase()
 *       .replace(/[^a-z0-9]+/g, "-")
 *       .replace(/^-|-$/g, "");
 *   }
 *
 * Se conserva el nombre local en vez de llamar a `aSlug` derecho en el JSX:
 * acá abajo lo que se arma es un ancla de la misma página (#depilacion), que no
 * tiene nada que ver con la URL de un tratamiento aunque el cálculo coincida.
 */
function categorySlug(category: string): string {
  return aSlug(category);
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
  /* Sin `?categoria=` es "Todos": la primera vista sigue siendo el catálogo
     completo, como hasta ahora. */
  const { categoria } = Route.useSearch();
  const navigate = useNavigate();

  /**
   * Cambia el filtro escribiéndolo en la URL. `null` = Todos.
   *
   * `replace: true` para no dejar una entrada de historial por cada cápsula que
   * se toca: si no, después de probar cuatro categorías hay que apretar «atrás»
   * cuatro veces para salir de la pantalla.
   */
  function elegirCategoria(category: string | null) {
    void navigate({
      to: "/servicios",
      search: category ? { categoria: categorySlug(category) } : {},
      replace: true,
    });
  }

  const services = useQuery({
    queryKey: ["services", "published"],
    queryFn: async () => (await api<RtaServicios>("/api/publico/servicios")).servicios,
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
    if (!categoria) return grouped;
    const match = grouped.filter(([category]) => categorySlug(category) === categoria);
    return match.length > 0 ? match : grouped;
  }, [grouped, categoria]);

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
                {/* `text-balance`: sin eso el quiebre dejaba la última palabra
                    sola en la segunda línea. */}
                {/* Titular anterior, cambiado a pedido del centro. Lo dejo acá
                    por si quieren volver:

                    ¿Qué necesita tu piel hoy?

                    El nuevo llegó escrito "Como te vas Consentir hoy" — así está
                    en TODO.md — y la primera vez se copió tal cual. Va corregido
                    a pedido: tilde en "Cómo", la "a" que faltaba, y "consentir"
                    en minúscula. Es un h1 del sitio público; sin corregir se lee
                    como error de tipeo, no como decisión. Las palabras son las
                    que eligieron ellas, no se cambió ninguna. */}
                <h1 className="display-section text-balance text-foreground">
                  Cómo te vas a consentir hoy
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
                      active={!categoria}
                      onClick={() => elegirCategoria(null)}
                    />
                  </li>
                  {grouped.map(([category, items]) => (
                    <li key={category}>
                      <CategoryPill
                        label={category}
                        count={items.length}
                        active={categoria === categorySlug(category)}
                        onClick={() => elegirCategoria(category)}
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
              {/* El nombre de la categoría era un `text-eyebrow` dorado: 11px
                  con 0.22em de tracking, y el dorado (L 0.755) sobre la crema
                  casi no tiene contraste. Encabezando una grilla de fichas
                  grandes, no se leía como el título de nada — parecía el pie de
                  la línea de arriba.

                  Ahora es lo que es: el título de la sección, en Bodoni y en
                  color de texto. El dorado y las versalitas siguen estando en
                  los rótulos chicos («Ver por categoría», «Ver tratamiento»),
                  que es donde ese estilo hace su trabajo. */}
              <div
                id={categorySlug(category)}
                className="flex scroll-mt-28 items-baseline justify-between gap-6 border-b border-border pb-3"
              >
                <h2 className="font-display text-3xl leading-tight text-foreground">{category}</h2>
                <span className="text-eyebrow shrink-0 text-muted-foreground/70">
                  {items.length} {items.length === 1 ? "tratamiento" : "tratamientos"}
                </span>
              </div>

              {/* Ficha por tratamiento en vez de renglones: la lista de texto
                  corrido no dejaba mirar un tratamiento a la vez. */}
              <ul className="mt-8 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
                {items.map((s) => (
                  <li key={s.id}>
                    {/* Comentadas, no borradas: mandaban el UUID, que es lo que
                        dejaba /servicios/11111111-1111-4111-8111-... en la
                        barra del navegador.

                          to="/servicios/$serviceId"
                          params={{ serviceId: s.id }}

                        El `?? s.id` no es decorativo: `slug` es opcional en la
                        base, y una ficha sin slug tiene que enlazar igual. La
                        ruta acepta las dos formas. */}
                    <Link
                      to="/servicios/$slug"
                      params={{ slug: s.slug ?? s.id }}
                      className="group flex h-full flex-col overflow-hidden rounded-sm border border-border bg-card shadow-soft transition-shadow duration-500 hover:shadow-lift"
                    >
                      {/* La foto ENTERA, no un recorte de la foto.

                          Esto era `aspect-[4/3]` con `object-cover`: una caja
                          apaisada comiéndose un flyer vertical. De una imagen
                          3:4 se veía poco más de la mitad, y lo que quedaba
                          afuera era justamente el nombre del tratamiento arriba
                          y los íconos de abajo — que es todo lo que el flyer
                          tiene para decir. Se leía como si la foto estuviera
                          ampliada de más.

                          Ahora la caja es vertical (4/5, cerca de la proporción
                          en que vienen los flyers) y la imagen va `contain`: se
                          ve completa siempre. Lo que sobre a los costados queda
                          del oliva con grano, igual que en la ficha del
                          tratamiento, así una foto apaisada tampoco se corta.

                          Sin el `group-hover:scale-105`: con `contain` ese zoom
                          empujaba los bordes fuera de la caja, o sea recortaba
                          al pasar el mouse justo lo que se acaba de arreglar.
                          El hover ya se nota en la sombra de la tarjeta. */}
                      <div className="surface-olive grain relative aspect-[4/5] overflow-hidden">
                        {s.image_url ? (
                          <img
                            src={imageUrl(s.image_url, "card") ?? undefined}
                            alt=""
                            loading="lazy"
                            className="h-full w-full object-contain"
                          />
                        ) : (
                          /* Sin foto cargada: inicial del tratamiento sobre el
                             oliva con grano, para que el hueco se lea como
                             decisión y no como imagen rota. El grano ya lo pone
                             la caja de afuera; acá sólo va el centrado. */
                          <div className="absolute inset-0 flex items-center justify-center">
                            <span className="font-display text-7xl text-primary-foreground/25">
                              {s.name.charAt(0)}
                            </span>
                          </div>
                        )}
                      </div>

                      <div className="flex flex-1 flex-col p-6">
                        <h3 className="font-display text-2xl leading-tight text-foreground">
                          {s.name}
                        </h3>
                        <p className="mt-3 line-clamp-2 flex-1 text-sm leading-relaxed text-muted-foreground">
                          {s.description}
                        </p>

                        {/* Con opciones cargadas, el precio del tratamiento no
                            se le cobra a nadie: lo que vale es el de cada
                            opción. Se muestra el más barato con "desde", que es
                            lo que la clienta puede esperar pagar como mínimo. */}
                        <div className="mt-6 flex items-baseline justify-between border-t border-border pt-4">
                          <span className="font-display text-2xl tabular-nums text-foreground">
                            {precioYDuracion(s).desde && (
                              <span className="mr-1.5 font-sans text-xs tracking-wide text-muted-foreground uppercase">
                                desde
                              </span>
                            )}
                            {formatMoney(precioYDuracion(s).precio)}
                          </span>
                          <span className="text-eyebrow text-muted-foreground/70">
                            {precioYDuracion(s).duracion}
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
