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
import { api } from "@/lib/api";
import type { RtaClientas } from "@/lib/api-tipos";
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
    // Las notas y los conteos vienen recortados por el SERVIDOR según el
    // permiso: las notas sólo con `clients_notes`, y los turnos de todas sólo
    // con `appointments`. Antes la pantalla decidía no pedir las notas y la RLS
    // hacía cumplir el resto; ahora las dos cosas se resuelven del otro lado.
    // El canSeeNotes de acá abajo sigue existiendo sólo para mostrar la columna.
    queryFn: async () => (await api<RtaClientas>("/api/clientas")).clientas,
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
