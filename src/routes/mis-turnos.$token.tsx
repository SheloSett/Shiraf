import { useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { CalendarDays, History } from "lucide-react";
import { SiteHeader } from "@/components/site-header";
import { SiteFooter } from "@/components/site-footer";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ReprogramarTurnoDialog } from "@/components/reprogramar-turno-dialog";
import { CancelarTurnoDialog } from "@/components/cancelar-turno-dialog";
import { SesionesPorReservar } from "@/components/sesiones-por-reservar";
import { api, apiPut, ErrorDeApi } from "@/lib/api";
import type { MiTurno, RtaTurnosDelEnlace } from "@/lib/api-tipos";
import {
  formatDateTime,
  formatMoney,
  HORAS_PARA_QUE_LA_CLIENTA_TOQUE_SU_TURNO,
  laClientaTodaviaPuede,
  STATUS_LABEL,
} from "@/lib/shiraf";

/**
 * «Mis turnos» de quien reservó sin cuenta (5/10/2026).
 *
 * Es a donde lleva el enlace que viaja en cada WhatsApp. Muestra lo mismo que
 * «Mi cuenta» —lo que tiene por venir, el historial, la sesión que le falta— a
 * alguien que no tiene cuenta ni contraseña: lo que la deja pasar es el token
 * de la dirección.
 *
 * Pública y fuera de `_authenticated` por lo mismo que /confirmar: quien llega
 * lo hace tocando un enlace desde el teléfono, sin sesión en ningún lado. El
 * token vale por sí solo.
 *
 * ── LO QUE NO TIENE ───────────────────────────────────────────────────────
 *
 * Ni «Mis datos» ni contraseña: no hay cuenta que editar. El nombre y el
 * teléfono son los que dejó al reservar, y si están mal se corrigen hablando
 * con el centro. Y no aparece el teléfono en pantalla a propósito — quien abre
 * el enlace ya lo sabe, y quien lo abra sin deber no tiene por qué enterarse.
 */
export const Route = createFileRoute("/mis-turnos/$token")({
  // Sin render en el servidor: todo lo de acá depende del token y del reloj de
  // quien mira, y no hay nada que un buscador tenga que leer.
  ssr: false,
  head: () => ({
    meta: [
      { title: "Mis turnos — Shiraf" },
      // Un enlace personal no puede terminar en un buscador. robots.txt ya
      // pide que no se rastree; esto es para el que llegue igual.
      { name: "robots", content: "noindex, nofollow" },
      // Y que la dirección —que lleva el token— no viaje como referente si
      // desde acá se toca un enlace hacia afuera.
      { name: "referrer", content: "no-referrer" },
    ],
  }),
  component: MisTurnosPage,
});

