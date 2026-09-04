import type { Prisma } from "@prisma/client";
import { prisma } from "@/server/db";
import {
  deliverAppointmentEmail,
  deliverAppointmentWhatsapp,
  deliverOverdueDigest,
  transporteWhatsapp,
} from "@/lib/notifications.server";
import type { TurnoVencido } from "@/lib/notifications";
import { yaVencio } from "@/lib/shiraf";

/**
 * El recordatorio del día antes.
 *
 * Es el único de los cuatro avisos que no lo dispara nadie: los otros tres salen
 * de una acción concreta —el centro confirma, el centro cancela, una clienta
 * reserva— y este tiene que ocurrir porque pasó el tiempo. Necesita, entonces,
 * algo que lo llame solo.
 *
 * ── POR QUÉ ESTO DEJÓ DE SER UN ENDPOINT CON UN SECRETO ───────────────────
 *
 * Hasta la salida de Supabase, "algo que lo llame solo" tenía que venir de
 * afuera: no había proceso nuestro donde poner un reloj. Lo disparaba `pg_cron`
 * desde la base, por HTTP, contra `POST /api/recordatorios`; y como quien llama
 * desde afuera no tiene sesión, hubo que inventarle un secreto en un header.
 *
 * Ese secreto nunca fue una decisión de diseño: era el precio de no tener
 * proceso. Ahora la app **es** un proceso —`node .output/server/index.mjs`, un
 * solo contenedor— así que el reloj vive adentro, como en `Ecommerce_mm`
 * (`services/cron.service.js`). Con eso se fueron tres cosas: la variable
 * `REMINDERS_SECRET` —sin la cual el compose ni arrancaba—, el crontab del VPS
 * que había que acordarse de escribir, y un endpoint público que mandaba mails a
 * clientas reales.
 *
 * ── A QUIÉN LE TOCA ────────────────────────────────────────────────────────
 *
 * A quien tiene un turno CONFIRMADO mañana y todavía no recibió el aviso.
 *
 * "Mañana", el día entero, y no "dentro de 24 horas". La diferencia importa: con
 * una ventana móvil de 24hs, la tarea tiene que correr cada hora y con la
 * ventana justa, y cualquier corrida que se saltee deja gente sin aviso para
 * siempre. Con "los turnos de mañana" alcanza con que corra una vez al día a la
 * mañana, y si un día no corrió, la del día siguiente no puede arreglarlo —
 * pero tampoco manda un recordatorio a destiempo, que es peor.
 *
 * Los pendientes quedan afuera a propósito: un turno sin confirmar no es un
 * turno, y recordarle a alguien que venga a algo que el centro todavía no
 * aceptó es prometer un horario que puede no existir.
 */

/** Argentina no tiene horario de verano desde 2009, así que el offset es fijo. */
const AR_OFFSET = "-03:00";
const TIMEZONE = "America/Argentina/Buenos_Aires";

/**
 * A las 10 y otra vez a las 13, hora de Buenos Aires.
 *
 * ── LA SEGUNDA PASADA NO MANDA NADA DOS VECES ─────────────────────────────
 *
 * `reminded_at` hace la corrida idempotente: quien ya recibió el aviso queda
 * fuera de la consulta. O sea que si la de las 10 anduvo, la de las 13 encuentra
 * cero turnos y no escribe ni un mail.
 *
 * Está para cubrir lo que el crontab del VPS no cubría: si a las 10 en punto el
 * contenedor estaba reiniciándose —un deploy, un reinicio del VPS—, ese día se
 * perdía entero y nadie se enteraba hasta que una clienta no venía. Sale gratis
 * y tapa el único agujero real de programarlo una sola vez al día.
 *
 * La zona horaria va declarada acá y no depende del reloj del servidor, que
 * corre en UTC. Es lo que se acabó al salir del crontab: antes había que
 * escribir la hora convertida y acordarse de por qué estaba corrida.
 */
const CUANDO = "0 10,13 * * *";

