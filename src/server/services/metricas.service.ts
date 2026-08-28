import { prisma } from "@/server/db";
import { normalizarTelefono } from "@/server/services/agenda.service";
import { enHoraDelCentro } from "@/server/services/turnos.service";
import type { FilaConTotal, RtaMetricas } from "@/lib/api-tipos";

/**
 * Los números del negocio: el Dashboard y la sección Métricas.
 *
 * ── UNA SOLA FUNCIÓN PARA LAS DOS PANTALLAS ───────────────────────────────
 *
 * `calcularMetricas` devuelve todo y cada pantalla dibuja lo que le toca. El
 * Dashboard NO es una consulta más liviana: es el mismo cálculo mirado de
 * cerca, con el rango puesto en el mes en curso. Partirlo en dos endpoints
 * dejaba dos definiciones de "facturado" que el día que alguien tocara una se
 * irían separando en silencio — y dos pantallas que dicen números distintos de
 * lo mismo son peores que no tenerlas.
 *
 * ── POR QUÉ SE CALCULA EN MEMORIA Y NO EN SQL ─────────────────────────────
 *
 * Casi todo esto se podría pedir con GROUP BY. No se hace, y es una decisión
 * con fecha de vencimiento explícita:
 *
 *   · Varias métricas se agrupan por HORA DE PARED DE BUENOS AIRES, no por el
 *     instante UTC que guarda la columna. En SQL eso es `AT TIME ZONE` en cada
 *     agrupación; acá es `enHoraDelCentro`, que ya existe y ya está probada
 *     contra la validación de horarios.
 *   · La identidad de una clienta NO es una columna: es `client_id`, y si es
 *     invitada, el teléfono normalizado. Agrupar por eso en SQL pide un índice
 *     de expresión y bajar a `$queryRaw`.
 *   · Es un centro de estética. Son miles de turnos en años, no millones.
 *
 * 🔴 **El día que `appointments` pase de ~50.000 filas esto hay que mirarlo de
 * nuevo.** Lo que primero se va a sentir es `identidadesDeSiempre`, la única
 * consulta que lee la tabla entera. Está aislada justamente para eso, y el
 * comentario de arriba de ella explica por qué no puede respetar el rango.
 */

/**
 * Estados que cuentan como "esto pasó".
 *
 * ⚠️ **Todo lo que diga plata cobrada o cantidad de visitas usa esto y nada
 * más.** No es una sutileza: un turno confirmado para la semana que viene no
 * facturó nada y no es una visita, y contarlo hace que el panel diga que una
 * clienta "vino 2 veces" por turnos que todavía no ocurrieron. Estuvo mal
 * escrito así —contaba todo lo no cancelado— y se veía enseguida: la lista de
 * frecuentes no cerraba con la tarjeta de facturado, que sí miraba `completed`.
 *
 * Lo que SÍ cuenta turnos abiertos, a propósito y cada uno con su motivo:
 *
 *   · `plata.agendado` — es justamente "lo que viene, sin cobrar".
 *   · `agenda.ocupacion` — mide agenda ocupada, no plata: un turno confirmado
 *     bloquea el horario aunque todavía no haya pasado.
 *   · `agenda.mapaDiaHora` — mide cuándo QUIEREN venir, así que entran hasta los
 *     cancelados.
 */
const REALIZADOS = ["completed"] as const;

/** Estados de un turno que todavía va a pasar. */
const ABIERTOS = ["pending", "confirmed"] as const;

/**
 * Cuántas visitas hacen a una clienta "habitual", para la lista de en riesgo.
 *
 * Con dos no alcanza: alguien que vino dos veces hace medio año puede no haber
 * sido nunca una clienta del centro. Tres es donde empieza a ser una costumbre
 * que se rompió, que es lo que la lista quiere encontrar.
 */
const VISITAS_PARA_SER_HABITUAL = 3;

/** A partir de cuántos días sin venir una habitual entra en la lista de riesgo. */
const DIAS_PARA_ESTAR_EN_RIESGO = 60;