function MisTurnosPage() {
  const { token } = Route.useParams();
  const queryClient = useQueryClient();

  const datos = useQuery({
    // "enlace" es la clave que invalidan los diálogos de cambiar y de sacar la
    // sesión cuando se usan desde acá.
    queryKey: ["enlace", token],
    queryFn: () => api<RtaTurnosDelEnlace>(`/api/enlace/${token}`),
    // Un enlace que no existe no va a existir al tercer intento.
    retry: (intentos, error) =>
      !(error instanceof ErrorDeApi && error.status === 404) && intentos < 2,
  });

  /** El turno abierto en el diálogo de cambiar, o null. */
  const [reprogramando, setReprogramando] = useState<MiTurno | null>(null);
  /** El turno que está por cancelar, o null. */
  const [cancelando, setCancelando] = useState<MiTurno | null>(null);

  const cancel = useMutation({
    // Al centro le avisa el servidor: desde acá no se puede, porque
    // `notifyAppointment` pide una sesión que esta persona no tiene.
    mutationFn: ({ id, motivo }: { id: string; motivo: string }) =>
      apiPut(`/api/enlace/${token}/turnos/${id}/cancelar`, motivo ? { motivo } : {}),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["enlace"] });
      setCancelando(null);
      toast.success("Turno cancelado.");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const now = Date.now();
  const all = datos.data?.turnos ?? [];
  const upcoming = all
    .filter((a) => new Date(a.starts_at).getTime() >= now && a.status !== "cancelled")
    .sort((a, b) => a.starts_at.localeCompare(b.starts_at));
  const history = all.filter(
    (a) => new Date(a.starts_at).getTime() < now || a.status === "cancelled",
  );

  const nombre = datos.data?.nombre?.trim().split(/\s+/)[0];

  return (
    <div className="min-h-screen">
      <SiteHeader />

      <section className="mx-auto max-w-5xl px-5 pt-14 pb-20">
        <p className="text-eyebrow text-muted-foreground">Mis turnos</p>
        <h1 className="mt-4 text-5xl text-foreground">Hola{nombre ? `, ${nombre}` : ""}</h1>
        <div className="gold-rule mt-6" />

        {datos.isPending && (
          <p className="mt-10 text-sm text-muted-foreground">Buscando tus turnos…</p>
        )}

        {/* El error dice qué pasó y no muestra una lista vacía: un enlace que
            no sirve y una persona sin turnos son cosas muy distintas, y la
            segunda no existe — sin turnos no hay enlace. */}
        {datos.isError && (
          <Card className="mt-10 border-border bg-card shadow-none">
            <CardContent className="p-6">
              <h2 className="font-display text-2xl text-foreground">
                {datos.error instanceof ErrorDeApi && datos.error.status === 404
                  ? "Este enlace no sirve"
                  : "No pudimos traer tus turnos"}
              </h2>
              <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
                {datos.error instanceof ErrorDeApi && datos.error.status === 404
                  ? "Fijate de abrirlo tal cual te llegó por WhatsApp, entero. Si lo copiaste a mano puede faltarle un pedazo."
                  : datos.error.message}
              </p>
              <div className="mt-5 flex flex-wrap gap-3">
                <Button asChild size="sm">
                  <Link to="/reservar">Sacar un turno</Link>
                </Button>
                <Button asChild size="sm" variant="outline">
                  <Link to="/contacto">Escribinos</Link>
                </Button>
              </div>
            </CardContent>
          </Card>
        )}

        {datos.data && (
          <>
            <SesionesPorReservar pendientes={datos.data.pendientes} token={token} />

            <div className="mt-12 flex items-center gap-3">
              <CalendarDays className="h-5 w-5 text-gold" />
              <h2 className="font-display text-2xl text-foreground">Próximos turnos</h2>
            </div>

            <div className="mt-5 space-y-3">
              {upcoming.map((a) => (
                <Card key={a.id} className="border-border/80 shadow-soft">
                  <CardContent className="flex flex-wrap items-center justify-between gap-4 p-5">
                    <div>
                      <p className="font-display text-xl text-foreground">{a.services.name}</p>
                      <p className="mt-1 text-sm text-muted-foreground">
                        {formatDateTime(a.starts_at)} · {a.professionals?.full_name}
                        {a.sessions_total > 1 &&
                          ` · sesión ${a.session_number} de ${a.sessions_total}`}
                      </p>
                    </div>
                    <div className="flex items-center gap-3">
                      <Badge variant={a.status === "confirmed" ? "default" : "secondary"}>
                        {STATUS_LABEL[a.status]}
                      </Badge>
                      {/* El paquete se cobra una sola vez, en la primera
                          sesión: las otras valen 0 y "$ 0" se leería como un
                          error. Igual que en «Mi cuenta». */}
                      <span className="text-sm text-muted-foreground">
                        {a.sessions_total > 1 && a.session_number > 1
                          ? "Incluida"
                          : formatMoney(a.services.price)}
                      </span>
                      {/* El mismo corte de horas que con cuenta, y el servidor
                          lo comprueba igual: esto es cortesía, no el candado. */}
                      {laClientaTodaviaPuede(a.starts_at, now) ? (
                        <>
                          <Button size="sm" variant="outline" onClick={() => setReprogramando(a)}>
                            Cambiar
                          </Button>
                          <Button size="sm" variant="ghost" onClick={() => setCancelando(a)}>
                            Cancelar
                          </Button>
                        </>
                      ) : (
                        <span
                          className="text-xs text-muted-foreground"
                          title={`Faltan menos de ${HORAS_PARA_QUE_LA_CLIENTA_TOQUE_SU_TURNO} horas`}
                        >
                          Para cambiarlo o cancelarlo, escribinos
                        </span>
                      )}
                    </div>
                  </CardContent>
                </Card>
              ))}
              {upcoming.length === 0 && (
                <Card className="border-dashed border-border bg-transparent shadow-none">
                  <CardContent className="flex flex-wrap items-center justify-between gap-4 p-6">
                    <p className="text-sm text-muted-foreground">No tenés turnos pendientes.</p>
                    <Button asChild size="sm">
                      <Link to="/reservar">Reservar turno</Link>
                    </Button>
                  </CardContent>
                </Card>
              )}
            </div>

            <div className="mt-14 flex items-center gap-3">
              <History className="h-5 w-5 text-gold" />
              <h2 className="font-display text-2xl text-foreground">Historial</h2>
            </div>
            <div className="mt-5 divide-y divide-border border-y border-border">
              {history.map((a) => (
                <div key={a.id} className="flex flex-wrap items-center justify-between gap-3 py-4">
                  <div>
                    <p className="text-[15px] text-foreground">{a.services.name}</p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {formatDateTime(a.starts_at)} · {a.professionals?.full_name}
                      {a.sessions_total > 1 &&
                        ` · sesión ${a.session_number} de ${a.sessions_total}`}
                    </p>
                  </div>
                  <Badge variant="outline">{STATUS_LABEL[a.status]}</Badge>
                </div>
              ))}
              {history.length === 0 && (
                <p className="py-4 text-sm text-muted-foreground">
                  Todavía no hay visitas registradas.
                </p>
              )}
            </div>

            {/* Lo que este enlace es, dicho una vez y al final: no pide nada,
                pero conviene que sepa que quien lo tenga ve lo mismo que ella. */}
            <p className="mt-10 text-xs leading-relaxed text-muted-foreground">
              Este enlace es personal: quien lo tenga puede ver y cambiar tus turnos, así que no lo
              compartas. Si preferís entrar con mail y contraseña,{" "}
              <Link to="/auth" className="underline underline-offset-2">
                podés crearte una cuenta
              </Link>{" "}
              y pedirnos que te pasemos ahí tu historial.
            </p>
          </>
        )}
      </section>

      <ReprogramarTurnoDialog
        turno={reprogramando}
        token={token}
        onOpenChange={(abierto) => !abierto && setReprogramando(null)}
      />

      <CancelarTurnoDialog
        turno={
          cancelando ? { id: cancelando.id, cuando: formatDateTime(cancelando.starts_at) } : null
        }
        quien="clienta"
        pendiente={cancel.isPending}
        onOpenChange={(abierto) => !abierto && setCancelando(null)}
        onConfirmar={(motivo) => cancelando && cancel.mutate({ id: cancelando.id, motivo })}
      />

      <SiteFooter />
    </div>
  );
}
