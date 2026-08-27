import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { api, apiPut } from "@/lib/api";
import type { MiTurno, RtaDisponibilidad, RtaProfesionalesConHorarios } from "@/lib/api-tipos";
import { buildSlots, formatDateTime, formatTime, WEEKDAYS } from "@/lib/shiraf";

/**
 * La clienta se mueve su propio turno.
 *
 * ── POR QUÉ NO ALCANZABA CON CANCELAR Y RESERVAR DE NUEVO ─────────────────
 *
 * Era la única salida que había, y es mala por dos motivos: le pierde al turno
 * su historia —queda uno cancelado y otro nuevo, y en la ficha de la clienta se
 * lee como si se hubiera arrepentido— y entre una cosa y la otra el lugar queda
 * libre, así que puede tomarlo otra persona y quedarse sin ninguno de los dos.
 * Acá es un solo UPDATE: o se mueve, o se queda donde estaba.
 *
 * ── LO QUE ELIGE, Y LO QUE NO ─────────────────────────────────────────────
 *
 * Día, hora y profesional —la misma u otra, con tal de que haga ese
 * tratamiento—. El tratamiento no: eso ya es otro turno, con otro precio y otra
 * duración, y para eso está reservar.
 *
 * Los horarios que se ofrecen son los de la agenda REAL de la profesional
 * elegida, con sus ratos ocupados descontados. Es el mismo cálculo de /reservar
 * y del panel: `buildSlots` sobre lo que devuelve `/api/reservar/disponibilidad`.
 * El servidor lo vuelve a comprobar entero, así que esto es comodidad y no el
 * candado.
 */
