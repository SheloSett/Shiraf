import { useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { MessageCircle } from "lucide-react";
import {
  ColumnasMensuales,
  MapaDiaHora,
  Ocupacion,
  Panel,
  Ranking,
  SinDatos,
  Tarjeta,
} from "@/components/admin/metricas-ui";
import { comoPlata, nombreDelMes, SERIE_A, SERIE_B } from "@/lib/metricas-formato";
import { AvisoDeVencidos } from "@/components/admin/aviso-de-vencidos";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { api } from "@/lib/api";
import type { RtaMetricas } from "@/lib/api-tipos";
import { toWhatsappNumber } from "@/lib/notifications";
import { formatDay } from "@/lib/shiraf";

export const Route = createFileRoute("/_authenticated/admin/metricas")({
  component: Metricas,
});

/** "2026-08-28" en hora local, que es lo que quiere un `<input type="date">`. */
function comoFechaDeInput(fecha: Date): string {
  const mes = String(fecha.getMonth() + 1).padStart(2, "0");
  const dia = String(fecha.getDate()).padStart(2, "0");
  return `${fecha.getFullYear()}-${mes}-${dia}`;
}

/**
 * Los atajos de rango.
 *
 * Existen porque el 90% de las veces que alguien abre esta pantalla quiere uno
 * de estos cinco, y elegir dos fechas en dos calendarios para pedir "este mes"
 * es trabajo que la pantalla puede hacer sola. Los dos campos quedan igual para
 * el 10% restante.
 */
const ATAJOS = [
  { id: "mes", label: "Este mes" },
  { id: "mes-pasado", label: "Mes pasado" },
  { id: "trimestre", label: "Últimos 3 meses" },
  { id: "anio", label: "Este año" },
  { id: "12-meses", label: "Últimos 12 meses" },
] as const;

function rangoDelAtajo(id: (typeof ATAJOS)[number]["id"]): { desde: string; hasta: string } {
  const hoy = new Date();
  const y = hoy.getFullYear();
  const m = hoy.getMonth();

  switch (id) {
    case "mes":
      return { desde: comoFechaDeInput(new Date(y, m, 1)), hasta: comoFechaDeInput(hoy) };
    case "mes-pasado":
      // El día 0 del mes actual es el último del anterior: evita tener que saber
      // si el mes pasado tenía 28, 30 o 31.
      return {
        desde: comoFechaDeInput(new Date(y, m - 1, 1)),
        hasta: comoFechaDeInput(new Date(y, m, 0)),
      };
    case "trimestre":
      return { desde: comoFechaDeInput(new Date(y, m - 2, 1)), hasta: comoFechaDeInput(hoy) };
    case "anio":
      return { desde: comoFechaDeInput(new Date(y, 0, 1)), hasta: comoFechaDeInput(hoy) };
    case "12-meses":
      return { desde: comoFechaDeInput(new Date(y, m - 11, 1)), hasta: comoFechaDeInput(hoy) };
  }
}

/**
 * Los números del negocio, con el rango a elección.
 *
 * Pide la misma ruta que el Dashboard con `?desde=&hasta=`. Todo lo que se
 * dibuja acá sale de esa única respuesta: no hay una consulta por panel, así que
 * los números de esta pantalla no pueden contradecirse entre sí — vienen todos
 * del mismo recorte de la base, sacado en el mismo instante.
 */
function Metricas() {
  const inicial = rangoDelAtajo("mes");
  const [desde, setDesde] = useState(inicial.desde);
  const [hasta, setHasta] = useState(inicial.hasta);

  const metricas = useQuery({
    queryKey: ["metricas", desde, hasta],
    staleTime: 5 * 60_000,
    // `keepPreviousData` en espíritu: mientras llega el rango nuevo se sigue
    // viendo el anterior en vez de vaciar la pantalla, que con seis paneles es
    // un salto muy grande.
    placeholderData: (previo) => previo,
    queryFn: async () =>
      api<RtaMetricas>(
        `/api/metricas?desde=${encodeURIComponent(desde)}&hasta=${encodeURIComponent(hasta)}`,
      ),
  });

  const d = metricas.data;

  function aplicarAtajo(id: (typeof ATAJOS)[number]["id"]) {
    const r = rangoDelAtajo(id);
    setDesde(r.desde);
    setHasta(r.hasta);
  }

  const meses = useMemo(() => (d ? d.plata.porMes.map((m) => m.mes) : []), [d]);

  // Los meses de "nuevas vs. que vuelven" pueden no ser los mismos que los de
  // facturación: un mes con turnos cancelados factura 0 pero tiene clientas. Se
  // dibujan con su propia lista de meses en vez de forzarlos a la otra, que
  // dejaría columnas fantasma.
  const mesesDeClientas = useMemo(() => (d ? d.clientas.nuevasPorMes.map((m) => m.mes) : []), [d]);

  return (
    <div>
      <div>
        <p className="text-eyebrow text-muted-foreground">Los números del centro</p>
        <h1 className="mt-3 font-display text-4xl text-foreground">Métricas</h1>
      </div>

      {/* Los filtros van en una sola fila arriba de todo: son el control de TODA
          la pantalla, no de un panel, y puestos al lado de un gráfico se leen
          como si filtraran sólo ése. */}
      <div className="mt-8 flex flex-wrap items-end gap-x-3 gap-y-4 rounded-sm border border-border bg-card p-4">
        <div className="flex flex-wrap gap-2">
          {ATAJOS.map((a) => {
            const r = rangoDelAtajo(a.id);
            const activo = r.desde === desde && r.hasta === hasta;
            return (
              <Button
                key={a.id}
                variant={activo ? "default" : "outline"}
                size="sm"
                onClick={() => aplicarAtajo(a.id)}
              >
                {a.label}
              </Button>
            );
          })}
        </div>

        <div className="flex flex-wrap items-end gap-3">
          <label className="text-sm">
            <span className="mb-1.5 block text-muted-foreground">Desde</span>
            <Input
              type="date"
              value={desde}
              max={hasta}
              onChange={(e) => setDesde(e.target.value)}
              className="w-40"
            />
          </label>
          <label className="text-sm">
            <span className="mb-1.5 block text-muted-foreground">Hasta</span>
            <Input
              type="date"
              value={hasta}
              min={desde}
              onChange={(e) => setHasta(e.target.value)}
              className="w-40"
            />
          </label>
        </div>

        {metricas.isFetching && (
          <span className="text-sm text-muted-foreground">Actualizando…</span>
        )}
      </div>

      {metricas.isError && (
        <div className="mt-6 max-w-xl rounded-sm border border-destructive/40 bg-destructive/5 p-5">
          <p className="text-sm font-medium text-foreground">No se pudieron cargar los números.</p>
          <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
            Puede ser la conexión, o un rango demasiado largo — el máximo son tres años. Esto NO
            quiere decir que el período esté en cero.
          </p>
        </div>
      )}

      {metricas.isLoading && <p className="mt-10 text-sm text-muted-foreground">Cargando…</p>}

      {d && (
        <div className="mt-6 space-y-6">
          <AvisoDeVencidos
            cantidad={d.alertas.vencidosSinCerrar}
            monto={d.alertas.montoSinCerrar}
          />

          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <Tarjeta
              titulo="Facturado"
              valor={comoPlata(d.plata.facturado)}
              detalle={`${d.plata.turnosRealizados} ${d.plata.turnosRealizados === 1 ? "turno realizado" : "turnos realizados"}`}
            />
            <Tarjeta
              titulo="Agendado"
              valor={comoPlata(d.plata.agendado)}
              detalle="Turnos por venir, sin cobrar todavía"
            />
            <Tarjeta titulo="Ticket promedio" valor={comoPlata(d.plata.ticketPromedio)} />
            <Tarjeta
              titulo="Anticipación"
              valor={
                d.agenda.anticipacionPromedioDias === null
                  ? "—"
                  : `${d.agenda.anticipacionPromedioDias} días`
              }
              detalle="Con cuánta anticipación reservan, en promedio"
            />
          </div>

          <Panel
            titulo="Facturación por mes"
            ayuda="Sólo turnos realizados. Los cancelados y los que todavía no pasaron no cuentan acá."
          >
            <ColumnasMensuales
              meses={meses}
              series={[
                {
                  nombre: "Facturado",
                  color: SERIE_A,
                  valores: d.plata.porMes.map((m) => m.facturado),
                },
              ]}
              formato={comoPlata}
            />
          </Panel>

          <div className="grid gap-6 xl:grid-cols-2">
            <Panel
              titulo="Facturación por tratamiento"
              ayuda="Cuánto dejó cada uno. A la derecha, cuántas veces se dio."
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

            <Panel
              titulo="Facturación por profesional"
              ayuda="Lo que facturaron los turnos de cada una."
            >
              <Ranking
                filas={d.plata.porProfesional.map((f) => ({
                  etiqueta: f.nombre,
                  valor: f.total,
                  nota: `${f.cantidad}×`,
                }))}
                color={SERIE_B}
                formato={comoPlata}
              />
            </Panel>
          </div>

          <Panel
            titulo="Ocupación de la agenda"
            ayuda="Minutos ocupados sobre los minutos que la agenda estaba abierta, según los horarios cargados en Profesionales. Acá SÍ entran los turnos por venir: un turno confirmado bloquea el horario aunque todavía no haya pasado. Los cancelados no, que ese hueco quedó libre."
          >
            <Ocupacion filas={d.agenda.ocupacion} />
          </Panel>

          <Panel
            titulo="Cuándo piden turno"
            ayuda="Todos los turnos del período por día y hora, cancelados incluidos: acá la pregunta es cuándo QUIEREN venir, que es lo que decide qué horarios conviene abrir."
          >
            <MapaDiaHora celdas={d.agenda.mapaDiaHora} />
          </Panel>

          <Panel
            titulo="Clientas nuevas y que vuelven"
            ayuda="Cuenta clientas, no turnos: la que vino tres veces en el mes es una. Es nueva si su primer turno Realizado en la historia del centro cae en ese mes."
          >
            <ColumnasMensuales
              meses={mesesDeClientas}
              series={[
                {
                  nombre: "Nuevas",
                  color: SERIE_A,
                  valores: d.clientas.nuevasPorMes.map((m) => m.nuevas),
                },
                {
                  nombre: "Que vuelven",
                  color: SERIE_B,
                  valores: d.clientas.nuevasPorMes.map((m) => m.repetidas),
                },
              ]}
            />
          </Panel>

          <div className="grid gap-6 xl:grid-cols-2">
            <Panel titulo="Clientas frecuentes" ayuda="Las que más veces vinieron en el período.">
              <Ranking
                filas={d.clientas.frecuentes.map((c) => ({
                  etiqueta: c.nombre,
                  valor: c.visitas,
                  nota: comoPlata(c.total),
                }))}
                formato={(n) => `${n} ${n === 1 ? "visita" : "visitas"}`}
              />
            </Panel>

            <Panel
              titulo="Motivos de cancelación"
              ayuda={`${d.clientas.cancelacion.canceladas} de ${d.clientas.cancelacion.total} turnos (${d.clientas.cancelacion.porcentaje}%). El motivo lo escribe quien cancela; los que no dejaron ninguno van juntos.`}
            >
              <Ranking
                filas={d.clientas.cancelacion.motivos.map((m) => ({
                  etiqueta: m.motivo,
                  valor: m.cantidad,
                }))}
                color={SERIE_B}
                formato={(n) => `${n}`}
              />
            </Panel>
          </div>

          {/*
            Este panel es el único que no es un gráfico, y es a propósito: no hay
            nada que comparar. Es una lista de gente a la que escribirle, así que
            lo que tiene que haber es el nombre y el botón de WhatsApp.

            Ignora el rango elegido a propósito, igual que «Lo que viene» en el
            Dashboard: "hace cuánto que no viene" se mide contra hoy, no contra
            el período que se esté mirando.
          */}
          <Panel
            titulo="Clientas que se están yendo"
            ayuda="Vinieron tres veces o más, hace más de 60 días que no aparecen y no tienen ningún turno agendado. Se mide contra hoy, no contra el período elegido."
          >
            {d.clientas.enRiesgo.length === 0 ? (
              <SinDatos>Ninguna clienta habitual dejó de venir. Buena noticia.</SinDatos>
            ) : (
              <ul className="divide-y divide-border">
                {d.clientas.enRiesgo.map((c) => {
                  const whatsapp = toWhatsappNumber(c.telefono);
                  return (
                    <li
                      key={`${c.nombre}-${c.ultima}`}
                      className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1 py-3 first:pt-0 last:pb-0"
                    >
                      <div className="min-w-0">
                        <p className="truncate text-sm text-foreground">{c.nombre}</p>
                        <p className="text-xs text-muted-foreground">
                          {c.visitas} visitas · última el {formatDay(c.ultima)}
                        </p>
                      </div>
                      <div className="flex items-center gap-4">
                        <span className="text-sm tabular-nums text-muted-foreground">
                          {c.diasSinVenir} días
                        </span>
                        {whatsapp ? (
                          <a
                            href={`https://wa.me/${whatsapp}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-1.5 text-sm text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
                          >
                            <MessageCircle className="h-3.5 w-3.5" />
                            Escribirle
                          </a>
                        ) : (
                          <span className="text-sm text-muted-foreground">Sin teléfono</span>
                        )}
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </Panel>

          <p className="text-xs text-muted-foreground">
            Período: {nombreDelMes(desde.slice(0, 7))} — {formatDay(`${hasta}T12:00:00`)}
          </p>
        </div>
      )}
    </div>
  );
}
