import { useMemo, useState } from "react";
import { createFileRoute, redirect, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Check } from "lucide-react";
import { SiteHeader } from "@/components/site-header";
import { SiteFooter } from "@/components/site-footer";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Calendar } from "@/components/ui/calendar";
import { Textarea } from "@/components/ui/textarea";
import { api, apiPost } from "@/lib/api";
import type { RtaDisponibilidad, RtaProfesionalesConHorarios, RtaServicios } from "@/lib/api-tipos";
import { buildSlots, formatMoney, formatTime, toDateKey, TOLERANCIA_MINUTOS } from "@/lib/shiraf";
import { isTeamAccount } from "@/lib/roles";
import { notifyAppointment } from "@/lib/notifications.functions";

// Claves opcionales, no claves obligatorias con valor `undefined`: con
// `exactOptionalPropertyTypes` activado esa diferencia hace que el router exija
// `search` en cada <Link to="/reservar">, aunque los dos params sean opcionales.
type Search = { service?: string; professional?: string };

export const Route = createFileRoute("/_authenticated/reservar")({
  validateSearch: (search: Record<string, unknown>): Search => {
    const parsed: Search = {};
    if (typeof search["service"] === "string") parsed.service = search["service"];
    if (typeof search["professional"] === "string") parsed.professional = search["professional"];
    return parsed;
  },
  /**
   * El centro no se reserva turnos a sí mismo desde el sitio público.
   *
   * Si la dueña o una empleada reservan acá, el turno entra como si fuera de una
   * clienta: ocupa un horario real, aparece en la agenda a nombre de ellas y
   * cuenta como una reserva más. Para bloquear un horario o cargar el turno de
   * alguien va "Nuevo turno" en el panel, que es la herramienta correcta.
   *
   * El desvío es al panel y no un cartel de error porque no hicieron nada mal:
   * simplemente ese formulario no es el suyo.
   */
  beforeLoad: async ({ context }) => {
    if (await isTeamAccount(context.queryClient)) {
      throw redirect({ to: "/admin" });
    }
  },
  head: () => ({
    meta: [
      { title: "Reservar turno — Shiraf" },
      {
        name: "description",
        content:
          "Elegí tu tratamiento, la profesional y el horario que mejor te queda. El centro confirma tu turno.",
      },
      { property: "og:title", content: "Reservar turno — Shiraf" },
      {
        property: "og:description",
        content: "Elegí tratamiento, profesional, día y horario para tu próxima visita a Shiraf.",
      },
    ],
  }),
  component: BookingPage,
});

