import { useEffect, useMemo, useState } from "react";
import { createFileRoute, Link, redirect, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Check, Clock, MessageCircle } from "lucide-react";
import { SiteHeader } from "@/components/site-header";
// 6/9/2026 - la flecha se mudo a `__root.tsx`: ahora va en todo el sitio.
// import { VolverArriba } from "@/components/volver-arriba";
import { SiteFooter } from "@/components/site-footer";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { CalendarioDeLaProfesional } from "@/components/calendario-de-la-profesional";
import { SacarSesionDialog } from "@/components/sacar-sesion-dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useAuth } from "@/hooks/useAuth";
import { useSesionesPendientes } from "@/hooks/useSesionesPendientes";
import { api, apiPost } from "@/lib/api";
import { imageUrl } from "@/lib/cloudinary";
import type {
  RtaDisponibilidad,
  RtaProfesionalesConHorarios,
  RtaReserva,
  RtaServicios,
  SesionPendiente,
} from "@/lib/api-tipos";
import {
  buildSlots,
  formatMoney,
  formatTime,
  precioYDuracion,
  toDateKey,
  TOLERANCIA_MINUTOS,
} from "@/lib/shiraf";
import { parseDateKey } from "@/lib/horarios";
import { desdeCuando } from "@/lib/sesiones";
import { recordarReserva } from "@/lib/volver-a-reservar";
import { isTeamAccount } from "@/lib/roles";
import { notifyAppointment } from "@/lib/notifications.functions";

// Claves opcionales, no claves obligatorias con valor `undefined`: con
// `exactOptionalPropertyTypes` activado esa diferencia hace que el router exija
// `search` en cada <Link to="/reservar">, aunque los dos params sean opcionales.
type Search = { service?: string; professional?: string };

/**
 * 5/10/2026 — esta pantalla vivía en `_authenticated/reservar.tsx` y pedía
 * cuenta para entrar. Se mudó acá, afuera del guard, porque desde hoy se puede
 * sacar turno con nombre y teléfono, sin registrarse: la dueña lo pidió porque
 * las clientas que no se animaban al registro terminaban pidiéndole el turno a
 * la secretaria. La dirección es la misma de siempre, /reservar.
 *
 * Quien tiene cuenta y está conectada reserva igual que antes, a su nombre. La
 * diferencia la hace el servidor mirando si hay sesión, no esta pantalla.
 */
