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
import { Plus } from "lucide-react";
import { NewAppointmentDialog } from "@/components/admin/new-appointment-dialog";
import { LinkGuestDialog, type GuestToLink } from "@/components/admin/link-guest-dialog";
import { supabase } from "@/integrations/supabase/client";
import { usePendingAppointments } from "@/hooks/usePendingAppointments";
import { formatDateTime, formatMoney, STATUS_LABEL } from "@/lib/shiraf";

export const Route = createFileRoute("/_authenticated/admin/turnos")({
  component: AdminAppointments,
});

const FILTERS = ["pending", "confirmed", "completed", "cancelled"] as const;
type Status = (typeof FILTERS)[number];

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
    mutationFn: async ({ id, status }: { id: string; status: Status }) => {
      const { error } = await supabase.from("appointments").update({ status }).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin-appointments"] });
      queryClient.invalidateQueries({ queryKey: ["admin-calendar"] });
      toast.success("Turno actualizado.");
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
                    {filter === "pending" && (
                      <Button
                        size="sm"
                        onClick={() => setStatus.mutate({ id: a.id, status: "confirmed" })}
                      >
                        Confirmar
                      </Button>
                    )}
                    {filter === "confirmed" && (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => setStatus.mutate({ id: a.id, status: "completed" })}
                      >
                        Marcar realizado
                      </Button>
                    )}
                    {filter !== "cancelled" && filter !== "completed" && (
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => setStatus.mutate({ id: a.id, status: "cancelled" })}
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
