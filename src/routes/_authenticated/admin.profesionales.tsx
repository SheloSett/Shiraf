import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { supabase } from "@/integrations/supabase/client";
import { WEEKDAYS } from "@/lib/shiraf";

export const Route = createFileRoute("/_authenticated/admin/profesionales")({
  component: AdminProfessionals,
});

function AdminProfessionals() {
  const team = useQuery({
    queryKey: ["admin-professionals"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("professionals")
        .select(
          "id, full_name, specialty, bio, is_active, professional_services(services(id, name)), professional_schedules(weekday, start_time, end_time)",
        )
        .order("full_name");
      if (error) throw error;
      return data;
    },
  });

  return (
    <div>
      <p className="text-eyebrow text-muted-foreground">Equipo</p>
      <h1 className="mt-3 font-display text-4xl text-foreground">Profesionales</h1>
      <p className="mt-4 max-w-lg text-sm text-muted-foreground">
        Cada profesional tiene sus tratamientos y sus días de atención. Los horarios definen los
        turnos disponibles para las clientas.
      </p>

      <div className="mt-8 grid gap-5 lg:grid-cols-2">
        {team.data?.map((p) => (
          <Card key={p.id} className="border-border/80 shadow-soft">
            <CardContent className="p-6">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <h2 className="font-display text-2xl text-foreground">{p.full_name}</h2>
                  <p className="mt-1 text-sm text-gold">{p.specialty}</p>
                </div>
                <Badge variant={p.is_active ? "default" : "outline"}>
                  {p.is_active ? "Activa" : "Inactiva"}
                </Badge>
              </div>
              <p className="mt-4 text-sm leading-relaxed text-muted-foreground">{p.bio}</p>

              <div className="mt-6 grid gap-6 sm:grid-cols-2">
                <div>
                  <p className="text-eyebrow text-muted-foreground">Tratamientos</p>
                  <div className="mt-3 flex flex-wrap gap-2">
                    {p.professional_services.map((ps) => (
                      <Badge key={ps.services?.id} variant="secondary" className="font-normal">
                        {ps.services?.name}
                      </Badge>
                    ))}
                  </div>
                </div>
                <div>
                  <p className="text-eyebrow text-muted-foreground">Horarios</p>
                  <ul className="mt-3 space-y-1 text-sm text-muted-foreground">
                    {[...p.professional_schedules]
                      .sort((a, b) => a.weekday - b.weekday)
                      .map((s, i) => (
                        <li key={i}>
                          {WEEKDAYS[s.weekday]} · {s.start_time.slice(0, 5)}–
                          {s.end_time.slice(0, 5)}
                        </li>
                      ))}
                  </ul>
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
