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
import { CalendarioDeLaProfesional } from "@/components/calendario-de-la-profesional";
import { api, apiPost } from "@/lib/api";
import { notifyAppointment } from "@/lib/notifications.functions";
import type {
  RtaDisponibilidad,
  RtaProfesionalesConHorarios,
  SesionPendiente,
} from "@/lib/api-tipos";
import { parseDateKey } from "@/lib/horarios";
import { diaLargo, todaviaNoSePuede } from "@/lib/sesiones";
import { buildSlots, formatTime, WEEKDAYS } from "@/lib/shiraf";
import { CLAVE_SESIONES_PENDIENTES } from "@/hooks/useSesionesPendientes";

/**
 * La clienta saca la sesión que sigue de un tratamiento de varias (5/10/2026).
 *
 * ── POR QUÉ EXISTE ────────────────────────────────────────────────────────
 *
 * Hasta hoy esto lo hacía sólo el centro, desde el panel (`NextSessionDialog`).
 * La clienta reservaba la primera y las demás se acordaban en el mostrador. La
 * dueña pidió que la pueda sacar ella y que el sitio se lo recuerde: es el
 * cartel de arriba de todo, y este diálogo es a donde lleva su botón.
 *
 * ── QUÉ ELIGE, Y QUÉ NO ───────────────────────────────────────────────────
 *
 * Día, hora y profesional. El tratamiento y la opción no: son los de la serie
 * que ya empezó, y el servidor los copia de la sesión anterior. Tampoco paga —
 * el paquete se cobró en la primera— y por eso acá no aparece ningún precio.
 *
 * Los días anteriores al intervalo del tratamiento salen deshabilitados y,
 * a diferencia del panel, acá no hay un botón para adelantarla igual: para la
 * clienta el intervalo es un mínimo. El servidor lo vuelve a comprobar.
 *
 * ── LAS DOS PUERTAS ───────────────────────────────────────────────────────
 *
 * Lo usa la clienta con cuenta y la que reservó sin cuenta, que entra por su
 * enlace personal. Cambia a dónde se manda el pedido y quién dispara los
 * avisos: con cuenta los pide esta pantalla, igual que al reservar; con el
 * enlace los manda el servidor, que es el único que puede — sin sesión no hay
 * forma de pasar por `notifyAppointment`.
 */
