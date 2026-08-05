import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { SiteHeader } from "@/components/site-header";
import { SiteFooter } from "@/components/site-footer";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/integrations/supabase/client";
import { WEEKDAYS } from "@/lib/shiraf";

export const Route = createFileRoute("/profesionales")({
  head: () => ({
    meta: [
      { title: "Nuestras profesionales — Shiraf" },
      {
        name: "description",
        content:
          "Conocé al equipo de Shiraf: especialidades, tratamientos que realiza cada profesional y sus días de atención.",
      },
      { property: "og:title", content: "Nuestras profesionales — Shiraf" },
      {
        property: "og:description",
        content: "Especialidades, tratamientos y horarios de atención del equipo de Shiraf.",
      },
    ],
  }),
  component: ProfessionalsPage,
});

function ProfessionalsPage() {
  const team = useQuery({
    queryKey: ["professionals", "full"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("professionals")
        .select(
          "id, full_name, specialty, bio, is_active, professional_services(services(id, name)), professional_schedules(weekday, start_time, end_time)",
        )
        .eq("is_active", true)
        .order("full_name");
      if (error) throw error;
      return data;
    },
  });

  return (
    <div className="min-h-screen">
      <SiteHeader />

      <section className="mx-auto max-w-6xl px-5 pt-16 pb-10">
        <p className="text-eyebrow text-muted-foreground">El equipo</p>
        <h1 className="mt-4 text-5xl text-foreground">Profesionales</h1>
        <div className="gold-rule mt-6" />
        <p className="mt-6 max-w-lg text-[15px] leading-relaxed text-muted-foreground">
          Cada profesional trabaja en tratamientos y horarios específicos. Al reservar podés elegir
          con quién querés atenderte.
        </p>
      </section>

      <section className="mx-auto grid max-w-6xl gap-6 px-5 pb-16 md:grid-cols-2">
        {team.data?.map((p) => (
          <Card key={p.id} className="border-border/80 shadow-soft">
            <CardContent className="p-7">
              <h2 className="text-3xl text-foreground">{p.full_name}</h2>
              <p className="mt-1 text-sm text-gold">{p.specialty}</p>
              <p className="mt-4 text-sm leading-relaxed text-muted-foreground">{p.bio}</p>

              <div className="mt-6">
                <p className="text-eyebrow text-muted-foreground">Realiza</p>
                <div className="mt-3 flex flex-wrap gap-2">
                  {p.professional_services.map((ps) => (
                    <Badge key={ps.services?.id} variant="secondary" className="font-normal">
                      {ps.services?.name}
                    </Badge>
                  ))}
                </div>
              </div>

              <div className="mt-6">
                <p className="text-eyebrow text-muted-foreground">Atiende</p>
                <ul className="mt-3 space-y-1 text-sm text-muted-foreground">
                  {[...p.professional_schedules]
                    .sort((a, b) => a.weekday - b.weekday)
                    .map((s, i) => (
                      <li key={i}>
                        {WEEKDAYS[s.weekday]} · {s.start_time.slice(0, 5)} a{" "}
                        {s.end_time.slice(0, 5)}
                      </li>
                    ))}
                </ul>
              </div>

              <Button asChild size="sm" variant="outline" className="mt-7">
                <Link to="/reservar" search={{ professional: p.id }}>
                  Reservar con {p.full_name.split(" ")[0]}
                </Link>
              </Button>
            </CardContent>
          </Card>
        ))}
        {team.isLoading && <p className="text-sm text-muted-foreground">Cargando equipo…</p>}
      </section>

      <SiteFooter />
    </div>
  );
}