/**
 * El resumen de vencidos: UNA vez por día, a las 10.
 *
 * Va en su propio reloj y no pegado al de arriba, y el motivo es que no es
 * idempotente: los recordatorios se marcan con `reminded_at` y por eso la
 * segunda pasada no manda nada, pero este resumen se armaría igual a las 13 y
 * el centro recibiría dos mails idénticos por día. Uno alcanza.
 */
const CUANDO_VENCIDOS = "0 10 * * *";

/**
 * Cuántos días para atrás mira el resumen.
 *
 * No es "todos los que quedaron abiertos alguna vez": con una semana el mail se
 * mantiene corto y accionable. Un turno de hace tres meses que nadie cerró no se
 * va a cerrar porque lo repitamos todos los días — lo único que hace es
 * convertir el mail en ruido y que se archive sin leer, incluido el día que sí
 * hay algo para hacer. Los viejos siguen a la vista en el panel, con su cartel
 * de «Vencido».
 */
const DIAS_DE_VENCIDOS = 7;

/** Cuántos se nombran en el mail. El resto se cuenta al final. */
const MAXIMO_EN_EL_MAIL = 15;

/**
 * El día de mañana en Buenos Aires, como par de instantes.
 *
 * El servidor corre en UTC, así que "mañana" según su reloj y "mañana" según el
 * centro son días distintos entre las 21 y la medianoche. Se resuelve pidiéndole
 * la fecha al formateador con el huso puesto, y recién ahí armando los límites.
 *
 * `en-CA` no es un capricho: es el único locale que devuelve la fecha en
 * AAAA-MM-DD, que es lo que hay que concatenar.
 *
 * Se exporta porque «los turnos de mañana» lo miran DOS cosas: esta tarea, que
 * manda el mail sola, y la pantalla de Avisos, desde donde alguien del centro
 * dispara el WhatsApp a mano. Si cada una calculara su propio "mañana", entre
 * las 21 y la medianoche la pantalla mostraría un día y el mail saldría por
 * otro, y nadie entendería por qué.
 */
export function tomorrowInBuenosAires(): { from: string; to: string; day: string } {
  const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000);
  const day = tomorrow.toLocaleDateString("en-CA", { timeZone: TIMEZONE });
  return {
    from: `${day}T00:00:00${AR_OFFSET}`,
    to: `${day}T23:59:59.999${AR_OFFSET}`,
    day,
  };
}

export type ReminderRun = {
  /** El día que se procesó, en AAAA-MM-DD y hora de Buenos Aires. */
  day: string;
  /** Turnos que entraron en la corrida. */
  found: number;
  /** Cuántos avisos salieron. */
  sent: number;
  /** Los que no salieron, con el motivo. Casi siempre: sin mail cargado. */
  skipped: { id: string; reason: string }[];
};

