import { useMemo, useState } from "react";
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
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { api } from "@/lib/api";
import type { RtaClientas, RtaFichaDeClienta } from "@/lib/api-tipos";
import { formatDateTime, formatMoney, STATUS_LABEL } from "@/lib/shiraf";
import { useAccess } from "@/hooks/useAccess";
import { useTeamMemberIds } from "@/hooks/useTeamMemberIds";

export const Route = createFileRoute("/_authenticated/admin/clientes")({
  component: AdminClients,
});

function AdminClients() {
  const { can } = useAccess();
  const canSeeNotes = can("clients_notes");
  /** La clienta cuya ficha está abierta en el panel lateral, o null. */
  const [viendo, setViendo] = useState<{ id: string; nombre: string } | null>(null);

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
              <TableHead className="w-24 text-right">Ficha</TableHead>
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
                  // `text-sm text-foreground` y no `text-xs text-muted-foreground`.
                  // Acá adentro hay alergias, embarazos y antecedentes —lo que
                  // evita aplicar algo contraindicado— y estaba escrito en la
                  // letra más chica y más despintada de toda la pantalla. Se leía
                  // peor que el teléfono.
                  //
                  // `line-clamp-3` corta a tres renglones para que una nota larga
                  // no estire la fila: la completa está en el panel lateral.
                  <TableCell className="max-w-72 text-sm text-foreground">
                    {c.notes ? (
                      <span className="line-clamp-3">{c.notes}</span>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </TableCell>
                )}
                <TableCell className="text-right">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => setViendo({ id: c.id, nombre: c.full_name ?? "Sin nombre" })}
                  >
                    Ver ficha
                  </Button>
                </TableCell>
              </TableRow>
            ))}
            {/* Sobre `rows` y no sobre la consulta: con el equipo escondido, la
                base puede tener perfiles y esta tabla quedar vacía igual. Se
                sigue pidiendo clients.data para no soltar el cartel mientras
                carga, que es cuando rows también está vacío. */}
            {clients.data && rows.length === 0 && (
              <TableRow>
                <TableCell
                  colSpan={canSeeNotes ? 7 : 6}
                  className="py-10 text-center text-sm text-muted-foreground"
                >
                  Todavía no hay clientas registradas.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>

      <FichaDeClienta clienta={viendo} onClose={() => setViendo(null)} />
    </div>
  );
}

/** Un dato de la ficha: etiqueta chica arriba, valor abajo. */
function Dato({ etiqueta, children }: { etiqueta: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="text-[11px] uppercase tracking-wide text-muted-foreground">{etiqueta}</p>
      <p className="mt-0.5 text-sm text-foreground">{children}</p>
    </div>
  );
}

/**
 * La ficha de una clienta, en un panel que entra por la izquierda.
 *
 * ── POR QUÉ UN PANEL Y NO UNA PANTALLA APARTE ─────────────────────────────
 *
 * Porque se abre para mirar una y volver a la lista: con una pantalla propia,
 * revisar tres clientas son seis navegaciones y la tabla se pierde de vista cada
 * vez. El panel se cierra con Escape o clic afuera y la lista sigue donde
 * estaba, con el scroll donde estaba.
 *
 * ── LA CONSULTA SE HACE ACÁ Y NO EN LA TABLA ──────────────────────────────
 *
 * La lista trae lo justo para la tabla. El historial de turnos de cada clienta
 * pedido para las 200 filas de la lista sería traer toda la agenda del centro
 * para mostrar una. Se pide al abrir, y react-query se lo guarda por si se
 * vuelve a la misma.
 *
 * ── LO QUE NO SE VE, Y POR QUÉ ────────────────────────────────────────────
 *
 * `puedeVerNotas` y `puedeVerTurnos` los manda el servidor. Sirven para
 * distinguir «no hay nada anotado» de «esto no te corresponde», que sin el aviso
 * se leen igual: una empleada con el contacto pero sin el permiso de notas vería
 * una ficha en blanco y concluiría que la clienta no tiene antecedentes.
 */