export const Route = createFileRoute("/reservar")({
  /*
   * Sin render en el servidor, como cuando colgaba de `_authenticated`, que lo
   * tenía apagado para todas sus hijas. Esta pantalla nunca se renderizó del
   * lado del servidor y no gana nada con empezar ahora: está fuera de
   * robots.txt, y arranca con `new Date()` en el estado — que en el servidor,
   * que corre en UTC, a la noche ya es el día siguiente.
   */
  ssr: false,
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

  /*
   * Quién reserva: la clienta conectada, o alguien sin cuenta (5/10/2026).
   *
   * `sinCuenta` espera a que la sesión termine de cargar. Sin esa espera, a
   * quien SÍ tiene cuenta se le dibujarían los campos de nombre y teléfono
   * durante medio segundo y después se le irían — un formulario que cambia solo
   * mientras lo estás leyendo.
   *
   * No es lo que decide de quién queda el turno: eso lo resuelve el servidor
   * mirando la cookie. Esto es sólo qué campos mostrar.
   */
  const { user, loading: cargandoSesion } = useAuth();
  const sinCuenta = !cargandoSesion && !user;
  const [guestName, setGuestName] = useState("");
  const [guestPhone, setGuestPhone] = useState("");

  /*
   * Ya contestó la pregunta de la entrada: quiere reservar sin cuenta.
   *
   * A quien llega sin sesión, lo primero que se le muestra es eso —seguir sin
   * registrarse o ingresar— y recién después los pasos. Lo pidió la dueña así:
   * que se decida ahí, de entrada, y no que la opción de la cuenta aparezca
   * como letra chica en el último paso.
   *
   * Se recuerda mientras dure la pestaña. Sin eso, la que vuelve de mirar la
   * ficha de un tratamiento tendría que contestar lo mismo cada vez. Se lee en
   * el inicializador y no en un efecto para que la pregunta no parpadee un
   * instante antes de irse — se puede porque esta ruta no se renderiza en el
   * servidor, así que `sessionStorage` existe desde el primer render.
   */
  const [sinRegistrarse, setSinRegistrarse] = useState(() => {
    try {
      return sessionStorage.getItem(ELIGIO_SIN_CUENTA) === "1";
    } catch {
      return false;
    }
  });

  /** A ingresar o crear la cuenta, dejando anotado que tiene que volver acá. */
  function irAIngresar() {
    // Con lo que ya tenía elegido, para que al volver no arranque de cero. El
    // horario no viaja: en el rato que tarda en ingresar lo puede tomar otra.
    recordarReserva({
      ...(serviceId ? { service: serviceId } : {}),
      ...(professionalId ? { professional: professionalId } : {}),
    });
    navigate({ to: "/auth" });
  }

  // Lo que escribió la última vez que reservó sin cuenta, para no pedírselo de
  // nuevo. Es una comodidad de este navegador y nada más: no identifica a nadie
  // ni le abre nada. En un efecto porque `localStorage` no existe hasta montar,
  // y con try/catch porque en una ventana privada puede tirar.
  useEffect(() => {
    try {
      const guardado = JSON.parse(localStorage.getItem(DATOS_DE_INVITADA) ?? "null") as {
        nombre?: unknown;
        telefono?: unknown;
      } | null;
      if (typeof guardado?.nombre === "string") setGuestName(guardado.nombre);
      if (typeof guardado?.telefono === "string") setGuestPhone(guardado.telefono);
    } catch {
      // Sin nada guardado, o guardado roto: los campos arrancan vacíos.
    }
  }, []);

  /** El turno que acaba de sacar alguien sin cuenta, para el cartel del final. */
  const [reservado, setReservado] = useState<Reservado | null>(null);

  /*
   * Las sesiones que le falta sacar a la clienta conectada, para avisarle si
   * está por reservar DE NUEVO un tratamiento que ya tiene empezado.
   *
   * Lo pidió la dueña: la clienta que vuelve a "sacar turno de Exosomas" casi
   * siempre lo que quiere es su sesión 2, que ya pagó, y sin el aviso
   * reservaría —y se le cobraría— un tratamiento entero nuevo.
   */
  const pendientes = useSesionesPendientes();
  const pendienteDeEste = pendientes.data?.find((p) => p.service_id === serviceId);
  /** El tratamiento que eligió empezar de nuevo igual, sabiendo que tiene uno a medias. */
  const [empezarNuevo, setEmpezarNuevo] = useState<string | undefined>();
  const [sacando, setSacando] = useState<SesionPendiente | null>(null);
  /** Hasta que no elige una de las dos cosas, los pasos que siguen no aparecen. */
  const frenadoPorPendiente = !!pendienteDeEste && empezarNuevo !== serviceId;

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
   * ── POR QUÉ NO ALCANZA CON `elegido` ──────────────────────────────────────
   *
   * Porque es un booleano, y el efecto sólo corre cuando su dependencia
   * CAMBIA. La primera elección lo lleva de false a true y la pantalla baja;
   * de ahí en más, elegir otro tratamiento lo deja en true, React no ve
   * ninguna diferencia y no vuelve a bajar. El síntoma es raro de explicar y
   * muy fácil de encontrar: la primera vez funciona y después no, justo
   * cuando alguien se equivocó y subió a corregir — el peor momento para
   * dejarla mirando el mismo lugar sin entender qué pasó.
   *
   * Así que la dependencia es QUÉ se eligió y no SI se eligió. Sigue en null
   * mientras el paso 1 no esté resuelto —con opciones, tocar la tarjeta no
   * alcanza y falta elegir cuál—, que es la regla que ya tenía `elegido`.
   *
   * Cambiar de opción dentro del mismo tratamiento también baja, y está bien:
   * es la elección que faltaba para poder seguir.
   *
   * Antes: `useEffect(() => { if (elegido) { … } }, [elegido]);`
   */
  //
  // 5/10/2026 — `sigue` y no `elegido` a secas: con una sesión pendiente de
  // ese mismo tratamiento, primero tiene que decidir si quiere esa o empezar
  // uno nuevo. Hasta entonces no se baja ni se muestran los pasos de abajo.
  //   const listoParaBajar = elegido ? `${serviceId}·${variantId ?? ""}` : null;
  const sigue = elegido && !frenadoPorPendiente;
  /** Todavía está en la pregunta de la entrada: los pasos no están en pantalla. */
  const enLaPregunta = sinCuenta && !sinRegistrarse;
  // Con `enLaPregunta` adentro para que baje recién cuando contesta: quien
  // llega con `?service=` ya tiene el paso 1 resuelto, y sin esto el efecto
  // corría con la pregunta en pantalla —sin paso 2 al que bajar— y después no
  // volvía a correr.
  //   const listoParaBajar = sigue ? `${serviceId}·${variantId ?? ""}` : null;
  const listoParaBajar = sigue && !enLaPregunta ? `${serviceId}·${variantId ?? ""}` : null;

  useEffect(() => {
    if (!listoParaBajar) return;
    document
      .getElementById("paso-profesional")
      ?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [listoParaBajar]);

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
      // Antes: `apiPost<{ id: string }>`. Ahora la respuesta dice además si el
      // turno quedó a nombre de una cuenta o de una invitada.
      const created = await apiPost<RtaReserva>("/api/reservar", {
        service_id: serviceId,
        // Viaja el id de la opción, nunca su precio: lo busca el servidor. Es
        // la misma regla que ya valía para el tratamiento.
        variant_id: variantId ?? null,
        professional_id: professionalId,
        starts_at: slot,
        client_notes: notes || null,
        // Sólo sin cuenta. Con sesión el servidor los ignora igual —el turno
        // es de la sesión—, pero no tiene sentido mandarlos.
        ...(sinCuenta ? { guest_name: guestName.trim(), guest_phone: guestPhone.trim() } : {}),
      });

      // Sin cuenta, los dos avisos de abajo ya los disparó el servidor: esta
      // pantalla no tiene sesión con la que pedirlos. Ver `avisarSinEsperar`.
      if (created.invitada) return created;

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
      // Los dos en paralelo y los dos SIN romper la reserva si el mail falla: el
      // turno YA está reservado y es lo que le importa a la clienta. Hacer
      // fallar la mutación por un mail la mandaría a reintentar una reserva que
      // ya existe, y el segundo intento lo rebotaría el control de superposición
      // contra su propio turno.
      //
      // Pero "no romper" no es "no enterarse". El rastro que sirve —el que puede
      // ver el centro— lo deja el servidor: `notifyAppointment` escribe una
      // línea `[aviso]` en el log del contenedor cuando el mail no sale, y por
      // ahí pasan los tres caminos (esta reserva, el panel y el recordatorio).
      // Acá sólo queda lo que ese log no ve: que el pedido ni siquiera haya
      // llegado a destino —sin conexión, o el aviso rechazado por permisos—.
      await Promise.all([
        notifyAppointment({
          data: { appointmentId: created.id, event: "new-request" },
        }).catch((e: Error) => console.error("[reserva] no se pudo avisar al centro:", e.message)),
        notifyAppointment({
          data: { appointmentId: created.id, event: "requested" },
        }).catch((e: Error) =>
          console.error("[reserva] no se pudo avisar a la clienta:", e.message),
        ),
      ]);

      return created;
    },
    // Antes no recibía nada: la mutación no devolvía la respuesta.
    // onSuccess: () => {
    onSuccess: (created) => {
      /*
       * Sin cuenta no hay «Mi cuenta» a donde mandarla. Se queda acá, con un
       * cartel que dice qué reservó y por dónde le llega el comprobante.
       *
       * El enlace a sus turnos NO se muestra en este cartel, y no es que falte:
       * el servidor no lo devuelve. Llega sólo por WhatsApp, porque acá nadie
       * comprobó que el teléfono que escribió sea suyo.
       */
      if (created.invitada) {
        try {
          localStorage.setItem(
            DATOS_DE_INVITADA,
            JSON.stringify({ nombre: guestName.trim(), telefono: guestPhone.trim() }),
          );
        } catch {
          // Si no se puede guardar, la próxima vez lo escribe de nuevo.
        }
        setReservado({
          tratamiento: variant ? `${service?.name} — ${variant.name}` : (service?.name ?? ""),
          profesional: professionals.data?.find((p) => p.id === professionalId)?.full_name ?? "",
          cuando: slot ?? "",
          telefono: guestPhone.trim(),
        });
        // Los horarios de ese día quedaron viejos: el que acaba de tomar ya no
        // está libre, y si saca otro turno no se lo tienen que ofrecer.
        queryClient.invalidateQueries({ queryKey: ["availability"] });
        window.scrollTo({ top: 0 });
        return;
      }

      queryClient.invalidateQueries({ queryKey: ["my-appointments"] });
      // Decía «¡Turno solicitado! Queda pendiente de confirmación.» — quedó de
      // cuando el turno nacía pendiente. Desde el 6/9/2026 reservar ES la
      // confirmación, y el mail que acaba de salir dice exactamente eso; el
      // toast no puede contradecirlo.
      // toast.success("¡Turno solicitado! Queda pendiente de confirmación.");
      toast.success("¡Turno reservado! Te mandamos el comprobante por mail.");
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

  /*
   * El cartel del final, para quien reservó sin cuenta. Reemplaza al formulario
   * entero y no va debajo: con los cuatro pasos todavía en pantalla, lo que se
   * lee es que falta algo por completar.
   */
  if (reservado) {
    return (
      <div className="min-h-screen">
        <SiteHeader />

        <section className="mx-auto max-w-2xl px-5 pt-14 pb-20">
          <p className="text-eyebrow text-muted-foreground">Reserva confirmada</p>
          <h1 className="mt-4 text-5xl text-foreground">¡Listo, tu turno está reservado!</h1>
          <div className="gold-rule mt-6" />

          <Card className="mt-10 border-border/80 shadow-soft">
            <CardContent className="space-y-5 p-6">
              <ul className="space-y-2 text-sm">
                <li className="flex justify-between gap-6">
                  <span className="text-muted-foreground">Tratamiento</span>
                  <span className="text-right text-foreground">{reservado.tratamiento}</span>
                </li>
                <li className="flex justify-between gap-6">
                  <span className="text-muted-foreground">Profesional</span>
                  <span className="text-foreground">{reservado.profesional}</span>
                </li>
                <li className="flex justify-between gap-6">
                  <span className="text-muted-foreground">Fecha y hora</span>
                  <span className="text-right text-foreground">
                    {new Date(reservado.cuando).toLocaleString("es-AR", {
                      weekday: "long",
                      day: "2-digit",
                      month: "long",
                      hour: "2-digit",
                      minute: "2-digit",
                      hourCycle: "h23",
                    })}
                  </span>
                </li>
              </ul>

              <p className="flex items-start gap-2.5 rounded-sm border-l-4 border-gold bg-gold-soft/20 p-3.5 text-sm leading-relaxed text-foreground">
                <MessageCircle className="mt-0.5 h-4 w-4 shrink-0 text-gold" aria-hidden="true" />
                <span>
                  Te mandamos el comprobante por WhatsApp al{" "}
                  <strong className="font-semibold">{reservado.telefono}</strong>. Ahí viene también
                  un enlace para ver, cambiar o cancelar tus turnos cuando quieras, sin tener que
                  registrarte.
                </span>
              </p>

              <p className="text-xs leading-relaxed text-muted-foreground">
                Si en unos minutos no te llega, escribinos: puede que el número haya quedado mal
                anotado. El pago se realiza en el centro.
              </p>

              <div className="flex flex-wrap gap-3">
                <Button asChild>
                  <Link to="/">Volver al inicio</Link>
                </Button>
                <Button
                  variant="outline"
                  onClick={() => {
                    // Vuelve al formulario limpio. El nombre y el teléfono se
                    // quedan: es la misma persona sacando otro turno.
                    setReservado(null);
                    setServiceId(undefined);
                    setVariantId(undefined);
                    setProfessionalId(undefined);
                    setSlot(undefined);
                    setNotes("");
                  }}
                >
                  Sacar otro turno
                </Button>
              </div>
            </CardContent>
          </Card>
        </section>

        <SiteFooter />
      </div>
    );
  }

  /*
   * La pregunta de la entrada, para quien llega sin sesión: ¿sin registrarte, o
   * con tu cuenta? Va ANTES de los pasos y en su lugar, no arriba de ellos: es
   * una decisión que cambia qué se le va a pedir, y con el catálogo ya
   * desplegado debajo nadie la lee.
   *
   * Las dos opciones valen lo mismo y por eso son dos tarjetas iguales. Si una
   * fuera un botón grande y la otra un enlace chiquito, la pantalla ya habría
   * elegido por ella — y lo que se pidió es justamente que elija.
   */
  if (enLaPregunta) {
    return (
      <div className="min-h-screen">
        <SiteHeader />

        <section className="mx-auto max-w-3xl px-5 pt-14 pb-20">
          <p className="text-eyebrow text-muted-foreground">Nueva reserva</p>
          <h1 className="mt-4 text-5xl text-foreground">Sacar turno</h1>
          <div className="gold-rule mt-6" />

          <h2 className="mt-12 font-display text-2xl text-foreground">¿Cómo querés reservar?</h2>

          <div className="mt-6 grid gap-4 sm:grid-cols-2">
            <Card className="border-border/80 shadow-soft">
              <CardContent className="flex h-full flex-col p-6">
                <p className="font-display text-xl text-foreground">Sin registrarme</p>
                <p className="mt-3 flex-1 text-sm leading-relaxed text-muted-foreground">
                  Sólo te pedimos tu nombre y tu celular. Te mandamos el comprobante por WhatsApp,
                  con un enlace para ver, cambiar o cancelar tu turno.
                </p>
                <Button
                  className="mt-6 w-full"
                  onClick={() => {
                    try {
                      sessionStorage.setItem(ELIGIO_SIN_CUENTA, "1");
                    } catch {
                      // Si no se puede guardar, se lo volvemos a preguntar la
                      // próxima vez. No es motivo para no dejarla seguir.
                    }
                    setSinRegistrarse(true);
                  }}
                >
                  Seguir sin cuenta
                </Button>
              </CardContent>
            </Card>

            <Card className="border-border/80 shadow-soft">
              <CardContent className="flex h-full flex-col p-6">
                <p className="font-display text-xl text-foreground">Con mi cuenta</p>
                <p className="mt-3 flex-1 text-sm leading-relaxed text-muted-foreground">
                  Ingresá, o creá tu cuenta en un minuto. Tenés todos tus turnos y tu historial en
                  un solo lugar, y no hace falta que escribas tus datos cada vez.
                </p>
                <Button className="mt-6 w-full" variant="outline" onClick={irAIngresar}>
                  Ingresar o registrarme
                </Button>
              </CardContent>
            </Card>
          </div>
        </section>

        <SiteFooter />
      </div>
    );
  }

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
              {/* 5/10/2026 — decía sólo «las siguientes las coordinamos con vos
                  en el centro». Eso sigue valiendo, y se suma que las puede
                  sacar ella cuando le toca. Se dicen LAS DOS a pedido de la
                  dueña: la que no se anima a hacerlo sola tiene que saber que
                  se lo puede pedir a la secretaria. */}
              . Acá reservás la primera. Las siguientes las coordinamos con vos cuando vengas, o las
              reservás vos desde el sitio cuando te toque: te avisamos. El valor es por el
              tratamiento completo.
            </p>
          )}

          {/* Ya tiene este tratamiento empezado y le falta una sesión. Va acá,
              apenas elige el tratamiento y antes de que elija nada más: es el
              momento en que todavía no perdió tiempo armando un turno que no
              era el que quería.

              No se le prohíbe empezar uno nuevo —puede querer exactamente
              eso—, pero tiene que decirlo: los pasos de abajo no aparecen
              hasta que elige una de las dos cosas. */}
          {pendienteDeEste && (
            <div className="mt-6 rounded-sm border border-gold bg-gold/10 p-5">
              <p className="font-display text-xl text-foreground">
                Ya tenés este tratamiento empezado
              </p>
              <p className="mt-2 text-sm leading-relaxed text-foreground">
                Te falta la sesión {pendienteDeEste.session_number} de{" "}
                {pendienteDeEste.sessions_total} de {pendienteDeEste.tratamiento}. Está incluida en
                lo que ya reservaste: no se paga de nuevo. {desdeCuando(pendienteDeEste)}
              </p>
              <div className="mt-4 flex flex-wrap gap-3">
                <Button type="button" onClick={() => setSacando(pendienteDeEste)}>
                  Reservar la sesión {pendienteDeEste.session_number}
                </Button>
                {frenadoPorPendiente && (
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => setEmpezarNuevo(serviceId)}
                  >
                    Empezar un tratamiento nuevo
                  </Button>
                )}
              </div>
            </div>
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

        {/* `sigue` y no `elegido`, acá y en los dos pasos de abajo: ver arriba. */}
        {sigue && (
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

        {sigue && professionalId && (
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

        {sigue && slot && service && (
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

                {/* Sin cuenta: lo único que se pide para reservar. El teléfono
                    no es un dato de contacto más — es a donde llega el
                    comprobante y el enlace a sus turnos, así que el texto de
                    abajo lo dice antes de que lo escriba mal. */}
                {sinCuenta && (
                  <div className="space-y-4 border-t border-border pt-5">
                    <div className="grid gap-4 sm:grid-cols-2">
                      <div className="space-y-2">
                        <Label htmlFor="guest-name">Nombre y apellido</Label>
                        <Input
                          id="guest-name"
                          autoComplete="name"
                          maxLength={80}
                          value={guestName}
                          onChange={(e) => setGuestName(e.target.value)}
                        />
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="guest-phone">Celular (con WhatsApp)</Label>
                        <Input
                          id="guest-phone"
                          type="tel"
                          inputMode="tel"
                          autoComplete="tel"
                          maxLength={30}
                          placeholder="11 2345 6789"
                          value={guestPhone}
                          onChange={(e) => setGuestPhone(e.target.value)}
                        />
                      </div>
                    </div>
                    <p className="text-xs leading-relaxed text-muted-foreground">
                      A ese número te mandamos el comprobante por WhatsApp, con un enlace para ver,
                      cambiar o cancelar tu turno. No hace falta que te registres.{" "}
                      {/* Un botón y no un <Link>: además de navegar deja
                          anotado que tiene que volver a esta reserva. Es la
                          misma salida que la tarjeta «Con mi cuenta» de la
                          entrada, por si cambió de idea a mitad de camino. */}
                      <button
                        type="button"
                        onClick={irAIngresar}
                        className="underline underline-offset-2 hover:text-foreground"
                      >
                        Si preferís usar tu cuenta, ingresá
                      </button>
                      .
                    </p>
                  </div>
                )}

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

                {/* Antes: `disabled={book.isPending}`. Sin cuenta, además, hasta
                    que no estén el nombre y el teléfono: el servidor los exige
                    y los valida de verdad, esto sólo evita el viaje. Mientras
                    la sesión carga tampoco, para que el turno no salga antes de
                    saber qué campos tocaba mostrar. */}
                <Button
                  className="w-full"
                  size="lg"
                  disabled={
                    book.isPending ||
                    cargandoSesion ||
                    (sinCuenta && (guestName.trim().length < 3 || guestPhone.trim().length < 8))
                  }
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

      {/* Acá estaba la flecha para volver arriba. Se mudó a `__root.tsx` el
          6/9/2026, a pedido de la dueña: va en todas las páginas y no sólo en
          ésta.

          <VolverArriba /> */}

      <SacarSesionDialog
        pendiente={sacando}
        onOpenChange={(abierto) => !abierto && setSacando(null)}
      />

      <SiteFooter />
    </div>
  );
}

/** Dónde queda guardado, en este navegador, lo que escribió quien reservó sin cuenta. */
const DATOS_DE_INVITADA = "shiraf:reserva-sin-cuenta";

/** Que ya eligió «sin registrarme» en la pregunta de la entrada. Dura lo que la pestaña. */
const ELIGIO_SIN_CUENTA = "shiraf:reservar-sin-registrarme";

/** Lo que muestra el cartel del final. Una foto de lo reservado, no ids. */
type Reservado = {
  tratamiento: string;
  profesional: string;
  /** El instante del turno, en ISO. */
  cuando: string;
  telefono: string;
};

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