export async function runDailyReminders(): Promise<ReminderRun> {
  const { from, to } = tomorrowInBuenosAires();

  // Esta consulta es la que cubre el índice parcial
  // `appointments_pending_reminder_idx` de prisma/sql/reglas.sql: confirmados
  // de un día que todavía no recibieron el aviso. Si se le cambian las
  // condiciones, mirá si el índice sigue sirviendo.
  const appointments = await prisma.appointments.findMany({
    where: {
      status: "confirmed",
      reminded_at: null,
      starts_at: { gte: new Date(from), lte: new Date(to) },
    },
    select: { id: true },
    orderBy: { starts_at: "asc" },
  });
  const skipped: { id: string; reason: string }[] = [];
  let sent = 0;

  // Se pregunta UNA vez por corrida y no por turno: las variables de entorno no
  // cambian mientras el proceso vive. Sirve para dos cosas, las dos de log —
  // callar el "no está configurado" repetido treinta veces, y que el día que el
  // canal se encienda sus fallas se vean.
  const conWhatsapp = (await transporteWhatsapp()) !== null;

  // De a uno y en serie, no en paralelo: son pocos por día —lo que entra en la
  // agenda de un centro— y Resend limita los envíos por segundo. Un Promise.all
  // de treinta mails se come el límite y falla la mitad.
  for (const appointment of appointments) {
    const mail = await deliverAppointmentEmail(appointment.id, "reminder");

    /*
     * El WhatsApp del recordatorio. Sale si hay algún transporte configurado —el
     * chip con Evolution o la API de Meta—; con los dos apagados devuelve
     * "todavía no está configurado" sin llamar a nadie. Cuál es cuál, en
     * `docs/whatsapp-automatico.md`.
     *
     * ⚠️ Éste es el punto del proyecto que más mensajes manda de una sentada:
     * todos los turnos de mañana, uno atrás del otro. Por el camino de Evolution
     * eso viaja por un canal no oficial, y una ráfaga es justo lo que hace que a
     * un número lo miren de cerca. El espaciado no está acá sino en el `delay`
     * de `evolution.service.ts`, que hace esperar a cada envío; el `for` de
     * abajo es en serie, así que alcanza con eso.
     *
     * ── POR QUÉ ALCANZA CON QUE SALGA UNO DE LOS DOS ──────────────────────
     *
     * `reminded_at` significa "a esta clienta ya se le avisó del turno de
     * mañana", y no "salió el mail". Marcándolo cuando cualquiera de los dos
     * canales llegó, la segunda pasada del día no le manda un WhatsApp repetido
     * a quien ya recibió el aviso — que molesta, y por el camino de Meta además
     * se cobra.
     *
     * La contra es que un mail que falla no se reintenta si el WhatsApp salió.
     * Se elige igual: la clienta ya está avisada, que es lo que importaba, y el
     * motivo del fallo queda en el log de todas formas.
     */
    const whatsapp = await deliverAppointmentWhatsapp(appointment.id, "reminder");

    if (!mail.sent && !whatsapp.sent) {
      // Sin marcar: que hoy no tuviera mail no significa que mañana tampoco. Y
      // si el motivo fue una caída del proveedor, dejarlo sin marcar es lo que
      // permite que un reintento lo levante.
      //
      // El motivo del WhatsApp sólo se nombra si el canal está encendido. Con
      // el canal apagado —que es el estado de hoy— su "motivo" es siempre el
      // mismo cartel de "no está configurado", y agregarlo a los 30 renglones
      // del día no informa nada: sólo hace que el motivo real, que es el del
      // mail, se lea peor.
      skipped.push({
        id: appointment.id,
        reason: conWhatsapp ? `mail: ${mail.reason} · whatsapp: ${whatsapp.reason}` : mail.reason,
      });
      continue;
    }

    // El aviso YA salió por al menos un canal. Si la marca falla, lo que no se
    // puede hacer es contarlo como no enviado: el próximo intento se lo mandaría
    // de nuevo. Se registra para que quede en el log del servidor y se sigue.
    //
    // Cuando salió uno solo de los dos, el motivo del otro va al log igual: sin
    // eso, un WhatsApp que empieza a fallar todos los días queda invisible
    // detrás de un mail que sí sale.
    if (!mail.sent) {
      console.warn(`[recordatorios] turno ${appointment.id} · sin mail: ${mail.reason}`);
    }
    if (conWhatsapp && !whatsapp.sent) {
      console.warn(`[recordatorios] turno ${appointment.id} · sin whatsapp: ${whatsapp.reason}`);
    }
    //
    // Con Prisma esto pasa de un `error` que se revisa a una excepción que hay
    // que atrapar. El try/catch no es defensivo por las dudas: es exactamente
    // el mismo caso de antes, escrito como lo pide el cliente nuevo.
    try {
      await prisma.appointments.update({
        where: { id: appointment.id },
        data: { reminded_at: new Date() },
      });
    } catch (e) {
      console.error(
        `[recordatorios] El aviso del turno ${appointment.id} salió pero no se pudo marcar: ${
          e instanceof Error ? e.message : e
        }`,
      );
    }

    sent += 1;
  }

  return { day: from.slice(0, 10), found: appointments.length, sent, skipped };
}

