export const WEEKDAYS = [
  "Domingo",
  "Lunes",
  "Martes",
  "Miércoles",
  "Jueves",
  "Viernes",
  "Sábado",
] as const;

export const STATUS_LABEL: Record<string, string> = {
  pending: "Pendiente",
  confirmed: "Confirmado",
  completed: "Realizado",
  cancelled: "Cancelado",
};

/**
 * Los mismos cuatro estados de arriba, pero como unión de TypeScript.
 *
 * STATUS_LABEL está tipado `Record<string, string>`: alcanza para poner un
 * cartel en pantalla, pero para el compilador la clave puede ser cualquier
 * texto. Desde que el calendario enlaza a la pestaña correcta de Turnos hace
 * falta lo otro: el enlace lleva el estado en la URL y el router exige que sea
 * uno de los cuatro, no un string suelto.
 */
export const STATUSES = ["pending", "confirmed", "completed", "cancelled"] as const;
export type AppointmentStatus = (typeof STATUSES)[number];

/**
 * El estado, si es uno de los cuatro; null si no.
 *
 * Se usa con datos que vienen de afuera y llegan como `string`: el `status` de
 * la base y el `?estado=` de la URL, que lo escribe cualquiera a mano.
 */
export function toStatus(value: unknown): AppointmentStatus | null {
  return STATUSES.includes(value as AppointmentStatus) ? (value as AppointmentStatus) : null;
}

/**
 * El estado que se le MUESTRA a una persona, que son cinco y no cuatro.
 *
 * La base guarda cuatro (`STATUSES`). El quinto, «Vencido», no es una columna:
 * es el cruce de un turno que sigue en pendiente o confirmado con una hora que
 * ya pasó. Son situaciones opuestas con el mismo `status` —un pendiente de la
 * semana que viene es agenda por delante; el mismo pendiente del martes pasado
 * es un turno que se vivió y que nadie cerró— y quien mira la pantalla necesita
 * distinguirlas.
 *
 * Vivía suelto adentro del calendario, en la función que elegía el color. Subió
 * acá cuando la lista de Turnos y la ficha tuvieron que mostrar lo mismo: la
 * regla es una sola y tiene que decidirse en un solo lugar, o las tres pantallas
 * terminan discrepando sobre el mismo turno.
 */
export type EstadoVisible = AppointmentStatus | "overdue";

export const ESTADO_VISIBLE_LABEL: Record<EstadoVisible, string> = {
  pending: "Pendiente",
  confirmed: "Confirmado",
  completed: "Realizado",
  cancelled: "Cancelado",
  overdue: "Vencido",
};

/**
 * El estado de un turno tal como hay que mostrarlo.
 *
 * Lo vencido se decide ANTES que el estado guardado: es lo único de la agenda
 * que pide que alguien vaya a hacer algo.
 *
 * Un cancelado o un realizado NUNCA vencen — ya están cerrados, que pase la
 * hora no les cambia nada. Sólo vence lo que quedó abierto.
 *
 * `now` en null es «todavía no sé qué hora es», y devuelve el estado guardado
 * sin más. Sirve para el rato entre que el servidor manda el HTML y el navegador
 * lo hidrata: ahí la fecha del servidor está en UTC y a las 23:35 de Argentina
 * allá ya es el día siguiente, así que decidir qué venció daría distinto en cada
 * lado y React se quejaría del cambio.
 */
export function estadoVisible(
  /*
   * Los tres datos del turno van juntos en un objeto y no sueltos como
   * parámetros. Es por una razón concreta: `minutos` y `now` son los dos
   * números, así que sueltos se pueden pasar al revés y TypeScript no dice nada
   * — el turno quedaría durando 1.7 billones de minutos y nunca vencería.
   */
  turno: { status: string; startsAt: string; minutos: number },
  now: number | null,
): EstadoVisible {
  const guardado = toStatus(turno.status);
  if (!guardado) return "pending";

  const abierto = guardado === "pending" || guardado === "confirmed";
  if (abierto && now !== null && yaVencio(turno.startsAt, turno.minutos, now)) return "overdue";

  return guardado;
}

