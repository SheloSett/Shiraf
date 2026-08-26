import { useState } from "react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ArrowLeft, Clock, Mail, MessageCircle, Phone, Trash2, User } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { EstadoTurno } from "@/components/admin/estado-turno";
import { quienAtiende } from "@/lib/shiraf";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { LinkGuestDialog, type GuestToLink } from "@/components/admin/link-guest-dialog";
import { EditGuestDialog, type GuestToEdit } from "@/components/admin/edit-guest-dialog";
import { api, apiPut } from "@/lib/api";
import type { RtaProfesionalesParaElTurno, RtaTurnoEnDetalle } from "@/lib/api-tipos";
import { formatDateTime, formatMoney, toStatus } from "@/lib/shiraf";
import { appointmentWhatsappUrl } from "@/lib/notifications";
import {
  NOTIFIES,
  openWhatsapp,
  toNotifiable,
  useCambiarEstadoDeTurno,
} from "@/hooks/useCambiarEstadoDeTurno";
import { useBorrarTurno } from "@/hooks/useBorrarTurno";
import { CancelarTurnoDialog, type TurnoACancelar } from "@/components/cancelar-turno-dialog";
import { useReprogramarTurno } from "@/hooks/useReprogramarTurno";

/**
 * La ficha de un turno.
 *
 * ⚠️ El archivo se llama `admin.turnos_.$id.tsx` y ese guión bajo no es un error
 * de tipeo: en el ruteo por archivos, `turnos_` significa "la URL sí cuelga de
 * /admin/turnos, pero la pantalla NO se dibuja adentro de la de turnos". Sin él,
 * TanStack trata a `admin.turnos.tsx` como el marco de esta pantalla y le exige
 * un <Outlet />; como esa pantalla es una tabla y no un marco, la ficha no se
 * vería nunca. Lo que sí la envuelve es `admin.tsx`, que es el panel con el menú
 * al costado — y eso está bien.
 */
export const Route = createFileRoute("/_authenticated/admin/turnos_/$id")({
  component: FichaDelTurno,
});

/** Un dato de la ficha: etiqueta chica arriba, valor abajo. */
function Dato({
  icono,
  etiqueta,
  children,
}: {
  icono?: React.ReactNode;
  etiqueta: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <p className="flex items-center gap-1.5 text-[11px] tracking-[0.12em] uppercase text-muted-foreground">
        {icono}
        {etiqueta}
      </p>
      <div className="mt-1 text-sm text-foreground">{children}</div>
    </div>
  );
}

function Tarjeta({ titulo, children }: { titulo: string; children: React.ReactNode }) {
  return (
    <section className="rounded-sm border border-border bg-card p-6">
      <h2 className="font-display text-xl text-foreground">{titulo}</h2>
      <div className="mt-5 grid gap-5 sm:grid-cols-2">{children}</div>
    </section>
  );
}

