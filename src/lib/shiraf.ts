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

export function formatMoney(value: number | string | null | undefined) {
  const n = Number(value ?? 0);
  return n.toLocaleString("es-AR", {
    style: "currency",
    currency: "ARS",
    maximumFractionDigits: 0,
  });
}

export function formatDateTime(iso: string) {
  return new Date(iso).toLocaleString("es-AR", {
    weekday: "long",
    day: "2-digit",
    month: "long",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function formatTime(iso: string) {
  return new Date(iso).toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit" });
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

type Schedule = { weekday: number; start_time: string; end_time: string };
type Busy = { starts_at: string; duration_minutes: number };

/** Genera los horarios disponibles de un día, cada 30 minutos, según la agenda de la profesional. */
export function buildSlots(
  date: Date,
  schedules: Schedule[],
  busy: Busy[],
  durationMinutes: number,
): string[] {
  const weekday = date.getDay();
  const daySchedules = schedules.filter((s) => s.weekday === weekday);
  if (daySchedules.length === 0) return [];

  const slots: string[] = [];
  const now = Date.now();

  for (const schedule of daySchedules) {
    const [sh, sm] = schedule.start_time.split(":").map(Number);
    const [eh, em] = schedule.end_time.split(":").map(Number);
    const cursor = new Date(date);
    cursor.setHours(sh ?? 0, sm ?? 0, 0, 0);
    const end = new Date(date);
    end.setHours(eh ?? 0, em ?? 0, 0, 0);

    while (cursor.getTime() + durationMinutes * 60000 <= end.getTime()) {
      const start = cursor.getTime();
      const finish = start + durationMinutes * 60000;
      const overlaps = busy.some((b) => {
        const bStart = new Date(b.starts_at).getTime();
        const bEnd = bStart + b.duration_minutes * 60000;
        return start < bEnd && bStart < finish;
      });
      if (!overlaps && start > now) slots.push(new Date(start).toISOString());
      cursor.setMinutes(cursor.getMinutes() + 30);
    }
  }

  return slots.sort();
}