export function SacarSesionDialog({
  pendiente,
  token,
  onOpenChange,
}: {
  /** La sesión a sacar, o null con el diálogo cerrado. */
  pendiente: SesionPendiente | null;
  /** El enlace personal, cuando quien la saca reservó sin cuenta. */
  token?: string;
  onOpenChange: (open: boolean) => void;
}) {
  const queryClient = useQueryClient();
  const [profesionalId, setProfesionalId] = useState("");
  const [dia, setDia] = useState("");
  const [hora, setHora] = useState("");

  const profesionales = useQuery({
    queryKey: ["professionals", "for-service", pendiente?.service_id],
    enabled: !!pendiente,
    queryFn: async () =>
      (
        await api<RtaProfesionalesConHorarios>(
          `/api/publico/servicios/${pendiente!.service_id}/profesionales`,
        )
      ).profesionales,
  });

  // Al abrir: el calendario arranca en el primer día posible —si no, una sesión
  // que se puede hacer recién el mes que viene abriría en un mes entero gris— y
  // la hora en blanco, que se elige de los huecos que de verdad hay.
  useEffect(() => {
    if (!pendiente) return;
    setDia(todaviaNoSePuede(pendiente) ? (pendiente.desde ?? "") : "");
    setHora("");
  }, [pendiente]);

  // La profesional de la sesión anterior queda elegida, si sigue haciendo ese
  // tratamiento. Va en su propio efecto porque depende de una lista que llega
  // después: preseleccionar a alguien que ya no está dejaría el selector
  // mostrando "Elegí una profesional" con un id escondido adentro.
  useEffect(() => {
    if (!pendiente || !profesionales.data) return;
    const sigue = profesionales.data.some((p) => p.id === pendiente.professional_id);
    setProfesionalId(sigue ? (pendiente.professional_id ?? "") : "");
  }, [pendiente, profesionales.data]);

  const fecha = useMemo(() => {
    const d = parseDateKey(dia);
    if (!d) return null;
    // A mediodía, por lo mismo que en «Cambiar el turno»: deja margen para
    // cualquier zona horaria.
    d.setHours(12, 0, 0, 0);
    return d;
  }, [dia]);

  /** El primer día que se puede elegir, a medianoche: el calendario compara por día. */
  const piso = useMemo(
    () => (pendiente?.desde ? parseDateKey(pendiente.desde) : undefined),
    [pendiente],
  );

  const disponibilidad = useQuery({
    queryKey: ["availability", profesionalId, dia],
    enabled: !!profesionalId && !!fecha,
    queryFn: async () => {
      const day = new Date(fecha!);
      day.setHours(0, 0, 0, 0);
      return api<RtaDisponibilidad>(
        `/api/reservar/disponibilidad?profesional=${profesionalId}&fecha=${day.toISOString()}`,
      );
    },
  });

  const libres = useMemo(() => {
    if (!fecha || !pendiente || !disponibilidad.data) return [];
    return buildSlots(
      fecha,
      disponibilidad.data.schedules,
      disponibilidad.data.busy,
      { minutos: pendiente.duration_minutes, margen: pendiente.buffer_minutes },
      disponibilidad.data.ausencias,
    );
  }, [fecha, pendiente, disponibilidad.data]);

  /** Qué días de la semana atiende, para explicar un día vacío. */
  const diasQueAtiende = useMemo(() => {
    const p = profesionales.data?.find((x) => x.id === profesionalId);
    if (!p) return [];
    return [...new Set(p.professional_schedules.map((s) => s.weekday))]
      .sort((x, y) => x - y)
      .map((d) => WEEKDAYS[d]);
  }, [profesionales.data, profesionalId]);

  const sacar = useMutation({
    mutationFn: async () => {
      const creado = await apiPost<{ id: string; session_number: number }>(
        token ? `/api/enlace/${token}/siguiente-sesion` : "/api/reservar/siguiente-sesion",
        {
          appointment_id: pendiente!.id,
          // `hora` ya es el instante en ISO: sale de `buildSlots`. Ver la nota
          // larga de `ReprogramarTurnoDialog` sobre por qué no se convierte.
          starts_at: hora,
          professional_id: profesionalId,
        },
      );

      // Los mismos dos avisos que al reservar, y con el fallo tragado por lo
      // mismo: el turno YA está, y un mail que no sale no puede convertirse en
      // un "no se pudo reservar" que la mande a intentarlo de nuevo.
      if (!token) {
        await Promise.all([
          notifyAppointment({ data: { appointmentId: creado.id, event: "new-request" } }).catch(
            (e: Error) => console.error("[sesión] no se pudo avisar al centro:", e.message),
          ),
          notifyAppointment({ data: { appointmentId: creado.id, event: "requested" } }).catch(
            (e: Error) => console.error("[sesión] no se pudo avisar a la clienta:", e.message),
          ),
        ]);
      }

      return creado;
    },
    onSuccess: (creado) => {
      queryClient.invalidateQueries({ queryKey: CLAVE_SESIONES_PENDIENTES });
      queryClient.invalidateQueries({ queryKey: ["my-appointments"] });
      queryClient.invalidateQueries({ queryKey: ["enlace"] });
      toast.success(
        `¡Listo! Reservaste la sesión ${creado.session_number}.`,
        token
          ? { description: "Te mandamos el comprobante por WhatsApp." }
          : { description: "Te mandamos el comprobante." },
      );
      onOpenChange(false);
    },
    onError: (error: Error) => {
      // El mismo caso que en /reservar: alguien tomó ese horario mientras ella
      // elegía. Se limpia la hora y se vuelven a pedir los libres.
      if (error.message.includes("ya fue tomado")) {
        setHora("");
        queryClient.invalidateQueries({ queryKey: ["availability"] });
        toast.error("Ese horario se acaba de ocupar. Elegí otro, por favor.");
        return;
      }
      toast.error(error.message);
    },
  });

  return (
    <Dialog open={pendiente !== null} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="font-display text-2xl">
            Reservar la sesión {pendiente?.session_number} de {pendiente?.sessions_total}
          </DialogTitle>
          <DialogDescription>
            {pendiente?.tratamiento}. Está incluida en tu tratamiento: no se paga de nuevo.
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

          {profesionalId && pendiente && (
            <div className="block">
              <span className="text-eyebrow text-muted-foreground">Qué día</span>
              <div className="mt-2">
                <CalendarioDeLaProfesional
                  profesionalId={profesionalId}
                  dateKey={dia}
                  onDateKey={(next) => {
                    setDia(next);
                    setHora("");
                  }}
                  {...(piso ? { noAntesDe: piso } : {})}
                  {...(piso && pendiente.desde
                    ? {
                        motivoDelPiso: `Esta sesión se puede hacer a partir del ${diaLargo(
                          pendiente.desde,
                        )}: el tratamiento pide ese descanso. Si necesitás adelantarla, escribinos.`,
                      }
                    : {})}
                />
              </div>
            </div>
          )}

          {profesionalId && fecha && (
            <div>
              <span className="text-eyebrow text-muted-foreground">A qué hora</span>
              {disponibilidad.isPending ? (
                <p className="mt-2 text-sm text-muted-foreground">Buscando horarios…</p>
              ) : disponibilidad.isError ? (
                // Antes que el "no le quedan horarios", y diciendo otra cosa:
                // una consulta que falló no es un día completo.
                <p className="mt-2 text-sm text-foreground">
                  No pudimos consultar los horarios. Probá de nuevo en un rato.
                </p>
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
                      {formatTime(h)}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        {/* La otra forma de sacarla, dicha acá adentro: es donde se traba la
            que no sabe cómo seguir. La dueña pidió que las dos opciones estén
            siempre a la vista — sacarla sola, o pedírsela a la secretaria. */}
        <p className="text-xs leading-relaxed text-muted-foreground">
          Si preferís, escribinos por WhatsApp y te la reservamos nosotras.
        </p>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Ahora no
          </Button>
          <Button
            disabled={!profesionalId || !fecha || !hora || sacar.isPending}
            onClick={() => sacar.mutate()}
          >
            {sacar.isPending ? "Reservando…" : "Reservar la sesión"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
