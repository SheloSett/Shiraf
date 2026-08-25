import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
// Los tres que sólo usaba la mutación mudada. Comentados y no borrados, con el
// mismo criterio que el bloque de más abajo: dejan ver qué dejó de pasar acá.
// import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
// import { toast } from "sonner";
import { useQuery } from "@tanstack/react-query";
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
import { useEffect, useRef, useState } from "react";
import { FileText, MessageCircle, Plus, TriangleAlert } from "lucide-react";
import { NewAppointmentDialog } from "@/components/admin/new-appointment-dialog";
import { LinkGuestDialog, type GuestToLink } from "@/components/admin/link-guest-dialog";
import { EditGuestDialog, type GuestToEdit } from "@/components/admin/edit-guest-dialog";
// import { api, apiPut } from "@/lib/api";  ← `apiPut` se fue con la mutación.
import { api } from "@/lib/api";
import type { RtaTurnos } from "@/lib/api-tipos";
import { usePendingAppointments, useUnassignedAppointments } from "@/hooks/usePendingAppointments";
import { formatDateTime, formatMoney, STATUS_LABEL, toStatus } from "@/lib/shiraf";
import {
  appointmentWhatsappUrl,
  // Los dos tipos los usaba lo que se mudó; `appointmentWhatsappUrl` se queda
  // porque el botón "Avisar" de cada fila lo sigue llamando desde acá.
  // type AppointmentEvent,
  // type NotifiableAppointment,
} from "@/lib/notifications";
// import { notifyAppointment } from "@/lib/notifications.functions";
import {
  NOTIFIES,
  openWhatsapp,
  toNotifiable,
  useCambiarEstadoDeTurno,
} from "@/hooks/useCambiarEstadoDeTurno";

/**
 * Qué mira la pantalla, escrito en la URL.
 *
 * `estado` es la pestaña y `turno` el turno que hay que resaltar. Los dos
 * existen por el mismo motivo: desde el calendario se hace clic en un turno y
 * hay que aterrizar en ÉL, no en la lista de pendientes por defecto. Guardar la
 * pestaña acá y no en un useState tiene además dos regalos: el botón "atrás"
 * del navegador vuelve a la pestaña anterior, y el enlace se puede compartir.
 *
 * Claves opcionales y no claves obligatorias en `undefined`: con
 * `exactOptionalPropertyTypes` esa diferencia hace que el router exija `search`
 * en cada <Link to="/admin/turnos">, aunque los dos params sean opcionales.
 */
type Search = { estado?: Pestana; turno?: string; sinProfesional?: "1" };

export const Route = createFileRoute("/_authenticated/admin/turnos")({
  validateSearch: (search: Record<string, unknown>): Search => {
    const parsed: Search = {};
    // `aPestana` y no un cast: el `?estado=` lo puede escribir cualquiera a
    // mano, y un valor inventado tiene que caer en la pestaña por defecto y no
    // pedirle a la base un estado que no existe.
    const estado = aPestana(search["estado"]);
    if (estado) parsed.estado = estado;
    if (typeof search["turno"] === "string") parsed.turno = search["turno"];
    // Sólo el texto "1" entra: es un filtro que se prende, no un valor.
    // Cualquier otra cosa en la URL se ignora y la tabla muestra todo, que es el
    // estado normal.
    //
    // "1" y no `true` porque el tipo de búsqueda de TODAS las rutas se junta en
    // un `Record<string, string>` —lo arma `new URLSearchParams()` en
    // recuperar.tsx— y un booleano ahí adentro no compila.
    if (search["sinProfesional"] === "1") parsed.sinProfesional = "1";
    return parsed;
  },
  component: AdminAppointments,
});

/**
 * Las pestañas de la tabla.
 *
 * Los cuatro estados de la base, más «Todos» — que no es un estado sino la
 * ausencia del filtro. Sin esa quinta pestaña había que saber de antemano en qué
 * estado quedó un turno para poder encontrarlo.
 *
 * `todos` viaja tal cual a la API, que lo entiende como "no filtres por estado".
 * Ver `listar` en turnos.controller.ts.
 */
const FILTERS = ["pending", "confirmed", "completed", "cancelled"] as const;
type Status = (typeof FILTERS)[number];

// «Todos» va PRIMERA, y no al final después de los cuatro estados: es la que se
// abre cuando no se está buscando nada en particular, y las otras cuatro son
// recortes de ésa. Leída de izquierda a derecha, la fila va de lo más amplio a
// lo más específico.
const PESTANAS = ["todos", ...FILTERS] as const;
type Pestana = (typeof PESTANAS)[number];

/** El estado, o `todos`; null si es cualquier otra cosa. */
function aPestana(valor: unknown): Pestana | null {
  if (valor === "todos") return "todos";
  return toStatus(valor);
}

