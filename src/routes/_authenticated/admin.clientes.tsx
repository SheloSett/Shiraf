import { useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Trash2 } from "lucide-react";
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
import { api, apiDelete } from "@/lib/api";
import type { RtaClientas, RtaFichaDeClienta } from "@/lib/api-tipos";
import { formatDateTime, formatMoney, STATUS_LABEL } from "@/lib/shiraf";
import { useAccess } from "@/hooks/useAccess";
import { useTeamMemberIds } from "@/hooks/useTeamMemberIds";

export const Route = createFileRoute("/_authenticated/admin/clientes")({
  component: AdminClients,
});

function AdminClients() {
  const { can, isAdmin } = useAccess();
  // 27/8/2026 — 'clients_notes' se absorbió en 'clients_contact', y se
  // preguntan los dos por lo mismo que en el controller: quien tiene la agenda
  // a cargo ve todo de la clienta, y `can()` no expande el `implies`. Esta
  // condición tiene que decir lo MISMO que el `veNotas` del servidor: si se
  // separan, la pantalla esconde una columna que la API igual manda, o al
  // revés muestra un encabezado sin nada abajo.
  // const canSeeNotes = can("clients_notes");
  const canSeeNotes = can("clients_contact") || can("appointments");
  /**
   * Las tres columnas que cuentan turnos.
   *
   * Sin el permiso `appointments` el servidor cuenta SÓLO los turnos propios
   * —ver el ⚠️ de `listar()` en clientas.controller.ts—, así que a una empleada
   * con «Ver datos de clientas» y nada más le llegaban `total: 0` y `done: 0`
   * para todas. Eso no es una fuga, es lo contrario: el filtro funcionando. El
   * problema era que la pantalla lo mostraba como un CERO, que afirma que la
   * clienta nunca vino, en vez de callarse.
   *
   * Se esconden por el mismo criterio que «Notas clínicas», acá abajo: una
   * columna que no se puede llenar no va. Y con esto la fila queda coherente
   * —antes «Última visita» decía «—» mientras las otras dos decían «0»,
   * contando las tres la misma cosa.
   */
  const canSeeTurnos = can("appointments");
  /** La clienta cuya ficha está abierta en el panel lateral, o null. */
  const [viendo, setViendo] = useState<{ id: string; nombre: string } | null>(null);
  /**
   * La clienta que se está por borrar, o null.
   *
   * Lleva los dos conteos además del nombre: el cartel tiene que decir cuántos
   * turnos se van con ella, que es lo que hace irreversible al borrado y lo que
   * no se ve mirando el botón.
   */
  const [borrando, setBorrando] = useState<{
    id: string;
    nombre: string;
    total: number;
    done: number;
  } | null>(null);

  const queryClient = useQueryClient();

  /**
   * Borrar la cuenta de una clienta.
   *
   * El servidor la frena si tiene turnos por venir sin cancelar y contesta con
   * el motivo escrito; el toast lo muestra tal cual y el cartel queda abierto,
   * porque después de cancelar esos turnos la decisión sigue en pie.
   */
  const borrar = useMutation({
    mutationFn: async (id: string) => await apiDelete(`/api/clientas/${id}`),
    onSuccess: (_dato, id) => {
      queryClient.invalidateQueries({ queryKey: ["admin-clients"] });
      // Los turnos que se fueron con ella salen de la lista y del calendario.
      queryClient.invalidateQueries({ queryKey: ["admin-appointments"] });
      queryClient.invalidateQueries({ queryKey: ["admin-calendar"] });
      setBorrando(null);
      // Por si la ficha abierta era justo la suya: quedaría un panel pidiendo
      // una clienta que ya no está.
      setViendo((actual) => (actual?.id === id ? null : actual));
      toast.success("Clienta eliminada.");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const clients = useQuery({
    // El permiso entra en la clave: sin esto, quien lo tenga y quien no
    // compartirían la misma entrada de caché y una vería la columna de la otra.
    queryKey: ["admin-clients", canSeeNotes],
    // Las notas y los conteos vienen recortados por el SERVIDOR según el
    // permiso: las notas sólo con `clients_contact` o `appointments`, y los
    // turnos de todas sólo
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
              {canSeeTurnos && (
                <>
                  <TableHead>Turnos</TableHead>
                  <TableHead>Realizados</TableHead>
                  <TableHead>Última visita</TableHead>
                </>
              )}
              {/* La columna entera desaparece sin el permiso, en vez de mostrar
                  una fila de "—": así no queda la duda de si la clienta no
                  escribió nada o si es que no se puede ver. */}
              {canSeeNotes && <TableHead>Notas clínicas</TableHead>}
              <TableHead className="w-32 text-right">Ficha</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((c) => (
              <TableRow key={c.id}>
                <TableCell className="text-foreground">{c.full_name ?? "Sin nombre"}</TableCell>
                <TableCell>{c.phone ?? "—"}</TableCell>
                {canSeeTurnos && (
                  <>
                    <TableCell>{c.total}</TableCell>
                    <TableCell>{c.done}</TableCell>
                    <TableCell className="whitespace-nowrap">
                      {c.last ? formatDateTime(c.last) : "—"}
                    </TableCell>
                  </>
                )}
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
                  <div className="flex justify-end gap-1">
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => setViendo({ id: c.id, nombre: c.full_name ?? "Sin nombre" })}
                    >
                      Ver ficha
                    </Button>

                    {/* Sólo la dueña, y el servidor exige lo mismo: quien tiene
                        «Ver datos de clientas» lee teléfonos y fichas, que es
                        una cosa; borrar una cuenta con todo su historial es
                        otra, y no se deshace. Ver `borrarClienta`. */}
                    {isAdmin && (
                      <Button
                        size="icon"
                        variant="ghost"
                        className="h-9 w-9 text-destructive hover:text-destructive"
                        aria-label={`Eliminar a ${c.full_name ?? "esta clienta"}`}
                        title="Eliminar la clienta"
                        onClick={() =>
                          setBorrando({
                            id: c.id,
                            nombre: c.full_name ?? "Sin nombre",
                            total: c.total,
                            done: c.done,
                          })
                        }
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    )}
                  </div>
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
                  // Nombre + Teléfono + Ficha, más las tres de turnos y la de
                  // notas cuando corresponden. Si se suma una columna, se suma acá.
                  colSpan={3 + (canSeeTurnos ? 3 : 0) + (canSeeNotes ? 1 : 0)}
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

      {/* Borrar una clienta.

          El cartel cuenta los turnos porque es la parte que sorprende: la
          cuenta se borra con todo lo que cuelga de ella —la ficha, las notas
          clínicas y los turnos— y eso se lleva puesto el historial del centro,
          no sólo el de la clienta. Con los números adelante la decisión se toma
          sabiendo qué se pierde. */}
      <AlertDialog open={!!borrando} onOpenChange={(next) => !next && setBorrando(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="font-display text-2xl">
              ¿Eliminar a {borrando?.nombre}?
            </AlertDialogTitle>
            <AlertDialogDescription>
              Se borra su cuenta con su ficha y sus notas clínicas, y no hay vuelta atrás.
              {borrando && borrando.total > 0 && (
                <span className="mt-3 block font-medium text-destructive">
                  Se van también sus {borrando.total} {borrando.total === 1 ? "turno" : "turnos"}
                  {borrando.done > 0 && ` —${borrando.done} de ellos ya realizados—`}: desaparecen
                  de la lista, del calendario y de la facturación del centro.
                </span>
              )}
              <span className="mt-3 block">
                Si tiene turnos por venir hay que cancelarlos primero, así recibe el aviso.
              </span>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Mejor no</AlertDialogCancel>
            <AlertDialogAction
              disabled={borrar.isPending}
              onClick={() => borrando && borrar.mutate(borrando.id)}
            >
              Eliminar la clienta
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
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
      {/* Abre por la DERECHA, que es de donde se la llamó: el botón «Ver ficha»
          es la última columna de la tabla, contra el borde derecho. Abriendo por
          la izquierda el panel aparecía en la punta opuesta a la que se acababa
          de tocar, y encima tapaba el menú lateral. Es además el lado que usan
          los otros dos Sheet de la app.

          El ancho generoso se queda: el historial son filas de tres datos y con
          un panel angosto cada turno ocuparía tres renglones. */}
      <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-lg">
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
