import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { supabase } from "@/integrations/supabase/client";
import { formatDateTime } from "@/lib/shiraf";

export const Route = createFileRoute("/_authenticated/admin/clientes")({
  component: AdminClients,
});

function AdminClients() {
  const clients = useQuery({
    queryKey: ["admin-clients"],
    queryFn: async () => {
      const [profiles, appointments] = await Promise.all([
        supabase
          .from("profiles")
          .select("id, full_name, phone, notes, created_at")
          .order("created_at", { ascending: false }),
        supabase.from("appointments").select("client_id, starts_at, status"),
      ]);
      if (profiles.error) throw profiles.error;
      if (appointments.error) throw appointments.error;

      return (profiles.data ?? []).map((p) => {
        const own = (appointments.data ?? []).filter((a) => a.client_id === p.id);
        const done = own.filter((a) => a.status === "completed").length;
        const last = own
          .map((a) => a.starts_at)
          .sort()
          .at(-1);
        return { ...p, total: own.length, done, last };
      });
    },
  });

  return (
    <div>
      <p className="text-eyebrow text-muted-foreground">Base de clientas</p>
      <h1 className="mt-3 font-display text-4xl text-foreground">Clientes</h1>

      <div className="mt-8 rounded-sm border border-border bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Nombre</TableHead>
              <TableHead>Teléfono</TableHead>
              <TableHead>Turnos</TableHead>
              <TableHead>Realizados</TableHead>
              <TableHead>Última visita</TableHead>
              <TableHead>Notas</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {clients.data?.map((c) => (
              <TableRow key={c.id}>
                <TableCell className="text-foreground">{c.full_name ?? "Sin nombre"}</TableCell>
                <TableCell>{c.phone ?? "—"}</TableCell>
                <TableCell>{c.total}</TableCell>
                <TableCell>{c.done}</TableCell>
                <TableCell className="whitespace-nowrap">
                  {c.last ? formatDateTime(c.last) : "—"}
                </TableCell>
                <TableCell className="max-w-64 text-xs text-muted-foreground">
                  {c.notes ?? "—"}
                </TableCell>
              </TableRow>
            ))}
            {clients.data?.length === 0 && (
              <TableRow>
                <TableCell colSpan={6} className="py-10 text-center text-sm text-muted-foreground">
                  Todavía no hay clientas registradas.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