/**
 * ¿Este turno ya pasó y sigue abierto?
 *
 * ── EL CORTE ES CUÁNDO TERMINA, MÁS LA TOLERANCIA ─────────────────────────
 *
 * No cuándo empieza. Ese era el bug: un turno de las 14:50 se marcaba «Vencido»
 * a las 14:50 en punto, con la clienta entrando por la puerta. Un turno que está
 * PASANDO no está vencido — vencido significa "ya terminó y nadie lo cerró",
 * que es una tarea pendiente para alguien; mientras la sesión corre no hay nada
 * que hacer.
 *
 * Es la misma lección que ya estaba aprendida en `miAgenda`, donde el comentario
 * dice textual: "con `starts_at >= now()` el turno de las 14:00 se borraba de la
 * pantalla a las 14:01, con la clienta todavía en la camilla". Acá faltaba.
 *
 * Y encima suma `TOLERANCIA_MINUTOS`, los 10 que el centro promete esperarle a
 * la que llega tarde — en la pantalla de reserva y en el mail de confirmación.
 * Si se le está esperando por escrito, el panel no puede darla por perdida en el
 * mismo minuto: la que llega 9 minutos tarde a un turno de 60 se va a las 15:59,
 * no a las 14:50.
 *
 * 🔴 **Esta es LA definición de «vencido» y no hay otra.** La usan las pantallas
 * (vía `estadoVisible`), el mail de vencidos que le llega al centro
 * (`reminders.service`) y el aviso del panel de métricas. Estuvo escrita por
 * separado en dos lados y se desincronizaron; si cambia, cambia acá y en ningún
 * otro lugar.
 */
export function yaVencio(startsAt: string | Date, minutos: number, now: number): boolean {
  const inicio = typeof startsAt === "string" ? new Date(startsAt).getTime() : startsAt.getTime();
  return inicio + (minutos + TOLERANCIA_MINUTOS) * 60_000 < now;
}

/**
 * Cuántas horas antes puede la CLIENTA tocar su propio turno.
 *
 * Cancelar o reprogramar desde «Mi cuenta» tiene un corte: pasado ese margen, el
 * turno ya no lo mueve ella. Un hueco que se libera dos horas antes no se vuelve
 * a llenar y la profesional se queda con la mañana partida; y si viene una
 * reprogramación sobre la hora, la agenda del día ya está armada.
 *
 * El corte es SÓLO para la clienta. El centro sigue pudiendo mover y cancelar
 * cualquier cosa desde el panel, que es donde se resuelven las excepciones —la
 * que llama por teléfono, la que se descompuso—: ahí hay alguien decidiendo.
 *
 * Vive acá porque lo miran los dos lados: el servidor, que es el que de verdad
 * lo impide, y la pantalla, que apaga el botón y explica por qué. Si estuvieran
 * escritos por separado, el día que cambie el número uno de los dos se olvida.
 */
export const HORAS_PARA_QUE_LA_CLIENTA_TOQUE_SU_TURNO = 6;

/**
 * Le quedan horas de sobra para tocarlo, o ya está encima.
 *
 * `now` en null —todavía no hidrató— devuelve `true`: sin reloj no se puede
 * decidir, y es el servidor el que manda. Apagar el botón en ese rato lo
 * mostraría deshabilitado por un instante en un turno que sí se puede cancelar.
 */
export function laClientaTodaviaPuede(startsAt: string, now: number | null): boolean {
  if (now === null) return true;
  const margen = HORAS_PARA_QUE_LA_CLIENTA_TOQUE_SU_TURNO * 60 * 60 * 1000;
  return new Date(startsAt).getTime() - now >= margen;
}

