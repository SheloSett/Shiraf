import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Check, ChevronsUpDown, Plus } from "lucide-react";
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
import { TeamTag } from "@/components/admin/team-tag";
import { SelectorDeHorario } from "@/components/admin/selector-de-horario";
import { instanteDe } from "@/lib/horarios";
import { api, apiPost } from "@/lib/api";
import type {
  RtaClientasParaElegir,
  RtaProfesionalesConHorarios,
  RtaServiciosParaTurno,
} from "@/lib/api-tipos";
import { useTeamMemberIds } from "@/hooks/useTeamMemberIds";
import { formatMoney, toDateKey } from "@/lib/shiraf";
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
  /** La opcion del tratamiento, cuando el tratamiento tiene. Ver service_variants. */
  const [variantId, setVariantId] = useState<string | undefined>();
  const [professionalId, setProfessionalId] = useState<string | undefined>();
  const [dateKey, setDateKey] = useState<string>(() => toDateKey(new Date()));
  const [time, setTime] = useState<string>("");
  const [notes, setNotes] = useState("");

  /**
   * Escribir la hora a mano en vez de elegirla de la lista.
   *
   * Arranca apagado. Antes el campo libre era lo único que había y el reloj del
   * navegador ofrecía las 22, las 4 de la mañana y cualquier cosa: nada de eso
   * es un horario en el que el centro atienda, y estaba a un dedazo de
   * distancia.
   *
   * Queda igual detrás de este botón porque es el motivo por el que el campo
   * libre existía: el trigger validate_appointment exime a propósito a quien
   * gestiona turnos del control de agenda, para que una profesional que se
   * queda más tarde por una clienta se pueda registrar. Sacarlo del todo
   * dejaría ese turno sin ninguna forma de cargarse.
   */
  const [manualTime, setManualTime] = useState(false);

  function reset() {
    setWho("registrada");
    setClientId(undefined);
    setGuestName("");
    setGuestPhone("");
    setGuestEmail("");
    setServiceId(undefined);
    setVariantId(undefined);
    setProfessionalId(undefined);
    setDateKey(toDateKey(new Date()));
    setTime("");
    setManualTime(false);
    setNotes("");
  }

  // Claves propias y no las de las otras pantallas: `admin-clients` y
  // `admin-services` ya existen con otra forma de fila, y compartir clave con
  // un select distinto hace que react-query sirva datos a los que les faltan
  // campos hasta el refetch.
  const clients = useQuery({
    queryKey: ["appointment-form", "clients"],
    enabled: open,
    queryFn: async () => (await api<RtaClientasParaElegir>("/api/turnos/clientas")).clientas,
  });

  const services = useQuery({
    queryKey: ["appointment-form", "services"],
    enabled: open,
    // Vienen los despublicados también, con la marca: el centro puede cargar un
    // turno de un tratamiento que todavía no está en el sitio.
    queryFn: async () => (await api<RtaServiciosParaTurno>("/api/turnos/servicios")).servicios,
  });

  const professionals = useQuery({
    queryKey: ["appointment-form", "professionals", serviceId],
    enabled: open && !!serviceId,
    queryFn: async () =>
      (await api<RtaProfesionalesConHorarios>(`/api/publico/servicios/${serviceId}/profesionales`))
        .profesionales,
  });

  /**
   * Quiénes de esa lista son del equipo y no clientas.
   *
   * `profiles` tiene una fila por cada cuenta, así que la consulta de arriba
   * trae también a las empleadas y a la dueña. No se las esconde a propósito:
   * una empleada también se atiende en el centro y hay que poder cargarle el
   * turno. Se las marca y se las manda al final.
   */
  const teamIds = useTeamMemberIds(open);

  // Las clientas primero, el equipo después. `sort` es estable, así que adentro
  // de cada grupo se mantiene el orden alfabético que ya trajo la consulta.
  const pickerClients = useMemo(() => {
    const rows = clients.data ?? [];
    if (teamIds.size === 0) return rows;
    return [...rows].sort((a, b) => Number(teamIds.has(a.id)) - Number(teamIds.has(b.id)));
  }, [clients.data, teamIds]);

  const service = services.data?.find((s) => s.id === serviceId);
  const variant = service?.variants.find((v) => v.id === variantId);

  /**
   * Lo que dura y lo que sale este turno.
   *
   * De la opcion cuando el tratamiento tiene opciones, del tratamiento cuando
   * no. Con opciones cargadas hay que elegir una: el servidor rechaza el alta
   * que no la traiga, porque el precio del tratamiento en ese caso no es el
   * de nadie.
   */
  const duracion = variant?.duration_minutes ?? service?.duration_minutes ?? 0;
  const margen = variant?.buffer_minutes ?? service?.buffer_minutes ?? 0;
  const precio = variant?.price ?? service?.price ?? 0;
  const faltaOpcion = !!service && service.variants.length > 0 && !variant;

  const client = clients.data?.find((c) => c.id === clientId);

  /**
   * El instante elegido, o null mientras falte el día o la hora.
   *
   * La consulta de disponibilidad, los horarios libres y el aviso de "fuera de
   * horario" se mudaron a `SelectorDeHorario`: los tres lugares del panel donde
   * se elige un horario —cargar, mover y agendar la sesión siguiente— tienen que
   * ofrecer lo mismo, y con el código copiado en cada uno eso duraba hasta el
   * primer arreglo.
   */
  const startsAt = instanteDe(dateKey, time);

  const create = useMutation({
    mutationFn: async () => {
      // Sin duration_minutes ni price: los fija validarTurno() leyéndolos del
      // catálogo, igual que antes los pisaba el trigger. Y sin status: nace
      // confirmado porque lo carga el centro.
      await apiPost("/api/turnos", {
        // Una cosa o la otra, nunca las dos.
        ...(who === "registrada"
          ? { client_id: clientId }
          : {
              guest_name: guestName.trim(),
              guest_phone: guestPhone.trim() || null,
              guest_email: guestEmail.trim() || null,
            }),
        service_id: serviceId,
        // El id de la opcion, nunca su precio: lo lee validarTurno del catalogo.
        variant_id: variantId ?? null,
        professional_id: professionalId,
        starts_at: startsAt!.toISOString(),
        client_notes: notes.trim() || null,
      });
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
  // `!faltaOpcion`: con opciones cargadas, sin elegir una no hay precio ni
  // duracion, y el alta la rechazaria el servidor.
  const ready = whoReady && !!serviceId && !faltaOpcion && !!professionalId && !!startsAt;

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
                      <span className="flex min-w-0 items-center">
                        <span className="truncate">
                          {client.full_name ?? "Sin nombre"}
                          {client.phone && (
                            <span className="text-muted-foreground"> · {client.phone}</span>
                          )}
                        </span>
                        {/* También acá, y no sólo en la lista: si no, se elige a
                            una empleada, se cierra el desplegable y el turno se
                            carga sin que nada haya vuelto a avisar. */}
                        {teamIds.has(client.id) && <TeamTag />}
                      </span>
                    ) : (
                      <span className="text-muted-foreground">Buscar clienta…</span>
                    )}
                    <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-(--radix-popover-trigger-width) p-0" align="start">
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
                        {pickerClients.map((c) => (
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
                            {teamIds.has(c.id) && <TeamTag />}
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
                // La opcion es de ESTE tratamiento: al cambiarlo deja de valer.
                setVariantId(undefined);
                setProfessionalId(undefined);
                setTime("");
              }}
              className="h-10 w-full rounded-sm border border-input bg-background px-3 text-sm text-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none"
            >
              <option value="">Elegir…</option>
              {services.data?.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.category} · {s.name} —{" "}
                  {s.variants.length > 0
                    ? `${s.variants.length} opciones`
                    : `${s.duration_minutes} min · ${formatMoney(s.price)}`}
                  {s.is_published ? "" : " (despublicado)"}
                </option>
              ))}
            </select>
          </div>

          {/* ── Opción del tratamiento ─────────────────────────────────── */}
          {service && service.variants.length > 0 && (
            <div className="space-y-2">
              <Label htmlFor="na-variant">Opción</Label>
              <select
                id="na-variant"
                value={variantId ?? ""}
                onChange={(e) => {
                  setVariantId(e.target.value || undefined);
                  // Los horarios sugeridos dependen de cuánto dura: una opción
                  // del doble de duración no entra en los mismos huecos.
                  setTime("");
                }}
                className="h-10 w-full rounded-sm border border-input bg-background px-3 text-sm text-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none"
              >
                <option value="">Elegir…</option>
                {service.variants.map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.name} — {v.duration_minutes} min · {formatMoney(v.price)}
                  </option>
                ))}
              </select>
              {faltaOpcion && (
                <p className="text-xs text-muted-foreground">
                  Este tratamiento se hace de más de una forma: de la opción salen el precio y la
                  duración del turno.
                </p>
              )}
            </div>
          )}

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
            <SelectorDeHorario
              idPrefijo="na"
              profesionalId={professionalId}
              duracion={duracion}
              margen={margen}
              dateKey={dateKey}
              onDateKey={setDateKey}
              time={time}
              onTime={setTime}
              manual={manualTime}
              onManual={setManualTime}
            />
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
                <span className="font-semibold text-foreground">{formatMoney(precio)}</span>
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