/** Los carteles de las pestañas. `STATUS_LABEL` no conoce a «Todos». */
const ETIQUETA_DE_PESTANA: Record<Pestana, string> = {
  pending: STATUS_LABEL["pending"] ?? "Pendiente",
  confirmed: STATUS_LABEL["confirmed"] ?? "Confirmado",
  completed: STATUS_LABEL["completed"] ?? "Realizado",
  cancelled: STATUS_LABEL["cancelled"] ?? "Cancelado",
  todos: "Todos",
};

// ⬇️ MUDADO a src/hooks/useCambiarEstadoDeTurno.ts.
//
// Se comenta y no se borra para que quede el rastro de dónde estuvo. Ahora lo
// necesitan dos pantallas —esta lista y la ficha de un turno—, y el aviso a la
// clienta tiene que salir igual desde las dos: si esto viviera copiado, el día
// que cambie el mensaje o el criterio de a quién se le avisa, una de las dos se
// queda vieja sin que nadie lo note.
// /**
//  * De los dos cambios de estado que hace el panel, cuáles ameritan avisarle a la
//  * clienta.
//  *
//  * "completed" no está a propósito: marcar un turno como realizado es una
//  * anotación interna que pasa DESPUÉS de que la clienta estuvo en el centro.
//  * Avisarle de eso es mandarle un mensaje para contarle algo que ya vivió.
//  */
// const NOTIFIES: Partial<Record<Status, AppointmentEvent>> = {
//   confirmed: "confirmed",
//   cancelled: "cancelled",
// };
//
// /**
//  * La fila de la tabla, en la forma que espera el módulo de avisos.
//  *
//  * El parámetro se tipa con lo mínimo que se usa y no con la fila entera: así
//  * esta función no se rompe cada vez que el select de arriba suma una columna.
//  */
// function toNotifiable(a: {
//   starts_at: string;
//   services: { name: string } | null;
//   professionals: { full_name: string } | null;
//   person: { name: string; phone: string | null };
// }): NotifiableAppointment {
//   return {
//     startsAt: a.starts_at,
//     clientName: a.person.name,
//     clientPhone: a.person.phone,
//     serviceName: a.services?.name ?? null,
//     professionalName: a.professionals?.full_name ?? null,
//   };
// }
//
// /** Abre WhatsApp con el mensaje cargado, en una pestaña aparte. */
// function openWhatsapp(url: string) {
//   window.open(url, "_blank", "noopener,noreferrer");
// }

