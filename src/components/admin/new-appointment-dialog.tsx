import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Check, ChevronsUpDown, Clock, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { supabase } from "@/integrations/supabase/client";
import { buildSlots, formatMoney, toDateKey, WEEKDAYS } from "@/lib/shiraf";
import { cn } from "@/lib/utils";

/**
 * Alta de turno desde el panel, a nombre de una clienta.
 *
 * Es el camino de los turnos que entran por teléfono o WhatsApp, que en un
 * centro de estética son buena parte de la agenda y hasta ahora no tenían forma
 * de registrarse: la única policy de INSERT exigía client_id = auth.uid(), así
 * que un turno sólo podía crearlo la propia clienta. La migración
 * 20260813050000 agrega la policy que habilita esto.
 *
 * Diferencia deliberada con el formulario público de /reservar: acá los
 * horarios sugeridos son una ayuda, no una reja. El trigger validate_appointment
 * exime al admin del control de agenda justamente porque que una profesional se
 * quede más tarde por una clienta es normal, y el panel tiene que poder
 * registrarlo. Lo que sí sigue valiendo para todos es el control de
 * superposición: dos turnos encimados con la misma profesional los rechaza la
 * base.
 */
export function NewAppointmentDialog({
  open,
  onOpenChange,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (next: boolean) => void;
  /** Se llama con el estado del turno creado, para que la lista se pare ahí. */
  onCreated: (status: "confirmed") => void;
}) {
  const queryClient = useQueryClient();

  /**
   * De quién es el turno.
   *
   * "registrada" busca entre las que ya tienen cuenta; "nueva" anota nombre y
   * teléfono sin crear ninguna. Por teléfono se consigue eso y poco más: pedir
   * un mail obligatorio para poder darla de alta habría dejado afuera justo el
   * caso más común, que es quien llama por primera vez.
   */
  const [who, setWho] = useState<"registrada" | "nueva">("registrada");

  const [clientId, setClientId] = useState<string | undefined>();
  const [clientPickerOpen, setClientPickerOpen] = useState(false);
  const [guestName, setGuestName] = useState("");
  const [guestPhone, setGuestPhone] = useState("");
  const [guestEmail, setGuestEmail] = useState("");
  const [serviceId, setServiceId] = useState<string | undefined>();
  const [professionalId, setProfessionalId] = useState<string | undefined>();
  const [dateKey, setDateKey] = useState<string>(() => toDateKey(new Date()));
  const [time, setTime] = useState<string>("");
  const [notes, setNotes] = useState("");

  function reset() {
    setWho("registrada");
    setClientId(undefined);
    setGuestName("");
    setGuestPhone("");
    setGuestEmail("");
    setServiceId(undefined);
    setProfessionalId(undefined);
    setDateKey(toDateKey(new Date()));
    setTime("");
    setNotes("");
  }

  // Claves propias y no las de las otras pantallas: `admin-clients` y
  // `admin-services` ya existen con otra forma de fila, y compartir clave con
  // un select distinto hace que react-query sirva datos a los que les faltan
  // campos hasta el refetch.
  const clients = useQuery({
    queryKey: ["appointment-form", "clients"],
    enabled: open,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("profiles")
        .select("id, full_name, phone")
        .order("full_name");
      if (error) throw error;
      return data;
    },
  });

  const services = useQuery({
    queryKey: ["appointment-form", "services"],
    enabled: open,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("services")
        .select("id, name, category, duration_minutes, price, is_published")
        .order("category")
        .order("name");
      if (error) throw error;
      return data;
    },
  });

  const professionals = useQuery({
    queryKey: ["appointment-form", "professionals", serviceId],
    enabled: open && !!serviceId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("professional_services")
        .select("professionals!inner(id, full_name, specialty, is_active)")
        .eq("service_id", serviceId!);
      if (error) throw error;
      return (data ?? [])
        .map((row) => row.professionals)
        .filter((p): p is NonNullable<typeof p> => !!p && p.is_active);
    },
  });

  const service = services.data?.find((s) => s.id === serviceId);
  const client = clients.data?.find((c) => c.id === clientId);
  const date = useMemo(() => parseDateKey(dateKey), [dateKey]);

  const availability = useQuery({
    queryKey: ["appointment-form", "availability", professionalId, dateKey],
    enabled: open && !!professionalId && !!date,
    queryFn: async () => {
      const day = new Date(date!);
      day.setHours(0, 0, 0, 0);
      const next = new Date(day);
      next.setDate(next.getDate() + 1);

      const [schedules, busy] = await Promise.all([
        supabase
          .from("professional_schedules")
          .select("weekday, start_time, end_time")
          .eq("professional_id", professionalId!),
        supabase.rpc("professional_busy_slots", {
          _professional_id: professionalId!,
          _from: day.toISOString(),
          _to: next.toISOString(),
        }),
      ]);
      if (schedules.error) throw schedules.error;
      if (busy.error) throw busy.error;

      return {
        schedules: schedules.data ?? [],
        busy: (busy.data ?? []).map((row) => ({
          starts_at: row.slot_start,
          duration_minutes: row.slot_minutes,
        })),
      };
    },
  });

  const suggested = useMemo(() => {
    if (!date || !service || !availability.data) return [];
    return buildSlots(
      date,
      availability.data.schedules,
      availability.data.busy,
      service.duration_minutes,
    );
  }, [date, service, availability.data]);

  /** Franjas de atención de ese día, para avisar cuándo se está saliendo de la agenda. */
  const daySchedules = useMemo(() => {
    if (!date || !availability.data) return [];
    return availability.data.schedules.filter((s) => s.weekday === date.getDay());
  }, [date, availability.data]);

  const startsAt = useMemo(() => {
    if (!date || !time) return null;
    const [hh, mm] = time.split(":").map(Number);
    if (hh === undefined || mm === undefined || Number.isNaN(hh) || Number.isNaN(mm)) return null;
    const value = new Date(date);
    value.setHours(hh, mm, 0, 0);
    return value;
  }, [date, time]);

  /** Fuera de la franja de atención: se permite igual, pero se avisa. */
  const outsideSchedule = useMemo(() => {
    if (!startsAt || !service || daySchedules.length === 0) return daySchedules.length === 0;
    const minutes = startsAt.getHours() * 60 + startsAt.getMinutes();
    const end = minutes + service.duration_minutes;
    return !daySchedules.some((s) => {
      const [sh = 0, sm = 0] = s.start_time.split(":").map(Number);
      const [eh = 0, em = 0] = s.end_time.split(":").map(Number);
      return minutes >= sh * 60 + sm && end <= eh * 60 + em;
    });
  }, [startsAt, service, daySchedules]);

  const create = useMutation({
    mutationFn: async () => {
      // duration_minutes y price los pisa el trigger validate_appointment con
      // los del catálogo; se manda la duración igual para no romper el tipo
      // generado, que la tiene como obligatoria.
      const { error } = await supabase.from("appointments").insert({
        // Una cosa o la otra, nunca las dos: el trigger descarta los datos de
        // invitada si viene client_id, pero mandar sólo lo que corresponde deja
        // la intención clara desde acá.
        ...(who === "registrada"
          ? { client_id: clientId! }
          : {
              guest_name: guestName.trim(),
              guest_phone: guestPhone.trim() || null,
              guest_email: guestEmail.trim() || null,
            }),
        service_id: serviceId!,
        professional_id: professionalId!,
        starts_at: startsAt!.toISOString(),
        duration_minutes: service!.duration_minutes,
        status: "confirmed",
        client_notes: notes.trim() || null,
      });
      if (error) throw error;
    },
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["admin-appointments"] }),
        queryClient.invalidateQueries({ queryKey: ["admin-calendar"] }),
        queryClient.invalidateQueries({ queryKey: ["appointment-form", "availability"] }),
      ]);
      toast.success("Turno cargado y confirmado.");
      reset();
      onOpenChange(false);
      onCreated("confirmed");
    },
    onError: (error: Error) => {
      // El trigger check_appointment_overlap rechaza los turnos encimados, y
      // vale también para el panel: el mensaje crudo de Postgres no le dice
      // nada a nadie.
      if (error.message.includes("ya fue tomado") || error.message.includes("exclusion")) {
        toast.error("Esa profesional ya tiene un turno a esa hora.");
        return;
      }
      toast.error(error.message);
    },
  });

  const whoReady = who === "registrada" ? !!clientId : guestName.trim().length > 0;
  const ready = whoReady && !!serviceId && !!professionalId && !!startsAt;

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        onOpenChange(next);
        if (!next) reset();
      }}
    >
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="font-display text-2xl">Nuevo turno</DialogTitle>
          <DialogDescription>
            Para los turnos que entran por teléfono o WhatsApp. Queda confirmado directamente.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* ── De quién es el turno ───────────────────────────────────── */}
          <div className="space-y-2">
            <Label>Clienta</Label>
            <div className="grid grid-cols-2 gap-2">
              {(["registrada", "nueva"] as const).map((option) => (
                <Button
                  key={option}
                  type="button"
                  variant={who === option ? "default" : "outline"}
                  className="font-normal"
                  onClick={() => setWho(option)}
                >
                  {option === "registrada" ? "Ya tiene cuenta" : "Es nueva"}
                </Button>
              ))}
            </div>
          </div>

          {who === "registrada" ? (
            <div className="space-y-2">
              <Popover open={clientPickerOpen} onOpenChange={setClientPickerOpen}>
                <PopoverTrigger asChild>
                  <Button
                    variant="outline"
                    role="combobox"
                    aria-expanded={clientPickerOpen}
                    className="w-full justify-between font-normal"
                  >
                    {client ? (
                      <span className="truncate">
                        {client.full_name ?? "Sin nombre"}
                        {client.phone && (
                          <span className="text-muted-foreground"> · {client.phone}</span>
                        )}
                      </span>
                    ) : (
                      <span className="text-muted-foreground">Buscar clienta…</span>
                    )}
                    <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-[--radix-popover-trigger-width] p-0" align="start">
                  <Command>
                    <CommandInput placeholder="Nombre o teléfono…" />
                    <CommandList>
                      <CommandEmpty>
                        <span className="block px-2 py-3 text-xs leading-relaxed">
                          No aparece ninguna. Si es la primera vez que viene, usá{" "}
                          <span className="font-medium">Es nueva</span>.
                        </span>
                      </CommandEmpty>
                      <CommandGroup>
                        {clients.data?.map((c) => (
                          <CommandItem
                            key={c.id}
                            // `value` es lo que filtra cmdk: sin el teléfono acá,
                            // buscar por número no encontraría nada.
                            value={`${c.full_name ?? "sin nombre"} ${c.phone ?? ""}`}
                            onSelect={() => {
                              setClientId(c.id);
                              setClientPickerOpen(false);
                            }}
                          >
                            <Check
                              className={cn(
                                "mr-2 h-4 w-4",
                                clientId === c.id ? "opacity-100" : "opacity-0",
                              )}
                            />
                            <span className="truncate">
                              {c.full_name ?? "Sin nombre"}
                              {c.phone && (
                                <span className="text-muted-foreground"> · {c.phone}</span>
                              )}
                            </span>
                          </CommandItem>
                        ))}
                      </CommandGroup>
                    </CommandList>
                  </Command>
                </PopoverContent>
              </Popover>
            </div>
          ) : (
            /* Clienta sin cuenta. No se le crea usuario: por teléfono se
               consigue un nombre y un celular, y con eso alcanza para que el
               turno exista en la agenda. */
            <div className="space-y-3 rounded-sm border border-border bg-secondary/30 p-3">
              <div className="space-y-2">
                <Label htmlFor="na-guest-name">Nombre y apellido</Label>
                <Input
                  id="na-guest-name"
                  value={guestName}
                  onChange={(e) => setGuestName(e.target.value)}
                  placeholder="Como te lo dictó por teléfono"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-2">
                  <Label htmlFor="na-guest-phone">Teléfono</Label>
                  <Input
                    id="na-guest-phone"
                    value={guestPhone}
                    onChange={(e) => setGuestPhone(e.target.value)}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="na-guest-email">Mail (opcional)</Label>
                  <Input
                    id="na-guest-email"
                    type="email"
                    value={guestEmail}
                    onChange={(e) => setGuestEmail(e.target.value)}
                  />
                </div>
              </div>
              {/* Este texto decía que el teléfono servía para vincularle el
                  turno cuando se registrara. Prometía de más: el teléfono no lo
                  verifica nadie, así que por ahí la vinculación es a mano y la
                  confirma quien atiende. Automática, sólo por mail — que
                  Supabase confirma con un enlace. */}
              <p className="text-xs leading-relaxed text-muted-foreground">
                No se le crea una cuenta.{" "}
                {guestEmail.trim()
                  ? "Como dejaste su mail, el día que se registre con esa casilla sus turnos van a aparecer solos en su historial."
                  : "Si te da el mail, el día que se registre con esa casilla sus turnos aparecen solos en su historial. Sin mail se vinculan igual, pero a mano desde la lista de turnos."}
              </p>
            </div>
          )}

          {/* ── Tratamiento ────────────────────────────────────────────── */}
          <div className="space-y-2">
            <Label htmlFor="na-service">Tratamiento</Label>
            <select
              id="na-service"
              value={serviceId ?? ""}
              onChange={(e) => {
                setServiceId(e.target.value || undefined);
                setProfessionalId(undefined);
                setTime("");
              }}
              className="h-10 w-full rounded-sm border border-input bg-background px-3 text-sm text-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none"
            >
              <option value="">Elegir…</option>
              {services.data?.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.category} · {s.name} — {s.duration_minutes} min · {formatMoney(s.price)}
                  {s.is_published ? "" : " (despublicado)"}
                </option>
              ))}
            </select>
          </div>

          {/* ── Profesional ────────────────────────────────────────────── */}
          {serviceId && (
            <div className="space-y-2">
              <Label htmlFor="na-professional">Profesional</Label>
              <select
                id="na-professional"
                value={professionalId ?? ""}
                onChange={(e) => {
                  setProfessionalId(e.target.value || undefined);
                  setTime("");
                }}
                className="h-10 w-full rounded-sm border border-input bg-background px-3 text-sm text-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none"
              >
                <option value="">Elegir…</option>
                {professionals.data?.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.full_name}
                    {p.specialty ? ` — ${p.specialty}` : ""}
                  </option>
                ))}
              </select>
              {professionals.data?.length === 0 && (
                <p className="text-xs text-muted-foreground">
                  Ninguna profesional tiene asignado este tratamiento. Asignáselo en Profesionales.
                </p>
              )}
            </div>
          )}

          {/* ── Día y hora ─────────────────────────────────────────────── */}
          {professionalId && (
            <>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="na-date">Día</Label>
                  <Input
                    id="na-date"
                    type="date"
                    value={dateKey}
                    onChange={(e) => {
                      setDateKey(e.target.value);
                      setTime("");
                    }}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="na-time">Hora</Label>
                  <Input
                    id="na-time"
                    type="time"
                    value={time}
                    onChange={(e) => setTime(e.target.value)}
                  />
                </div>
              </div>

              <div className="space-y-2">
                <p className="text-xs text-muted-foreground">
                  {daySchedules.length > 0 ? (
                    <>
                      {WEEKDAYS[date?.getDay() ?? 0]}:{" "}
                      {daySchedules
                        .map((s) => `${s.start_time.slice(0, 5)}–${s.end_time.slice(0, 5)}`)
                        .join(", ")}
                    </>
                  ) : (
                    <>Esta profesional no atiende ese día.</>
                  )}
                </p>

                {suggested.length > 0 && (
                  <div className="flex flex-wrap gap-1.5">
                    {suggested.map((iso) => {
                      const label = toTimeInput(iso);
                      return (
                        <Button
                          key={iso}
                          type="button"
                          size="sm"
                          variant={time === label ? "default" : "outline"}
                          className="h-8"
                          onClick={() => setTime(label)}
                        >
                          {label}
                        </Button>
                      );
                    })}
                  </div>
                )}

                {/* Aviso, no bloqueo: el trigger exime al admin del control de
                    agenda a propósito. La superposición sí la frena la base. */}
                {startsAt && outsideSchedule && (
                  <p className="flex items-start gap-2 rounded-sm border border-gold/50 bg-gold/10 p-2.5 text-xs text-foreground">
                    <Clock className="mt-0.5 h-3.5 w-3.5 shrink-0 text-gold" />
                    Ese horario queda fuera de la agenda habitual de la profesional. Se puede cargar
                    igual.
                  </p>
                )}
              </div>
            </>
          )}

          {/* ── Nota ───────────────────────────────────────────────────── */}
          <div className="space-y-2">
            <Label htmlFor="na-notes">Nota (opcional)</Label>
            <Textarea
              id="na-notes"
              rows={2}
              placeholder="Alergias, embarazo, lo que haya contado por teléfono…"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
            />
          </div>

          {startsAt && service && (
            <div className="rounded-sm border border-border bg-secondary/40 p-3 text-sm">
              <div className="flex items-center justify-between gap-3">
                <span className="text-muted-foreground">Total</span>
                <span className="font-semibold text-foreground">{formatMoney(service.price)}</span>
              </div>
              <p className="mt-1 text-xs text-muted-foreground">
                El precio queda congelado en el turno, aunque después cambie el del catálogo.
              </p>
            </div>
          )}

          <Button
            className="w-full"
            size="lg"
            disabled={!ready || create.isPending}
            onClick={() => create.mutate()}
          >
            <Plus className="mr-2 h-4 w-4" />
            Cargar turno
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/**
 * "2026-08-13" → Date local a medianoche.
 *
 * `new Date("2026-08-13")` lo interpretaría como UTC y, al oeste de Greenwich,
 * devolvería el día anterior. Por eso se arma por partes.
 */
function parseDateKey(key: string): Date | undefined {
  const [y, m, d] = key.split("-").map(Number);
  if (!y || !m || !d) return undefined;
  const date = new Date(y, m - 1, d);
  return Number.isNaN(date.getTime()) ? undefined : date;
}

/**
 * Date → "HH:MM", el formato que espera <input type="time">.
 *
 * A mano y no con formatTime(), que usa toLocaleTimeString: el valor se compara
 * contra el del input para marcar el horario elegido, y alcanza con que el
 * locale devuelva "10:00 a. m." para que la comparación no case nunca.
 */
function toTimeInput(iso: string): string {
  const d = new Date(iso);
  return `${`${d.getHours()}`.padStart(2, "0")}:${`${d.getMinutes()}`.padStart(2, "0")}`;
}
