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
import { supabase } from "@/integrations/supabase/client";
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

  const appointments = useQuery({
    queryKey: ["admin-appointments", filter],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("appointments")
        .select(
          "id, starts_at, status, duration_minutes, client_notes, client_id, services(name, price), professionals(full_name)",
        )
        .eq("status", filter)
        .order("starts_at");
      if (error) throw error;

      const clientIds = [...new Set((data ?? []).map((a) => a.client_id))];
      const clients = clientIds.length
        ? (await supabase.from("profiles").select("id, full_name, phone").in("id", clientIds)).data
        : [];
      const byId = new Map((clients ?? []).map((c) => [c.id, c]));

      return (data ?? []).map((a) => ({ ...a, client: byId.get(a.client_id) ?? null }));
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

      <Tabs value={filter} onValueChange={(v) => setFilter(v as Status)} className="mt-8">
        <TabsList>
          {FILTERS.map((f) => (
            <TabsTrigger key={f} value={f}>
              {STATUS_LABEL[f]}
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
                  <span className="block">{a.client?.full_name ?? "—"}</span>
                  <span className="text-xs text-muted-foreground">{a.client?.phone}</span>
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