function FichaDelTurno() {
  const { id } = Route.useParams();

  /** Invitada que se está vinculando a una cuenta, o null. */
  const [linking, setLinking] = useState<GuestToLink | null>(null);
  /** Invitada a la que se le están corrigiendo los datos, o null. */
  const [editing, setEditing] = useState<GuestToEdit | null>(null);
  /** ¿Está abierto el cartel que pregunta si se borra el turno? */
  const [borrandoTurno, setBorrandoTurno] = useState(false);
  /** El turno que se está por cancelar, o null. Ver `cambiarA`. */
  const [cancelando, setCancelando] = useState<TurnoACancelar | null>(null);

  const navigate = useNavigate();

  const turno = useQuery({
    // La clave arranca con "turno" a propósito: el hook que cambia el estado
    // invalida por ese prefijo, así que apretar "Confirmar" acá refresca esta
    // misma pantalla sin que haya que acordarse de pedirlo.
    queryKey: ["turno", id],
    queryFn: async () => (await api<RtaTurnoEnDetalle>(`/api/turnos/${id}`)).turno,
  });

  const setStatus = useCambiarEstadoDeTurno();
  const reprogramar = useReprogramarTurno();
  // El valor del <input type="datetime-local">, que es hora LOCAL sin zona.
  const [nuevoHorario, setNuevoHorario] = useState("");
  const borrar = useBorrarTurno();

  if (turno.isPending) {
    return <p className="text-sm text-muted-foreground">Buscando el turno…</p>;
  }

  if (turno.isError || !turno.data) {
    return (
      <div>
        <p className="text-sm text-muted-foreground">
          {turno.error?.message ?? "No encontramos ese turno."}
        </p>
        <Button asChild variant="outline" className="mt-4">
          <Link to="/admin/turnos" search={{}}>
            <ArrowLeft className="mr-2 h-4 w-4" /> Volver a Turnos
          </Link>
        </Button>
      </div>
    );
  }

  const t = turno.data;
  const estado = toStatus(t.status);
  /**
   * Un turno que todavía no empezó no se pudo haber realizado. Se mide contra el
   * comienzo y no contra el final: que la clienta se vaya cinco minutos antes es
   * normal, y hacer esperar a que termine el bloque sería una molestia.
   */
  const todaviaNoEmpezo = new Date(t.starts_at) > new Date();
  /**
   * Un turno que todavía se va a atender NO se borra: se cancela.
   *
   * Es la misma regla que aplica el servidor —ver `turnos.controller → borrar`—
   * y el motivo es que cancelar es lo único que le avisa a la clienta. Borrar
   * derecho el turno de mañana le libera el horario al centro y la deja
   * viniendo igual, sin que nadie le haya dicho nada.
   */
  const seBorra = !((estado === "pending" || estado === "confirmed") && todaviaNoEmpezo);

  const aviso = estado ? NOTIFIES[estado] : undefined;
  const whatsapp = aviso ? appointmentWhatsappUrl(aviso, toNotifiable(t)) : null;

  /**
   * El pedido de cambio de estado, que siempre lleva los datos del aviso.
   *
   * Cancelar es el único que no se ejecuta derecho: abre el cartel que pide el
   * motivo, porque ese texto es el que la clienta va a leer en el mail. Se
   * decide acá adentro y no en cada botón a propósito — esta pantalla cancela
   * desde DOS lugares (el botón de arriba y la grilla de corregir un turno ya
   * cerrado), y si la decisión viviera en el botón, uno de los dos se iba a
   * quedar sin pedir el motivo.
   */
  const cambiarA = (status: NonNullable<typeof estado>) => {
    if (status === "cancelled") {
      setCancelando({ id: t.id, quien: t.person.name, cuando: formatDateTime(t.starts_at) });
      return;
    }
    setStatus.mutate({ id: t.id, status, notify: toNotifiable(t) });
  };

  return (
    // `mx-auto`: la ficha es una columna angosta y el panel es ancho. Pegada a
    // la izquierda dejaba media pantalla vacía a la derecha y la lectura arrancaba
    // en un costado. Centrada queda donde la vista va sola.
    <div className="mx-auto max-w-4xl">
      {/* La vuelta lleva la pestaña del estado de este turno y su id: se aterriza
          en la lista con la fila resaltada, que es de donde se vino. */}
      <Button asChild variant="ghost" size="sm" className="-ml-3">
        <Link to="/admin/turnos" search={{ ...(estado ? { estado } : {}), turno: t.id }}>
          <ArrowLeft className="mr-2 h-4 w-4" /> Volver a Turnos
        </Link>
      </Button>

      <div className="mt-4 flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-eyebrow text-muted-foreground">Turno</p>
          <h1 className="mt-3 font-display text-4xl text-foreground first-letter:uppercase">
            {formatDateTime(t.starts_at)}
          </h1>
        </div>
        <EstadoTurno
          status={t.status}
          startsAt={t.starts_at}
          now={Date.now()}
          className="text-sm"
        />
      </div>

      <div className="mt-8 space-y-6">
        <Tarjeta titulo="La clienta">
          <Dato icono={<User className="h-3 w-3" />} etiqueta="Nombre">
            <span className="flex flex-wrap items-center gap-2">
              {t.person.name}
              {/* Igual que en la lista: marcar la invitada evita que se la busque
                  en Clientes y no aparezca — no tiene ficha porque no tiene
                  cuenta. */}
              {t.person.isGuest && (
                <Badge variant="outline" className="font-normal text-[10px]">
                  sin cuenta
                </Badge>
              )}
            </span>
          </Dato>

          <Dato icono={<Phone className="h-3 w-3" />} etiqueta="Teléfono">
            {t.person.phone ?? <span className="text-muted-foreground">Sin teléfono</span>}
          </Dato>

          <Dato icono={<Mail className="h-3 w-3" />} etiqueta="Mail">
            {t.email ?? <span className="text-muted-foreground">Sin mail</span>}
          </Dato>

          <Dato etiqueta="Nota de la reserva">
            {t.client_notes ? (
              <span className="italic">“{t.client_notes}”</span>
            ) : (
              <span className="text-muted-foreground">No dejó ninguna</span>
            )}
          </Dato>

          {t.person.isGuest && (
            <div className="flex flex-wrap gap-2 sm:col-span-2">
              {/* Los dos diálogos son los mismos de la lista. Editar va sin
                  condición: sus datos viven en este turno y siempre se pueden
                  corregir. Vincular pide teléfono, que es con lo que se buscan
                  los demás turnos de la misma persona. */}
              <Button
                size="sm"
                variant="outline"
                onClick={() =>
                  setEditing({
                    appointmentId: t.id,
                    name: t.guest_name ?? "",
                    phone: t.guest_phone,
                    email: t.guest_email,
                  })
                }
              >
                Corregir sus datos
              </Button>
              {t.person.phone && (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => setLinking({ name: t.person.name, phone: t.person.phone })}
                >
                  Vincular a una cuenta
                </Button>
              )}
            </div>
          )}
        </Tarjeta>

        <Tarjeta titulo="El turno">
          <Dato etiqueta="Tratamiento">
            {/* El nombre siempre llega: si el tratamiento se borró del catálogo,
                viene congelado del turno. Lo que se pierde es el enlace al
                catálogo, no el dato. */}
            {t.services.name}
            {t.services.id === null && (
              <span className="mt-1 block text-xs text-muted-foreground">
                Este tratamiento ya no está en el catálogo.
              </span>
            )}
          </Dato>

          <Dato etiqueta="Profesional">
            {(() => {
              const q = quienAtiende(
                t.professionals,
                t.professional_name,
                t.status,
                t.starts_at,
                Date.now(),
              );

              if (q.caso === "asignada") return q.nombre;

              // Se borró del equipo, pero el turno guarda quién lo atendió. Es
              // el dato correcto y no hay nada que hacer con él: se muestra como
              // información, sin rojo y sin pedir nada.
              if (q.caso === "historica") {
                return (
                  <>
                    {q.nombre}
                    <span className="mt-1 block text-xs text-muted-foreground">
                      Ya no trabaja en el centro. Queda anotada porque es quien atendió este turno.
                    </span>
                  </>
                );
              }

              if (q.caso === "desactivada") {
                return (
                  <>
                    {q.nombre}
                    <span
                      className={`mt-1 block text-xs ${q.seArregla ? "font-semibold text-destructive" : "text-muted-foreground"}`}
                    >
                      {q.seArregla
                        ? "Ya no atiende — hay que pasarle este turno a otra."
                        : "Ya no atiende. Este turno ya pasó, así que queda a su nombre."}
                    </span>
                  </>
                );
              }

              // Nunca tuvo a nadie. Sólo es un problema si todavía se puede
              // resolver: en un turno que ya pasó, asignarle alguien ahora sería
              // anotar que la atendió quien no la atendió.
              return q.seArregla ? (
                <span className="font-semibold text-destructive">Sin asignar</span>
              ) : (
                <>
                  <span className="text-muted-foreground">Sin registrar</span>
                  <span className="mt-1 block text-xs text-muted-foreground">
                    No quedó anotado quién lo atendió, y el turno ya pasó. Asignarle alguien ahora
                    diría que la atendió una persona que quizá no fue.
                  </span>
                </>
              );
            })()}
          </Dato>

          <Dato icono={<Clock className="h-3 w-3" />} etiqueta="Duración">
            {t.duration_minutes} minutos
          </Dato>

          <Dato etiqueta="Valor">
            {formatMoney(t.price)}
            {/* El precio del turno está congelado al día que se reservó. Si el
                del catálogo cambió desde entonces, se avisa: cobrar el nuevo o
                respetar el viejo es una decisión del centro, pero para tomarla
                hay que saber que son distintos. */}
            {/* `price` del catálogo es null cuando el tratamiento se borró: ahí
                no hay con qué comparar y no se avisa nada. */}
            {t.services.price !== null && t.services.price !== t.price && (
              <span className="mt-1 block text-xs text-muted-foreground">
                Hoy en el catálogo figura {formatMoney(t.services.price)}
              </span>
            )}
          </Dato>

          <Dato etiqueta="Pedido el">{formatDateTime(t.created_at)}</Dato>

          {t.admin_notes && <Dato etiqueta="Nota interna">{t.admin_notes}</Dato>}

          {/* El motivo de la cancelación.
              La etiqueta dice de dónde salió porque cambia cómo se lee: si lo
              escribió el centro, la clienta ya lo recibió por mail; si lo
              escribió ella, es lo único que el centro sabe de por qué perdió
              ese turno. */}
          {t.cancel_reason && <Dato etiqueta="Motivo de la cancelación">{t.cancel_reason}</Dato>}
        </Tarjeta>

        <section className="rounded-sm border border-border bg-card p-6">
          <h2 className="font-display text-xl text-foreground">Qué hacer con este turno</h2>

          {/* ── LOS CAMBIOS DE ESTADO, SIEMPRE TODOS ──────────────────────
              Antes cada botón tenía su propia condición y sólo salían los del
              "camino feliz": pendiente ofrecía confirmar, confirmado ofrecía
              realizado, y un turno cerrado no ofrecía NADA — decía «no hay nada
              más que hacerle». Un clic al lado dejaba el turno mal para siempre,
              porque la tabla tampoco lo deja tocar.

              Ahora están los cuatro estados menos el que el turno ya tiene, que
              es el único que no tiene sentido ofrecer. Esta es la pantalla donde
              se arregla cualquier cosa; la tabla quedó con lo de todos los días.

              El servidor nunca puso trabas: `cambiarEstado` acepta cualquier
              transición y su única regla —que no se puede marcar realizado algo
              que todavía no empezó— es la misma que aplica el `disabled`. */}
          <div className="mt-5 flex flex-wrap gap-2">
            {(
              [
                ["confirmed", "Confirmar"],
                ["completed", "Marcar realizado"],
                ["cancelled", "Cancelar el turno"],
                ["pending", "Volver a pendiente"],
              ] as const
            )
              .filter(([otro]) => otro !== estado)
              .map(([otro, texto]) => {
                // Un turno que todavía no empezó no se pudo haber realizado. El
                // servidor lo rechaza igual; acá se apaga para no ofrecer algo
                // que va a fallar, y el título dice por qué.
                const bloqueado = otro === "completed" && todaviaNoEmpezo;
                return (
                  <Button
                    key={otro}
                    // Cancelar en `ghost` para que no compita: es la salida, no
                    // lo que se viene a hacer.
                    variant={otro === "cancelled" ? "ghost" : "outline"}
                    disabled={setStatus.isPending || bloqueado}
                    title={bloqueado ? "Todavía no llegó la hora de este turno" : undefined}
                    onClick={() => cambiarA(otro)}
                  >
                    {texto}
                  </Button>
                );
              })}

            {/* Reenviar el aviso, para cuando el del toast se pasó de largo o el
                mensaje no llegó. Sale con el texto del estado en el que el turno
                está AHORA. Sin teléfono no hay enlace posible y no aparece. */}
            {whatsapp && (
              <Button
                variant="ghost"
                title="Abrir WhatsApp con el aviso escrito"
                onClick={() => openWhatsapp(whatsapp)}
              >
                <MessageCircle className="mr-2 h-4 w-4" /> Avisar por WhatsApp
              </Button>
            )}
          </div>

          {/* ── REPROGRAMAR ──────────────────────────────────────────────
              La salida de un turno vencido. A uno que se pasó de hora no se le
              puede inventar una profesional ni darlo por realizado si no pasó;
              lo que corresponde es correrlo de fecha. Hasta ahora la única forma
              era cancelarlo y cargarlo de nuevo, que le pierde el historial.

              Sirve igual para uno por venir: la clienta que avisa que no llega,
              la profesional que se enferma.

              Cerrado no se muestra —realizado ya pasó, cancelado ya no va—: si
              hay que revivirlo, primero se le cambia el estado con los botones
              de arriba. Son dos decisiones y conviene que sean dos clics. */}
          {estado !== "completed" && estado !== "cancelled" && (
            <div className="mt-6 border-t border-border pt-5">
              <p className="text-sm font-medium text-foreground">Reprogramar el turno</p>
              <p className="mt-1 text-sm text-muted-foreground">
                Se le avisa a la clienta con el horario nuevo. Si ese horario ya está tomado con la
                misma profesional, la base lo frena y no se guarda nada.
              </p>
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <input
                  type="datetime-local"
                  aria-label="Nuevo día y hora del turno"
                  value={nuevoHorario}
                  onChange={(e) => setNuevoHorario(e.target.value)}
                  className="h-10 rounded-sm border border-input bg-background px-3 text-sm text-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none"
                />
                <Button
                  size="sm"
                  variant="outline"
                  disabled={!nuevoHorario || reprogramar.isPending}
                  onClick={() =>
                    reprogramar.mutate(
                      {
                        id: t.id,
                        // `datetime-local` da "2026-08-25T14:30" sin zona, que
                        // `new Date` interpreta como hora local — la del centro,
                        // que es la que se acaba de tipear. De ahí sale el
                        // instante absoluto que guarda la base.
                        startsAt: new Date(nuevoHorario).toISOString(),
                        // El aviso lleva el horario NUEVO, no el que el turno
                        // todavía tiene en pantalla.
                        notify: {
                          ...toNotifiable(t),
                          startsAt: new Date(nuevoHorario).toISOString(),
                        },
                      },
                      { onSuccess: () => setNuevoHorario("") },
                    )
                  }
                >
                  {reprogramar.isPending ? "Moviendo…" : "Reprogramar"}
                </Button>
              </div>
            </div>
          )}

          {/* Reasignar sólo tiene sentido sobre un turno que se va a atender. Uno
              cerrado no se mueve de profesional: ya pasó. */}
          {(estado === "pending" || estado === "confirmed") && (
            <CambiarProfesional turnoId={t.id} actual={t.professionals} />
          )}

          {/* ── SACARLO DE LA AGENDA PARA SIEMPRE ────────────────────────
              Abajo de todo, detrás de una línea y con el botón en gris: es la
              única acción de esta pantalla que no se deshace, y no es la que se
              vino a hacer. Arriba están los estados, que es lo de todos los
              días; esto es para el turno que nunca tendría que haber existido.

              Mientras el turno se pueda atender no aparece: ahí lo que
              corresponde es cancelarlo, que además le avisa a la clienta. */}
          {seBorra && (
            <div className="mt-6 border-t border-border pt-5">
              <p className="text-sm text-muted-foreground">
                ¿Este turno nunca existió —se cargó dos veces, o en el día equivocado—? Se puede
                borrar de la base. Cancelarlo, en cambio, lo deja escrito.
              </p>
              <Button
                size="sm"
                variant="ghost"
                className="mt-3 text-destructive hover:text-destructive"
                onClick={() => setBorrandoTurno(true)}
              >
                <Trash2 className="mr-2 h-4 w-4" /> Eliminar el turno
              </Button>
            </div>
          )}
        </section>
      </div>

      <LinkGuestDialog guest={linking} onOpenChange={(next) => !next && setLinking(null)} />
      <EditGuestDialog guest={editing} onOpenChange={(next) => !next && setEditing(null)} />

      <CancelarTurnoDialog
        turno={cancelando}
        quien="centro"
        pendiente={setStatus.isPending}
        onOpenChange={(abierto) => !abierto && setCancelando(null)}
        onConfirmar={(motivo) =>
          setStatus.mutate(
            { id: t.id, status: "cancelled", notify: toNotifiable(t), motivo },
            { onSuccess: () => setCancelando(null) },
          )
        }
      />

      <AlertDialog open={borrandoTurno} onOpenChange={setBorrandoTurno}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="font-display text-2xl">
              ¿Eliminar este turno?
            </AlertDialogTitle>
            <AlertDialogDescription>
              {t.person.name} · {formatDateTime(t.starts_at)}
              <span className="mt-3 block">
                Se borra de la base y no queda registro de que existió: ni en la lista, ni en el
                calendario, ni en el historial de la clienta.
              </span>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Mejor no</AlertDialogCancel>
            <AlertDialogAction
              disabled={borrar.isPending}
              onClick={() =>
                borrar.mutate(t.id, {
                  // Esta pantalla es la del turno que se acaba de borrar: quedarse
                  // sería mirar una ficha que ya no existe. Se vuelve a la lista.
                  onSuccess: () => void navigate({ to: "/admin/turnos", search: {} }),
                })
              }
            >
              Eliminar el turno
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

/**
 * Pasarle el turno a otra profesional.
 *
 * ── POR QUÉ ES UN COMPONENTE APARTE ───────────────────────────────────────
 *
 * Porque tiene sus propios hooks y la ficha los tendría que declarar antes de
 * saber si el turno existe — arriba de los `return` tempranos, donde todavía no
 * hay ni id de tratamiento ni horario que pedir. Acá se monta cuando ya hay
 * turno y pide sus datos con eso a la vista.
 *
 * ── LO QUE MUESTRA Y LO QUE NO DECIDE ─────────────────────────────────────
 *
 * El desplegable trae sólo a las que hacen ese tratamiento, y marca «(ocupada)»
 * a las que ya tienen algo a esa hora. Eso es una ayuda para elegir: la que
 * decide de verdad es la base, dentro de la misma transacción que la escritura.
 * Si entre que se dibuja la lista y se aprieta Cambiar entra otra reserva, el
 * pedido vuelve con «Ese horario ya fue tomado con esa profesional» — y está
 * bien que así sea.
 */
function CambiarProfesional({
  turnoId,
  actual,
}: {
  turnoId: string;
  actual: { id: string; full_name: string; is_active: boolean } | null;
}) {
  const queryClient = useQueryClient();
  const actualId = actual?.id ?? null;
  const [elegida, setElegida] = useState<string>(actualId ?? "");

  const candidatas = useQuery({
    queryKey: ["turno", turnoId, "profesionales"],
    queryFn: async () =>
      (await api<RtaProfesionalesParaElTurno>(`/api/turnos/${turnoId}/profesionales`))
        .profesionales,
  });

  const mover = useMutation({
    mutationFn: (professional_id: string | null) =>
      apiPut(`/api/turnos/${turnoId}/profesional`, { professional_id }),
    onSuccess: async () => {
      // Las cuatro pantallas que muestran quién atiende este turno. Son las
      // mismas que invalida `useCambiarEstadoDeTurno` y por el mismo motivo:
      // olvidarse de una deja el nombre viejo en pantalla y parece que el
      // cambio no se guardó.
      //
      // ⚠️ "appointments" a secas NO es ninguna clave de este proyecto — era el
      // error que tenía esto: se invalidaba algo que no existe y ni el listado
      // ni el calendario se enteraban del cambio.
      await queryClient.invalidateQueries({ queryKey: ["turno", turnoId] });
      await queryClient.invalidateQueries({ queryKey: ["admin-appointments"] });
      await queryClient.invalidateQueries({ queryKey: ["admin-calendar"] });
      toast.success("Turno reasignado.");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const sinCambio = (elegida || null) === actualId;

  return (
    <div className="mt-6 border-t border-border pt-5">
      <p
        className={`text-sm font-medium ${
          actual && actual.is_active ? "text-foreground" : "text-destructive"
        }`}
      >
        Pasárselo a otra profesional
        {/* Cuando el turno no tiene quién lo atienda, esto deja de ser una
            opción y pasa a ser lo que hay que hacer. Se dice con el color. */}
        {(!actual || !actual.is_active) && " — este turno lo necesita"}
      </p>
      <p className="mt-1 text-sm text-muted-foreground">
        Sólo aparecen las que realizan este tratamiento. La clienta no recibe ningún aviso: si hay
        que contarle, mandale un mensaje.
      </p>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <select
          value={elegida}
          onChange={(e) => setElegida(e.target.value)}
          disabled={candidatas.isPending || mover.isPending}
          aria-label="Profesional del turno"
          className="h-10 min-w-56 rounded-sm border border-input bg-background px-3 text-sm text-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none"
        >
          <option value="">Sin asignar</option>
          {/* La actual, cuando ya no está entre las candidatas — porque se la
              desactivó. Sin esta opción el desplegable arrancaba en blanco y no
              se entendía a nombre de quién estaba el turno. */}
          {actual && !actual.is_active && (
            <option value={actual.id}>{actual.full_name} (ya no atiende)</option>
          )}
          {candidatas.data?.map((p) => (
            <option key={p.id} value={p.id}>
              {p.full_name}
              {/* Ocupada no la saca de la lista: puede ser justo la que hay que
                  poner, y el rechazo con el motivo se lee mejor que una opción
                  que no está y no se sabe por qué. */}
              {p.libre || p.id === actualId ? "" : " (ocupada a esa hora)"}
            </option>
          ))}
        </select>

        <Button
          variant="outline"
          disabled={sinCambio || mover.isPending}
          onClick={() => mover.mutate(elegida || null)}
        >
          Cambiar
        </Button>
      </div>

      {candidatas.data?.length === 0 && (
        <p className="mt-2 text-sm text-muted-foreground">
          No hay ninguna otra profesional activa que realice este tratamiento.
        </p>
      )}
    </div>
  );
}