function AdminAppointments() {
  // const queryClient = useQueryClient();  ← lo pide el hook por su cuenta.
  const navigate = useNavigate();
  const search = Route.useSearch();

  // Comentado, no borrado: la pestaña dejó de vivir en un useState y pasó a la
  // URL (ver `Search` arriba). Con el estado local, entrar por el enlace del
  // calendario mostraba siempre "Pendiente" y el turno buscado no aparecía.
  // const [filter, setFilter] = useState<Status>("pending");
  const filter: Pestana = search.estado ?? "pending";
  /** El filtro rojo: sólo los turnos que nadie va a atender. */
  const soloSinProfesional = search.sinProfesional === "1";

  /**
   * Cambiar de pestaña.
   *
   * `replace` para no llenar el historial: son cuatro pestañas de la misma
   * pantalla, y el "atrás" tiene que volver de donde vino la persona (el
   * calendario, casi siempre) y no recorrer las pestañas que fue mirando.
   *
   * El `turno` resaltado se cae a propósito al cambiar de pestaña: el resaltado
   * señala un turno puntual al que se vino a mirar, y ya no se está mirando.
   */
  const setFilter = (next: Pestana) => {
    // El filtro de "sin profesional" NO se arrastra al cambiar de pestaña: es un
    // recorte puntual que se vino a resolver, y quedárselo pegado haría que la
    // tabla se viera medio vacía sin que se entienda por qué.
    void navigate({ to: "/admin/turnos", search: { estado: next }, replace: true });
  };

  /** Abre la lista de los que hay que asignar: todos los estados, sólo esos. */
  const verSinProfesional = () => {
    void navigate({
      to: "/admin/turnos",
      search: { estado: "todos", sinProfesional: "1" },
      replace: true,
    });
  };
  const [creating, setCreating] = useState(false);
  /** Invitada que se está vinculando a una cuenta, o null. */
  const [linking, setLinking] = useState<GuestToLink | null>(null);
  /** Invitada a la que se le están corrigiendo los datos, o null. */
  const [editing, setEditing] = useState<GuestToEdit | null>(null);

  // El mismo número que muestra el menú lateral: react-query comparte la
  // consulta, así que estar en esta pantalla no la pide dos veces.
  const pendingCount = usePendingAppointments();
  // Los turnos que se van a atender y no tienen a quién. Mismo número que el
  // punto rojo del menú: react-query comparte la consulta.
  const unassignedCount = useUnassignedAppointments();

  const appointments = useQuery({
    queryKey: ["admin-appointments", filter, soloSinProfesional],
    // `person` viene armada del servidor: una sola forma para el turno de una
    // clienta con cuenta y para el de una invitada, así la tabla no tiene que
    // saber cuál es cuál. Antes eso costaba una segunda consulta acá, para
    // buscar los profiles de los que sí tenían cuenta.
    queryFn: async () =>
      (
        await api<RtaTurnos>(
          `/api/turnos?estado=${filter}${soloSinProfesional ? "&sinProfesional=1" : ""}`,
        )
      ).turnos,
  });

  /**
   * El turno que llega señalado desde el calendario.
   *
   * La lista trae TODOS los turnos del estado (el servidor no pagina), así que
   * el que se busca está sí o sí en la tabla — pero puede estar a media
   * pantalla de scroll. Se lo lleva a la vista solo, porque si no la persona
   * hace clic en un turno de agosto y aterriza mirando los de enero.
   */
  const highlighted = search.turno ?? null;
  const highlightedRow = useRef<HTMLTableRowElement | null>(null);
  useEffect(() => {
    if (!highlighted || !appointments.data) return;
    highlightedRow.current?.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [highlighted, appointments.data]);

  // Lo mismo de antes, ahora compartido con la ficha del turno. Se usa igual:
  // setStatus.mutate({ id, status, notify }).
  const setStatus = useCambiarEstadoDeTurno();

  // ⬇️ MUDADO a src/hooks/useCambiarEstadoDeTurno.ts.
  //
  // Se comenta y no se borra para que quede el rastro de dónde estuvo. Ahora lo
  // necesitan dos pantallas —esta lista y la ficha de un turno—, y el aviso a la
  // clienta tiene que salir igual desde las dos: si esto viviera copiado, el día
  // que cambie el mensaje o el criterio de a quién se le avisa, una de las dos se
  // queda vieja sin que nadie lo note.
  //   const setStatus = useMutation({
  //     mutationFn: async ({
  //       id,
  //       status,
  //     }: {
  //       id: string;
  //       status: Status;
  //       notify: NotifiableAppointment;
  //     }) => {
  //       await apiPut(`/api/turnos/${id}/estado`, { status });
  //
  //       const event = NOTIFIES[status];
  //       if (!event) return { mail: null };
  //
  //       // El mail se manda acá pero su fracaso NO se propaga: el cambio de estado
  //       // ya está guardado en la base, y hacer fallar la mutación por un mail que
  //       // no salió dejaría la pantalla diciendo que el turno no se confirmó cuando
  //       // sí se confirmó. Se reporta como aviso y el turno queda como quedó.
  //       return {
  //         mail: await notifyAppointment({ data: { appointmentId: id, event } }).catch((e: Error) => ({
  //           sent: false as const,
  //           reason: e.message,
  //         })),
  //       };
  //     },
  //     onSuccess: ({ mail }, { status, notify }) => {
  //       queryClient.invalidateQueries({ queryKey: ["admin-appointments"] });
  //       queryClient.invalidateQueries({ queryKey: ["admin-calendar"] });
  //
  //       // El WhatsApp va en un botón del toast y no abriendo la pestaña solo:
  //       // abrir una desde el callback de una petición ya no cuenta como gesto del
  //       // usuario y los bloqueadores de popups la comen. Apretar el botón sí.
  //       //
  //       // Que además sea opcional es a propósito: hay turnos que se confirman con
  //       // la clienta al teléfono, ya avisada, y ahí el mensaje sobra.
  //       const event = NOTIFIES[status];
  //       const url = event ? appointmentWhatsappUrl(event, notify) : null;
  //
  //       toast.success("Turno actualizado.", {
  //         description: mail
  //           ? mail.sent
  //             ? "Le avisamos por mail."
  //             : `Por mail no salió: ${mail.reason}`
  //           : undefined,
  //         ...(url
  //           ? { action: { label: "Avisar", onClick: () => openWhatsapp(url) }, duration: 10000 }
  //           : {}),
  //       });
  //     },
  //     onError: (e: Error) => toast.error(e.message),
  //   });

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
      <EditGuestDialog guest={editing} onOpenChange={(next) => !next && setEditing(null)} />

      {/* El cartel de los turnos que nadie va a atender.

          Va arriba de todo y en rojo a propósito: es la única cosa de esta
          pantalla que NO se resuelve sola ni se nota mirando la tabla. La fila
          de un turno sin asignar se ve igual que las demás, y la de uno con la
          profesional desactivada se ve MEJOR todavía: muestra un nombre. Si
          nadie lo agarra, el día del turno llega y no hay quién atienda.

          Aparece en todas las pestañas, incluso mientras se está mirando el
          filtro que lo resuelve, y ahí cambia el botón por uno que vuelve. */}
      {unassignedCount > 0 && (
        <div className="mt-6 flex flex-wrap items-center gap-4 rounded-sm border-2 border-destructive bg-destructive/10 p-4">
          <TriangleAlert className="h-5 w-5 shrink-0 text-destructive" />
          <div className="flex-1">
            <p className="font-medium text-foreground">
              {unassignedCount === 1
                ? "Hay 1 turno sin nadie que lo atienda"
                : `Hay ${unassignedCount} turnos sin nadie que los atienda`}
            </p>
            <p className="mt-0.5 text-sm text-muted-foreground">
              O no tienen profesional asignada, o la que tienen está desactivada y ya no atiende. La
              clienta {unassignedCount === 1 ? "lo" : "los"} espera igual. Abrí cada uno y usá
              «Pasárselo a otra profesional».
            </p>
          </div>
          {soloSinProfesional ? (
            <Button variant="outline" onClick={() => setFilter("pending")}>
              Ver todos los turnos
            </Button>
          ) : (
            <Button variant="destructive" onClick={verSinProfesional}>
              Ver cuáles son
            </Button>
          )}
        </div>
      )}

      <Tabs value={filter} onValueChange={(v) => setFilter(v as Pestana)} className="mt-8">
        <TabsList>
          {/* Sólo "Pendiente" lleva número: es el único estado que pide algo de
              quien mira la pantalla. Ponerle el conteo a las cuatro pestañas
              haría que ninguna llame la atención.

              Antes era `<TabsTrigger>{STATUS_LABEL[f]}</TabsTrigger>` a secas. */}
          {PESTANAS.map((f) => (
            <TabsTrigger key={f} value={f} className="gap-2">
              {ETIQUETA_DE_PESTANA[f]}
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
              <TableRow
                key={a.id}
                ref={a.id === highlighted ? highlightedRow : null}
                // El turno al que se vino desde el calendario, marcado con el
                // mismo dorado suave con el que la grilla marca el día de hoy:
                // es "acá estás", no un estado nuevo del turno.
                className={a.id === highlighted ? "bg-gold-soft/25" : ""}
              >
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
                        {/* Editar va sin condición, al revés que vincular: sus
                            datos viven en este turno y siempre se pueden
                            corregir. Es más, el caso más útil es justo el que
                            no tiene teléfono todavía. */}
                        <button
                          type="button"
                          onClick={() =>
                            setEditing({
                              appointmentId: a.id,
                              name: a.guest_name ?? "",
                              phone: a.guest_phone,
                              email: a.guest_email,
                            })
                          }
                          className="text-[10px] text-muted-foreground underline underline-offset-2 transition-colors hover:text-foreground"
                        >
                          editar
                        </button>
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
                <TableCell>
                  {/* Los DOS casos que hay que resolver van en rojo y enlazados a
                      la ficha, que es donde se reasigna:

                        · sin profesional asignada;
                        · con una profesional desactivada, que ya no atiende.

                      El segundo es el que engaña. La fila mostraba el nombre como
                      cualquier otra —"Valentina Ríos", texto negro— y parecía
                      resuelta, cuando esa persona no viene más. */}
                  {a.professionals && a.professionals.is_active ? (
                    a.professionals.full_name
                  ) : (
                    <Link
                      to="/admin/turnos/$id"
                      params={{ id: a.id }}
                      className="inline-flex items-center gap-1.5 rounded-sm bg-destructive/15 px-2 py-1 text-xs font-semibold text-destructive hover:bg-destructive/25"
                    >
                      <TriangleAlert className="h-3 w-3 shrink-0" />
                      {a.professionals
                        ? `${a.professionals.full_name} · ya no atiende`
                        : "Sin asignar"}
                    </Link>
                  )}
                </TableCell>
                <TableCell>{formatMoney(a.services?.price)}</TableCell>
                <TableCell className="text-right">
                  <div className="flex justify-end gap-2">
                    {/* La ficha del turno: los datos de la clienta, el valor y
                        el resto de lo que en una fila de tabla no entra. Va
                        primera y en gris para que no le compita al botón del
                        estado, que es la acción de todos los días. */}
                    <Button asChild size="sm" variant="ghost">
                      <Link to="/admin/turnos/$id" params={{ id: a.id }}>
                        <FileText className="mr-2 h-4 w-4" /> Ver ficha
                      </Link>
                    </Button>

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
                        // Un turno que todavía no empezó no se pudo haber
                        // realizado. El servidor lo rechaza igual; acá se apaga
                        // el botón para no ofrecer algo que va a fallar, y el
                        // título dice por qué está apagado.
                        disabled={new Date(a.starts_at) > new Date()}
                        title={
                          new Date(a.starts_at) > new Date()
                            ? "Todavía no llegó la hora de este turno"
                            : undefined
                        }
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
