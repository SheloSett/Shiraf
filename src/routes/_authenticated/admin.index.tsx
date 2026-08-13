import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/integrations/supabase/client";
import { formatTime, STATUS_LABEL, WEEKDAYS } from "@/lib/shiraf";

export const Route = createFileRoute("/_authenticated/admin/")({
  component: AdminCalendar,
});

function AdminCalendar() {
  const [cursor, setCursor] = useState(() => {
    const d = new Date();
    d.setDate(1);
    d.setHours(0, 0, 0, 0);
    return d;
  });

  const monthStart = cursor;
  const monthEnd = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1);

  const appointments = useQuery({
    queryKey: ["admin-calendar", monthStart.toISOString()],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("appointments")
        .select("id, starts_at, status, services(name), professionals(full_name)")
        .gte("starts_at", monthStart.toISOString())
        .lt("starts_at", monthEnd.toISOString())
        .order("starts_at");
      if (error) throw error;
      return data;
    },
  });

  const firstWeekday = monthStart.getDay();
  const daysInMonth = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 0).getDate();
  const cells: (number | null)[] = [
    ...Array.from({ length: firstWeekday }, () => null),
    ...Array.from({ length: daysInMonth }, (_, i) => i + 1),
  ];

  const byDay = (appointments.data ?? []).reduce<
    Record<number, NonNullable<typeof appointments.data>>
  >((acc, a) => {
    const day = new Date(a.starts_at).getDate();
    acc[day] = [...(acc[day] ?? []), a];
    return acc;
  }, {});

  return (
    <div>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-eyebrow text-muted-foreground">Agenda del mes</p>
          <h1 className="mt-3 font-display text-4xl text-foreground">
            {cursor.toLocaleDateString("es-AR", { month: "long", year: "numeric" })}
          </h1>
        </div>
        <div className="flex gap-2">
          <Button
            size="icon"
            variant="outline"
            onClick={() => setCursor(new Date(cursor.getFullYear(), cursor.getMonth() - 1, 1))}
          >
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <Button
            size="icon"
            variant="outline"
            onClick={() => setCursor(new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1))}
          >
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
      </div>

      <div className="mt-8 grid grid-cols-7 gap-px overflow-hidden rounded-sm border border-border bg-border">
        {WEEKDAYS.map((w) => (
          <div
            key={w}
            className="bg-secondary px-2 py-2 text-center text-[11px] tracking-[0.12em] uppercase text-muted-foreground"
          >
            {w.slice(0, 3)}
          </div>
        ))}
        {cells.map((day, i) => (
          <div key={i} className="min-h-28 bg-card p-2">
            {day && (
              <>
                <span className="text-xs text-muted-foreground">{day}</span>
                <div className="mt-1 space-y-1">
                  {(byDay[day] ?? []).map((a) => (
                    <div
                      key={a.id}
                      className={`rounded-sm px-1.5 py-1 text-[11px] leading-tight ${
                        a.status === "cancelled"
                          ? "bg-muted text-muted-foreground line-through"
                          : a.status === "confirmed"
                            ? "bg-primary/10 text-foreground"
                            : "bg-gold/15 text-foreground"
                      }`}
                    >
                      <span className="font-medium">{formatTime(a.starts_at)}</span>{" "}
                      {a.services?.name}
                      <span className="block text-muted-foreground">
                        {a.professionals?.full_name}
                      </span>
                    </div>
                  ))}
                </div>
              </>
            )}
          </div>
        ))}
      </div>

      <div className="mt-6 flex flex-wrap gap-3 text-xs text-muted-foreground">
        <span className="flex items-center gap-2">
          <span className="h-3 w-3 rounded-sm bg-gold/40" /> {STATUS_LABEL["pending"]}
        </span>
        <span className="flex items-center gap-2">
          <span className="h-3 w-3 rounded-sm bg-primary/25" /> {STATUS_LABEL["confirmed"]}
        </span>
        <span className="flex items-center gap-2">
          <span className="h-3 w-3 rounded-sm bg-muted" /> {STATUS_LABEL["cancelled"]}
        </span>
      </div>
    </div>
  );
}
