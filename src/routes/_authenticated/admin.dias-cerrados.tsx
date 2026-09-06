import { useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ArrowUpRight, CalendarOff, TriangleAlert } from "lucide-react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { api, apiDelete, apiPost } from "@/lib/api";
import type { RtaCierreGuardado, RtaCierres, TurnoEnDiaCerrado } from "@/lib/api-tipos";
import { formatDateTime, STATUS_LABEL, toDateKey } from "@/lib/shiraf";

export const Route = createFileRoute("/_authenticated/admin/dias-cerrados")({
  head: () => ({
    meta: [{ title: "Días cerrados — Panel Shiraf" }],
  }),
  component: DiasCerrados,
});

/** Lo que se está escribiendo en el formulario de «cerrar». */
type CierreForm = { desde: string; hasta: string; motivo: string };

const CIERRE_VACIO: CierreForm = { desde: "", hasta: "", motivo: "" };

/**
 * "2026-12-25" → "jueves 25 de diciembre", con el año sólo si no es el de hoy.
 *
 * Se parte a mano y se arma con `new Date(a, m - 1, d)` en vez de
 * `new Date("2026-12-25")`: esa forma la parsea el navegador como medianoche
 * **UTC**, y en Buenos Aires cae en el día anterior. Es la misma cuenta que
 * hacen `diaLargo` en Avisos y `comoDiaCorto` en Profesionales.
 */
function diaLargo(clave: string): string {
  const [a, m, d] = clave.split("-").map(Number);
  if (!a || !m || !d) return clave;
  const esteAnio = new Date().getFullYear();
  return new Date(a, m - 1, d).toLocaleDateString("es-AR", {
    weekday: "long",
    day: "numeric",
    month: "long",
    ...(a === esteAnio ? {} : { year: "numeric" as const }),
  });
}

/** "el jueves 25 de diciembre", o "del jueves 24 de diciembre al viernes 2 de enero". */
function tramoLegible(c: { starts_on: string; ends_on: string }): string {
  return c.starts_on === c.ends_on
    ? `el ${diaLargo(c.starts_on)}`
    : `del ${diaLargo(c.starts_on)} al ${diaLargo(c.ends_on)}`;
}

function conMayuscula(texto: string): string {
  return texto.charAt(0).toUpperCase() + texto.slice(1);
}

/**
 * Los días que el centro no abre.
 *
 * ── POR QUÉ ESTA PANTALLA ─────────────────────────────────────────────────
 *
 * Las ausencias de cada profesional ya existían, en su ficha. Pero un feriado
 * no es de una: hasta ahora el 25 de diciembre había que cargarlo profesional
 * por profesional, y la que entraba al equipo después nacía sin él. Esto es
 * "no viene nadie", una sola vez.
 *
 * ── LO QUE HACE AL GUARDAR, Y LO QUE NO ───────────────────────────────────
 *
 * Desde el momento en que se guarda, nadie puede reservar esos días —ni
 * moverse un turno ahí desde su cuenta—. Lo que NO hace es cancelar los turnos
 * que ya estaban dados: son clientas con la confirmación por mail en la mano, y
 * un mail de cancelación a cada una, de golpe, no se deshace. Entonces esos
 * turnos se muestran —en el diálogo de abajo apenas se guarda, y después
 * marcados en rojo en la lista, con su número en el menú— hasta que alguien
 * los reprograme o los cancele uno por uno, desde la ficha de cada turno, con
 * el mail que cada caso merezca.
 *
 * El centro sí puede cargar un turno un día cerrado desde el panel: el
 * calendario se lo muestra en gris, y «Cargar fuera de horario» sigue estando
 * para la excepción a mano. Es la misma regla que ya vale para las ausencias.
 */
