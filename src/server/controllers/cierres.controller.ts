import { prisma } from "@/server/db";
import { json, type Ctx } from "@/server/http";
import { comoFecha, fechaDesdeTexto } from "@/server/serializar";
import { cierresVigentes, turnosEnDiasCerrados } from "@/server/services/cierres.service";
import { hoyEnElCentro } from "@/server/services/turnos.service";
import type { CierreDelCentro, RtaCierreGuardado, RtaCierres } from "@/lib/api-tipos";

/**
 * Los días que el centro no abre. Permiso `appointments`.
 *
 * ── POR QUÉ `appointments` Y NO `team` ────────────────────────────────────
 *
 * Las ausencias de una profesional piden `team`: son parte de su ficha, como
 * sus horarios. Cerrar el centro entero es otra cosa: es una decisión sobre la
 * agenda, y lo que deja atrás —los turnos que ya estaban dados esos días— lo
 * tiene que resolver quien gestiona turnos, que es quien puede reprogramarlos
 * y cancelarlos. Pedir `team` acá dejaría la pantalla en manos de alguien que
 * ve el problema y no lo puede tocar.
 *
 * Y es un permiso, no `exigirAdmin()`: en la práctica lo carga la dueña, pero
 * "el 25 no abrimos" es exactamente el tipo de cosa que se le pide anotar a la
 * secretaria. Si el centro prefiere reservárselo, es una línea en
 * cierres.routes.ts y otra en permissions.ts.
 */

function aCierre(c: {
  id: string;
  starts_on: Date;
  ends_on: Date;
  reason: string | null;
}): CierreDelCentro {
  return {
    id: c.id,
    starts_on: comoFecha(c.starts_on),
    ends_on: comoFecha(c.ends_on),
    reason: c.reason,
  };
}

/**
 * Los cierres por venir, cada uno con los turnos que le quedaron adentro.
 *
 * Los turnos van en la misma respuesta y no en un endpoint aparte a propósito:
 * son LA información de esta pantalla. Un cierre sin conflictos es una fila
 * tranquila; uno con turnos en pie es trabajo pendiente, y la diferencia tiene
 * que verse sin un segundo pedido que pueda fallar solo.
 */
export async function listar() {
  const cierres = await cierresVigentes();
  const enPie = await turnosEnDiasCerrados(cierres);

  const salida: RtaCierres = {
    cierres: cierres.map((c) => ({ ...aCierre(c), turnos_en_pie: enPie.get(c.id) ?? [] })),
  };
  return json(salida);
}

/**
 * Cerrar uno o varios días.
 *
 * ── SE GUARDA AUNQUE HAYA TURNOS ADENTRO ──────────────────────────────────
 *
 * Y se devuelven, para que la pantalla los muestre. Es la misma decisión que
 * `crearAusencia` y por el mismo motivo: esos turnos son clientas con una
 * confirmación por mail en la mano. Cancelarlos en masa acá sería mandar de
 * golpe un mail a cada una sin forma de volver atrás; y no dejar guardar hasta
 * resolverlos obligaría a hacerlo justo cuando la dueña está anotando algo
 * rápido antes de olvidárselo.
 *
 * Entonces el cierre entra —desde ya nadie reserva más esos días— y los turnos
 * quedan a la vista, acá y en la lista, hasta que se resuelvan uno por uno.
 *
 * ── LO QUE SÍ SE RECHAZA ──────────────────────────────────────────────────
 *
 * Un cierre que ya terminó. Las ausencias lo aceptan, pero acá la lista sólo
 * muestra lo vigente: guardar el martes pasado "saldría bien" y desaparecería
 * en el acto, que se lee como que no se guardó. Mejor decirlo.
 */
export async function crear(ctx: Ctx) {
  const desde = fechaDesdeTexto(ctx.body["starts_on"]);
  const hasta = fechaDesdeTexto(ctx.body["ends_on"]);
  if (!desde || !hasta) return json({ error: "Poné las dos fechas." }, 400);
  if (hasta < desde) {
    return json({ error: "La fecha de reapertura va después de la del cierre." }, 400);
  }
  if (hasta < hoyEnElCentro()) {
    return json({ error: "Esos días ya pasaron: no hay nada que cerrar." }, 400);
  }

  const motivo = typeof ctx.body["reason"] === "string" ? ctx.body["reason"].trim() : "";

  const cierre = await prisma.center_closures.create({
    data: { starts_on: desde, ends_on: hasta, reason: motivo || null },
    select: { id: true, starts_on: true, ends_on: true, reason: true },
  });

  const enPie = await turnosEnDiasCerrados([cierre]);

  const salida: RtaCierreGuardado = {
    cierre: aCierre(cierre),
    turnos_en_pie: enPie.get(cierre.id) ?? [],
  };
  return json(salida, 201);
}

/**
 * Reabrir: el centro sí va a atender esos días.
 *
 * No devuelve nada de los turnos porque no hay nada que avisar — sacar un
 * cierre sólo vuelve a abrir días que estaban cerrados.
 */
export async function borrar(ctx: Ctx) {
  const id = ctx.params["id"];
  if (!id) return json({ error: "Falta el cierre." }, 400);

  const existe = await prisma.center_closures.findUnique({ where: { id }, select: { id: true } });
  if (!existe) return json({ error: "Ese cierre ya no está." }, 404);

  await prisma.center_closures.delete({ where: { id } });
  return json({ ok: true });
}
