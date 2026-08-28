import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { ArrowRight } from "lucide-react";
import { AvisoDeVencidos } from "@/components/admin/aviso-de-vencidos";
import { Panel, Ranking, SinDatos, Tarjeta } from "@/components/admin/metricas-ui";
import { comoPlata, SERIE_B } from "@/lib/metricas-formato";
import { api } from "@/lib/api";
import type { RtaMetricas } from "@/lib/api-tipos";
import { formatDateTime } from "@/lib/shiraf";

export const Route = createFileRoute("/_authenticated/admin/dashboard")({
  component: Dashboard,
});

/**
 * La primera pantalla del panel para la dueña: cómo viene el mes.
 *
 * Pide `/api/metricas` sin rango, y esa ausencia significa "el mes en curso" —
 * el default lo pone el servidor (ver `metricas.controller`), no esta pantalla,
 * así que Dashboard y Métricas no pueden estar mirando meses distintos.
 *
 * Lo que se muestra acá es un RECORTE de lo que devuelve esa ruta: los cuatro
 * números de arriba, dos rankings y lo que viene. Todo lo demás —ocupación,
 * mapa de horarios, retención, cancelaciones— vive en Métricas. El criterio es
 * cuánto tiempo se le dedica: esto se mira treinta segundos entre turno y turno.
 */
function Dashboard() {
  const metricas = useQuery({
    queryKey: ["metricas", "mes-en-curso"],
    staleTime: 5 * 60_000,
    queryFn: async () => api<RtaMetricas>("/api/metricas"),
  });

  const d = metricas.data;

  return (
    <div>
      <div>
        <p className="text-eyebrow text-muted-foreground">El mes en curso</p>
        <h1 className="mt-3 font-display text-4xl text-foreground">Dashboard</h1>
      </div>

      <p className="mt-4 max-w-xl text-sm leading-relaxed text-muted-foreground">
        Un vistazo a cómo viene el mes. Para mirar otros períodos, comparar meses o ver la ocupación
        de la agenda está{" "}
        <Link to="/admin/metricas" className="text-foreground underline underline-offset-4">
          Métricas
        </Link>
        .
      </p>

      {metricas.isLoading && <p className="mt-10 text-sm text-muted-foreground">Cargando…</p>}

      {/* El error separado del vacío, igual que en el resto del panel: un mes sin
          facturar y un servidor que no contestó no se pueden dibujar igual. Acá
          la confusión es cara — "no vendimos nada" es una conclusión. */}
      {metricas.isError && (
        <div className="mt-10 max-w-xl rounded-sm border border-destructive/40 bg-destructive/5 p-5">
          <p className="text-sm font-medium text-foreground">No se pudieron cargar los números.</p>
          <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
            Puede ser la conexión. Esto NO quiere decir que el mes esté en cero.
          </p>
        </div>
      )}

      {d && (
        <>
          <AvisoDeVencidos
            cantidad={d.alertas.vencidosSinCerrar}
            monto={d.alertas.montoSinCerrar}
          />

          <div className="mt-10 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <Tarjeta
              titulo="Facturado"
              valor={comoPlata(d.plata.facturado)}
              detalle={`${d.plata.turnosRealizados} ${d.plata.turnosRealizados === 1 ? "turno realizado" : "turnos realizados"}`}
            />
            <Tarjeta
              titulo="Agendado"
              valor={comoPlata(d.plata.agendado)}
              // La distinción importa y por eso está escrita: lo agendado todavía
              // no entró. Sumar las dos cifras y llamarlas "facturación del mes"
              // es la forma más común de creerse un número que no pasó.
              detalle="Turnos por venir, sin cobrar todavía"
            />
            <Tarjeta titulo="Ticket promedio" valor={comoPlata(d.plata.ticketPromedio)} />
            <Tarjeta
              titulo="Cancelación"
              valor={`${d.clientas.cancelacion.porcentaje}%`}
              detalle={`${d.clientas.cancelacion.canceladas} de ${d.clientas.cancelacion.total} turnos`}
            />
          </div>

          <div className="mt-6 grid gap-6 xl:grid-cols-2">
            <Panel
              titulo="Tratamientos más pedidos"
              ayuda="Por lo que facturaron este mes. Sólo turnos marcados como Realizado. El número de la derecha es cuántas veces se dio."
            >
              <Ranking
                filas={d.plata.porTratamiento.map((f) => ({
                  etiqueta: f.nombre,
                  valor: f.total,
                  nota: `${f.cantidad}×`,
                }))}
                formato={comoPlata}
              />
            </Panel>

            <Panel titulo="Clientas frecuentes" ayuda="Las que más veces vinieron este mes.">
              <Ranking
                filas={d.clientas.frecuentes.map((c) => ({
                  etiqueta: c.nombre,
                  valor: c.visitas,
                  nota: comoPlata(c.total),
                }))}
                color={SERIE_B}
                formato={(n) => `${n} ${n === 1 ? "visita" : "visitas"}`}
              />
            </Panel>
          </div>

          <div className="mt-6">
            <Panel
              titulo="Lo que viene"
              ayuda="Los próximos ocho turnos, del más cercano al más lejano. No depende del mes que se esté mirando."
            >
              {d.proximosTurnos.length === 0 ? (
                <SinDatos>No hay turnos agendados.</SinDatos>
              ) : (
                <ul className="divide-y divide-border">
                  {d.proximosTurnos.map((t) => (
                    <li
                      key={t.id}
                      className="grid gap-x-6 gap-y-1 py-3 first:pt-0 last:pb-0 sm:grid-cols-[13rem_minmax(0,1fr)_auto] sm:items-baseline"
                    >
                      <span className="text-sm tabular-nums text-foreground">
                        {formatDateTime(t.empiezaEn)}
                      </span>
                      <span className="min-w-0 truncate text-sm text-foreground">
                        {t.tratamiento}
                        <span className="text-muted-foreground">
                          {" · "}
                          {t.clienta ?? "Sin nombre"}
                        </span>
                      </span>
                      <span className="text-sm text-muted-foreground">
                        {t.profesional ?? "Sin asignar"}
                      </span>
                    </li>
                  ))}
                </ul>
              )}

              <Link
                to="/admin/turnos"
                className="mt-6 inline-flex items-center gap-2 text-sm text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
              >
                Ver todos los turnos <ArrowRight className="h-3.5 w-3.5" />
              </Link>
            </Panel>
          </div>
        </>
      )}
    </div>
  );
}
