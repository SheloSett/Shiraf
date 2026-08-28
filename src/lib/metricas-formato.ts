import { formatMoney } from "@/lib/shiraf";

/**
 * Los colores y los formateadores de los gráficos, separados de los componentes.
 *
 * Viven acá y no dentro de `metricas-ui.tsx` por una razón de herramienta y no de
 * diseño: un archivo que exporta componentes Y constantes rompe el fast refresh
 * de Vite —cada cambio recarga la página entera en vez de sólo el componente— y
 * eslint lo avisa. Es la misma razón por la que shadcn deja los `cva` afuera.
 */

/**
 * El verde y el dorado escalonados para usar como marcas de gráfico.
 *
 * NO son `--primary` ni `--gold`: los de la marca fallan dos de los seis
 * chequeos de contraste como color de gráfico. El detalle, con el reporte del
 * validador, está en `styles.css` arriba de los tokens.
 */
export const SERIE_A = "var(--serie-a)";
export const SERIE_B = "var(--serie-b)";

/** Rampa secuencial de un solo matiz, de claro a oscuro, para el mapa de calor. */
export const RAMPA = [
  "var(--rampa-1)",
  "var(--rampa-2)",
  "var(--rampa-3)",
  "var(--rampa-4)",
  "var(--rampa-5)",
];

/** "2026-08" → "ago 2026". */
export function nombreDelMes(clave: string): string {
  const [anio, mes] = clave.split("-").map(Number);
  if (!anio || !mes) return clave;
  const nombre = new Date(Date.UTC(anio, mes - 1, 1)).toLocaleDateString("es-AR", {
    month: "short",
    timeZone: "UTC",
  });
  return `${nombre} ${anio}`;
}

/** El formateador de plata del proyecto, para no reimplementarlo en cada panel. */
export const comoPlata = (n: number) => formatMoney(n);