/**
 * Quién atiende (o atendió) un turno.
 *
 * Son CUATRO situaciones y las pantallas sólo distinguían dos:
 *
 *   asignada     · tiene profesional y sigue atendiendo.
 *   desactivada  · la tiene, pero está dada de baja.
 *   historica    · no tiene ficha, pero sí el nombre congelado: la borraron.
 *   sinAsignar   · no tiene ni ficha ni nombre. Nunca se le asignó a nadie.
 *
 * `historica` no existía, y es la que rompía el historial. Al borrar a una
 * profesional la FK deja `professional_id` en NULL, así que el turno que ESA
 * persona atendió en agosto pasaba a verse idéntico a uno sin asignar: en rojo y
 * pidiendo que se le pusiera alguien. Ponerle alguien hoy sería escribir que la
 * atendió una persona que no la atendió. Por eso el nombre se congela en
 * `appointments.professional_name`, igual que el del tratamiento.
 *
 * `seArregla` es lo otro: dice si todavía tiene sentido pedir que se resuelva.
 * Sólo un turno abierto y por venir se arregla asignando a alguien; uno vencido,
 * realizado o cancelado, no. Es lo que decide si va en rojo o en gris, y sale de
 * `estadoVisible` para que no haya dos criterios de "esto ya pasó".
 *
 * Devuelve la DECISIÓN, no el texto: cada pantalla la escribe como le entra. En
 * la grilla del calendario hay 11px y dos palabras; en la ficha hay un renglón
 * entero.
 */
export type QuienAtiende =
  | { caso: "asignada"; nombre: string }
  | { caso: "desactivada"; nombre: string; seArregla: boolean }
  | { caso: "historica"; nombre: string }
  | { caso: "sinAsignar"; seArregla: boolean };

export function quienAtiende(
  profesional: { full_name: string; is_active: boolean } | null | undefined,
  nombreCongelado: string | null | undefined,
  /* Mismo objeto que `estadoVisible`, y por el mismo motivo. */
  turno: { status: string; startsAt: string; minutos: number },
  now: number | null,
): QuienAtiende {
  const estado = estadoVisible(turno, now);
  const seArregla = estado === "pending" || estado === "confirmed";

  if (profesional?.is_active) return { caso: "asignada", nombre: profesional.full_name };
  if (profesional) return { caso: "desactivada", nombre: profesional.full_name, seArregla };
  if (nombreCongelado) return { caso: "historica", nombre: nombreCongelado };
  return { caso: "sinAsignar", seArregla };
}

/**
 * Un tramo de atención: un día y un rango de horas.
 *
 * Se llama tramo y no "horario" porque un día puede tener más de uno. La base y
 * el buscador de horarios libres siempre lo permitieron —`professional_schedules`
 * no tiene ninguna restricción de un tramo por día, y `buildSlots` recorre todas
 * las ventanas del día—, pero las pantallas los listaban sueltos y un lunes
 * partido se leía como dos lunes distintos.
 */
export type Tramo = { weekday: number; start_time: string; end_time: string };

/**
 * Los tramos agrupados por día, cada día con los suyos en orden de reloj.
 *
 * Es lo que hace que "Lunes 9 a 13" y "Lunes 15 a 17" se muestren como un solo
 * lunes con un corte en el medio, que es como lo piensa quien arma la agenda.
 */
export function agruparPorDia<T extends Tramo>(tramos: T[]): { weekday: number; tramos: T[] }[] {
  const porDia = new Map<number, T[]>();
  for (const t of tramos) {
    porDia.set(t.weekday, [...(porDia.get(t.weekday) ?? []), t]);
  }

  return [...porDia.entries()]
    .sort(([a], [b]) => a - b)
    .map(([weekday, delDia]) => ({
      weekday,
      tramos: [...delDia].sort((a, b) => a.start_time.localeCompare(b.start_time)),
    }));
}

/** "09:00:00" y "09:00" son lo mismo acá: la base devuelve lo primero. */
export function soloHoraYMinutos(hora: string) {
  return hora.slice(0, 5);
}

/**
 * ¿Hay dos tramos del mismo día pisándose? Devuelve el día, o null.
 *
 * Un solapamiento no rompe nada visible —`buildSlots` simplemente ofrece dos
 * veces los mismos horarios—, pero es siempre un error de carga: nadie atiende
 * de 9 a 13 y de 12 a 16 al mismo tiempo. Se avisa al guardar, que es cuando
 * todavía se puede corregir.
 */