/**
 * Quién es la clienta de un turno, para contar visitas.
 *
 * No es una columna: una clienta con cuenta es su `client_id`, y una invitada es
 * su teléfono normalizado — el mismo criterio que usa `vincularTurnosDeInvitada`
 * para juntarle los turnos cuando se registra. Sin esto, la señora que vino seis
 * veces sin cuenta cuenta como seis clientas nuevas y las métricas de retención
 * dicen exactamente lo contrario de lo que pasa.
 *
 * Devuelve null cuando no hay ni cuenta ni teléfono: ese turno no se puede
 * atribuir a nadie y queda afuera de las métricas de clientas (sigue contando
 * para la plata y para la ocupación, que no preguntan de quién es).
 */
function identidadDeLaClienta(t: {
  client_id: string | null;
  guest_phone: string | null;
}): string | null {
  if (t.client_id) return `cuenta:${t.client_id}`;
  const telefono = normalizarTelefono(t.guest_phone);
  return telefono ? `tel:${telefono}` : null;
}

/** "2026-08", en hora del centro. */
function claveDeMes(instante: Date): string {
  return enHoraDelCentro(instante).fecha.slice(0, 7);
}

function redondear(valor: number, decimales = 0): number {
  const f = 10 ** decimales;
  return Math.round(valor * f) / f;
}

/**
 * Ordena de mayor a menor y corta. Se usa en los cuatro rankings.
 *
 * El corte no es decorativo: un ranking de 40 tratamientos no es un ranking, es
 * la tabla otra vez. Lo que se quiere saber es cuáles son los que mueven la
 * aguja.
 */
function ranking<T>(filas: T[], valor: (f: T) => number, cuantas = 8): T[] {
  return [...filas].sort((a, b) => valor(b) - valor(a)).slice(0, cuantas);
}

/**
 * La historia completa de cada clienta: primera visita, última, cuántas y cómo
 * se llama.
 *
 * ⚠️ Es la única consulta que ignora el rango, y no puede no hacerlo: para saber
 * si una clienta que vino en agosto es NUEVA hay que saber si vino alguna vez
 * antes de agosto. Acotada al rango, todas las clientas de cualquier período dan
 * "nuevas" y la métrica miente al 100%. Lo mismo con "hace cuánto que no viene":
 * se mide contra su último turno real, que puede ser de hace dos años.
 *
 * Trae el nombre y el teléfono además de las fechas porque los necesita la lista
 * de clientas en riesgo, y esa gente por definición NO está en el rango —no se
 * la puede nombrar con los datos del período—. Estuvo un rato siendo una segunda
 * consulta igual de pesada al lado de ésta: dos escaneos completos de
 * `appointments` para armar un panel. Es una sola.
 *
 * 🔴 Es la que hay que cambiar primero si algún día esto pesa. Ver la nota de
 * arriba del archivo.
 */
type HistoriaDeClienta = {
  primera: Date;
  ultima: Date;
  visitas: number;
  nombre: string;
  telefono: string | null;
};

async function identidadesDeSiempre(): Promise<Map<string, HistoriaDeClienta>> {
  const todos = await prisma.appointments.findMany({
    // SÓLO los realizados. "Vino 4 veces" tiene que significar que vino: un turno
    // agendado para la semana que viene no es una visita, y contarlo hacía que
    // una clienta con un turno futuro apareciera entre las frecuentes por algo
    // que todavía no pasó. Ver la nota de `REALIZADOS`.
    where: { status: { in: [...REALIZADOS] } },
    select: {
      client_id: true,
      guest_phone: true,
      guest_name: true,
      starts_at: true,
      client: { select: { profile: { select: { full_name: true, phone: true } } } },
    },
    // Ascendente para que el último que se procesa de cada clienta sea el más
    // reciente: así el nombre y el teléfono que quedan son los últimos que dejó,
    // que es lo que sirve para escribirle hoy.
    orderBy: { starts_at: "asc" },
  });

  const historia = new Map<string, HistoriaDeClienta>();
  for (const t of todos) {
    const id = identidadDeLaClienta(t);
    if (!id) continue;

    const nombre = t.client?.profile?.full_name ?? t.guest_name ?? "Sin nombre";
    const telefono = t.client?.profile?.phone ?? t.guest_phone;

    const previo = historia.get(id);
    if (!previo) {
      historia.set(id, { primera: t.starts_at, ultima: t.starts_at, visitas: 1, nombre, telefono });
      continue;
    }
    previo.visitas += 1;
    if (t.starts_at < previo.primera) previo.primera = t.starts_at;
    if (t.starts_at >= previo.ultima) {
      previo.ultima = t.starts_at;
      previo.nombre = nombre;
      previo.telefono = telefono;
    }
  }
  return historia;
}