/**
 * Los turnos que ya pasaron y siguen abiertos, y el aviso al centro.
 *
 * "Abierto" es pendiente o confirmado con el turno YA TERMINADO —más los minutos
 * de tolerancia—: es exactamente el «Vencido» que muestran las pantallas, que no
 * es un estado de la base sino el cruce de esos datos.
 *
 * La regla ya NO está escrita dos veces. Vivía acá y en `estadoVisible()`, con un
 * comentario que pedía acordarse de tocar las dos, y pasó lo que se pedía no
 * pasara: la de las pantallas cortaba por `starts_at` y marcaba vencido un turno
 * que recién empezaba. Ahora las dos llaman a `yaVencio()`, que es la única
 * definición.
 *
 * Lo que el centro tiene que hacer con cada uno está en el texto del mail:
 * reprogramarlo —que es lo único que recupera ese turno— o cerrarlo.
 */
async function avisarDeLosVencidos(): Promise<void> {
  const ahora = new Date();
  const desde = new Date(ahora.getTime() - DIAS_DE_VENCIDOS * 24 * 60 * 60 * 1000);

  // Tipada y no inferida: sin el tipo, TypeScript lee ["pending","confirmed"]
  // como string[] y Prisma espera el enum de la columna.
  const where: Prisma.appointmentsWhereInput = {
    status: { in: ["pending", "confirmed"] },
    // Corte grueso, sólo para no traer el futuro: lo fino —que haya TERMINADO,
    // no que haya empezado— depende de `starts_at` y `duration_minutes` juntas,
    // y eso Prisma no lo sabe expresar sin bajar a SQL crudo. Se afina abajo, con
    // `yaVencio`, igual que hace `miAgenda` con el mismo problema.
    starts_at: { lt: ahora, gte: desde },
  };

  const candidatos = await prisma.appointments.findMany({
    where,
    orderBy: { starts_at: "asc" },
    select: {
      id: true,
      starts_at: true,
      duration_minutes: true,
      guest_name: true,
      service_name: true,
      service: { select: { name: true } },
      client: { select: { profile: { select: { full_name: true } } } },
    },
  });

  // Acá se cae el turno que está pasando ahora mismo, que es justamente el que
  // no hay que avisar: nadie tiene que hacer nada con él todavía.
  const vencidos = candidatos.filter((t) =>
    yaVencio(t.starts_at, t.duration_minutes, ahora.getTime()),
  );

  // La cuenta va aparte de la lista: el mail nombra unos pocos y dice cuántos
  // más quedaron, así que necesita el total de verdad y no el largo del recorte.
  const total = vencidos.length;
  const filas = vencidos.slice(0, MAXIMO_EN_EL_MAIL);

  if (total === 0) return;

  const turnos: TurnoVencido[] = filas.map((t) => ({
    id: t.id,
    startsAt: t.starts_at.toISOString(),
    // El mismo orden que en el resto del proyecto: manda la cuenta, y los datos
    // de invitada son el respaldo.
    clientName: t.client?.profile?.full_name ?? t.guest_name ?? "Clienta",
    // El nombre congelado como respaldo, por si el tratamiento se borró del
    // catálogo: el mail tiene que poder decir de qué era el turno igual.
    serviceName: t.service?.name ?? t.service_name,
  }));

  const envio = await deliverOverdueDigest(turnos, total);

  console.log(
    envio.sent
      ? `[vencidos] ${total} turno(s) sin cerrar. Resumen enviado.`
      : `[vencidos] ${total} turno(s) sin cerrar, pero el mail no salió: ${envio.reason}`,
  );
}

/** Para no programar dos relojes si el módulo se carga más de una vez. */
let programado = false;