function FichaDeClienta({
  clienta,
  onClose,
}: {
  clienta: { id: string; nombre: string } | null;
  onClose: () => void;
}) {
  const ficha = useQuery({
    queryKey: ["admin-clients", "ficha", clienta?.id],
    enabled: clienta !== null,
    queryFn: async () => (await api<RtaFichaDeClienta>(`/api/clientas/${clienta!.id}`)).clienta,
  });

  return (
    <Sheet open={clienta !== null} onOpenChange={(next) => !next && onClose()}>
      {/* `side="left"` y ancho generoso: el historial son filas de tres datos y
          con un panel angosto cada turno ocuparía tres renglones. */}
      <SheetContent side="left" className="w-full overflow-y-auto sm:max-w-lg">
        <SheetHeader>
          <SheetTitle className="font-display text-2xl">{clienta?.nombre}</SheetTitle>
        </SheetHeader>

        {ficha.isPending && (
          <p className="mt-6 text-sm text-muted-foreground">Buscando la ficha…</p>
        )}

        {ficha.isError && (
          <p className="mt-6 text-sm text-destructive">
            {ficha.error?.message ?? "No pudimos traer la ficha."}
          </p>
        )}

        {ficha.data && (
          <div className="mt-6 space-y-6">
            <div className="grid grid-cols-2 gap-4">
              <Dato etiqueta="Teléfono">
                {ficha.data.phone ?? <span className="text-muted-foreground">Sin teléfono</span>}
              </Dato>
              <Dato etiqueta="Mail">
                {ficha.data.email ?? <span className="text-muted-foreground">Sin cuenta</span>}
              </Dato>
              <Dato etiqueta="Cumpleaños">
                {ficha.data.birth_date ? (
                  // Se parte a mano y no con `new Date("1990-05-23")`: eso lo lee
                  // como medianoche UTC y en Buenos Aires muestra el día
                  // anterior. Un cumpleaños corrido un día es de los errores que
                  // nadie perdona.
                  formatearFecha(ficha.data.birth_date)
                ) : (
                  <span className="text-muted-foreground">Sin cargar</span>
                )}
              </Dato>
              <Dato etiqueta="Clienta desde">{formatDateTime(ficha.data.created_at)}</Dato>
            </div>

            {/* La cuenta dada de baja: si no se dice, el centro se pregunta por
                qué la clienta no puede entrar. */}
            {ficha.data.cuentaActiva === false && (
              <p className="rounded-sm border border-destructive bg-destructive/10 p-3 text-sm font-medium text-destructive">
                Su cuenta está dada de baja: no puede entrar al sitio.
              </p>
            )}

            <div>
              <h3 className="text-sm font-semibold text-foreground">Notas clínicas</h3>
              {!ficha.data.puedeVerNotas ? (
                <p className="mt-2 text-sm italic text-muted-foreground">
                  No tenés acceso a las notas clínicas.
                </p>
              ) : ficha.data.notes ? (
                // Tamaño normal y `whitespace-pre-wrap`: se escriben con
                // renglones aparte y sin esto quedaban todos pegados.
                <p className="mt-2 whitespace-pre-wrap rounded-sm border border-border bg-secondary/30 p-3 text-sm text-foreground">
                  {ficha.data.notes}
                </p>
              ) : (
                <p className="mt-2 text-sm text-muted-foreground">Todavía no hay nada anotado.</p>
              )}
            </div>

            <div>
              <h3 className="text-sm font-semibold text-foreground">
                Historial
                {ficha.data.puedeVerTurnos && ficha.data.turnos.length > 0 && (
                  <span className="ml-2 font-normal text-muted-foreground">
                    {ficha.data.turnos.length} {ficha.data.turnos.length === 1 ? "turno" : "turnos"}
                  </span>
                )}
              </h3>

              {!ficha.data.puedeVerTurnos ? (
                <p className="mt-2 text-sm italic text-muted-foreground">
                  No tenés acceso a los turnos.
                </p>
              ) : ficha.data.turnos.length === 0 ? (
                <p className="mt-2 text-sm text-muted-foreground">Todavía no vino nunca.</p>
              ) : (
                <ul className="mt-2 space-y-2">
                  {ficha.data.turnos.map((t) => (
                    <li
                      key={t.id}
                      className="rounded-sm border border-border p-3 text-sm text-foreground"
                    >
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <span className="font-medium">{t.service}</span>
                        <Badge variant="outline" className="font-normal">
                          {STATUS_LABEL[t.status] ?? t.status}
                        </Badge>
                      </div>
                      <p className="mt-1 text-sm text-muted-foreground">
                        {formatDateTime(t.starts_at)}
                        {t.professional ? ` · ${t.professional}` : " · sin profesional"}
                        {" · "}
                        {formatMoney(t.price)}
                      </p>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}

/**
 * "1990-05-23" → "23/5/1990".
 *
 * A mano y no con `new Date(...)`: el constructor lee una fecha sin hora como
 * medianoche UTC, y en Buenos Aires eso se muestra como el día anterior. Un
 * cumpleaños corrido un día es de los errores que nadie perdona.
 */
function formatearFecha(iso: string): string {
  const [anio, mes, dia] = iso.split("-");
  return `${Number(dia)}/${Number(mes)}/${anio}`;
}