function DiasCerrados() {
  const queryClient = useQueryClient();

  const cierres = useQuery({
    queryKey: ["cierres"],
    // Los turnos en pie cambian desde otras pantallas —alguien reprograma uno
    // desde Turnos— y al volver acá la lista tiene que reflejarlo.
    staleTime: 30_000,
    refetchOnWindowFocus: true,
    queryFn: () => api<RtaCierres>("/api/cierres"),
  });

  const [form, setForm] = useState<CierreForm>(CIERRE_VACIO);

  /**
   * Los turnos que quedaron en pie después de cerrar unos días.
   *
   * Se muestran hasta que la persona los cierre a mano: son los que tiene que
   * ir a reprogramar o cancelar, y un toast que se va solo a los cinco segundos
   * no alcanza para una lista que hay que trabajar. Es el mismo diálogo que
   * usan las ausencias.
   */
  const [enPie, setEnPie] = useState<RtaCierreGuardado | null>(null);

  /**
   * Qué se refresca al tocar un cierre.
   *
   * Además de esta lista: los contadores del menú —el número rojo sale del
   * mismo endpoint que los otros dos— y los calendarios del panel, que cachean
   * qué días están grises. Sin esto, «Nuevo turno» seguiría ofreciendo el
   * feriado hasta recargar la página.
   */
  async function refresh() {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["cierres"] }),
      queryClient.invalidateQueries({ queryKey: ["admin-appointments"] }),
      queryClient.invalidateQueries({ queryKey: ["disponibilidad"] }),
      queryClient.invalidateQueries({ queryKey: ["disponibilidad-mes"] }),
    ]);
  }

  const cerrar = useMutation({
    mutationFn: () =>
      apiPost<RtaCierreGuardado>("/api/cierres", {
        starts_on: form.desde,
        // Un día suelto es el mismo día de los dos lados. Dejar «Hasta» vacío
        // es lo que hace cualquiera al anotar un solo día.
        ends_on: form.hasta || form.desde,
        reason: form.motivo.trim() || null,
      }),
    onSuccess: async (rta) => {
      await refresh();
      setForm(CIERRE_VACIO);
      if (rta.turnos_en_pie.length > 0) {
        setEnPie(rta);
      } else {
        toast.success("Listo. Esos días no se pueden sacar turnos.");
      }
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const reabrir = useMutation({
    mutationFn: (id: string) => apiDelete(`/api/cierres/${id}`),
    onSuccess: async () => {
      await refresh();
      toast.success("Listo, esos días vuelven a estar abiertos.");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const lista = cierres.data?.cierres ?? [];
  const hoy = toDateKey(new Date());

  return (
    <div>
      <div>
        <p className="text-eyebrow text-muted-foreground">Agenda</p>
        <h1 className="mt-3 font-display text-4xl text-foreground">Días cerrados</h1>
      </div>

      <p className="mt-4 max-w-2xl text-sm leading-relaxed text-muted-foreground">
        Los días que el centro no abre para nadie: un feriado, las vacaciones de todo el equipo, un
        arreglo en el local. Esos días no se puede reservar con ninguna profesional. Los horarios de
        siempre quedan como están, y si una sola no viene, eso se anota en su ficha.
      </p>

      <div className="mt-8 grid gap-8 lg:grid-cols-[minmax(0,22rem)_1fr]">
        {/* El formulario. A la vista y no detrás de un botón, al revés que las
            ausencias en la ficha: acá la pantalla existe para esto. */}
        <Card className="h-fit border-border/80 shadow-soft">
          <CardContent className="space-y-4 p-5">
            <div>
              <p className="font-medium text-foreground">Cerrar el centro</p>
              <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                Un día solo o un tramo. Los dos extremos entran.
              </p>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label htmlFor="cierre-desde">Desde</Label>
                <Input
                  id="cierre-desde"
                  type="date"
                  /* Un día que ya pasó no cierra nada. El servidor lo rechaza
                     igual; esto evita el viaje. */
                  min={hoy}
                  value={form.desde}
                  onChange={(e) => setForm((f) => ({ ...f, desde: e.target.value }))}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="cierre-hasta">Hasta</Label>
                <Input
                  id="cierre-hasta"
                  type="date"
                  /* No deja elegir una reapertura anterior al cierre. */
                  min={form.desde || hoy}
                  value={form.hasta}
                  onChange={(e) => setForm((f) => ({ ...f, hasta: e.target.value }))}
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="cierre-motivo">Motivo (opcional)</Label>
              <Input
                id="cierre-motivo"
                placeholder="Feriado"
                value={form.motivo}
                onChange={(e) => setForm((f) => ({ ...f, motivo: e.target.value }))}
              />
              <p className="text-xs text-muted-foreground">
                Es para acordarse: no sale en el sitio ni en ningún mail.
              </p>
            </div>

            <Button
              className="w-full"
              disabled={!form.desde || cerrar.isPending}
              onClick={() => cerrar.mutate()}
            >
              <CalendarOff className="mr-2 h-4 w-4" />
              {form.hasta && form.hasta !== form.desde ? "Cerrar esos días" : "Cerrar ese día"}
            </Button>
            <p className="text-center text-xs text-muted-foreground">
              Dejando «Hasta» vacío se cierra un día solo.
            </p>
          </CardContent>
        </Card>

        <div>
          {cierres.isLoading && <p className="text-sm text-muted-foreground">Cargando…</p>}

          {/* El error va separado del vacío, como en todo el panel: una
              consulta que falla dibujada como una que volvió sin filas diría
              "no hay días cerrados" cuando lo que pasó es que no se pudo
              preguntar — y ahí alguien cierra un día que ya estaba cerrado, o
              da por abierto uno que no. */}
          {cierres.isError && (
            <div className="rounded-sm border border-destructive/40 bg-destructive/5 p-5">
              <p className="text-sm font-medium text-foreground">No se pudo cargar la lista.</p>
              <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                {(cierres.error as Error).message} — probá de nuevo en un rato. Esto no significa
                que no haya días cerrados.
              </p>
            </div>
          )}

          {!cierres.isLoading && !cierres.isError && lista.length === 0 && (
            <div className="rounded-sm border border-dashed border-border p-8 text-center">
              <p className="text-sm text-foreground">No hay días cerrados por delante.</p>
              <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                Los de antes no se muestran: ya no cambian nada de lo que se puede reservar.
              </p>
            </div>
          )}

          {lista.length > 0 && (
            <div className="space-y-3">
              {lista.map((c) => {
                const conflictos = c.turnos_en_pie.length;
                return (
                  <Card
                    key={c.id}
                    /* Rojo el borde entero cuando quedó algo adentro: es la
                       fila que hay que trabajar, y tiene que distinguirse de
                       las tranquilas sin leerlas. */
                    className={
                      conflictos > 0
                        ? "border-destructive/60 shadow-soft"
                        : "border-border/80 shadow-soft"
                    }
                  >
                    <CardContent className="p-5">
                      <div className="flex flex-wrap items-start justify-between gap-4">
                        <div className="min-w-0">
                          <p className="flex items-center gap-2 font-display text-xl text-foreground">
                            <CalendarOff className="h-4 w-4 shrink-0 text-muted-foreground" />
                            {conMayuscula(tramoLegible(c))}
                          </p>
                          {c.reason && (
                            <p className="mt-1 text-sm text-muted-foreground">{c.reason}</p>
                          )}
                        </div>
                        <Button
                          variant="outline"
                          size="sm"
                          className="shrink-0"
                          disabled={reabrir.isPending}
                          onClick={() => reabrir.mutate(c.id)}
                        >
                          Reabrir
                        </Button>
                      </div>

                      {conflictos > 0 ? (
                        <div className="mt-4 rounded-sm border border-destructive/40 bg-destructive/5 p-3">
                          <p className="flex items-center gap-2 text-sm font-medium text-foreground">
                            <TriangleAlert className="h-4 w-4 shrink-0 text-destructive" />
                            {conflictos === 1
                              ? "Hay 1 turno dado ese día"
                              : `Hay ${conflictos} turnos dados esos días`}
                          </p>
                          <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                            Se reservaron antes de cerrar y siguen en pie: la clienta tiene la
                            confirmación y ese día no va a haber nadie. Reprogramalos o cancelalos
                            desde cada turno, así le llega el aviso.
                          </p>
                          <ul className="mt-3 space-y-2">
                            {c.turnos_en_pie.map((t) => (
                              <TurnoEnPie key={t.id} turno={t} />
                            ))}
                          </ul>
                        </div>
                      ) : (
                        <p className="mt-3 text-xs text-muted-foreground">
                          Sin turnos dados esos días.
                        </p>
                      )}
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/*
        Los turnos que quedaron en pie después de cerrar unos días.

        El cierre YA se guardó cuando esto aparece — el título lo dice en esas
        palabras a propósito, para que no se lea como "¿confirmás?". Lo único que
        falta es resolver estos turnos, y eso se hace uno por uno desde la ficha
        de cada uno, con el mail que cada caso merezca. Es el mismo diálogo que
        usan las ausencias en Profesionales.
      */}
      <AlertDialog open={!!enPie} onOpenChange={(next) => !next && setEnPie(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Cerrado — pero quedan turnos esos días</AlertDialogTitle>
            <AlertDialogDescription>
              Ya nadie puede reservar {enPie ? tramoLegible(enPie.cierre) : "esos días"}. Estos
              turnos se dieron antes y siguen en pie: reprogramalos o cancelalos desde cada uno, así
              las clientas se enteran. Quedan marcados en esta pantalla hasta que se resuelvan.
            </AlertDialogDescription>
          </AlertDialogHeader>

          <ul className="max-h-64 space-y-2 overflow-y-auto text-sm">
            {enPie?.turnos_en_pie.map((t) => (
              <TurnoEnPie key={t.id} turno={t} />
            ))}
          </ul>

          <AlertDialogFooter>
            <AlertDialogAction onClick={() => setEnPie(null)}>Entendido</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

/**
 * Un turno que quedó en pie, con el enlace a su ficha.
 *
 * La ficha es donde se resuelve —reprogramar, cancelar con motivo, avisar por
 * WhatsApp— y por eso el enlace va derecho ahí y no a la lista de Turnos. El
 * teléfono va a la vista para el caso de que primero se la quiera llamar.
 */
function TurnoEnPie({ turno }: { turno: TurnoEnDiaCerrado }) {
  return (
    <li className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-border bg-background px-3 py-2">
      <div className="min-w-0">
        <p className="flex flex-wrap items-center gap-2 font-medium text-foreground">
          {formatDateTime(turno.starts_at)}
          <Badge variant="outline" className="font-normal">
            {STATUS_LABEL[turno.status] ?? turno.status}
          </Badge>
        </p>
        <p className="text-sm text-muted-foreground">
          {turno.quien}
          {turno.telefono ? <> · {turno.telefono}</> : null} · {turno.tratamiento}
          {turno.profesional ? <> · con {turno.profesional}</> : <> · sin profesional</>}
        </p>
      </div>
      <Link
        to="/admin/turnos/$id"
        params={{ id: turno.id }}
        className="inline-flex shrink-0 items-center gap-1 text-sm text-gold underline-offset-4 transition-opacity hover:underline hover:opacity-80"
      >
        Ver turno <ArrowUpRight className="h-3.5 w-3.5" />
      </Link>
    </li>
  );
}
