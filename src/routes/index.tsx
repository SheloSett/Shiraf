import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Clock, Leaf, Sparkles, Star } from "lucide-react";
import heroImage from "@/assets/hero-spa.jpg";
import { SiteHeader } from "@/components/site-header";
import { SiteFooter } from "@/components/site-footer";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
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
        .select("id, name, description, category, duration_minutes, price")
        .eq("is_published", true)
        .order("price", { ascending: true })
        .limit(6);
      if (error) throw error;
      return data;
    },
  });

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
    <div className="min-h-screen">
      <SiteHeader />

      <section className="mx-auto grid max-w-6xl items-center gap-12 px-5 pt-16 pb-20 lg:grid-cols-[1fr_1.05fr] lg:pt-24">
        <div>
          <p className="text-eyebrow text-muted-foreground">Centro de estética</p>
          <div className="gold-rule mt-5" />
          <h1 className="mt-6 text-5xl leading-[1.05] text-foreground sm:text-6xl">
            Calma, belleza
            <br />y bienestar
          </h1>
          <p className="mt-6 max-w-md text-[15px] leading-relaxed text-muted-foreground">
            Tratamientos faciales, corporales y aparatología pensados uno por uno. Elegí tu
            servicio, el día, el horario y la profesional que te acompaña.
          </p>
          <div className="mt-9 flex flex-wrap gap-3">
            <Button asChild size="lg">
              <Link to="/reservar">Reservar turno</Link>
            </Button>
            <Button asChild size="lg" variant="outline">
              <Link to="/servicios">Ver servicios</Link>
            </Button>
          </div>
        </div>

        <div className="relative">
          <img
            src={heroImage}
            alt="Sala de tratamientos de Shiraf con paredes verde oliva y detalles dorados"
            width={1408}
            height={1008}
            className="w-full rounded-sm object-cover shadow-lift"
          />
        </div>
      </section>

      <section className="border-y border-border bg-secondary/50">
        <div className="mx-auto grid max-w-6xl gap-8 px-5 py-14 sm:grid-cols-3">
          {[
            { icon: Leaf, title: "Cosmética profesional", text: "Productos de línea dermatológica." },
            { icon: Clock, title: "Turnos flexibles", text: "Agenda online, confirmación por el centro." },
            { icon: Star, title: "Equipo especializado", text: "Cada profesional en lo suyo." },
          ].map((item) => (
            <div key={item.title} className="flex gap-4">
              <item.icon className="mt-1 h-5 w-5 shrink-0 text-gold" />
              <div>
                <p className="text-sm font-semibold text-foreground">{item.title}</p>
                <p className="mt-1 text-sm text-muted-foreground">{item.text}</p>
              </div>
            </div>
          ))}
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-5 py-20">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="text-eyebrow text-muted-foreground">Nuestros tratamientos</p>
            <h2 className="mt-3 text-4xl text-foreground">Servicios</h2>
          </div>
          <Link to="/servicios" className="text-sm text-muted-foreground underline-offset-4 hover:underline">
            Ver todos
          </Link>
        </div>

        <div className="mt-10 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {services.data?.map((s) => (
            <Card key={s.id} className="border-border/80 shadow-soft transition-shadow hover:shadow-lift">
              <CardContent className="p-6">
                <p className="text-eyebrow text-gold">{s.category}</p>
                <h3 className="mt-3 text-2xl text-foreground">{s.name}</h3>
                <p className="mt-2 min-h-12 text-sm leading-relaxed text-muted-foreground">
                  {s.description}
                </p>
                <div className="mt-5 flex items-center justify-between border-t border-border pt-4 text-sm">
                  <span className="text-muted-foreground">{s.duration_minutes} min</span>
                  <span className="font-semibold text-foreground">{formatMoney(s.price)}</span>
                </div>
              </CardContent>
            </Card>
          ))}
          {services.isLoading &&
            Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="h-56 animate-pulse rounded-sm bg-muted" />
            ))}
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-5 pb-20">
        <p className="text-eyebrow text-muted-foreground">El equipo</p>
        <h2 className="mt-3 text-4xl text-foreground">Profesionales</h2>
        <div className="mt-10 grid gap-5 sm:grid-cols-3">
          {professionals.data?.map((p) => (
            <div key={p.id} className="border-l border-gold/60 pl-5">
              <h3 className="text-2xl text-foreground">{p.full_name}</h3>
              <p className="mt-1 text-sm text-gold">{p.specialty}</p>
              <p className="mt-3 text-sm leading-relaxed text-muted-foreground">{p.bio}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-5 pb-4">
        <div className="surface-olive flex flex-col items-center gap-6 rounded-sm px-8 py-16 text-center">
          <Sparkles className="h-6 w-6 text-gold" />
          <h2 className="max-w-lg text-4xl text-primary-foreground">
            Reservá tu próximo momento de calma
          </h2>
          <p className="max-w-md text-sm text-primary-foreground/75">
            Elegís el tratamiento, el día y la profesional. Nosotros confirmamos el turno.
          </p>
          <Button asChild size="lg" variant="secondary">
            <Link to="/reservar">Sacar turno</Link>
          </Button>
        </div>
      </section>

      <SiteFooter />
    </div>
  );
}
