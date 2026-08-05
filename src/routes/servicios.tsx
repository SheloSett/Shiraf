import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { SiteHeader } from "@/components/site-header";
import { SiteFooter } from "@/components/site-footer";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { supabase } from "@/integrations/supabase/client";
import { formatMoney } from "@/lib/shiraf";

export const Route = createFileRoute("/servicios")({
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

  const grouped = (services.data ?? []).reduce<Record<string, typeof services.data>>(
    (acc, service) => {
      const key = service.category;
      acc[key] = [...(acc[key] ?? []), service];
      return acc;
    },
    {} as Record<string, NonNullable<typeof services.data>>,
  );

  return (
    <div className="min-h-screen">
      <SiteHeader />

      <section className="mx-auto max-w-6xl px-5 pt-16 pb-10">
        <p className="text-eyebrow text-muted-foreground">Carta de tratamientos</p>
        <h1 className="mt-4 text-5xl text-foreground">Servicios</h1>
        <div className="gold-rule mt-6" />
        <p className="mt-6 max-w-lg text-[15px] leading-relaxed text-muted-foreground">
          Cada tratamiento se realiza con cosmética profesional y una evaluación previa de la piel.
          Los precios pueden ajustarse según la zona a tratar.
        </p>
      </section>

      <section className="mx-auto max-w-6xl px-5 pb-16">
        {Object.entries(grouped).map(([category, items]) => (
          <div key={category} className="mb-14">
            <h2 className="text-eyebrow border-b border-border pb-3 text-gold">{category}</h2>
            <div className="mt-6 grid gap-5 md:grid-cols-2">
              {items?.map((s) => (
                <Card key={s.id} className="border-border/80 shadow-soft">
                  <CardContent className="p-6">
                    <div className="flex items-start justify-between gap-4">
                      <h3 className="text-2xl text-foreground">{s.name}</h3>
                      <span className="whitespace-nowrap font-semibold text-foreground">
                        {formatMoney(s.price)}
                      </span>
                    </div>
                    <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                      {s.description}
                    </p>
                    <div className="mt-5 flex items-center justify-between border-t border-border pt-4 text-sm">
                      <span className="text-muted-foreground">{s.duration_minutes} minutos</span>
                      <Button asChild size="sm" variant="outline">
                        <Link to="/reservar" search={{ service: s.id }}>
                          Reservar
                        </Link>
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          </div>
        ))}
        {services.isLoading && <p className="text-sm text-muted-foreground">Cargando servicios…</p>}
      </section>

      <SiteFooter />
    </div>
  );
}
