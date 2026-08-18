import { useMemo } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, MessageCircle, Quote } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/integrations/supabase/client";
import { toWhatsappNumber } from "@/lib/notifications";
import { formatDay, formatTime, toDateKey } from "@/lib/shiraf";

export const Route = createFileRoute("/_authenticated/admin/mi-agenda")({
  component: MyAgenda,
});

/** Cuántos días adelante se piden. El mismo número que dice el subtítulo. */
const DAYS_AHEAD = 30;

type AgendaRow = {
  appointment_id: string;
  appointment_start: string;
  appointment_minutes: number;
  appointment_state: string;
  service_name: string;
  client_name: string | null;
  client_phone: string | null;
  clinical_notes: string | null;
  booking_note: string | null;
  client_is_guest: boolean;
};

/**
 * "Hoy", "Mañana" o el día escrito.
 *
 * Vale la pena el caso especial: en una lista de turnos, lo primero que se
 * busca es qué toca ahora, y "Hoy" se encuentra de un vistazo donde "martes 19
 * de agosto" hay que leerlo y compararlo con la fecha de la compu.
 */
function dayLabel(iso: string): string {
  const key = toDateKey(new Date(iso));
  const today = new Date();
  const tomorrow = new Date();
  tomorrow.setDate(today.getDate() + 1);

  if (key === toDateKey(today)) return "Hoy";
  if (key === toDateKey(tomorrow)) return "Mañana";
  return formatDay(iso);
}

/**
 * La agenda propia de una profesional.
 *
 * Es la única sección del panel que no depende de una casilla de permisos: la
 * habilita tener la ficha de profesional atada a la cuenta, y eso lo hace la
 * dueña desde Equipo. Ver la migración 20260818020000.
 *
 * Todo lo que se muestra llega de `my_agenda()`, una sola función que ya viene
 * filtrada por la base. Acá no hay ningún `.eq("professional_id", …)` que
 * alguien pueda sacar sin darse cuenta: la pantalla no sabría cómo pedir la
 * agenda de otra persona ni queriendo.
 */
