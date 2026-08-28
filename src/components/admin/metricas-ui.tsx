import type { ReactNode } from "react";
import { nombreDelMes, RAMPA, SERIE_A, SERIE_B } from "@/lib/metricas-formato";

/**
 * Las piezas de los gráficos, compartidas por el Dashboard y por Métricas.
 *
 * Están acá y no dentro de una de las dos pantallas porque el Dashboard es un
 * recorte de Métricas: los mismos rankings, el mismo criterio de color, las
 * mismas etiquetas. Duplicados, el día que se toque uno las dos pantallas
 * empiezan a dibujar lo mismo de dos formas distintas.
 *
 * ── SOBRE LOS COLORES ─────────────────────────────────────────────────────
 *
 * `--serie-a` y `--serie-b` (verde y dorado) para identidad; `--rampa-1..5`,
 * un solo matiz de claro a oscuro, para magnitud. La explicación de por qué NO
 * son `--primary` y `--gold` está en `styles.css`, arriba de los tokens, con el
 * reporte del validador.
 *
 * Lo que hay que respetar al tocar esto:
 *
 *   · **Todo valor pintado lleva su número escrito al lado.** El dorado da 2.41:1
 *     contra el fondo, y esa advertencia se levanta mostrando el dato en texto.
 *     No es adorno: sin la etiqueta, la barra dorada no se lee.
 *   · El texto va en color de texto (`foreground` / `muted-foreground`), nunca en
 *     el color de la serie. El color lo lleva la marca, no las letras.
 *   · Con dos series hay leyenda, siempre.
 */

/** Un número grande con su rótulo. Cuando el dato es UNO, no va gráfico. */
export function Tarjeta({
  titulo,
  valor,
  detalle,
}: {
  titulo: string;
  valor: ReactNode;
  detalle?: ReactNode;
}) {
  return (
    <div className="rounded-sm border border-border bg-card p-5">
      <p className="text-eyebrow text-muted-foreground">{titulo}</p>
      {/* `tabular-nums` para que dos tarjetas al lado no bailen al actualizarse. */}
      <p className="mt-3 font-display text-3xl tabular-nums text-foreground">{valor}</p>
      {detalle && <p className="mt-2 text-sm text-muted-foreground">{detalle}</p>}
    </div>
  );
}