/**
 * Pone los dos relojes a andar: el de los recordatorios y el del resumen de
 * vencidos. Se llama una vez, desde `src/server.ts` — con el primer pedido que
 * entra, no al levantar el proceso. Ver el comentario de allá.
 *
 * ── LOS DOS CASOS EN LOS QUE NO ARRANCA, Y POR QUÉ ────────────────────────
 *
 * 1. **Fuera de producción.** En la máquina de desarrollo la app se levanta
 *    contra la base local, que tiene los datos reales exportados de Supabase —
 *    mails de clientas incluidos. Un reloj andando ahí le manda un recordatorio
 *    de verdad a una persona de verdad porque alguien dejó `bun run dev`
 *    abierto. Los mails que se disparan a mano desde el panel siguen saliendo:
 *    lo que se apaga es lo que ocurre solo, sin que nadie lo haya pedido.
 *
 * 2. **En Cloudflare Workers.** El build por defecto del proyecto apunta ahí
 *    (es a donde publica Lovable) y el Dockerfile lo pisa con `NITRO_PRESET=
 *    node-server` para el contenedor. En un Worker no hay proceso vivo entre
 *    pedidos: un `cron.schedule` no se ejecutaría nunca, y quedaría un reloj
 *    fantasma que hace creer que los recordatorios están cubiertos. Mejor no
 *    arrancarlo y decirlo en el log.
 *
 * `navigator.userAgent === "Cloudflare-Workers"` es la forma estándar de
 * reconocer ese runtime (WinterCG), y no depende de ninguna variable que alguien
 * tenga que acordarse de poner.
 */
export async function iniciarRecordatorios(): Promise<void> {
  if (programado) return;

  if (typeof navigator !== "undefined" && navigator.userAgent === "Cloudflare-Workers") {
    console.warn("[recordatorios] No se programan: este runtime no mantiene el proceso vivo.");
    return;
  }

  if (process.env["NODE_ENV"] !== "production") return;

  // Antes del `await`, para que dos llamadas juntas no programen dos relojes.
  programado = true;

  // El import va acá adentro y DESPUÉS de los dos guards, no arriba del archivo:
  // así, en el build de Cloudflare, `node-cron` no se llega a evaluar nunca. Es
  // una librería de proceso largo —relojes y timers— y no tiene por qué correr
  // en un runtime que no tiene proceso largo.
  const { schedule } = await import("node-cron");

  schedule(CUANDO, correr, { timezone: TIMEZONE, name: "recordatorios" });
  schedule(CUANDO_VENCIDOS, correrVencidos, { timezone: TIMEZONE, name: "vencidos" });

  console.log(
    `[recordatorios] Programados: "${CUANDO}" · vencidos: "${CUANDO_VENCIDOS}" (${TIMEZONE}).`,
  );
}

/**
 * Una corrida, con su resultado en el log.
 *
 * El log es la única señal que queda: sin el endpoint no hay una respuesta HTTP
 * que alguien pueda mirar, así que cada corrida tiene que dejar dicho qué hizo.
 * Se ve con `docker compose logs -f app`.
 *
 * El try/catch envuelve TODO a propósito. Lo que tira acá adentro —la base
 * caída, Resend caído— sube como rechazo sin atrapar y se lleva puesto el
 * proceso entero, o sea el sitio, por un mail que no salió.
 */
async function correr(): Promise<void> {
  try {
    const { day, found, sent, skipped } = await runDailyReminders();
    console.log(`[recordatorios] ${day}: ${found} turno(s), ${sent} aviso(s) enviado(s).`);

    // Uno por línea y con el motivo: casi siempre es "no tiene mail cargado", y
    // eso se arregla en la ficha de la clienta.
    for (const { id, reason } of skipped) {
      console.warn(`[recordatorios] Sin enviar · turno ${id}: ${reason}`);
    }
  } catch (error) {
    console.error("[recordatorios] La corrida falló entera:", error);
  }
}

/**
 * La pasada de los vencidos, con su resultado en el log.
 *
 * El try/catch envuelve todo por el mismo motivo que el de `correr`: lo que tire
 * acá adentro sube como rechazo sin atrapar y se lleva puesto el proceso —o sea
 * el sitio— por un mail que no salió.
 */
async function correrVencidos(): Promise<void> {
  try {
    await avisarDeLosVencidos();
  } catch (error) {
    console.error("[vencidos] La corrida falló entera:", error);
  }
}