function BookingPage() {
  const search = Route.useSearch();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const [serviceId, setServiceId] = useState<string | undefined>(search.service);
  const [professionalId, setProfessionalId] = useState<string | undefined>(search.professional);
  const [date, setDate] = useState<Date | undefined>(new Date());
  const [slot, setSlot] = useState<string | undefined>();
  const [notes, setNotes] = useState("");

  const services = useQuery({
    queryKey: ["services", "published"],
    // El mismo endpoint que el catálogo público, y a propósito comparten la
    // clave de caché: entrar acá viniendo de /servicios no vuelve a pedirlo.
    queryFn: async () => (await api<RtaServicios>("/api/publico/servicios")).servicios,
  });

  const professionals = useQuery({
    queryKey: ["professionals", "for-service", serviceId],
    enabled: !!serviceId,
    // El filtro por is_active lo hace el servidor: una profesional dada de baja
    // no tiene que seguir apareciendo como opción.
    queryFn: async () =>
      (await api<RtaProfesionalesConHorarios>(`/api/publico/servicios/${serviceId}/profesionales`))
        .profesionales,
  });

  const service = services.data?.find((s) => s.id === serviceId);

  const availability = useQuery({
    queryKey: ["availability", professionalId, date && toDateKey(date)],
    enabled: !!professionalId && !!date,
    // De los turnos ajenos vuelve SÓLO cuándo empiezan y cuánto duran, nunca
    // de quién son. Es la misma frontera que ponía professional_busy_slots, que
    // existía porque la RLS no dejaba leer los turnos de las demás — y sin ella
    // esos horarios se habrían mostrado como libres.
    queryFn: async () => {
      const day = new Date(date!);
      day.setHours(0, 0, 0, 0);
      return api<RtaDisponibilidad>(
        `/api/reservar/disponibilidad?profesional=${professionalId}&fecha=${day.toISOString()}`,
      );
    },
  });

  const slots = useMemo(() => {
    if (!date || !service || !availability.data) return [];
    return buildSlots(
      date,
      availability.data.schedules,
      availability.data.busy,
      service.duration_minutes,
    );
  }, [date, service, availability.data]);

  const book = useMutation({
    mutationFn: async () => {
      // Sin client_id ni duration_minutes: los pone el servidor. El primero sale
      // de la sesión —si viajara desde acá, cualquiera reservaría a nombre de
      // otra— y la duración y el precio los fija el tratamiento, con el precio
      // del día de hoy congelado en el turno.
      const created = await apiPost<{ id: string }>("/api/reservar", {
        service_id: serviceId,
        professional_id: professionalId,
        starts_at: slot,
        client_notes: notes || null,
      });

      // Dos avisos, uno para cada lado del mostrador:
      //
      //   new-request · al CENTRO. El turno nace pendiente y no sirve de nada
      //                 hasta que alguien lo confirma, así que si nadie mira el
      //                 panel se queda ahí. Es el aviso que evita que una
      //                 clienta espere una respuesta que nunca sale.
      //
      //   requested   · a la CLIENTA. Le queda por escrito qué pidió, cuándo, y
      //                 que todavía falta la confirmación. Antes de esto,
      //                 reservar terminaba en un toast que se iba en cinco
      //                 segundos: no quedaba ningún rastro de la reserva salvo
      //                 entrar de nuevo al sitio.
      //
      // Los dos en paralelo y los dos con el fallo tragado a propósito: el turno
      // YA está reservado y es lo que le importa a la clienta. Hacer fallar la
      // mutación por un mail la mandaría a reintentar una reserva que ya existe,
      // y el segundo intento lo rebotaría el control de superposición contra su
      // propio turno.
      await Promise.all([
        notifyAppointment({
          data: { appointmentId: created.id, event: "new-request" },
        }).catch(() => undefined),
        notifyAppointment({
          data: { appointmentId: created.id, event: "requested" },
        }).catch(() => undefined),
      ]);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["my-appointments"] });
      toast.success("¡Turno solicitado! Queda pendiente de confirmación.");
      navigate({ to: "/mi-cuenta" });
    },
    // El trigger de la base rechaza los turnos superpuestos. Puede pasar si
    // alguien reservó ese mismo horario mientras esta clienta completaba el
    // formulario: se avisa y se recargan los horarios para que vea el que quedó
    // ocupado.
    onError: (error: Error) => {
      const taken = error.message.includes("ya fue tomado") || error.message.includes("exclusion");
      if (taken) {
        setSlot(undefined);
        queryClient.invalidateQueries({ queryKey: ["availability"] });
        toast.error("Ese horario se acaba de ocupar. Elegí otro, por favor.");
        return;
      }
      toast.error(error.message);
    },
  });

  return (
    <div className="min-h-screen">
      <SiteHeader />

      <section className="mx-auto max-w-5xl px-5 pt-14 pb-20">
        <p className="text-eyebrow text-muted-foreground">Nueva reserva</p>
        <h1 className="mt-4 text-5xl text-foreground">Sacar turno</h1>
        <div className="gold-rule mt-6" />

        <Step n={1} title="Elegí el tratamiento" className="mt-12">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {services.data?.map((s) => {
              const active = s.id === serviceId;
              return (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => {
                    setServiceId(s.id);
                    setProfessionalId(undefined);
                    setSlot(undefined);
                  }}
                  className={`rounded-sm border p-4 text-left transition-colors ${
                    active
                      ? "border-primary bg-primary/5"
                      : "border-border bg-card hover:border-primary/40"
                  }`}
                >
                  <p className="text-eyebrow text-gold">{s.category}</p>
                  <p className="mt-2 font-display text-xl text-foreground">{s.name}</p>
                  <p className="mt-2 text-xs text-muted-foreground">
                    {s.duration_minutes} min · {formatMoney(s.price)}
                  </p>
                </button>
              );
            })}
          </div>
        </Step>

        {serviceId && (
          <Step n={2} title="Elegí la profesional" className="mt-12">
            <div className="grid gap-3 sm:grid-cols-3">
              {professionals.data?.map((p) => {
                const active = p.id === professionalId;
                return (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => {
                      setProfessionalId(p.id);
                      setSlot(undefined);
                    }}
                    className={`rounded-sm border p-4 text-left transition-colors ${
                      active
                        ? "border-primary bg-primary/5"
                        : "border-border bg-card hover:border-primary/40"
                    }`}
                  >
                    <p className="font-display text-xl text-foreground">{p.full_name}</p>
                    <p className="mt-1 text-xs text-muted-foreground">{p.specialty}</p>
                  </button>
                );
              })}
              {professionals.data?.length === 0 && (
                <p className="text-sm text-muted-foreground">
                  Todavía no hay profesionales asignadas a este tratamiento.
                </p>
              )}
            </div>
          </Step>
        )}

        {serviceId && professionalId && (
          <Step n={3} title="Día y horario" className="mt-12">
            <div className="grid gap-8 md:grid-cols-[auto_1fr]">
              <Card className="w-fit border-border/80 shadow-soft">
                <CardContent className="p-3">
                  <Calendar
                    mode="single"
                    selected={date}
                    onSelect={(d) => {
                      setDate(d);
                      setSlot(undefined);
                    }}
                    disabled={{ before: new Date() }}
                    className="pointer-events-auto"
                  />
                </CardContent>
              </Card>

              <div>
                {availability.isLoading && (
                  <p className="text-sm text-muted-foreground">Buscando disponibilidad…</p>
                )}
                {/* El error va antes que el "no hay horarios" y dice otra cosa.
                    Sin esto, cuando la consulta fallaba `slots` quedaba vacío y
                    la clienta leía "no hay horarios ese día, probá otra fecha":
                    se iba convencida de que el centro estaba lleno, y probando
                    otras fechas le pasaba lo mismo. */}
                {availability.isError && (
                  <p className="rounded-sm border border-destructive/50 bg-destructive/10 p-3 text-sm leading-relaxed text-foreground">
                    No pudimos consultar los horarios en este momento. Volvé a intentar en un rato o
                    escribinos y te lo reservamos nosotras.
                  </p>
                )}
                {!availability.isLoading && !availability.isError && slots.length === 0 && (
                  <p className="text-sm text-muted-foreground">
                    No hay horarios disponibles ese día. Probá con otra fecha.
                  </p>
                )}
                <div className="flex flex-wrap gap-2">
                  {slots.map((iso) => (
                    <Button
                      key={iso}
                      type="button"
                      size="sm"
                      variant={slot === iso ? "default" : "outline"}
                      onClick={() => setSlot(iso)}
                    >
                      {formatTime(iso)}
                    </Button>
                  ))}
                </div>
              </div>
            </div>
          </Step>
        )}

        {slot && service && (
          <Step n={4} title="Confirmar" className="mt-12">
            <Card className="border-border/80 shadow-soft">
              <CardContent className="space-y-5 p-6">
                <ul className="space-y-2 text-sm">
                  <li className="flex justify-between gap-6">
                    <span className="text-muted-foreground">Tratamiento</span>
                    <span className="text-foreground">{service.name}</span>
                  </li>
                  <li className="flex justify-between gap-6">
                    <span className="text-muted-foreground">Profesional</span>
                    <span className="text-foreground">
                      {professionals.data?.find((p) => p.id === professionalId)?.full_name}
                    </span>
                  </li>
                  <li className="flex justify-between gap-6">
                    <span className="text-muted-foreground">Fecha y hora</span>
                    <span className="text-foreground">
                      {new Date(slot).toLocaleString("es-AR", {
                        weekday: "long",
                        day: "2-digit",
                        month: "long",
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </span>
                  </li>
                  <li className="flex justify-between gap-6 border-t border-border pt-3">
                    <span className="text-muted-foreground">Valor</span>
                    <span className="font-semibold text-foreground">
                      {formatMoney(service.price)}
                    </span>
                  </li>
                </ul>

                <Textarea
                  placeholder="¿Algo que debamos saber? Alergias, embarazo, tratamientos previos…"
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                />

                <p className="text-xs text-muted-foreground">
                  El pago se realiza en el centro. Tu turno queda pendiente hasta que lo
                  confirmemos.
                </p>

                {/* La tolerancia, dicha ANTES de reservar y no sólo en el mail.
                    Es una regla que el centro va a tener que sostener con
                    alguien que llega tarde, y sostenerla es mucho más fácil
                    cuando estaba escrita en la pantalla donde la persona
                    apretó el botón. El mismo texto le llega después por mail:
                    el número sale de una sola constante para que no puedan
                    decir cosas distintas. */}
                <p className="rounded-sm border border-border bg-secondary/30 p-3 text-xs text-foreground">
                  Te esperamos hasta {TOLERANCIA_MINUTOS} minutos. Pasado ese rato el turno se
                  libera, porque atrás hay otra clienta esperando.
                </p>

                <Button
                  className="w-full"
                  size="lg"
                  disabled={book.isPending}
                  onClick={() => book.mutate()}
                >
                  <Check className="mr-2 h-4 w-4" />
                  Solicitar turno
                </Button>
              </CardContent>
            </Card>
          </Step>
        )}
      </section>

      <SiteFooter />
    </div>
  );
}

function Step({
  n,
  title,
  className = "",
  children,
}: {
  n: number;
  title: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div className={className}>
      <div className="mb-5 flex items-center gap-3">
        <span className="flex h-7 w-7 items-center justify-center rounded-full border border-gold text-xs text-gold">
          {n}
        </span>
        <h2 className="font-display text-2xl text-foreground">{title}</h2>
      </div>
      {children}
    </div>
  );
}
