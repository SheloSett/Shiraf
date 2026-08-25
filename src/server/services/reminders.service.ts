import { prisma } from "@/server/db";
import { deliverAppointmentEmail } from "@/lib/notifications.server";

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
 * El día de mañana en Buenos Aires, como par de instantes.
 *
 * El servidor corre en UTC, así que "mañana" según su reloj y "mañana" según el
 * centro son días distintos entre las 21 y la medianoche. Se resuelve pidiéndole
 * la fecha al formateador con el huso puesto, y recién ahí armando los límites.
 *
 * `en-CA` no es un capricho: es el único locale que devuelve la fecha en
 * AAAA-MM-DD, que es lo que hay que concatenar.
 */
function tomorrowInBuenosAires(): { from: string; to: string } {
  const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000);
  const day = tomorrow.toLocaleDateString("en-CA", { timeZone: TIMEZONE });
  return {
    from: `${day}T00:00:00${AR_OFFSET}`,
    to: `${day}T23:59:59.999${AR_OFFSET}`,
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

  // De a uno y en serie, no en paralelo: son pocos por día —lo que entra en la
  // agenda de un centro— y Resend limita los envíos por segundo. Un Promise.all
  // de treinta mails se come el límite y falla la mitad.
  for (const appointment of appointments) {
    const result = await deliverAppointmentEmail(appointment.id, "reminder");

    if (!result.sent) {
      // Sin marcar: que hoy no tuviera mail no significa que mañana tampoco. Y
      // si el motivo fue una caída de Resend, dejarlo sin marcar es lo que
      // permite que un reintento lo levante.
      skipped.push({ id: appointment.id, reason: result.reason });
      continue;
    }

    // El mail YA salió. Si la marca falla, lo que no se puede hacer es contarlo
    // como no enviado: el próximo intento se lo mandaría de nuevo. Se registra
    // para que quede en el log del servidor y se sigue.
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

/** Para no programar dos relojes si el módulo se carga más de una vez. */
let programado = false;

/**
 * Pone el reloj a andar. Se llama una vez, al arrancar el servidor.
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
  console.log(`[recordatorios] Programados: "${CUANDO}" (${TIMEZONE}).`);
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
