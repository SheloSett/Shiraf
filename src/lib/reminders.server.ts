import { deliverAppointmentEmail } from "@/lib/notifications.functions";

/**
 * El recordatorio del día antes.
 *
 * Es el único de los cuatro avisos que no lo dispara nadie: los otros tres
 * salen de una acción concreta —el centro confirma, el centro cancela, una
 * clienta reserva— y este tiene que ocurrir porque pasó el tiempo. Por eso
 * necesita algo que lo llame solo, y por eso vive detrás de un endpoint con un
 * secreto en vez de detrás del login: quien lo va a invocar es un cron, que no
 * tiene sesión de nadie.
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
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { from, to } = tomorrowInBuenosAires();

  const { data, error } = await supabaseAdmin
    .from("appointments")
    .select("id")
    .eq("status", "confirmed")
    .is("reminded_at", null)
    .gte("starts_at", from)
    .lte("starts_at", to)
    .order("starts_at");

  if (error) throw new Error(`No se pudieron leer los turnos: ${error.message}`);

  const appointments = data ?? [];
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

    const { error: markError } = await supabaseAdmin
      .from("appointments")
      .update({ reminded_at: new Date().toISOString() })
      .eq("id", appointment.id);

    // El mail YA salió. Si la marca falla, lo que no se puede hacer es contarlo
    // como no enviado: el próximo intento se lo mandaría de nuevo. Se registra
    // para que quede en el log del servidor y se sigue.
    if (markError) {
      console.error(
        `[recordatorios] El aviso del turno ${appointment.id} salió pero no se pudo marcar: ${markError.message}`,
      );
    }

    sent += 1;
  }

  return { day: from.slice(0, 10), found: appointments.length, sent, skipped };
}

/**
 * ¿El pedido trae el secreto correcto?
 *
 * Sin REMINDERS_SECRET configurado la respuesta es siempre que no. Es a
 * propósito: la alternativa —"si no hay secreto, dejá pasar a cualquiera"— es
 * cómoda en desarrollo y deja el endpoint abierto en producción el día que
 * alguien se olvide de la variable. Un endpoint que dispara mails a clientas no
 * puede quedar abierto por omisión.
 */
export function isAuthorizedReminderRequest(request: Request): boolean {
  const secret = process.env["REMINDERS_SECRET"];
  if (!secret) return false;

  const header = request.headers.get("authorization") ?? "";
  return header === `Bearer ${secret}`;
}
