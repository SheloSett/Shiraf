import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useState } from "react";
import { MessageCircle, Plus } from "lucide-react";
import { NewAppointmentDialog } from "@/components/admin/new-appointment-dialog";
import { LinkGuestDialog, type GuestToLink } from "@/components/admin/link-guest-dialog";
import { supabase } from "@/integrations/supabase/client";
import { usePendingAppointments } from "@/hooks/usePendingAppointments";
import { formatDateTime, formatMoney, STATUS_LABEL } from "@/lib/shiraf";
import {
  appointmentWhatsappUrl,
  type AppointmentEvent,
  type NotifiableAppointment,
} from "@/lib/notifications";
import { notifyAppointment } from "@/lib/notifications.functions";

export const Route = createFileRoute("/_authenticated/admin/turnos")({
  component: AdminAppointments,
});

const FILTERS = ["pending", "confirmed", "completed", "cancelled"] as const;
type Status = (typeof FILTERS)[number];

/**
 * De los dos cambios de estado que hace el panel, cuáles ameritan avisarle a la
 * clienta.
 *
 * "completed" no está a propósito: marcar un turno como realizado es una
 * anotación interna que pasa DESPUÉS de que la clienta estuvo en el centro.
 * Avisarle de eso es mandarle un mensaje para contarle algo que ya vivió.
 */
const NOTIFIES: Partial<Record<Status, AppointmentEvent>> = {
  confirmed: "confirmed",
  cancelled: "cancelled",
};

/**
 * La fila de la tabla, en la forma que espera el módulo de avisos.
 *
 * El parámetro se tipa con lo mínimo que se usa y no con la fila entera: así
 * esta función no se rompe cada vez que el select de arriba suma una columna.
 */
function toNotifiable(a: {
  starts_at: string;
  services: { name: string } | null;
  professionals: { full_name: string } | null;
  person: { name: string; phone: string | null };
}): NotifiableAppointment {
  return {
    startsAt: a.starts_at,
    clientName: a.person.name,
    clientPhone: a.person.phone,
    serviceName: a.services?.name ?? null,
    professionalName: a.professionals?.full_name ?? null,
  };
}

/** Abre WhatsApp con el mensaje cargado, en una pestaña aparte. */
function openWhatsapp(url: string) {
  window.open(url, "_blank", "noopener,noreferrer");
}

