import { useMemo } from "react";
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
import { useAccess } from "@/hooks/useAccess";
import { useTeamMemberIds } from "@/hooks/useTeamMemberIds";

export const Route = createFileRoute("/_authenticated/admin/clientes")({
  component: AdminClients,
});

function AdminClients() {
  const { can } = useAccess();
  const canSeeNotes = can("clients_notes");

  const clients = useQuery({
    // El permiso entra en la clave: sin esto, quien lo tenga y quien no
    // compartirían la misma entrada de caché y una vería la columna de la otra.
    queryKey: ["admin-clients", canSeeNotes],
    queryFn: async () => {
      const [profiles, appointments] = await Promise.all([
        supabase
          .from("profiles")
          .select("id, full_name, phone, created_at")
          .order("created_at", { ascending: false }),
        supabase.from("appointments").select("client_id, starts_at, status"),
      ]);
      if (profiles.error) throw profiles.error;
      if (appointments.error) throw appointments.error;

      // Las notas viven en su propia tabla desde la migración 20260814010000.
      // Ni siquiera se pide la consulta sin el permiso: la RLS la devolvería
      // vacía igual, pero así el pedido tampoco sale del navegador.
      const notes = canSeeNotes
        ? (await supabase.from("client_notes").select("client_id, body")).data
        : [];
      const noteByClient = new Map((notes ?? []).map((n) => [n.client_id, n.body]));

      return (profiles.data ?? []).map((p) => {
        const own = (appointments.data ?? []).filter((a) => a.client_id === p.id);
        const done = own.filter((a) => a.status === "completed").length;
        const last = own
          .map((a) => a.starts_at)
          .sort()
          .at(-1);
        return { ...p, notes: noteByClient.get(p.id) ?? null, total: own.length, done, last };
      });
    },
  });

  /**
   * Esta lista sale de `profiles`, que tiene una fila por cada cuenta, así que
   * las empleadas y la dueña figuraban acá como clientas que nunca vinieron.
   *
   * Acá se las ESCONDE, y en el buscador de "Nuevo turno" no: son dos preguntas
   * distintas. Esta pantalla es la base de clientas —a quién le vendo, a quién
   * hace mucho que no veo— y una empleada con 0 turnos ensucia esa lectura. El
   * buscador de turnos, en cambio, tiene que poder encontrarlas: una empleada
   * también se atiende en el centro y hay que poder cargarle el turno. Ahí
   * aparecen, con la etiqueta «Equipo».
   */
  const teamIds = useTeamMemberIds(can("clients_contact") || can("appointments"));

  const rows = useMemo(() => {
    const data = clients.data ?? [];
    if (teamIds.size === 0) return data;
    return data.filter((c) => !teamIds.has(c.id));
  }, [clients.data, teamIds]);

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
              {/* La columna entera desaparece sin el permiso, en vez de mostrar
                  una fila de "—": así no queda la duda de si la clienta no
                  escribió nada o si es que no se puede ver. */}
              {canSeeNotes && <TableHead>Notas clínicas</TableHead>}
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((c) => (
              <TableRow key={c.id}>
                <TableCell className="text-foreground">{c.full_name ?? "Sin nombre"}</TableCell>
                <TableCell>{c.phone ?? "—"}</TableCell>
                <TableCell>{c.total}</TableCell>
                <TableCell>{c.done}</TableCell>
                <TableCell className="whitespace-nowrap">
                  {c.last ? formatDateTime(c.last) : "—"}
                </TableCell>
                {canSeeNotes && (
                  <TableCell className="max-w-64 text-xs text-muted-foreground">
                    {c.notes ?? "—"}
                  </TableCell>
                )}
              </TableRow>
            ))}
            {/* Sobre `rows` y no sobre la consulta: con el equipo escondido, la
                base puede tener perfiles y esta tabla quedar vacía igual. Se
                sigue pidiendo clients.data para no soltar el cartel mientras
                carga, que es cuando rows también está vacío. */}
            {clients.data && rows.length === 0 && (
              <TableRow>
                <TableCell
                  colSpan={canSeeNotes ? 6 : 5}
                  className="py-10 text-center text-sm text-muted-foreground"
                >
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