/**
 * Cuántos minutos de agenda tiene cada profesional en el rango.
 *
 * Es el denominador de la ocupación, y por eso no puede salir de los turnos: si
 * saliera de ahí, una profesional con un solo turno en toda la semana daría 100%
 * de ocupación. Sale de `professional_schedules`, que es lo que el centro dijo
 * que iba a estar abierto.
 *
 * Se recorre día por día en hora del centro porque un rango de un mes son 30
 * vueltas: contar los lunes con aritmética de fechas es más corto de escribir y
 * más fácil de tener mal cuando el rango no empieza un lunes.
 */
function minutosDisponibles(
  horarios: { weekday: number; start_time: Date; end_time: Date }[],
  desde: Date,
  hasta: Date,
): number {
  // Los minutos que cubre cada día de la semana, sumados una sola vez.
  const porDia = new Map<number, number>();
  for (const h of horarios) {
    // Un @db.Time viaja como Date en el epoch y en UTC: lo que vale es la hora.
    const inicio = h.start_time.getUTCHours() * 60 + h.start_time.getUTCMinutes();
    const fin = h.end_time.getUTCHours() * 60 + h.end_time.getUTCMinutes();
    porDia.set(h.weekday, (porDia.get(h.weekday) ?? 0) + Math.max(fin - inicio, 0));
  }

  let total = 0;
  // Se avanza de a un día desde el arranque del rango. `enHoraDelCentro` decide
  // qué día de la semana es cada fecha, que es lo mismo que decide si un turno
  // entra en la agenda: los dos lados usan el mismo reloj.
  for (let t = desde.getTime(); t < hasta.getTime(); t += 24 * 60 * 60 * 1000) {
    const { diaDeLaSemana } = enHoraDelCentro(new Date(t));
    total += porDia.get(diaDeLaSemana) ?? 0;
  }
  return total;
}