export function Panel({
  titulo,
  ayuda,
  children,
}: {
  titulo: string;
  ayuda?: string;
  children: ReactNode;
}) {
  return (
    <section className="rounded-sm border border-border bg-card p-6">
      <h2 className="font-display text-xl text-foreground">{titulo}</h2>
      {ayuda && <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">{ayuda}</p>}
      <div className="mt-6">{children}</div>
    </section>
  );
}

export function SinDatos({ children }: { children: ReactNode }) {
  return <p className="py-6 text-center text-sm text-muted-foreground">{children}</p>;
}

/**
 * Un ranking: etiqueta, barra y valor escrito.
 *
 * Barras horizontales y no torta. Una torta compara ángulos, que es lo que peor
 * hace el ojo; acá lo que se pregunta es "cuál es más y por cuánto", y eso son
 * largos que arrancan de la misma línea.
 *
 * La barra es de un solo color a propósito. Pintar cada fila de un color
 * distinto no agrega información —la posición ya dice el orden— y gasta los dos
 * colores de identidad en algo que no los necesita.
 */
export function Ranking({
  filas,
  color = SERIE_A,
  formato = (n: number) => String(n),
}: {
  filas: { etiqueta: string; valor: number; nota?: string }[];
  color?: string;
  formato?: (n: number) => string;
}) {
  if (filas.length === 0) return <SinDatos>Todavía no hay datos.</SinDatos>;

  // La escala arranca del más alto y no de la suma: lo que importa es la
  // proporción entre el primero y el resto.
  const tope = Math.max(...filas.map((f) => f.valor), 1);

  return (
    <ul className="space-y-3">
      {filas.map((f) => (
        <li key={f.etiqueta}>
          <div className="flex items-baseline justify-between gap-4">
            <span className="min-w-0 truncate text-sm text-foreground">{f.etiqueta}</span>
            <span className="shrink-0 text-sm tabular-nums text-foreground">
              {formato(f.valor)}
            </span>
          </div>
          <div className="mt-1.5 flex items-center gap-3">
            {/* La pista gris da la referencia del 100%: sin ella, la barra más
                larga parece "lleno" aunque sea el 4% de algo. */}
            <div className="h-2 flex-1 overflow-hidden rounded-full bg-muted">
              <div
                className="h-full rounded-full"
                style={{ width: `${(f.valor / tope) * 100}%`, background: color }}
              />
            </div>
            {f.nota && (
              <span className="shrink-0 text-xs tabular-nums text-muted-foreground">{f.nota}</span>
            )}
          </div>
        </li>
      ))}
    </ul>
  );
}

/**
 * Ocupación: lo vendido sobre lo que estaba abierto.
 *
 * Es un medidor y no un ranking: cada barra se lee contra su propio 100%, no
 * contra la de al lado. Por eso la pista siempre representa la agenda completa
 * de esa profesional y el porcentaje va escrito.
 */
export function Ocupacion({
  filas,
}: {
  filas: {
    nombre: string;
    minutosVendidos: number;
    minutosDisponibles: number;
    porcentaje: number;
  }[];
}) {
  if (filas.length === 0) return <SinDatos>No hay profesionales activas.</SinDatos>;

  return (
    <ul className="space-y-4">
      {filas.map((f) => {
        // Sin horarios cargados NO es 0% de ocupación: es que no se sabe. Son dos
        // problemas distintos y uno se arregla en Profesionales, así que la
        // pantalla no los dibuja igual.
        const sinAgenda = f.minutosDisponibles === 0;
        return (
          <li key={f.nombre}>
            <div className="flex items-baseline justify-between gap-4">
              <span className="min-w-0 truncate text-sm text-foreground">{f.nombre}</span>
              <span className="shrink-0 text-sm tabular-nums text-foreground">
                {sinAgenda ? "—" : `${f.porcentaje}%`}
              </span>
            </div>
            <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-muted">
              {!sinAgenda && (
                <div
                  className="h-full rounded-full"
                  style={{
                    width: `${Math.min(f.porcentaje, 100)}%`,
                    background: SERIE_A,
                  }}
                />
              )}
            </div>
            <p className="mt-1.5 text-xs text-muted-foreground">
              {sinAgenda
                ? "Sin horarios cargados — no se puede calcular. Cargalos en Profesionales."
                : `${Math.round(f.minutosVendidos / 60)} h vendidas de ${Math.round(f.minutosDisponibles / 60)} h de agenda`}
            </p>
          </li>
        );
      })}
    </ul>
  );
}

/** Alto del área de columnas. Ver la nota de adentro sobre por qué en `rem`. */
const ALTO_DEL_GRAFICO = "10rem";

/**
 * Columnas por mes. Con una serie no lleva leyenda —el título ya la nombra—; con
 * dos, sí y siempre.
 *
 * Las columnas van agrupadas y no apiladas: apiladas, la segunda serie no
 * arranca de una línea común y su evolución deja de poder compararse mes a mes,
 * que es justo lo que se viene a mirar en "nuevas vs. que vuelven".
 */
export function ColumnasMensuales({
  meses,
  series,
  formato = (n: number) => String(n),
}: {
  meses: string[];
  series: { nombre: string; color: string; valores: number[] }[];
  formato?: (n: number) => string;
}) {
  if (meses.length === 0) return <SinDatos>No hay meses en el rango elegido.</SinDatos>;

  const tope = Math.max(...series.flatMap((s) => s.valores), 1);

  return (
    <div>
      {series.length > 1 && (
        <ul className="mb-5 flex flex-wrap gap-x-5 gap-y-2">
          {series.map((s) => (
            <li key={s.nombre} className="flex items-center gap-2 text-sm text-muted-foreground">
              <span
                className="h-2.5 w-2.5 shrink-0 rounded-full"
                style={{ background: s.color }}
                aria-hidden="true"
              />
              {s.nombre}
            </li>
          ))}
        </ul>
      )}

      {/*
        ⚠️ El alto de las columnas se calcula en `rem` y NO con porcentajes.

        Con porcentajes no se dibujaba nada: se veía la etiqueta del mes y
        ninguna barra. El motivo es que un `height: X%` sólo resuelve si el
        padre tiene un alto DEFINIDO, y la fila tenía `items-end`, que hace que
        cada columna se encoja al alto de su contenido en vez de estirarse a los
        11rem de la fila. El `h-full` de adentro colgaba entonces de una caja de
        alto automático, el porcentaje daba cero y la barra medía cero.

        Multiplicando contra `ALTO_DEL_GRAFICO` el número sale en píxeles desde
        el principio y no depende de la cadena de alturas de los padres.
      */}
      <div className="overflow-x-auto">
        <div className="flex min-w-full gap-4">
          {meses.map((mes, i) => (
            <div key={mes} className="flex min-w-14 flex-1 flex-col items-center gap-2">
              <div
                className="flex w-full items-end justify-center gap-1"
                style={{ height: ALTO_DEL_GRAFICO }}
              >
                {series.map((s) => {
                  const valor = s.valores[i] ?? 0;
                  return (
                    <div
                      key={s.nombre}
                      // El `title` es la capa de detalle: el valor exacto de cada
                      // columna sin escribir un número sobre todas, que llena el
                      // gráfico de texto y lo vuelve ilegible.
                      title={`${nombreDelMes(mes)} · ${s.nombre}: ${formato(valor)}`}
                      className="w-full max-w-8 rounded-t-sm transition-opacity hover:opacity-80"
                      style={{
                        // Mínimo de 2px para que un mes con dato pero chico no se
                        // vea igual que uno sin dato.
                        height:
                          valor > 0 ? `max(2px, calc(${valor / tope} * ${ALTO_DEL_GRAFICO}))` : "0",
                        background: s.color,
                      }}
                    />
                  );
                })}
              </div>
              <span className="text-xs whitespace-nowrap text-muted-foreground">
                {nombreDelMes(mes)}
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* La tabla debajo no es redundante: es lo que hace que el gráfico se pueda
          leer sin distinguir colores y sin pasar el mouse. */}
      <div className="mt-5 overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border text-left">
              <th className="pb-2 font-normal text-muted-foreground">Mes</th>
              {series.map((s) => (
                <th key={s.nombre} className="pb-2 text-right font-normal text-muted-foreground">
                  {s.nombre}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {meses.map((mes, i) => (
              <tr key={mes} className="border-b border-border/50 last:border-0">
                <td className="py-2 text-foreground">{nombreDelMes(mes)}</td>
                {series.map((s) => (
                  <td key={s.nombre} className="py-2 text-right tabular-nums text-foreground">
                    {formato(s.valores[i] ?? 0)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

const DIAS = ["Dom", "Lun", "Mar", "Mié", "Jue", "Vie", "Sáb"];

/**
 * Mapa de día × hora: cuándo pide turno la gente.
 *
 * Rampa de un solo matiz, de claro a oscuro. La intensidad ES la magnitud, así
 * que ordena sola; con un arcoíris habría que ir a buscar la referencia para
 * saber si el rojo es más o menos que el verde.
 *
 * Las horas se recortan a las que tienen algo. Un mapa de 24 filas donde 14
 * están vacías es sobre todo un mapa de celdas vacías.
 */
export function MapaDiaHora({
  celdas,
}: {
  celdas: { dia: number; hora: number; cantidad: number }[];
}) {
  if (celdas.length === 0) return <SinDatos>No hubo turnos en el rango elegido.</SinDatos>;

  const horas = [...new Set(celdas.map((c) => c.hora))].sort((a, b) => a - b);
  const tope = Math.max(...celdas.map((c) => c.cantidad));
  const porClave = new Map(celdas.map((c) => [`${c.dia}:${c.hora}`, c.cantidad]));

  /** En qué escalón de la rampa cae un valor. 0 turnos no pinta nada. */
  function tono(cantidad: number): string {
    if (cantidad === 0) return "var(--muted)";
    const paso = Math.ceil((cantidad / tope) * RAMPA.length);
    return RAMPA[Math.min(paso, RAMPA.length) - 1]!;
  }

  return (
    <div className="overflow-x-auto">
      <table className="border-separate" style={{ borderSpacing: "2px" }}>
        <thead>
          <tr>
            <th />
            {DIAS.map((d) => (
              <th key={d} className="px-1 pb-1 text-xs font-normal text-muted-foreground">
                {d}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {horas.map((hora) => (
            <tr key={hora}>
              <th className="pr-2 text-right text-xs font-normal tabular-nums text-muted-foreground">
                {String(hora).padStart(2, "0")}
              </th>
              {DIAS.map((_, dia) => {
                const cantidad = porClave.get(`${dia}:${hora}`) ?? 0;
                return (
                  <td key={dia}>
                    <div
                      title={`${DIAS[dia]} ${String(hora).padStart(2, "0")}:00 — ${cantidad} ${cantidad === 1 ? "turno" : "turnos"}`}
                      className="flex h-8 w-11 items-center justify-center rounded-sm text-xs tabular-nums"
                      style={{
                        background: tono(cantidad),
                        // El número va oscuro sobre los tonos claros y claro
                        // sobre los oscuros. Es la única forma de que se lea en
                        // los dos extremos de la rampa.
                        color:
                          cantidad / tope > 0.6 ? "var(--primary-foreground)" : "var(--foreground)",
                      }}
                    >
                      {cantidad > 0 ? cantidad : ""}
                    </div>
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