export function ReprogramarTurnoDialog({
  turno,
  onOpenChange,
}: {
  /** El turno a mover, o null con el diálogo cerrado. */
  turno: MiTurno | null;
  onOpenChange: (open: boolean) => void;
}) {
  const queryClient = useQueryClient();
  const [profesionalId, setProfesionalId] = useState("");
  const [dia, setDia] = useState("");
  const [hora, setHora] = useState("");

  // Al abrir, arranca con la profesional que ya tiene: lo más común es querer
  // cambiar el día y no la persona.
  useEffect(() => {
    if (!turno) return;
    setProfesionalId(turno.professional_id ?? "");
    setDia("");
    setHora("");
  }, [turno]);

  const profesionales = useQuery({
    queryKey: ["reprogramar", "profesionales", turno?.service_id],
    enabled: !!turno?.service_id,
    queryFn: async () =>
      (
        await api<RtaProfesionalesConHorarios>(
          `/api/publico/servicios/${turno!.service_id}/profesionales`,
        )
      ).profesionales,
  });

  const fecha = useMemo(() => {
    if (!dia) return null;
    // "2026-09-15" se parsea a mediodía y no a medianoche: con la hora en 00:00
    // y el navegador en una zona al oeste de UTC, `new Date("...")` cae en el
    // día anterior. El mediodía deja margen para cualquier zona.
    const [a, m, d] = dia.split("-").map(Number);
    if (!a || !m || !d) return null;
    return new Date(a, m - 1, d, 12, 0, 0, 0);
  }, [dia]);

  const disponibilidad = useQuery({
    queryKey: ["reprogramar", "disponibilidad", profesionalId, dia],
    enabled: !!profesionalId && !!fecha,
    queryFn: async () => {
      const day = new Date(fecha!);
      day.setHours(0, 0, 0, 0);
      return api<RtaDisponibilidad>(
        `/api/reservar/disponibilidad?profesional=${profesionalId}&fecha=${day.toISOString()}`,
      );
    },
  });

  /** Los horarios libres de ese día, ya descontado lo ocupado. */
  const libres = useMemo(() => {
    if (!fecha || !turno || !disponibilidad.data) return [];
    return buildSlots(
      fecha,
      disponibilidad.data.schedules,
      disponibilidad.data.busy,
      turno.duration_minutes,
    );
  }, [fecha, turno, disponibilidad.data]);

  /** Qué días de la semana atiende, para explicar un día vacío. */
  const diasQueAtiende = useMemo(() => {
    const p = profesionales.data?.find((x) => x.id === profesionalId);
    if (!p) return [];
    return [...new Set(p.professional_schedules.map((s) => s.weekday))]
      .sort((x, y) => x - y)
      .map((d) => WEEKDAYS[d]);
  }, [profesionales.data, profesionalId]);

  const mover = useMutation({
    mutationFn: async () => {
      const [hh, mm] = hora.split(":").map(Number);
      const cuando = new Date(fecha!);
      cuando.setHours(hh ?? 0, mm ?? 0, 0, 0);
      await apiPut(`/api/mi-cuenta/turnos/${turno!.id}/reprogramar`, {
        starts_at: cuando.toISOString(),
        professional_id: profesionalId,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["my-appointments"] });
      toast.success("Listo, te movimos el turno.");
      onOpenChange(false);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  // El día de hoy, para que el calendario no ofrezca fechas pasadas. El servidor
  // las rechaza igual.
  const hoy = new Date();
  const minimo = `${hoy.getFullYear()}-${String(hoy.getMonth() + 1).padStart(2, "0")}-${String(hoy.getDate()).padStart(2, "0")}`;

  return (
    <Dialog open={turno !== null} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="font-display text-2xl">Cambiar el turno</DialogTitle>
          <DialogDescription>
            {turno ? (
              <>
                {turno.services.name} — hoy lo tenés {formatDateTime(turno.starts_at)}.
              </>
            ) : null}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <label className="block">
            <span className="text-eyebrow text-muted-foreground">Con quién</span>
            <select
              value={profesionalId}
              onChange={(e) => {
                setProfesionalId(e.target.value);
                setHora("");
              }}
              className="mt-2 h-10 w-full rounded-sm border border-input bg-background px-3 text-sm text-foreground"
            >
              <option value="">Elegí una profesional</option>
              {profesionales.data?.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.full_name}
                </option>
              ))}
            </select>
          </label>

          <label className="block">
            <span className="text-eyebrow text-muted-foreground">Qué día</span>
            <input
              type="date"
              min={minimo}
              value={dia}
              onChange={(e) => {
                setDia(e.target.value);
                setHora("");
              }}
              className="mt-2 h-10 w-full rounded-sm border border-input bg-background px-3 text-sm text-foreground"
            />
          </label>

          {profesionalId && fecha && (
            <div>
              <span className="text-eyebrow text-muted-foreground">A qué hora</span>
              {disponibilidad.isPending ? (
                <p className="mt-2 text-sm text-muted-foreground">Buscando horarios…</p>
              ) : libres.length === 0 ? (
                <p className="mt-2 text-sm text-muted-foreground">
                  Ese día no le quedan horarios.
                  {diasQueAtiende.length > 0 && <> Atiende {diasQueAtiende.join(", ")}.</>}
                </p>
              ) : (
                <div className="mt-2 flex flex-wrap gap-2">
                  {libres.map((h) => (
                    <button
                      key={h}
                      type="button"
                      onClick={() => setHora(h)}
                      className={`rounded-sm border px-3 py-1.5 text-sm transition-colors ${
                        hora === h
                          ? "border-primary bg-primary text-primary-foreground"
                          : "border-input bg-background text-foreground hover:border-primary"
                      }`}
                    >
                      {/* 26/8/2026 — acá decía `{h}` a secas, y `h` es el ISO en UTC
                          que después se le manda al servidor: los botones salían
                          escritos "2026-08-31T13:50:00.000Z" en vez de "10:50".
                          Además de ser ilegible, mostraba la hora en UTC, tres
                          horas corrida de la que la clienta iba a ir. El valor
                          que viaja no cambia — sigue siendo `h`, tanto en el
                          `key` como en `setHora` —; lo único que cambia es cómo
                          se lee. `formatTime` es la misma función con la que
                          pinta los horarios la pantalla de reservar, así que las
                          dos pantallas que mueven un turno ahora dicen la hora
                          igual. */}
                      {/* {h} */}
                      {formatTime(h)}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Dejarlo como está
          </Button>
          <Button
            disabled={!profesionalId || !fecha || !hora || mover.isPending}
            onClick={() => mover.mutate()}
          >
            {mover.isPending ? "Moviendo…" : "Cambiar el turno"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