export function diaConTramosSuperpuestos(tramos: Tramo[]): number | null {
  for (const { weekday, tramos: delDia } of agruparPorDia(tramos)) {
    for (let i = 1; i < delDia.length; i++) {
      // Ya vienen ordenados por hora de inicio: alcanza con mirar si cada uno
      // arranca antes de que termine el anterior.
      if (delDia[i]!.start_time < delDia[i - 1]!.end_time) return weekday;
    }
  }
  return null;
}

export function formatMoney(value: number | string | null | undefined) {
  const n = Number(value ?? 0);
  return n.toLocaleString("es-AR", {
    style: "currency",
    currency: "ARS",
    maximumFractionDigits: 0,
  });
}

export function formatDateTime(iso: string) {
  // 26/8/2026 — `hourCycle: "h23"` para que diga "14:00" y no "02:00 p. m.".
  // En Argentina un turno se dice con el reloj de 24 horas; el a. m./p. m. es
  // más largo, se lee peor y encima obliga a mirar dos veces cuál de los dos
  // dice. Va `hourCycle` y no `hour12: false` porque son distintos donde
  // importa: `hour12: false` puede caer en el ciclo h24 según la build de ICU
  // y escribir la medianoche como "24:00". `h23` la escribe "00:00" siempre.
  return new Date(iso).toLocaleString("es-AR", {
    weekday: "long",
    day: "2-digit",
    month: "long",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  });
}

export function formatTime(iso: string) {
  // 26/8/2026 — `hourCycle: "h23"` para que diga "14:00" y no "02:00 p. m.".
  // En Argentina un turno se dice con el reloj de 24 horas; el a. m./p. m. es
  // más largo, se lee peor y encima obliga a mirar dos veces cuál de los dos
  // dice. Va `hourCycle` y no `hour12: false` porque son distintos donde
  // importa: `hour12: false` puede caer en el ciclo h24 según la build de ICU
  // y escribir la medianoche como "24:00". `h23` la escribe "00:00" siempre.
  // return new Date(iso).toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit" });
  return new Date(iso).toLocaleTimeString("es-AR", {
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  });
}

export function formatDay(iso: string) {
  return new Date(iso).toLocaleDateString("es-AR", {
    weekday: "long",
    day: "2-digit",
    month: "long",
  });
}