export async function calcularMetricas(desde: Date, hasta: Date): Promise<RtaMetricas> {
  const ahora = new Date();

  const [turnos, profesionales, historia] = await Promise.all([
    prisma.appointments.findMany({
      where: { starts_at: { gte: desde, lt: hasta } },
      select: {
        id: true,
        starts_at: true,
        created_at: true,
        duration_minutes: true,
        status: true,
        price: true,
        service_name: true,
        service: { select: { name: true } },
        professional_id: true,
        professional_name: true,
        professional: { select: { full_name: true } },
        cancel_reason: true,
        client_id: true,
        guest_name: true,
        guest_phone: true,
        client: { select: { profile: { select: { full_name: true, phone: true } } } },
      },
      orderBy: { starts_at: "asc" },
    }),
    prisma.professionals.findMany({
      where: { is_active: true },
      select: {
        id: true,
        full_name: true,
        schedules: { select: { weekday: true, start_time: true, end_time: true } },
      },
    }),
    identidadesDeSiempre(),
  ]);

  const realizados = turnos.filter((t) => (REALIZADOS as readonly string[]).includes(t.status));
  const abiertos = turnos.filter(
    (t) => (ABIERTOS as readonly string[]).includes(t.status) && t.starts_at >= ahora,
  );
  const cancelados = turnos.filter((t) => t.status === "cancelled");

  // Los que ya pasaron y siguen abiertos. El corte es cuándo TERMINAN, igual que
  // en "mi agenda": un turno de las 14:00 que dura una hora no está vencido a
  // las 14:05, está pasando.
  const vencidos = turnos.filter(
    (t) =>
      (ABIERTOS as readonly string[]).includes(t.status) &&
      t.starts_at.getTime() + t.duration_minutes * 60_000 < ahora.getTime(),
  );

  const facturado = realizados.reduce((suma, t) => suma + t.price.toNumber(), 0);
  const agendado = abiertos.reduce((suma, t) => suma + t.price.toNumber(), 0);

  // ── Plata ────────────────────────────────────────────────────────────────

  // Los rankings de plata se arman SÓLO con los realizados: un turno cancelado
  // no facturó nada, y contarlo haría que el tratamiento que más se cancela
  // parezca el que más vende.
  const porTratamiento = new Map<string, { cantidad: number; total: number }>();
  const porProfesional = new Map<string, { cantidad: number; total: number }>();
  const porMes = new Map<string, { facturado: number; turnos: number }>();

  for (const t of realizados) {
    // El nombre congelado manda sobre el del catálogo: es el que tenía el
    // tratamiento el día que se dio, y es lo que deja que un tratamiento
    // borrado siga contando en el historial en vez de desaparecer.
    const tratamiento = t.service_name ?? t.service?.name ?? "Sin tratamiento";
    const profesional = t.professional_name ?? t.professional?.full_name ?? "Sin asignar";
    const mes = claveDeMes(t.starts_at);
    const monto = t.price.toNumber();

    const a = porTratamiento.get(tratamiento) ?? { cantidad: 0, total: 0 };
    porTratamiento.set(tratamiento, { cantidad: a.cantidad + 1, total: a.total + monto });

    const b = porProfesional.get(profesional) ?? { cantidad: 0, total: 0 };
    porProfesional.set(profesional, { cantidad: b.cantidad + 1, total: b.total + monto });

    const c = porMes.get(mes) ?? { facturado: 0, turnos: 0 };
    porMes.set(mes, { facturado: c.facturado + monto, turnos: c.turnos + 1 });
  }

  // ── Agenda ───────────────────────────────────────────────────────────────

  // Ocupación: los minutos que se vendieron sobre los que estaban abiertos. Los
  // cancelados NO cuentan como vendidos —ese hueco quedó libre— pero el
  // denominador no cambia, que es justamente lo que hace que cancelar se vea.
  const minutosPorProfesional = new Map<string, number>();
  for (const t of turnos) {
    if (t.status === "cancelled" || !t.professional_id) continue;
    minutosPorProfesional.set(
      t.professional_id,
      (minutosPorProfesional.get(t.professional_id) ?? 0) + t.duration_minutes,
    );
  }

  const ocupacion = profesionales
    .map((p) => {
      const disponibles = minutosDisponibles(p.schedules, desde, hasta);
      const vendidos = minutosPorProfesional.get(p.id) ?? 0;
      return {
        nombre: p.full_name,
        minutosVendidos: vendidos,
        minutosDisponibles: disponibles,
        // Sin horarios cargados el porcentaje sería una división por cero. Se
        // devuelve 0 y la pantalla lo distingue mirando `minutosDisponibles`:
        // "0% ocupada" y "sin horarios cargados" son cosas muy distintas.
        porcentaje: disponibles > 0 ? redondear((vendidos / disponibles) * 100, 1) : 0,
      };
    })
    .sort((a, b) => b.porcentaje - a.porcentaje);

  // El mapa de día × hora: cuándo pide turno la gente. Entran los cancelados a
  // propósito — la pregunta acá es cuándo QUIEREN venir, para decidir horarios
  // de apertura, y una cancelación no borra que ese horario se pidió.
  const mapa = new Map<string, number>();
  for (const t of turnos) {
    const { diaDeLaSemana, minutosDelDia } = enHoraDelCentro(t.starts_at);
    const clave = `${diaDeLaSemana}:${Math.floor(minutosDelDia / 60)}`;
    mapa.set(clave, (mapa.get(clave) ?? 0) + 1);
  }

  // Anticipación: cuántos días antes reservan. Sólo sobre los que no canceló
  // nadie, y sólo positivos: un turno cargado por el centro para hoy a la tarde
  // da 0, y uno cargado después de que pasó (se registra a mano lo que ya se
  // atendió) daría negativo y ensuciaría el promedio.
  const anticipaciones = turnos
    .filter((t) => t.status !== "cancelled")
    .map((t) => (t.starts_at.getTime() - t.created_at.getTime()) / (24 * 60 * 60 * 1000))
    .filter((d) => d >= 0);

  // ── Clientas ─────────────────────────────────────────────────────────────

  type Acumulado = {
    nombre: string;
    telefono: string | null;
    visitas: number;
    total: number;
    ultima: Date;
  };
  const porClienta = new Map<string, Acumulado>();
  const nuevasPorMes = new Map<string, { nuevas: number; repetidas: number }>();
  const yaContadaEsteMes = new Set<string>();

  for (const t of realizados) {
    const id = identidadDeLaClienta(t);
    if (!id) continue;

    const nombre = t.client?.profile?.full_name ?? t.guest_name ?? "Sin nombre";
    const telefono = t.client?.profile?.phone ?? t.guest_phone;

    const previo = porClienta.get(id);
    if (previo) {
      previo.visitas += 1;
      previo.total += t.price.toNumber();
      if (t.starts_at > previo.ultima) previo.ultima = t.starts_at;
    } else {
      porClienta.set(id, {
        nombre,
        telefono,
        visitas: 1,
        total: t.price.toNumber(),
        ultima: t.starts_at,
      });
    }

    // Nuevas vs. que vuelven, contando CLIENTAS y no turnos: si viene tres veces
    // en el mes es una clienta, no tres. Por eso el Set, que además se llavea
    // por mes — la misma clienta puede contar como "repetida" en marzo y en
    // abril, y eso es correcto.
    const mes = claveDeMes(t.starts_at);
    const llave = `${mes}|${id}`;
    if (!yaContadaEsteMes.has(llave)) {
      yaContadaEsteMes.add(llave);
      const conteo = nuevasPorMes.get(mes) ?? { nuevas: 0, repetidas: 0 };
      // Es nueva si su primer turno de TODA la historia cae en este mismo mes.
      // De ahí sale `identidadesDeSiempre`: con los datos del rango solo, esto
      // daría siempre "nueva".
      const primera = historia.get(id)?.primera;
      const esNueva = primera ? claveDeMes(primera) === mes : true;
      if (esNueva) conteo.nuevas += 1;
      else conteo.repetidas += 1;
      nuevasPorMes.set(mes, conteo);
    }
  }

  // En riesgo: habituales que dejaron de venir y que NO tienen nada agendado.
  // Sin esa segunda condición la lista se llena de clientas que vuelven el
  // jueves, y una lista así se deja de leer a la semana.
  const conTurnoFuturo = new Set<string>();
  const futuros = await prisma.appointments.findMany({
    where: { starts_at: { gte: ahora }, status: { in: [...ABIERTOS] } },
    select: { client_id: true, guest_phone: true },
  });
  for (const t of futuros) {
    const id = identidadDeLaClienta(t);
    if (id) conTurnoFuturo.add(id);
  }

  const enRiesgo = [...historia.entries()]
    .filter(([id]) => !conTurnoFuturo.has(id))
    .map(([id, h]) => {
      const dias = Math.floor((ahora.getTime() - h.ultima.getTime()) / (24 * 60 * 60 * 1000));
      return { id, ...h, dias };
    })
    .filter((c) => c.dias >= DIAS_PARA_ESTAR_EN_RIESGO);

  const motivos = new Map<string, number>();
  for (const t of cancelados) {
    const motivo = t.cancel_reason?.trim() || "Sin motivo anotado";
    motivos.set(motivo, (motivos.get(motivo) ?? 0) + 1);
  }

  // ── Próximos turnos ──────────────────────────────────────────────────────

  // Ignoran el rango a propósito: la pregunta del Dashboard es "qué viene
  // ahora", y eso no cambia porque alguien esté mirando las métricas de marzo.
  const proximos = await prisma.appointments.findMany({
    where: { starts_at: { gte: ahora }, status: { in: [...ABIERTOS] } },
    orderBy: { starts_at: "asc" },
    take: 8,
    select: {
      id: true,
      starts_at: true,
      status: true,
      service_name: true,
      service: { select: { name: true } },
      professional_name: true,
      professional: { select: { full_name: true } },
      guest_name: true,
      client: { select: { profile: { select: { full_name: true } } } },
    },
  });

  return {
    rango: { desde: desde.toISOString(), hasta: hasta.toISOString() },
    plata: {
      facturado: redondear(facturado, 2),
      agendado: redondear(agendado, 2),
      ticketPromedio: realizados.length > 0 ? redondear(facturado / realizados.length, 2) : 0,
      turnosRealizados: realizados.length,
      porTratamiento: ranking(
        [...porTratamiento].map(([nombre, v]) => ({ nombre, ...v })),
        (f) => f.total,
      ),
      porProfesional: ranking(
        [...porProfesional].map(([nombre, v]) => ({ nombre, ...v })),
        (f) => f.total,
      ),
      porMes: [...porMes]
        .map(([mes, v]) => ({ mes, ...v }))
        .sort((a, b) => a.mes.localeCompare(b.mes)),
    },
    agenda: {
      ocupacion,
      mapaDiaHora: [...mapa].map(([clave, cantidad]) => {
        const [dia = 0, hora = 0] = clave.split(":").map(Number);
        return { dia, hora, cantidad };
      }),
      anticipacionPromedioDias:
        anticipaciones.length > 0
          ? redondear(anticipaciones.reduce((a, b) => a + b, 0) / anticipaciones.length, 1)
          : null,
    },
    clientas: {
      frecuentes: ranking(
        [...porClienta.values()].map((c) => ({
          nombre: c.nombre,
          telefono: c.telefono,
          visitas: c.visitas,
          ultima: c.ultima.toISOString(),
          total: redondear(c.total, 2),
        })),
        (c) => c.visitas,
      ),
      nuevasPorMes: [...nuevasPorMes]
        .map(([mes, v]) => ({ mes, ...v }))
        .sort((a, b) => a.mes.localeCompare(b.mes)),
      enRiesgo: ranking(
        enRiesgo
          // El corte por visitas va acá y no antes porque `enRiesgo` ya filtró
          // por días y por no tener turno agendado: así las tres condiciones de
          // "se está yendo" quedan a la vista una abajo de la otra.
          .filter((c) => c.visitas >= VISITAS_PARA_SER_HABITUAL)
          .map((c) => ({
            nombre: c.nombre,
            telefono: c.telefono,
            visitas: c.visitas,
            ultima: c.ultima.toISOString(),
            diasSinVenir: c.dias,
          })),
        (c) => c.visitas,
        12,
      ),
      cancelacion: {
        total: turnos.length,
        canceladas: cancelados.length,
        porcentaje: turnos.length > 0 ? redondear((cancelados.length / turnos.length) * 100, 1) : 0,
        motivos: ranking(
          [...motivos].map(([motivo, cantidad]) => ({ motivo, cantidad })),
          (m) => m.cantidad,
        ),
      },
    },
    alertas: {
      vencidosSinCerrar: vencidos.length,
      montoSinCerrar: redondear(
        vencidos.reduce((suma, t) => suma + t.price.toNumber(), 0),
        2,
      ),
    },
    proximosTurnos: proximos.map((t) => ({
      id: t.id,
      empiezaEn: t.starts_at.toISOString(),
      tratamiento: t.service_name ?? t.service?.name ?? "Sin tratamiento",
      clienta: t.client?.profile?.full_name ?? t.guest_name,
      profesional: t.professional_name ?? t.professional?.full_name ?? null,
      estado: t.status,
    })),
  };
}
