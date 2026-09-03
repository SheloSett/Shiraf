import { useEffect, useMemo, useState } from "react";
import { createFileRoute, redirect, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Check, Clock } from "lucide-react";
import { SiteHeader } from "@/components/site-header";
import { SiteFooter } from "@/components/site-footer";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { CalendarioDeLaProfesional } from "@/components/calendario-de-la-profesional";
import { Textarea } from "@/components/ui/textarea";
import { api, apiPost } from "@/lib/api";
import { imageUrl } from "@/lib/cloudinary";
import type { RtaDisponibilidad, RtaProfesionalesConHorarios, RtaServicios } from "@/lib/api-tipos";
import {
  buildSlots,
  formatMoney,
  formatTime,
  precioYDuracion,
  toDateKey,
  TOLERANCIA_MINUTOS,
} from "@/lib/shiraf";
import { parseDateKey } from "@/lib/horarios";
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

  /** Igual que en /servicios: si la foto tiene `image_url` pero el archivo ya
   * no existe en Cloudinary, cae al mismo placeholder que "sin foto" en vez
   * de mostrar el ícono de imagen rota. Ver el comentario de `fotosRotas` en
   * `servicios.index.tsx`. */
  const [fotosRotas, setFotosRotas] = useState<Set<string>>(new Set());
  /**
   * Qué opción del tratamiento se eligió, cuando el tratamiento tiene.
   *
   * Se guarda el id y no la opción entera por lo mismo que el tratamiento: si
   * el catálogo se refresca mientras la clienta completa el formulario, un
   * objeto viejo seguiría en pantalla con un precio que ya cambió.
   */
  const [variantId, setVariantId] = useState<string | undefined>();
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

  /**
   * La opción elegida, y si ya se puede seguir.
   *
   * Un tratamiento con opciones no tiene precio ni duración propios hasta que se
   * elige una: sin eso no se puede calcular ni un horario libre. Por eso
   * `elegido` es lo que abre el paso de la profesional, y no `serviceId` a
   * secas como antes.
   *
   * La regla la vuelve a aplicar el servidor en `validarTurno` — acá es para que
   * la pantalla no ofrezca horarios de una duración que todavía nadie eligió.
   */
  const variant = service?.variants.find((v) => v.id === variantId);
  const elegido = !!service && (service.variants.length === 0 || !!variant);

  /**
   * Apenas queda elegido el tratamiento, la pantalla baja sola hasta
   * "Elegí la profesional" — sea porque se acaba de tocar una tarjeta, o
   * porque se llegó con `?service=` ya puesto (el botón "Reservar" de la
   * ficha del tratamiento) y el paso 1 nace resuelto.
   *
   * Depende de `elegido` y no de `serviceId`: con opciones, tocar la tarjeta
   * no alcanza —falta elegir cuál— así que recién ahí tiene sentido bajar.
   */
  useEffect(() => {
    if (elegido) {
      document
        .getElementById("paso-profesional")
        ?.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }, [elegido]);

  /** Lo que dura y lo que sale este turno: de la opción si hay, del tratamiento si no. */
  const duracion = variant?.duration_minutes ?? service?.duration_minutes ?? 0;
  const margen = variant?.buffer_minutes ?? service?.buffer_minutes ?? 0;
  const precio = variant?.price ?? service?.price ?? 0;

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
    // La duración es la de la OPCIÓN cuando el tratamiento tiene: un "cuerpo
    // completo" de 80 minutos no entra en los huecos de uno de 40, y ofrecer
    // esos horarios sería mandar a la clienta a un turno que va a rebotar.
    return buildSlots(
      date,
      availability.data.schedules,
      availability.data.busy,
      { minutos: duracion, margen },
      availability.data.ausencias,
    );
  }, [date, service, availability.data, duracion, margen]);

  const book = useMutation({
    mutationFn: async () => {
      // Sin client_id ni duration_minutes: los pone el servidor. El primero sale
      // de la sesión —si viajara desde acá, cualquiera reservaría a nombre de
      // otra— y la duración y el precio los fija el tratamiento, con el precio
      // del día de hoy congelado en el turno.
      const created = await apiPost<{ id: string }>("/api/reservar", {
        service_id: serviceId,
        // Viaja el id de la opción, nunca su precio: lo busca el servidor. Es
        // la misma regla que ya valía para el tratamiento.
        variant_id: variantId ?? null,
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
                  // `aria-pressed` y no sólo el color del borde: con la foto
                  // arriba, "elegido" se apoyaba entero en un cambio de tinte que
                  // un lector de pantalla no anuncia y que a simple vista compite
                  // con la imagen.
                  aria-pressed={active}
                  onClick={() => {
                    setServiceId(s.id);
                    // La opción es de ESTE tratamiento: cambiar de tratamiento
                    // la deja sin sentido. Sin limpiarla, el id viejo viajaría
                    // al servidor y rebotaría con "ese tratamiento no tiene
                    // opciones", que no le explica nada a nadie.
                    setVariantId(undefined);
                    setProfessionalId(undefined);
                    setSlot(undefined);
                  }}
                  className={`group overflow-hidden rounded-sm border text-left transition-colors ${
                    active
                      ? "border-primary bg-primary/5"
                      : "border-border bg-card hover:border-primary/40"
                  }`}
                >
                  {/*
                    Misma foto y MISMO encuadre que las tarjetas de /servicios
                    (`aspect-square` con el preset "card", sin recortar). Es a
                    propósito: casi todas las que llegan acá vienen de mirar el
                    catálogo, y lo que tiene que pasar es que reconozcan la que
                    ya eligieron. Con otro encuadre la misma foto se ve como
                    otra foto.

                    Esto era `aspect-[4/3]` con `object-cover`: la esquina de
                    abajo del flyer —el precio, la duración— quedaba recortada
                    igual que en /servicios antes de arreglarlo ahí, sólo que acá
                    nadie lo había tocado todavía. Ver el comentario largo en
                    `servicios.index.tsx` para el porqué de cada clase.
                  */}
                  <div
                    className={`relative aspect-square overflow-hidden ${
                      s.image_url && !fotosRotas.has(s.id) ? "" : "surface-olive"
                    }`}
                  >
                    {s.image_url && !fotosRotas.has(s.id) ? (
                      <img
                        src={imageUrl(s.image_url, "card") ?? undefined}
                        // Decorativa: el nombre del tratamiento está escrito justo
                        // abajo, así que describir la foto lo hace repetir dos veces
                        // a quien escucha la página.
                        alt=""
                        loading="lazy"
                        onError={() => setFotosRotas((prev) => new Set(prev).add(s.id))}
                        // Sin `group-hover:scale-105`: con `contain` ese zoom
                        // empujaba los bordes fuera de la caja, o sea recortaba
                        // al pasar el mouse justo lo que se acaba de sacar. El
                        // hover ya se nota en el borde del botón (`hover:border-primary/40`).
                        className="h-full w-full object-contain"
                      />
                    ) : (
                      /* Sin foto cargada —o con `image_url` pero el archivo ya
                         no existe en Cloudinary, ver `fotosRotas`—: inicial del
                         tratamiento sobre el oliva con grano. El mismo relleno
                         que el catálogo, para que el hueco se lea como decisión
                         y no como imagen rota. */
                      <div className="grain absolute inset-0 flex items-center justify-center">
                        <span className="font-display text-6xl text-primary-foreground/25">
                          {s.name.charAt(0)}
                        </span>
                      </div>
                    )}

                    {active && (
                      <span className="absolute top-2.5 right-2.5 flex h-7 w-7 items-center justify-center rounded-full bg-primary text-primary-foreground">
                        <Check className="h-4 w-4" />
                      </span>
                    )}
                  </div>

                  <div className="p-4">
                    <p className="text-eyebrow text-gold">{s.category}</p>
                    <p className="mt-2 font-display text-xl text-foreground">{s.name}</p>
                    {/* Con opciones, el precio del tratamiento no se le cobra a
                        nadie: se muestra el de la más barata, con "desde". */}
                    <p className="mt-2 text-xs text-muted-foreground">
                      {precioYDuracion(s).duracion} · {precioYDuracion(s).desde ? "desde " : ""}
                      {formatMoney(precioYDuracion(s).precio)}
                    </p>
                  </div>
                </button>
              );
            })}
          </div>

          {/* Que son varias sesiones, dicho apenas se elige el tratamiento: es
              parte de lo que se está reservando y no puede aparecer recién en
              el resumen, cuando ya eligió día y hora. */}
          {service && service.sessions_count > 1 && (
            <p className="mt-6 rounded-sm border border-gold/40 bg-gold/5 px-4 py-3 text-sm leading-relaxed text-foreground">
              {service.name} son {service.sessions_count} sesiones
              {service.session_interval_days > 0
                ? ` con ${service.session_interval_days} días entre una y otra`
                : ""}
              . Acá reservás la primera; las siguientes las coordinamos con vos en el centro. El
              valor es por el tratamiento completo.
            </p>
          )}

          {/* Las opciones van DENTRO del paso 1 y no en un paso propio: elegir
              "cuerpo completo" es terminar de elegir el tratamiento, no una
              decisión aparte. Además así los pasos siguen siendo cuatro para
              todos los tratamientos, con y sin opciones. */}
          {service && service.variants.length > 0 && (
            <div className="mt-6 border-t border-border pt-6">
              <p className="text-sm text-foreground">
                {service.name} se hace de más de una forma. ¿Cuál querés?
              </p>
              <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {service.variants.map((v) => {
                  const active = v.id === variantId;
                  return (
                    <button
                      key={v.id}
                      type="button"
                      aria-pressed={active}
                      onClick={() => {
                        setVariantId(v.id);
                        // El horario se limpia: los huecos libres dependen de
                        // cuánto dura, y la opción nueva puede durar el doble.
                        setSlot(undefined);
                      }}
                      className={`rounded-sm border p-4 text-left transition-colors ${
                        active
                          ? "border-primary bg-primary/5"
                          : "border-border bg-card hover:border-primary/40"
                      }`}
                    >
                      <p className="text-[15px] text-foreground">{v.name}</p>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {v.duration_minutes} min · {formatMoney(v.price)}
                      </p>
                    </button>
                  );
                })}
              </div>
            </div>
          )}
        </Step>

        {elegido && (
          <Step n={2} id="paso-profesional" title="Elegí la profesional" className="mt-12">
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

        {elegido && professionalId && (
          <Step n={3} title="Día y horario" className="mt-12">
            <div className="grid gap-8 md:grid-cols-[auto_1fr]">
              {/* El mismo calendario que usan el panel y «cambiar el turno»:
                  los días que la profesional atiende salen resaltados y los que
                  no trabaja, los de ausencia y los pasados quedan
                  deshabilitados. Antes se podía elegir cualquier día futuro y el
                  "no hay horarios ese día" llegaba después — que en el sitio
                  público es peor que en el panel, porque la clienta no sabe qué
                  días viene cada profesional y prueba a ciegas. */}
              <Card className="w-fit border-border/80 shadow-soft">
                <CardContent className="p-3">
                  <CalendarioDeLaProfesional
                    profesionalId={professionalId}
                    dateKey={date ? toDateKey(date) : ""}
                    onDateKey={(next) => {
                      setDate(parseDateKey(next));
                      setSlot(undefined);
                    }}
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
                  {service.sessions_count > 1 && (
                    <li className="flex justify-between gap-6">
                      <span className="text-muted-foreground">Sesiones</span>
                      <span className="text-foreground">
                        {service.sessions_count} · reservás la 1ª
                      </span>
                    </li>
                  )}
                  {/* En su propio renglón y no pegada al nombre: es lo que
                      explica el precio de abajo, y con dos opciones de precios
                      distintos ese renglón tiene que poder leerse solo. */}
                  {variant && (
                    <li className="flex justify-between gap-6">
                      <span className="text-muted-foreground">Opción</span>
                      <span className="text-foreground">
                        {variant.name} · {variant.duration_minutes} min
                      </span>
                    </li>
                  )}
                  <li className="flex justify-between gap-6">
                    <span className="text-muted-foreground">Profesional</span>
                    <span className="text-foreground">
                      {professionals.data?.find((p) => p.id === professionalId)?.full_name}
                    </span>
                  </li>
                  <li className="flex justify-between gap-6">
                    <span className="text-muted-foreground">Fecha y hora</span>
                    <span className="text-foreground">
                      {/* Estas opciones son las MISMAS que las de formatDateTime()
                          en shiraf.ts, copiadas. Se le agrega el hourCycle igual
                          que allá para que el resumen no diga la hora distinto
                          que el resto de la app — pero conviene unificarlo. */}
                      {new Date(slot).toLocaleString("es-AR", {
                        weekday: "long",
                        day: "2-digit",
                        month: "long",
                        hour: "2-digit",
                        minute: "2-digit",
                        hourCycle: "h23",
                      })}
                    </span>
                  </li>
                  <li className="flex justify-between gap-6 border-t border-border pt-3">
                    <span className="text-muted-foreground">Valor</span>
                    {/* El de la opción cuando hay: es el que se va a cobrar y
                        el que el servidor congela en el turno. */}
                    <span className="font-semibold text-foreground">{formatMoney(precio)}</span>
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
                    decir cosas distintas.

                    26/8/2026 — se le subió el volumen, porque no se veía. La
                    versión comentada abajo estaba en `text-xs`, el MISMO tamaño
                    que el renglón del pago que tiene justo encima, y sobre una
                    card de L 0.99 el `bg-secondary/30` no llega a teñir nada.
                    Resultado: las dos se leían como el mismo bloque de letra
                    chica al pie — que es exactamente lo que nadie lee antes de
                    apretar el botón. Una regla que la clienta no vio no se
                    puede sostener después con quien llegó tarde, así que no
                    alcanzaba con que el texto estuviera: tenía que leerse.

                    Ahora va en `text-sm` y lo que carga el aviso es la barra
                    dorada de la izquierda, el mismo recurso con el que se marca
                    el día de hoy en el calendario. El fondo es sólo un tinte
                    de apoyo: se eligió así a propósito para no repetir el error
                    del calendario, donde el aviso dependía de un relleno que
                    se mimetizaba con lo que tenía debajo. Una barra no se
                    mezcla con nada, y se ve igual en el tema claro y el oscuro. */}
                {/* <p className="rounded-sm border border-border bg-secondary/30 p-3 text-xs text-foreground">
                  Te esperamos hasta {TOLERANCIA_MINUTOS} minutos. Pasado ese rato el turno se
                  libera, porque atrás hay otra clienta esperando.
                </p> */}
                <p className="flex items-start gap-2.5 rounded-sm border-l-4 border-gold bg-gold-soft/20 p-3.5 text-sm text-foreground">
                  <Clock className="mt-0.5 h-4 w-4 shrink-0 text-gold" aria-hidden="true" />
                  <span>
                    Te esperamos hasta{" "}
                    <strong className="font-semibold">{TOLERANCIA_MINUTOS} minutos</strong>. Pasado
                    ese rato el turno se libera, porque atrás hay otra clienta esperando.
                  </span>
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
  id,
  children,
}: {
  n: number;
  title: string;
  className?: string;
  /** Para poder bajar hasta acá con `scrollIntoView`, ver el efecto de arriba. */
  id?: string;
  children: React.ReactNode;
}) {
  return (
    // `scroll-mt-28`: el header es sticky, y sin este margen el scroll
    // automático deja el título tapado justo debajo de la barra.
    <div id={id} className={`scroll-mt-28 ${className}`}>
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
