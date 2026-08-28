import { json, type Ctx } from "@/server/http";
import { calcularMetricas } from "@/server/services/metricas.service";
import type { RtaMetricas } from "@/lib/api-tipos";

/**
 * Los números del negocio.
 *
 * El permiso lo pide el router (`metrics`), no esta función: es una sola ruta y
 * un solo permiso, así que ponerlo acá adentro sería repetir lo que ya dice la
 * línea que la declara.
 *
 * ⚠️ Esta pantalla muestra facturación. `metrics` es un permiso aparte y no está
 * dentro de ninguno de los otros a propósito: quien gestiona turnos ve los
 * precios de cada turno —los necesita para cobrar— pero eso no es lo mismo que
 * ver cuánto factura el centro, cuánto se lleva cada profesional y qué clientas
 * se están yendo. Es la clase de dato por el que se pregunta antes de darlo.
 */

/**
 * Cuánto puede abarcar un rango, en días.
 *
 * Tres años. No es por costo de la consulta —el filtro por `starts_at` usa
 * índice— sino por el `take` que NO hay: la respuesta crece con el rango, y sin
 * tope alguien que escriba `desde=1900` en la URL se trae la tabla entera a la
 * memoria del servidor y arma un JSON de megabytes.
 */
const DIAS_MAXIMOS = 365 * 3;

const UN_DIA = 24 * 60 * 60 * 1000;

/**
 * Lee una fecha de la query. Devuelve null si no vino o si no es una fecha.
 *
 * `new Date("cualquier cosa")` da un Date inválido en vez de tirar, y ese Date
 * se propaga hasta la consulta y vuelve como un error de Postgres ilegible. Se
 * corta acá.
 */
function fechaDeLaQuery(ctx: Ctx, clave: string): Date | null {
  const crudo = ctx.url.searchParams.get(clave);
  if (!crudo) return null;
  const fecha = new Date(crudo);
  return Number.isNaN(fecha.getTime()) ? null : fecha;
}

export async function metricas(ctx: Ctx) {
  const ahora = new Date();

  /*
   * Sin rango, el mes en curso.
   *
   * Es lo que pide el Dashboard, que no manda fechas: su rango ES el mes. La
   * pantalla de Métricas siempre manda las dos, así que este default lo usa una
   * sola de las dos y por eso está acá y no repetido en las dos pantallas.
   */
  const desde =
    fechaDeLaQuery(ctx, "desde") ??
    new Date(Date.UTC(ahora.getUTCFullYear(), ahora.getUTCMonth(), 1));

  // El `hasta` es EXCLUSIVO —la consulta usa `lt`—, así que quien pida el 31 de
  // agosto tiene que recibir el 31 de agosto entero. Se le suma un día al que
  // llega en vez de pedirle a la pantalla que mande el 1 de septiembre, que es
  // la clase de detalle que se olvida y hace perder el último día del mes.
  const hastaPedido = fechaDeLaQuery(ctx, "hasta");
  const hasta = hastaPedido
    ? new Date(hastaPedido.getTime() + UN_DIA)
    : new Date(Date.UTC(ahora.getUTCFullYear(), ahora.getUTCMonth() + 1, 1));

  if (hasta <= desde) {
    return json({ error: "El rango termina antes de empezar." }, 400);
  }

  if (hasta.getTime() - desde.getTime() > DIAS_MAXIMOS * UN_DIA) {
    return json({ error: `El rango no puede pasar de ${DIAS_MAXIMOS} días.` }, 400);
  }

  const datos = await calcularMetricas(desde, hasta);
  return json(datos satisfies RtaMetricas);
}
