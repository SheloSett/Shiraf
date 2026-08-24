import { useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ArrowLeft, Clock, Mail, MessageCircle, Phone, User } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { LinkGuestDialog, type GuestToLink } from "@/components/admin/link-guest-dialog";
import { EditGuestDialog, type GuestToEdit } from "@/components/admin/edit-guest-dialog";
import { api, apiPut } from "@/lib/api";
import type { RtaProfesionalesParaElTurno, RtaTurnoEnDetalle } from "@/lib/api-tipos";
import { formatDateTime, formatMoney, STATUS_LABEL, toStatus } from "@/lib/shiraf";
import { appointmentWhatsappUrl } from "@/lib/notifications";
import {
  NOTIFIES,
  openWhatsapp,
  toNotifiable,
  useCambiarEstadoDeTurno,
} from "@/hooks/useCambiarEstadoDeTurno";

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

  const turno = useQuery({
    // La clave arranca con "turno" a propósito: el hook que cambia el estado
    // invalida por ese prefijo, así que apretar "Confirmar" acá refresca esta
    // misma pantalla sin que haya que acordarse de pedirlo.
    queryKey: ["turno", id],
    queryFn: async () => (await api<RtaTurnoEnDetalle>(`/api/turnos/${id}`)).turno,
  });

  const setStatus = useCambiarEstadoDeTurno();

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
  const aviso = estado ? NOTIFIES[estado] : undefined;
  const whatsapp = aviso ? appointmentWhatsappUrl(aviso, toNotifiable(t)) : null;

  /** El pedido de cambio de estado, que siempre lleva los datos del aviso. */
  const cambiarA = (status: NonNullable<typeof estado>) =>
    setStatus.mutate({ id: t.id, status, notify: toNotifiable(t) });

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
        <Badge variant="outline" className="text-sm">
          {STATUS_LABEL[t.status] ?? t.status}
        </Badge>
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
            {t.professionals?.full_name ?? (
              <span className="text-muted-foreground">Sin asignar</span>
            )}
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
        </Tarjeta>

        <section className="rounded-sm border border-border bg-card p-6">
          <h2 className="font-display text-xl text-foreground">Qué hacer con este turno</h2>

          <div className="mt-5 flex flex-wrap gap-2">
            {estado === "pending" && (
              <Button onClick={() => cambiarA("confirmed")} disabled={setStatus.isPending}>
                Confirmar
              </Button>
            )}
            {estado === "confirmed" && (
              <Button
                variant="outline"
                onClick={() => cambiarA("completed")}
                // Un turno que todavía no empezó no se pudo haber realizado. El
                // servidor lo rechaza igual; acá se apaga para no ofrecer algo
                // que va a fallar.
                disabled={setStatus.isPending || todaviaNoEmpezo}
                title={todaviaNoEmpezo ? "Todavía no llegó la hora de este turno" : undefined}
              >
                Marcar realizado
              </Button>
            )}
            {(estado === "pending" || estado === "confirmed") && (
              <Button
                variant="ghost"
                onClick={() => cambiarA("cancelled")}
                disabled={setStatus.isPending}
              >
                Cancelar el turno
              </Button>
            )}

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

          {/* Reasignar sólo tiene sentido sobre un turno que se va a atender. Uno
              cerrado no se mueve de profesional: ya pasó. */}
          {(estado === "pending" || estado === "confirmed") && (
            <CambiarProfesional turnoId={t.id} actualId={t.professionals?.id ?? null} />
          )}

          {(estado === "completed" || estado === "cancelled") && (
            <p className="mt-4 text-sm text-muted-foreground">
              Este turno ya está cerrado como “{STATUS_LABEL[t.status]}”. No hay nada más que
              hacerle.
            </p>
          )}
        </section>
      </div>

      <LinkGuestDialog guest={linking} onOpenChange={(next) => !next && setLinking(null)} />
      <EditGuestDialog guest={editing} onOpenChange={(next) => !next && setEditing(null)} />
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
function CambiarProfesional({ turnoId, actualId }: { turnoId: string; actualId: string | null }) {
  const queryClient = useQueryClient();
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
      // El prefijo alcanza para las dos: la ficha y su lista de candidatas.
      await queryClient.invalidateQueries({ queryKey: ["turno", turnoId] });
      await queryClient.invalidateQueries({ queryKey: ["appointments"] });
      toast.success("Turno reasignado.");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const sinCambio = (elegida || null) === actualId;

  return (
    <div className="mt-6 border-t border-border pt-5">
      <p className="text-sm font-medium text-foreground">Pasárselo a otra profesional</p>
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