function AdminAppointments() {
  const queryClient = useQueryClient();
  const [filter, setFilter] = useState<Status>("pending");
  const [creating, setCreating] = useState(false);
  /** Invitada que se está vinculando a una cuenta, o null. */
  const [linking, setLinking] = useState<GuestToLink | null>(null);

  // El mismo número que muestra el menú lateral: react-query comparte la
  // consulta, así que estar en esta pantalla no la pide dos veces.
  const pendingCount = usePendingAppointments();

  const appointments = useQuery({
    queryKey: ["admin-appointments", filter],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("appointments")
        .select(
          "id, starts_at, status, duration_minutes, client_notes, client_id, guest_name, guest_phone, services(name, price), professionals(full_name)",
        )
        .eq("status", filter)
        .order("starts_at");
      if (error) throw error;

      // client_id es nulo en los turnos que el centro carga a nombre de alguien
      // sin cuenta, así que hay que filtrarlos antes de buscar sus fichas.
      const clientIds = [
        ...new Set((data ?? []).map((a) => a.client_id).filter((id): id is string => !!id)),
      ];
      const clients = clientIds.length
        ? (await supabase.from("profiles").select("id, full_name, phone").in("id", clientIds)).data
        : [];
      const byId = new Map((clients ?? []).map((c) => [c.id, c]));

      return (data ?? []).map((a) => {
        const profile = a.client_id ? (byId.get(a.client_id) ?? null) : null;
        return {
          ...a,
          // Una sola forma para los dos casos, así la tabla no tiene que saber
          // si el turno es de una clienta con cuenta o de una invitada.
          person: {
            name: profile?.full_name ?? a.guest_name ?? "Sin nombre",
            phone: profile?.phone ?? a.guest_phone ?? null,
            isGuest: !a.client_id,
          },
        };
      });
    },
  });

  const setStatus = useMutation({
    mutationFn: async ({
      id,
      status,
    }: {
      id: string;
      status: Status;
      notify: NotifiableAppointment;
    }) => {
      const { error } = await supabase.from("appointments").update({ status }).eq("id", id);
      if (error) throw error;

      const event = NOTIFIES[status];
      if (!event) return { mail: null };

      // El mail se manda acá pero su fracaso NO se propaga: el cambio de estado
      // ya está guardado en la base, y hacer fallar la mutación por un mail que
      // no salió dejaría la pantalla diciendo que el turno no se confirmó cuando
      // sí se confirmó. Se reporta como aviso y el turno queda como quedó.
      return {
        mail: await notifyAppointment({ data: { appointmentId: id, event } }).catch((e: Error) => ({
          sent: false as const,
          reason: e.message,
        })),
      };
    },
    onSuccess: ({ mail }, { status, notify }) => {
      queryClient.invalidateQueries({ queryKey: ["admin-appointments"] });
      queryClient.invalidateQueries({ queryKey: ["admin-calendar"] });

      // El WhatsApp va en un botón del toast y no abriendo la pestaña solo:
      // abrir una desde el callback de una petición ya no cuenta como gesto del
      // usuario y los bloqueadores de popups la comen. Apretar el botón sí.
      //
      // Que además sea opcional es a propósito: hay turnos que se confirman con
      // la clienta al teléfono, ya avisada, y ahí el mensaje sobra.
      const event = NOTIFIES[status];
      const url = event ? appointmentWhatsappUrl(event, notify) : null;

      toast.success("Turno actualizado.", {
        description: mail
          ? mail.sent
            ? "Le avisamos por mail."
            : `Por mail no salió: ${mail.reason}`
          : undefined,
        ...(url
          ? { action: { label: "Avisar", onClick: () => openWhatsapp(url) }, duration: 10000 }
          : {}),
      });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-eyebrow text-muted-foreground">Solicitudes y agenda</p>
          <h1 className="mt-3 font-display text-4xl text-foreground">Turnos</h1>
        </div>
        <Button onClick={() => setCreating(true)}>
          <Plus className="mr-2 h-4 w-4" /> Nuevo turno
        </Button>
      </div>

      {/* El turno cargado desde acá nace confirmado, así que la lista salta a
          esa pestaña: si no, se creaba y no aparecía en pantalla (el filtro por
          defecto es "pendientes") y parecía que no había pasado nada. */}
      <NewAppointmentDialog
        open={creating}
        onOpenChange={setCreating}
        onCreated={(status) => setFilter(status)}
      />

      <LinkGuestDialog guest={linking} onOpenChange={(next) => !next && setLinking(null)} />

      <Tabs value={filter} onValueChange={(v) => setFilter(v as Status)} className="mt-8">
        <TabsList>
          {/* Sólo "Pendiente" lleva número: es el único estado que pide algo de
              quien mira la pantalla. Ponerle el conteo a las cuatro pestañas
              haría que ninguna llame la atención.

              Antes era `<TabsTrigger>{STATUS_LABEL[f]}</TabsTrigger>` a secas. */}
          {FILTERS.map((f) => (
            <TabsTrigger key={f} value={f} className="gap-2">
              {STATUS_LABEL[f]}
              {f === "pending" && pendingCount > 0 && (
                <span className="min-w-5 rounded-full bg-gold px-1.5 py-0.5 text-center text-xs font-semibold text-primary tabular-nums">
                  {pendingCount > 99 ? "99+" : pendingCount}
                </span>
              )}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>

      <div className="mt-6 rounded-sm border border-border bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Fecha y hora</TableHead>
              <TableHead>Cliente</TableHead>
              <TableHead>Tratamiento</TableHead>
              <TableHead>Profesional</TableHead>
              <TableHead>Valor</TableHead>
              <TableHead className="text-right">Acciones</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {appointments.data?.map((a) => (
              <TableRow key={a.id}>
                <TableCell className="whitespace-nowrap">{formatDateTime(a.starts_at)}</TableCell>
                <TableCell>
                  <span className="flex items-center gap-2">
                    {a.person.name}
                    {/* Marcar la invitada evita que se la busque en Clientes y
                        no aparezca: no tiene ficha porque no tiene cuenta. */}
                    {a.person.isGuest && (
                      <>
                        <Badge variant="outline" className="font-normal text-[10px]">
                          sin cuenta
                        </Badge>
                        {/* Sólo con teléfono: es el dato con el que se buscan
                            los demás turnos de la misma persona. */}
                        {a.person.phone && (
                          <button
                            type="button"
                            onClick={() =>
                              setLinking({ name: a.person.name, phone: a.person.phone })
                            }
                            className="text-[10px] text-muted-foreground underline underline-offset-2 transition-colors hover:text-foreground"
                          >
                            vincular
                          </button>
                        )}
                      </>
                    )}
                  </span>
                  <span className="text-xs text-muted-foreground">{a.person.phone}</span>
                  {a.client_notes && (
                    <span className="mt-1 block max-w-52 text-xs italic text-muted-foreground">
                      “{a.client_notes}”
                    </span>
                  )}
                </TableCell>
                <TableCell>{a.services?.name}</TableCell>
                <TableCell>{a.professionals?.full_name ?? "Sin asignar"}</TableCell>
                <TableCell>{formatMoney(a.services?.price)}</TableCell>
                <TableCell className="text-right">
                  <div className="flex justify-end gap-2">
                    {/* Reenviar el aviso, para cuando el del toast se pasó de
                        largo o el mensaje no llegó. Sale con el texto del
                        estado en el que el turno está AHORA, que es lo que la
                        clienta necesita saber. Sin teléfono no hay enlace
                        posible y el botón no aparece. */}
                    {(() => {
                      const event = NOTIFIES[a.status as Status];
                      const url = event ? appointmentWhatsappUrl(event, toNotifiable(a)) : null;
                      if (!url) return null;
                      return (
                        <Button
                          size="sm"
                          variant="ghost"
                          title="Abrir WhatsApp con el aviso escrito"
                          onClick={() => openWhatsapp(url)}
                        >
                          <MessageCircle className="mr-2 h-4 w-4" /> Avisar
                        </Button>
                      );
                    })()}

                    {filter === "pending" && (
                      <Button
                        size="sm"
                        onClick={() =>
                          setStatus.mutate({
                            id: a.id,
                            status: "confirmed",
                            notify: toNotifiable(a),
                          })
                        }
                      >
                        Confirmar
                      </Button>
                    )}
                    {filter === "confirmed" && (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() =>
                          setStatus.mutate({
                            id: a.id,
                            status: "completed",
                            notify: toNotifiable(a),
                          })
                        }
                      >
                        Marcar realizado
                      </Button>
                    )}
                    {filter !== "cancelled" && filter !== "completed" && (
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() =>
                          setStatus.mutate({
                            id: a.id,
                            status: "cancelled",
                            notify: toNotifiable(a),
                          })
                        }
                      >
                        Cancelar
                      </Button>
                    )}
                    {(filter === "cancelled" || filter === "completed") && (
                      <Badge variant="outline">{STATUS_LABEL[a.status]}</Badge>
                    )}
                  </div>
                </TableCell>
              </TableRow>
            ))}
            {appointments.data?.length === 0 && (
              <TableRow>
                <TableCell colSpan={6} className="py-10 text-center text-sm text-muted-foreground">
                  No hay turnos en este estado.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
