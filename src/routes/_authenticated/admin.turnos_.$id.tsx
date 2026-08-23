import { useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, Clock, Mail, MessageCircle, Phone, User } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { LinkGuestDialog, type GuestToLink } from "@/components/admin/link-guest-dialog";
import { EditGuestDialog, type GuestToEdit } from "@/components/admin/edit-guest-dialog";
import { api } from "@/lib/api";
import type { RtaTurnoEnDetalle } from "@/lib/api-tipos";
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
            {t.services?.name ?? <span className="text-muted-foreground">Sin tratamiento</span>}
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
            {t.services && t.services.price !== t.price && (
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
                disabled={setStatus.isPending}
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