function MyAgenda() {
  const agenda = useQuery({
    queryKey: ["my-agenda"],
    // Un turno nuevo lo carga otra persona desde otra pantalla, así que esto se
    // refresca solo: la profesional deja el panel abierto en la cabina.
    staleTime: 60_000,
    refetchOnWindowFocus: true,
    refetchInterval: 5 * 60_000,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("my_agenda", { _days: DAYS_AHEAD });
      if (error) throw error;
      return (data ?? []) as AgendaRow[];
    },
  });

  // Agrupados por día, respetando el orden que ya trae la consulta (starts_at
  // ascendente): un Map conserva el orden de inserción, así que no hace falta
  // volver a ordenar nada.
  const days = useMemo(() => {
    const byDay = new Map<string, AgendaRow[]>();
    for (const row of agenda.data ?? []) {
      const key = toDateKey(new Date(row.appointment_start));
      byDay.set(key, [...(byDay.get(key) ?? []), row]);
    }
    return [...byDay.values()];
  }, [agenda.data]);

  const total = agenda.data?.length ?? 0;

  return (
    <div>
      <div>
        <p className="text-eyebrow text-muted-foreground">Tus próximos turnos</p>
        <h1 className="mt-3 font-display text-4xl text-foreground">Mi agenda</h1>
      </div>

      <p className="mt-4 max-w-xl text-sm leading-relaxed text-muted-foreground">
        Los turnos asignados a vos para los próximos {DAYS_AHEAD} días. Los confirma y los cancela
        el centro; acá los ves para saber qué te toca.
      </p>

      {agenda.isLoading && <p className="mt-10 text-sm text-muted-foreground">Cargando…</p>}

      {/*
        El error va separado del vacío y no junto con él, que es el mismo bug
        que ya se corrigió en los horarios de "Nuevo turno": si una consulta que
        falla se dibuja igual que una que volvió sin filas, la pantalla dice "no
        tenés turnos" cuando lo que pasó es que no se pudo preguntar. Y ahí nadie
        revisa: se confía y se pierde el turno.
      */}
      {agenda.isError && (
        <div className="mt-10 max-w-xl rounded-sm border border-destructive/40 bg-destructive/5 p-5">
          <p className="text-sm font-medium text-foreground">No se pudo cargar la agenda.</p>
          <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
            Puede ser la conexión. Volvé a entrar en un rato y, si sigue igual, avisale a la dueña —
            esto no significa que no tengas turnos.
          </p>
        </div>
      )}

      {!agenda.isLoading && !agenda.isError && total === 0 && (
        <div className="mt-10 max-w-xl rounded-sm border border-dashed border-border p-8 text-center">
          <p className="text-sm text-muted-foreground">
            No tenés turnos en los próximos {DAYS_AHEAD} días.
          </p>
        </div>
      )}

      <div className="mt-10 space-y-12">
        {days.map((rows) => (
          <section key={rows[0]!.appointment_id}>
            <div className="flex items-baseline gap-4 border-b border-border pb-3">
              <h2 className="font-display text-2xl text-foreground first-letter:uppercase">
                {dayLabel(rows[0]!.appointment_start)}
              </h2>
              <span className="text-eyebrow text-muted-foreground">
                {rows.length} {rows.length === 1 ? "turno" : "turnos"}
              </span>
            </div>

            <ul className="mt-6 space-y-5">
              {rows.map((row) => {
                const whatsapp = toWhatsappNumber(row.client_phone);
                return (
                  <li
                    key={row.appointment_id}
                    className="grid gap-x-6 gap-y-3 sm:grid-cols-[5.5rem_1fr]"
                  >
                    {/* La hora es lo primero que se busca, así que va sola en su
                        columna y con cifras monoespaciadas: la lista se lee para
                        abajo sin que los dígitos se corran. */}
                    <div>
                      <p className="font-display text-2xl tabular-nums text-foreground">
                        {formatTime(row.appointment_start)}
                      </p>
                      <p className="text-xs text-muted-foreground">{row.appointment_minutes} min</p>
                    </div>

                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
                        <p className="text-[15px] text-foreground">{row.service_name}</p>
                        {/* Un turno sin confirmar todavía puede no pasar. Ella no
                            lo confirma, pero tiene que saber cuáles están firmes
                            antes de organizarse el día. */}
                        {row.appointment_state === "pending" && (
                          <Badge variant="outline" className="font-normal text-[10px]">
                            sin confirmar
                          </Badge>
                        )}
                      </div>

                      <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted-foreground">
                        <span className="text-foreground">{row.client_name ?? "Sin nombre"}</span>
                        {row.client_is_guest && (
                          <Badge variant="outline" className="font-normal text-[10px]">
                            invitada
                          </Badge>
                        )}
                        {whatsapp ? (
                          <a
                            href={`https://wa.me/${whatsapp}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-1.5 underline-offset-4 hover:text-foreground hover:underline"
                          >
                            <MessageCircle className="h-3.5 w-3.5" />
                            {row.client_phone}
                          </a>
                        ) : (
                          <span>Sin teléfono</span>
                        )}
                      </p>

                      {/* Lo que dejó escrito la clienta al reservar. */}
                      {row.booking_note && (
                        <p className="mt-3 flex gap-2 text-sm leading-relaxed text-muted-foreground">
                          <Quote className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                          {row.booking_note}
                        </p>
                      )}

                      {/* Las notas clínicas: alergias, embarazos, antecedentes.
                          Van destacadas y al final —lo último que se lee antes
                          de entrar a la cabina— porque son las que cambian qué
                          se puede aplicar. */}
                      {row.clinical_notes && (
                        <p className="mt-3 flex gap-2 rounded-sm border border-gold/40 bg-gold/5 p-3 text-sm leading-relaxed text-foreground">
                          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-gold" />
                          {row.clinical_notes}
                        </p>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          </section>
        ))}
      </div>
    </div>
  );
}
