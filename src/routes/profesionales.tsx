import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { SiteHeader } from "@/components/site-header";
import { SiteFooter } from "@/components/site-footer";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { api } from "@/lib/api";
import type { RtaProfesionalesConDetalle } from "@/lib/api-tipos";
import { texto } from "@/lib/contenido";
import { useContenido } from "@/hooks/useContenido";
import { urlDe } from "@/lib/seo";
import { agruparPorDia, soloHoraYMinutos, WEEKDAYS } from "@/lib/shiraf";

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
      { property: "og:url", content: urlDe("/profesionales") },
    ],
    // Su propia dirección, no la de la portada. El motivo, en index.tsx.
    links: [{ rel: "canonical", href: urlDe("/profesionales") }],
  }),
  component: ProfessionalsPage,
});

function ProfessionalsPage() {
  // Sólo el encabezado. Cada ficha —nombre, especialidad, bio, qué hace y
  // cuándo atiende— sale de la sección Profesionales del panel, que es donde
  // corresponde: son datos de la persona, no texto de la página.
  const c = useContenido("profesionales");

  const team = useQuery({
    queryKey: ["professionals", "full"],
    queryFn: async () =>
      (await api<RtaProfesionalesConDetalle>("/api/publico/profesionales?detalle=1")).profesionales,
  });

  return (
    <div className="min-h-screen">
      <SiteHeader />

      <section className="mx-auto max-w-6xl px-5 pt-16 pb-10">
        {/* Antes estaban los tres textos escritos acá: "El equipo",
            "Profesionales" y la bajada. Pasaron a ser los defaults del panel. */}
        <p className="text-eyebrow text-muted-foreground">{texto(c, "eyebrow")}</p>
        <h1 className="mt-4 text-5xl text-foreground">{texto(c, "titulo")}</h1>
        <div className="gold-rule mt-6" />
        <p className="mt-6 max-w-lg text-[15px] leading-relaxed text-muted-foreground">
          {texto(c, "bajada")}
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
                {/* Un renglón por DÍA, con todos sus tramos. Antes era un
                    renglón por tramo:

                      Lunes · 09:00 a 13:00
                      Lunes · 15:00 a 17:00

                    que de un vistazo se lee como dos lunes. Quien mira esto está
                    decidiendo cuándo venir, y lo que necesita saber es que el
                    lunes hay un corte al mediodía. */}
                <ul className="mt-3 space-y-1 text-sm text-muted-foreground">
                  {agruparPorDia(p.professional_schedules).map(({ weekday, tramos }) => (
                    <li key={weekday}>
                      {WEEKDAYS[weekday]} ·{" "}
                      {tramos
                        .map(
                          (t) =>
                            `${soloHoraYMinutos(t.start_time)} a ${soloHoraYMinutos(t.end_time)}`,
                        )
                        .join(" y ")}
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