export function toDateKey(date: Date) {
  const y = date.getFullYear();
  const m = `${date.getMonth() + 1}`.padStart(2, "0");
  const d = `${date.getDate()}`.padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/**
 * Un texto convertido en pieza de URL: "Drenaje linfático" → "drenaje-linfatico".
 *
 * Vivía adentro de `servicios.index.tsx` como `categorySlug`, sirviendo para las
 * anclas de categoría. Subió acá cuando la ficha de tratamiento pasó a usar slug
 * en vez de UUID, y ahora la usan tres lados que TIENEN que coincidir: la
 * pantalla, el servidor cuando guarda un tratamiento, y el script que rellenó
 * los slugs viejos. Si cada uno tuviera su copia, el día que una acentúe distinto
 * el enlace apunta a una URL que no existe.
 *
 * Lo que hace, en orden:
 *
 *   · `normalize("NFD")` separa la tilde de la letra —"á" pasa a ser "a" más un
 *     acento suelto— y el reemplazo siguiente descarta el acento. Sin este paso
 *     "á" no es "a" para nadie y terminaría comida por el filtro de abajo.
 *   · todo lo que no sea letra o número queda como guion, y los guiones del
 *     principio y del final se van: "Peeling químico." → "peeling-quimico".
 *
 * ⚠️ Puede devolver "" y eso es correcto, no un error: un nombre escrito sólo
 * con símbolos ("+++") no tiene nada que llevar a la URL. Quien la use para
 * armar una URL tiene que decidir qué pone en ese caso — el servidor cae a
 * "tratamiento", ver `slugLibre` en catalogo.service.ts.
 */
export function aSlug(texto: string): string {
  return texto
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

type Schedule = { weekday: number; start_time: string; end_time: string };
type Busy = {
  starts_at: string;
  duration_minutes: number;
  /**
   * El margen de limpieza DE ESE TURNO, congelado cuando se reservó.
   *
   * No es el del tratamiento que se está por reservar: entre dos turnos manda
   * el del que termina, y el que termina acá es éste. Ver `buildSlots`.
   */
  buffer_minutes: number;
};

/**
 * Un tramo en que una profesional no atiende, con los dos extremos incluidos.
 *
 * Las fechas son "YYYY-MM-DD" y se comparan como texto a propósito: así ordenan
 * igual que como fechas y no hay ninguna zona horaria de por medio. Un día es un
 * día del almanaque del centro; convertirlo a instante sólo agregaría la
 * pregunta de a qué hora empieza, que no tiene sentido acá.
 */
export type Ausencia = { starts_on: string; ends_on: string };

const MINUTE = 60000;

/**
 * ── LAS PERILLAS DE LA AGENDA ───────────────────────────────────────────────
 * Están acá arriba y a la vista porque no son detalles de implementación: son
 * reglas del negocio. El margen de limpieza ya lo definió el centro; el
 * desborde sigue pendiente. Ver TODO.md.
 */

/**
 * El margen de limpieza que se usa cuando el tratamiento no dice otra cosa.
 *
 * DEFINIDO POR EL CENTRO (18/8/2026): 10 minutos entre clienta y clienta. Antes
 * estaba en 0 y los turnos iban pegados — la que entraba 12:45 se cruzaba en la
 * puerta con la que salía.
 *
 * ⚠️ **Ya NO es la regla: es sólo el default.** Desde el 31/8/2026 el margen lo
 * dice cada tratamiento, en `services.buffer_minutes`, porque una depilación
 * deja la cabina para limpiar y un masaje no. Este número es el `@default(10)`
 * de esa columna escrito en TypeScript, y lo que se usa cuando el dato falta:
 * un turno viejo, una fila que entró por fuera de la app.
 *
 * **No lo uses para calcular una agenda.** Eso se hace con el margen del
 * tratamiento; quien lo necesite lo recibe. Ver `buildSlots`.
 */
export const SLOT_BUFFER_MINUTES = 10;

/**
 * ¿Esta profesional está ausente ese día?
 *
 * 🔴 **Ésta es LA definición de "ese día no atiende" y no hay otra.** La usan la
 * pantalla de reserva (vía `buildSlots`), el diálogo del panel y el candado del
 * servidor en `exigirQueEntreEnLaAgenda`. La lección está aprendida: `yaVencio`
 * existe porque la regla de "vencido" se había escrito dos veces y se separaron.
 *
 * Los dos extremos entran: del 15 al 29 son quince días sin trabajar, no
 * catorce. Es como lo lee cualquiera que escriba esas fechas en un papel.
 */
export function estaAusente(dia: Date | string, ausencias: readonly Ausencia[]): boolean {
  const clave = typeof dia === "string" ? dia.slice(0, 10) : toDateKey(dia);
  return ausencias.some((a) => a.starts_on <= clave && clave <= a.ends_on);
}

/**
 * Cuántos minutos espera el centro a una clienta que llega tarde.
 *
 * DEFINIDO POR EL CENTRO (26/8/2026): 10 minutos.
 *
 * ⚠️ **Comparte el número con `SLOT_BUFFER_MINUTES` y no tiene nada que ver con
 * él.** Aquél es el rato de limpieza entre una clienta y la siguiente; éste es
 * cuánto se le espera a la que llega tarde. Que hoy los dos valgan 10 es
 * casualidad, y por eso son dos constantes y no una: el día que el centro
 * decida esperar 15, cambiar un solo número no puede ensanchar también los
 * huecos de la agenda.
 *
 * Se dice en dos lados y los dos importan: en la pantalla de reserva, ANTES de
 * confirmar, y en el mail que le llega después. Que esté escrito de antemano es
 * lo que permite sostenerlo sin discutir el día que alguien llega 20 minutos
 * tarde.
 */
export const TOLERANCIA_MINUTOS = 10;

/**
 * ¿El último turno del día puede terminar después del horario de salida?
 *
 * PENDIENTE, y es LA pregunta para el centro. Con una profesional de 12 a 16,
 * sesiones de 45 minutos y los 10 de limpieza:
 *
 *   false → 12:00, 12:55, 13:50, 14:45   (la última sale 15:30)
 *   true  → ídem + 15:40, que la deja hasta las 16:25
 *
 * Queda en false, que NO es la lista que se pidió —esa incluía las 15:45—, y la
 * razón es en qué dirección duele equivocarse:
 *
 *   En false se ofrece un turno de menos. Se arregla solo: el panel lo puede
 *   cargar igual, porque a propósito no le aplica el control de agenda.
 *
 *   En true una clienta reserva sola, por el sitio, un horario que deja a la
 *   profesional trabajando después de su hora. Eso no se deshace: ya está
 *   comprometido y hay que llamarla para cancelarlo.
 *
 * Además el desborde puede ser grande, porque lo acota la DURACIÓN del
 * tratamiento y no un ratito fijo. Esa misma profesional de 12 a 16, con una
 * depilación de 90, encadena 12:00 y 13:40; en true se le suma 15:20, que
 * termina 16:50 — cincuenta minutos tarde. "Un ratito más" y "casi una hora"
 * son la misma regla, y la regla no sabe distinguirlas.
 *
 * Cuando el centro decida, esto es una sola línea.
 */
export const ALLOW_OVERTIME = false;

/**
 * Los horarios que se le pueden ofrecer a alguien para un tratamiento.
 *
 * Los turnos se ENCADENAN: cada uno arranca cuando termina el anterior, y el
 * paso lo da la duración del tratamiento más su margen de limpieza. Una
 * profesional de 12 a 16, con sesiones de 45 y margen de 10, ofrece 12:00,
 * 12:55, 13:50, 14:45.
 *
 * ── ENTRE DOS TURNOS MANDA EL MARGEN DEL QUE TERMINA ──────────────────────
 *
 * El margen es el rato de limpiar lo que se acaba de usar, así que lo pone el
 * tratamiento de ATRÁS y no el que viene. Se ve en las dos direcciones:
 *
 *   · Después de un turno ya tomado manda el margen DE ESE TURNO
 *     (`b.buffer_minutes`, congelado el día que se reservó). Una depilación de
 *     20 tapa hasta 20 minutos después de terminar, venga lo que venga.
 *   · Antes de un turno ya tomado manda el margen del tratamiento que se está
 *     eligiendo, porque el que termina ahí es él.
 *   · Entre dos horarios sugeridos los dos son el mismo tratamiento, así que
 *     sale del `step` y da igual mirarlo de un lado o del otro.
 *
 * Hasta el 31/8/2026 esto era un solo número para todo el catálogo
 * (`SLOT_BUFFER_MINUTES`), y por eso el bloque ocupado se ensanchaba igual de
 * los dos lados.
 *
 * ── LOS DÍAS QUE NO ESTÁ ──────────────────────────────────────────────────
 *
 * Se descartan enteros, antes de cualquier cuenta: no hay medio día ausente. El
 * horario semanal dice "los martes de 12 a 16" y la ausencia es la excepción que
 * lo tapa. Ver `estaAusente`.
 *
 * Antes esto caminaba una grilla fija de 30 minutos y descartaba lo que pisara
 * un turno. El problema no era estético: tomadas las 12:00, la sesión terminaba
 * 12:45, pero la grilla sólo conocía 12:30 (pisado) y 13:00 — las 12:45 no se
 * ofrecían nunca y esos 15 minutos se perdían. Repetido toda la tarde, entraban
 * cuatro clientas donde entran cinco.
 *
 * Lo que ocupa la agenda es el TURNO, no el servicio: los bloques ocupados
 * llegan de professional_busy_slots(), que devuelve todos los de esa
 * profesional sin importar de qué tratamiento sean. Por eso un masaje tomado a
 * las 12:00 tapa también la depilación de las 12:00, y la de 90 minutos se
 * reacomoda al primer hueco donde entre entera.
 *
 * Es una ayuda para elegir, no el candado: quien decide si el turno se puede
 * crear es la base (validate_appointment y check_appointment_overlap).
 */
export function buildSlots(
  date: Date,
  schedules: Schedule[],
  busy: Busy[],
  /*
   * Los dos números del tratamiento van juntos en un objeto y no sueltos, por
   * el mismo motivo que en `estadoVisible`: `minutos` y `margen` son los dos
   * números y sueltos se pueden pasar al revés sin que TypeScript diga nada.
   * Una sesión de 10 minutos con 45 de limpieza no se distingue de una de 45
   * con 10 mirando la llamada; agrupados, no se puede escribir mal.
   */
  tratamiento: { minutos: number; margen: number },
  ausencias: readonly Ausencia[],
): string[] {
  const weekday = date.getDay();
  const daySchedules = schedules.filter((s) => s.weekday === weekday);
  if (daySchedules.length === 0 || tratamiento.minutos <= 0) return [];

  // El día que no está no se ofrece, aunque su horario semanal lo tenga.
  if (estaAusente(date, ausencias)) return [];

  const now = Date.now();
  const step = (tratamiento.minutos + tratamiento.margen) * MINUTE;

  // Cada bloque ocupado se ensancha, pero NO con el mismo número de los dos
  // lados: manda siempre el margen del tratamiento que termina. Ver el bloque
  // del comentario de arriba.
  const blocked = busy
    .map((b) => {
      const from = new Date(b.starts_at).getTime();
      return {
        // Antes del turno ocupado el que termina es el que se está eligiendo.
        from: from - tratamiento.margen * MINUTE,
        // Después, el que termina es el turno ocupado, con SU margen.
        to: from + (b.duration_minutes + b.buffer_minutes) * MINUTE,
      };
    })
    .sort((a, b) => a.from - b.from);

  const windows = daySchedules.map((s) => ({
    from: atTime(date, s.start_time),
    to: atTime(date, s.end_time),
  }));

  // El desborde vale sólo al cierre del día, nunca en un corte del medio. Si la
  // profesional trabaja 09–13 y 16–20, estirarse a las 13 no es quedarse un
  // rato más: es comerle el almuerzo.
  const closing = Math.max(...windows.map((w) => w.to));

  const slots: string[] = [];

  for (const window of windows) {
    for (const gap of freeGaps(window, blocked)) {
      // Sólo el hueco que llega hasta la hora de salida puede desbordar. Contra
      // otro turno no hay desborde posible: ese tiempo es de otra clienta.
      const canOverrun = ALLOW_OVERTIME && gap.to === closing;

      for (let start = gap.from; ; start += step) {
        const fits = canOverrun ? start < gap.to : start + tratamiento.minutos * MINUTE <= gap.to;
        if (!fits) break;
        // Los horarios ya pasados no se ofrecen, ni siquiera los de esta mañana
        // cuando se mira el día de hoy a la tarde.
        if (start > now) slots.push(new Date(start).toISOString());
      }
    }
  }

  return slots.sort();
}

/**
 * Los tramos libres de una franja de atención, ya descontados los turnos.
 *
 * Es el corazón del encadenado: en vez de probar una grilla contra los turnos,
 * se calculan los huecos reales y cada uno arranca su propia cadena. Por eso el
 * primer horario libre después de un turno es el instante en que ese turno
 * termina, y no el próximo número redondo.
 */
function freeGaps(
  window: { from: number; to: number },
  blocked: readonly { from: number; to: number }[],
): { from: number; to: number }[] {
  const gaps: { from: number; to: number }[] = [];
  let cursor = window.from;

  for (const block of blocked) {
    if (block.to <= cursor) continue; // ya quedó atrás
    if (block.from >= window.to) break; // los que siguen son de después
    if (block.from > cursor) gaps.push({ from: cursor, to: block.from });
    // Math.max y no block.to a secas: dos bloques encimados dejarían el cursor
    // yendo para atrás. La base no debería permitirlos, pero esto no depende de
    // eso para no devolver horarios ocupados.
    cursor = Math.max(cursor, block.to);
    if (cursor >= window.to) break;
  }

  if (cursor < window.to) gaps.push({ from: cursor, to: window.to });
  return gaps;
}

/** "13:30:00" sobre un día → el instante exacto, en hora local. */
function atTime(date: Date, time: string): number {
  const [h = 0, m = 0] = time.split(":").map(Number);
  const value = new Date(date);
  value.setHours(h, m, 0, 0);
  return value.getTime();
}
