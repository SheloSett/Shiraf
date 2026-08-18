import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { CalendarCheck, KeyRound, Pencil, Plus, Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { supabase } from "@/integrations/supabase/client";
import { useAccess } from "@/hooks/useAccess";
import { WEEKDAYS } from "@/lib/shiraf";
import { linkProfessionalAccount } from "@/lib/team";
import { createEmployee } from "@/lib/team.functions";

export const Route = createFileRoute("/_authenticated/admin/profesionales")({
  component: AdminProfessionals,
});

type ProfessionalForm = {
  full_name: string;
  specialty: string;
  bio: string;
  is_active: boolean;
};

/** Horario en edición. Sin `id` = todavía no existe en la base. */
type DraftSchedule = {
  id?: string;
  weekday: number;
  start_time: string;
  end_time: string;
};

const EMPTY_FORM: ProfessionalForm = {
  full_name: "",
  specialty: "",
  bio: "",
  is_active: true,
};

/** Fila que se agrega al tocar "Agregar horario"; después se edita en el lugar. */
const DEFAULT_SCHEDULE: DraftSchedule = { weekday: 1, start_time: "09:00", end_time: "17:00" };

function AdminProfessionals() {
  const queryClient = useQueryClient();
  // Crear la cuenta y atarla a la ficha es cosa de la dueña: el alta de gente no
  // se delega, y el trigger de `professionals.user_id` tampoco lo permitiría.
  const { isAdmin } = useAccess();

  /** Ficha a la que se le está creando la cuenta, o null. */
  const [granting, setGranting] = useState<{ id: string; name: string } | null>(null);
  const [grantEmail, setGrantEmail] = useState("");
  const [grantPassword, setGrantPassword] = useState("");

  const [formOpen, setFormOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<ProfessionalForm>(EMPTY_FORM);

  // Tratamientos y horarios se editan en el mismo diálogo que los datos. En un
  // alta no hay id todavía, así que se juntan acá y se graban recién cuando la
  // profesional existe; en una edición se comparan contra lo que ya estaba.
  const [draftServices, setDraftServices] = useState<Set<string>>(new Set());
  const [draftSchedules, setDraftSchedules] = useState<DraftSchedule[]>([]);

  const [deleting, setDeleting] = useState<{ id: string; name: string } | null>(null);
  /** Baja temporal a confirmar. Sólo se pide confirmación si tiene turnos futuros. */
  const [deactivating, setDeactivating] = useState<{
    id: string;
    name: string;
    count: number;
  } | null>(null);

  const team = useQuery({
    queryKey: ["admin-professionals"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("professionals")
        .select(
          "id, full_name, specialty, bio, is_active, user_id, professional_services(id, service_id, services(id, name)), professional_schedules(id, weekday, start_time, end_time)",
        )
        .order("full_name");
      if (error) throw error;
      return data;
    },
  });

  const services = useQuery({
    // Clave propia y no ["admin-services"] a secas, que es la que usa la
    // pantalla de Servicios con un select mucho más grande. Compartiéndola,
    // react-query servía a las dos lo que hubiera cacheado la primera: al
    // entrar a Servicios viniendo de acá, la tabla mostraba precio, duración y
    // publicado vacíos hasta que refetcheaba.
    //
    // El prefijo se mantiene a propósito: invalidar ["admin-services"] desde
    // Servicios sigue alcanzando a esta lista, que es lo que se quiere cuando
    // se crea o se borra un tratamiento.
    queryKey: ["admin-services", "picker"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("services")
        .select("id, name, category")
        .order("category")
        .order("name");
      if (error) throw error;
      return data;
    },
  });

  /**
   * Turnos futuros sin realizar, por profesional.
   *
   * Desactivar o borrar a alguien no toca sus turnos ya reservados: quedan
   * agendados con una profesional que ya no atiende, y nadie se entera hasta
   * que la clienta se presenta. Esto no lo impide —a veces es exactamente lo
   * que se quiere, porque renunció— pero lo pone a la vista para poder
   * reasignarlos antes.
   *
   * Ojo: leer turnos ajenos exige el permiso `appointments`. Sin él la RLS
   * devuelve vacío y el aviso no aparece. Es una limitación conocida y no un
   * bug: quien gestiona el equipo sin ver la agenda no tiene con qué avisar.
   */
  const upcoming = useQuery({
    queryKey: ["professionals-upcoming"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("appointments")
        .select("professional_id")
        .in("status", ["pending", "confirmed"])
        .gte("starts_at", new Date().toISOString());
      if (error) throw error;

      const counts = new Map<string, number>();
      for (const row of data ?? []) {
        if (!row.professional_id) continue;
        counts.set(row.professional_id, (counts.get(row.professional_id) ?? 0) + 1);
      }
      return counts;
    },
  });

  function upcomingFor(professionalId: string): number {
    return upcoming.data?.get(professionalId) ?? 0;
  }

  async function refresh() {
    await queryClient.invalidateQueries({ queryKey: ["professionals-upcoming"] });
    await queryClient.invalidateQueries({ queryKey: ["admin-professionals"] });
    // Las páginas públicas y el formulario de reserva leen los mismos datos.
    await queryClient.invalidateQueries({ queryKey: ["professionals"] });
  }

  const save = useMutation({
    mutationFn: async () => {
      const payload = {
        full_name: form.full_name.trim(),
        specialty: form.specialty.trim() || null,
        bio: form.bio.trim() || null,
        is_active: form.is_active,
      };

      const original = team.data?.find((p) => p.id === editingId);
      let professionalId = editingId;

      if (professionalId) {
        const { error } = await supabase
          .from("professionals")
          .update(payload)
          .eq("id", professionalId);
        if (error) throw error;
      } else {
        // Hace falta el id devuelto para poder colgarle tratamientos y horarios.
        const { data, error } = await supabase
          .from("professionals")
          .insert(payload)
          .select("id")
          .single();
        if (error) throw error;
        professionalId = data.id;
      }

      // ── Tratamientos ──────────────────────────────────────────────────────
      const existingLinks = new Map(
        (original?.professional_services ?? []).map((ps) => [ps.service_id, ps.id]),
      );

      const servicesToAdd = [...draftServices].filter((id) => !existingLinks.has(id));
      const linksToRemove = [...existingLinks.entries()]
        .filter(([serviceId]) => !draftServices.has(serviceId))
        .map(([, linkId]) => linkId);

      if (servicesToAdd.length > 0) {
        const { error } = await supabase.from("professional_services").insert(
          servicesToAdd.map((serviceId) => ({
            professional_id: professionalId,
            service_id: serviceId,
          })),
        );
        if (error) throw error;
      }

      if (linksToRemove.length > 0) {
        const { error } = await supabase
          .from("professional_services")
          .delete()
          .in("id", linksToRemove);
        if (error) throw error;
      }

      // ── Horarios ──────────────────────────────────────────────────────────
      const invalid = draftSchedules.find((s) => s.start_time >= s.end_time);
      if (invalid) {
        throw new Error(
          `El horario del ${WEEKDAYS[invalid.weekday]} termina antes de empezar. Corregilo para guardar.`,
        );
      }

      const originalSchedules = original?.professional_schedules ?? [];
      const keptScheduleIds = new Set(
        draftSchedules.map((s) => s.id).filter((id): id is string => !!id),
      );

      const schedulesToAdd = draftSchedules.filter((s) => !s.id);
      const schedulesToRemove = originalSchedules
        .map((s) => s.id)
        .filter((id) => !keptScheduleIds.has(id));

      // Filas que ya existían y cambiaron de día u horario: se actualizan en vez
      // de borrarse y recrearse, así conservan su id.
      const schedulesToUpdate = draftSchedules.filter((s) => {
        if (!s.id) return false;
        const before = originalSchedules.find((o) => o.id === s.id);
        if (!before) return false;
        return (
          before.weekday !== s.weekday ||
          before.start_time.slice(0, 5) !== s.start_time ||
          before.end_time.slice(0, 5) !== s.end_time
        );
      });

      if (schedulesToAdd.length > 0) {
        const { error } = await supabase.from("professional_schedules").insert(
          schedulesToAdd.map((s) => ({
            professional_id: professionalId,
            weekday: s.weekday,
            start_time: s.start_time,
            end_time: s.end_time,
          })),
        );
        if (error) throw error;
      }

      for (const s of schedulesToUpdate) {
        const { error } = await supabase
          .from("professional_schedules")
          .update({
            weekday: s.weekday,
            start_time: s.start_time,
            end_time: s.end_time,
          })
          .eq("id", s.id!);
        if (error) throw error;
      }

      if (schedulesToRemove.length > 0) {
        const { error } = await supabase
          .from("professional_schedules")
          .delete()
          .in("id", schedulesToRemove);
        if (error) throw error;
      }
    },
    onSuccess: async () => {
      await refresh();
      const wasEditing = !!editingId;
      closeForm();
      toast.success(wasEditing ? "Profesional actualizada." : "Profesional creada.");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const remove = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("professionals").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: async () => {
      await refresh();
      setDeleting(null);
      toast.success("Profesional eliminada.");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  /**
   * Le crea la cuenta a una profesional y se la ata a su ficha, en un solo paso.
   *
   * Antes esto eran dos pantallas: cargar la ficha acá y después ir a Equipo a
   * crear a la misma persona de nuevo —escribiendo el nombre por segunda vez—
   * para recién ahí vincularla. El nombre ya lo sabemos: sale de la ficha.
   *
   * La cuenta se crea SIN ningún acceso tildado. Con eso ve su agenda y nada
   * más, que es exactamente lo que se quiso. Si además atiende el teléfono o
   * carga turnos, las casillas se tildan después en Equipo — pero eso es una
   * decisión aparte y no tiene por qué colarse en el alta.
   */
  const grantAccess = useMutation({
    mutationFn: async () => {
      if (!granting) throw new Error("No hay ninguna profesional seleccionada.");

      const created = await createEmployee({
        data: {
          email: grantEmail.trim(),
          password: grantPassword,
          fullName: granting.name,
          permissions: [],
        },
      });

      // Si el vínculo falla, la cuenta ya existe y sirve: no se deshace nada.
      // Se avisa distinto para que se pueda atar a mano desde Equipo en vez de
      // quedar una cuenta huérfana sin que nadie se entere.
      try {
        await linkProfessionalAccount(created.id, granting.id);
      } catch (error) {
        return {
          ...created,
          linkError: error instanceof Error ? error.message : "",
        };
      }
      return { ...created, linkError: null as string | null };
    },
    onSuccess: async (result) => {
      await refresh();
      // Equipo lista las mismas cuentas y las mismas fichas.
      await queryClient.invalidateQueries({ queryKey: ["admin-team"] });
      await queryClient.invalidateQueries({ queryKey: ["admin-team-professionals"] });
      closeGrant();
      if (result.linkError) {
        toast.warning(
          `Se creó la cuenta de ${result.fullName}, pero no se pudo atar a su ficha. Hacelo desde Equipo. (${result.linkError})`,
        );
      } else {
        toast.success(`${result.fullName} ya entra con ${result.email} y ve su agenda.`);
      }
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const toggleActive = useMutation({
    mutationFn: async ({ id, value }: { id: string; value: boolean }) => {
      const { error } = await supabase
        .from("professionals")
        .update({ is_active: value })
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: refresh,
    onError: (e: Error) => toast.error(e.message),
  });

  function closeForm() {
    setFormOpen(false);
    setEditingId(null);
    setForm(EMPTY_FORM);
    setDraftServices(new Set());
    setDraftSchedules([]);
  }

  function closeGrant() {
    setGranting(null);
    setGrantEmail("");
    setGrantPassword("");
  }

  function openCreate() {
    setEditingId(null);
    setForm(EMPTY_FORM);
    setDraftServices(new Set());
    setDraftSchedules([]);
    setFormOpen(true);
  }

  function openEdit(p: NonNullable<typeof team.data>[number]) {
    setEditingId(p.id);
    setForm({
      full_name: p.full_name,
      specialty: p.specialty ?? "",
      bio: p.bio ?? "",
      is_active: p.is_active,
    });
    setDraftServices(new Set(p.professional_services.map((ps) => ps.service_id)));
    setDraftSchedules(
      [...p.professional_schedules]
        .sort((a, b) => a.weekday - b.weekday)
        .map((s) => ({
          id: s.id,
          weekday: s.weekday,
          // La base devuelve "09:00:00" y el input type=time espera "09:00".
          start_time: s.start_time.slice(0, 5),
          end_time: s.end_time.slice(0, 5),
        })),
    );
    setFormOpen(true);
  }

  function addDraftSchedule() {
    setDraftSchedules((prev) => [...prev, { ...DEFAULT_SCHEDULE }]);
  }

  function updateDraftSchedule(index: number, patch: Partial<DraftSchedule>) {
    setDraftSchedules((prev) =>
      prev.map((schedule, i) => (i === index ? { ...schedule, ...patch } : schedule)),
    );
  }

  /** El largo mínimo lo pide Supabase; el mail lo valida el zod del servidor. */
  const grantReady = grantEmail.trim().length > 0 && grantPassword.length >= 8;

  return (
    <div>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-eyebrow text-muted-foreground">Equipo</p>
          <h1 className="mt-3 font-display text-4xl text-foreground">Profesionales</h1>
        </div>
        <Button onClick={openCreate}>
          <Plus className="mr-2 h-4 w-4" /> Nueva profesional
        </Button>
      </div>

      <p className="mt-4 max-w-lg text-sm text-muted-foreground">
        Cada profesional tiene sus tratamientos y sus días de atención. Los horarios definen los
        turnos disponibles para las clientas.
      </p>

      <div className="mt-8 grid gap-5 lg:grid-cols-2">
        {team.data?.map((p) => (
          <Card key={p.id} className="border-border/80 shadow-soft">
            <CardContent className="p-6">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <h2 className="font-display text-2xl text-foreground">{p.full_name}</h2>
                  <p className="mt-1 text-sm text-gold">{p.specialty}</p>
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  <Switch
                    className="mr-2"
                    checked={p.is_active}
                    onCheckedChange={(value) => {
                      // Activar nunca pregunta; desactivar sólo si deja turnos
                      // colgados. Un interruptor que abre un diálogo cada vez
                      // deja de sentirse un interruptor.
                      const pending = upcomingFor(p.id);
                      if (!value && pending > 0) {
                        setDeactivating({ id: p.id, name: p.full_name, count: pending });
                        return;
                      }
                      toggleActive.mutate({ id: p.id, value });
                    }}
                    aria-label={`${p.is_active ? "Desactivar" : "Activar"} a ${p.full_name}`}
                  />
                  <Button
                    size="icon"
                    variant="ghost"
                    className="h-9 w-9"
                    aria-label={`Editar ${p.full_name}`}
                    onClick={() => openEdit(p)}
                  >
                    <Pencil className="h-4 w-4" />
                  </Button>
                  <Button
                    size="icon"
                    variant="ghost"
                    className="h-9 w-9 text-destructive hover:text-destructive"
                    aria-label={`Eliminar ${p.full_name}`}
                    onClick={() => setDeleting({ id: p.id, name: p.full_name })}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </div>

              {!p.is_active && (
                <Badge variant="outline" className="mt-3">
                  Inactiva — no aparece en el sitio
                </Badge>
              )}

              <p className="mt-4 text-sm leading-relaxed text-muted-foreground">{p.bio}</p>

              <div className="mt-6 grid gap-6 sm:grid-cols-2">
                <div>
                  <p className="text-eyebrow text-muted-foreground">Tratamientos</p>
                  <div className="mt-3 flex flex-wrap gap-2">
                    {p.professional_services.map((ps) => (
                      <Badge key={ps.id} variant="secondary" className="font-normal">
                        {ps.services?.name}
                      </Badge>
                    ))}
                    {p.professional_services.length === 0 && (
                      <span className="text-xs text-muted-foreground">Sin tratamientos</span>
                    )}
                  </div>
                </div>

                <div>
                  <p className="text-eyebrow text-muted-foreground">Horarios</p>
                  <ul className="mt-3 space-y-1 text-sm text-muted-foreground">
                    {[...p.professional_schedules]
                      .sort((a, b) => a.weekday - b.weekday)
                      .map((s) => (
                        <li key={s.id}>
                          {WEEKDAYS[s.weekday]} · {s.start_time.slice(0, 5)}–
                          {s.end_time.slice(0, 5)}
                        </li>
                      ))}
                    {p.professional_schedules.length === 0 && (
                      <li className="text-xs">Sin horarios — no se le pueden sacar turnos</li>
                    )}
                  </ul>
                </div>
              </div>

              {/* El acceso al panel, en la misma tarjeta donde está el resto de
                  sus datos. Antes había que ir a Equipo y volver a cargar a la
                  misma persona desde cero para poder vincularla. */}
              <div className="mt-6 flex flex-wrap items-center justify-between gap-3 border-t border-border pt-4">
                {p.user_id ? (
                  <p className="flex items-center gap-2 text-xs text-muted-foreground">
                    <CalendarCheck className="h-3.5 w-3.5 shrink-0 text-gold" />
                    Entra al panel y ve su agenda
                  </p>
                ) : (
                  <p className="text-xs text-muted-foreground">Sin acceso al panel</p>
                )}

                {isAdmin && !p.user_id && (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => setGranting({ id: p.id, name: p.full_name })}
                  >
                    <KeyRound className="mr-2 h-4 w-4" /> Darle acceso
                  </Button>
                )}
              </div>
            </CardContent>
          </Card>
        ))}

        {team.data?.length === 0 && (
          <p className="text-sm text-muted-foreground">Todavía no hay profesionales cargadas.</p>
        )}
      </div>

      {/* ── Darle acceso al panel ──────────────────────────────────────────
          Pide sólo el mail y la contraseña: el nombre sale de la ficha, que es
          justamente lo que se venía escribiendo dos veces. */}
      <Dialog open={!!granting} onOpenChange={(next) => !next && closeGrant()}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="font-display text-2xl">
              Darle acceso a {granting?.name}
            </DialogTitle>
            <DialogDescription>
              Se crea su cuenta y queda atada a esta ficha. Al entrar ve “Mi agenda”: sus próximos
              turnos con el tratamiento, el día, la hora y la clienta. Ningún otro acceso — si
              además tiene que cargar turnos o tocar el catálogo, eso se tilda en Equipo.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="gr-email">Mail</Label>
              <Input
                id="gr-email"
                type="email"
                autoComplete="off"
                value={grantEmail}
                onChange={(e) => setGrantEmail(e.target.value)}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="gr-password">Contraseña inicial</Label>
              <Input
                id="gr-password"
                type="text"
                autoComplete="off"
                placeholder="Mínimo 8 caracteres"
                value={grantPassword}
                onChange={(e) => setGrantPassword(e.target.value)}
                aria-invalid={grantPassword.length > 0 && grantPassword.length < 8}
              />
              {grantPassword.length > 0 && grantPassword.length < 8 && (
                <p className="text-xs text-destructive">
                  Le faltan {8 - grantPassword.length}{" "}
                  {8 - grantPassword.length === 1 ? "caracter" : "caracteres"}: el mínimo es 8.
                </p>
              )}
              <p className="flex items-start gap-2 text-xs leading-relaxed text-muted-foreground">
                <KeyRound className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                Se muestra en texto plano a propósito: tenés que poder copiarla para dársela.
                Después ella la cambia desde Mi cuenta.
              </p>
            </div>

            <Button
              className="w-full"
              size="lg"
              disabled={!grantReady || grantAccess.isPending}
              onClick={() => grantAccess.mutate()}
            >
              {grantAccess.isPending ? "Creando…" : "Crear la cuenta"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Un solo diálogo para alta y edición: datos, tratamientos y horarios. */}
      <Dialog open={formOpen} onOpenChange={(next) => (next ? setFormOpen(true) : closeForm())}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle className="font-display text-2xl">
              {editingId ? "Editar profesional" : "Nueva profesional"}
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-8">
            <div className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="pr-name">Nombre y apellido</Label>
                <Input
                  id="pr-name"
                  value={form.full_name}
                  onChange={(e) => setForm({ ...form, full_name: e.target.value })}
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="pr-specialty">Especialidad</Label>
                <Input
                  id="pr-specialty"
                  placeholder="Cosmetología facial, masajes…"
                  value={form.specialty}
                  onChange={(e) => setForm({ ...form, specialty: e.target.value })}
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="pr-bio">Reseña</Label>
                <Textarea
                  id="pr-bio"
                  rows={3}
                  value={form.bio}
                  onChange={(e) => setForm({ ...form, bio: e.target.value })}
                />
              </div>

              <div className="flex items-center justify-between gap-4 rounded-sm border border-border p-3">
                <div>
                  <p className="text-sm text-foreground">Activa</p>
                  <p className="text-xs text-muted-foreground">
                    Apagado no aparece en el sitio ni se le pueden sacar turnos.
                  </p>
                </div>
                <Switch
                  checked={form.is_active}
                  onCheckedChange={(value) => setForm({ ...form, is_active: value })}
                />
              </div>
            </div>

            <div>
              <p className="text-eyebrow border-b border-border pb-3 text-gold">
                Tratamientos que realiza
              </p>
              <div className="mt-4 grid max-h-56 gap-2 overflow-y-auto sm:grid-cols-2">
                {services.data?.map((s) => (
                  <label
                    key={s.id}
                    className="flex cursor-pointer items-start gap-3 rounded-sm border border-border p-3"
                  >
                    <Checkbox
                      className="mt-0.5"
                      checked={draftServices.has(s.id)}
                      onCheckedChange={(checked) =>
                        setDraftServices((prev) => {
                          const next = new Set(prev);
                          if (checked) next.add(s.id);
                          else next.delete(s.id);
                          return next;
                        })
                      }
                    />
                    <span>
                      <span className="block text-sm text-foreground">{s.name}</span>
                      <span className="text-xs text-muted-foreground">{s.category}</span>
                    </span>
                  </label>
                ))}
                {services.data?.length === 0 && (
                  <p className="text-sm text-muted-foreground">
                    Todavía no hay tratamientos cargados.
                  </p>
                )}
              </div>
            </div>

            <div>
              <p className="text-eyebrow border-b border-border pb-3 text-gold">
                Días y horarios de atención
              </p>

              {/* Cada fila es editable en el lugar: antes sólo se podían borrar
                  y volver a cargar para corregir un horario. */}
              <ul className="mt-4 space-y-2">
                {draftSchedules.map((s, index) => {
                  const invalid = s.start_time >= s.end_time;
                  return (
                    <li
                      key={s.id ?? `nuevo-${index}`}
                      className="rounded-sm border border-border p-3"
                    >
                      <div className="flex items-end gap-3">
                        <div className="min-w-0 flex-1 space-y-1.5">
                          <Label htmlFor={`sch-day-${index}`} className="text-xs">
                            Día
                          </Label>
                          <select
                            id={`sch-day-${index}`}
                            value={s.weekday}
                            onChange={(e) =>
                              updateDraftSchedule(index, { weekday: Number(e.target.value) })
                            }
                            className="h-10 w-full rounded-sm border border-input bg-background px-2 text-sm text-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none"
                          >
                            {WEEKDAYS.map((day, dayIndex) => (
                              <option key={day} value={dayIndex}>
                                {day}
                              </option>
                            ))}
                          </select>
                        </div>

                        <div className="space-y-1.5">
                          <Label htmlFor={`sch-start-${index}`} className="text-xs">
                            Desde
                          </Label>
                          <Input
                            id={`sch-start-${index}`}
                            type="time"
                            value={s.start_time}
                            onChange={(e) =>
                              updateDraftSchedule(index, { start_time: e.target.value })
                            }
                          />
                        </div>

                        <div className="space-y-1.5">
                          <Label htmlFor={`sch-end-${index}`} className="text-xs">
                            Hasta
                          </Label>
                          <Input
                            id={`sch-end-${index}`}
                            type="time"
                            value={s.end_time}
                            onChange={(e) =>
                              updateDraftSchedule(index, { end_time: e.target.value })
                            }
                          />
                        </div>

                        <Button
                          type="button"
                          size="icon"
                          variant="ghost"
                          className="h-10 w-10 shrink-0 text-destructive hover:text-destructive"
                          aria-label={`Quitar horario de ${WEEKDAYS[s.weekday]}`}
                          onClick={() =>
                            setDraftSchedules((prev) => prev.filter((_, i) => i !== index))
                          }
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>

                      {invalid && (
                        <p className="mt-2 text-xs text-destructive">
                          La hora de fin tiene que ser posterior a la de inicio.
                        </p>
                      )}
                    </li>
                  );
                })}

                {draftSchedules.length === 0 && (
                  <li className="text-sm text-muted-foreground">
                    Sin horarios. Agregá al menos uno para que se le puedan sacar turnos.
                  </li>
                )}
              </ul>

              <Button
                type="button"
                variant="outline"
                className="mt-3 w-full"
                onClick={addDraftSchedule}
              >
                <Plus className="mr-2 h-4 w-4" /> Agregar horario
              </Button>
            </div>

            <Button
              className="w-full"
              size="lg"
              disabled={!form.full_name.trim() || save.isPending}
              onClick={() => save.mutate()}
            >
              {editingId ? "Guardar cambios" : "Crear profesional"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!deleting} onOpenChange={(next) => !next && setDeleting(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="font-display text-2xl">
              ¿Eliminar a {deleting?.name}?
            </AlertDialogTitle>
            <AlertDialogDescription>
              {deleting && upcomingFor(deleting.id) > 0 && (
                <span className="mb-3 block font-medium text-foreground">
                  Tiene {upcomingFor(deleting.id)}{" "}
                  {upcomingFor(deleting.id) === 1 ? "turno futuro" : "turnos futuros"} sin realizar.
                  Van a quedar sin profesional asignada y las clientas no se enteran.
                </span>
              )}
              Se borran también sus tratamientos asignados y sus horarios. Los turnos ya reservados
              con ella no se pierden, pero quedan sin profesional asignada. Si sólo querés que deje
              de aparecer en el sitio, usá el interruptor de activa.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => deleting && remove.mutate(deleting.id)}
              disabled={remove.isPending}
            >
              Eliminar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Baja temporal con turnos colgando. Sólo aparece si los hay: si no, el
          interruptor actúa directo. */}
      <AlertDialog open={!!deactivating} onOpenChange={(next) => !next && setDeactivating(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="font-display text-2xl">
              {deactivating?.name} tiene turnos agendados
            </AlertDialogTitle>
            <AlertDialogDescription>
              Le quedan {deactivating?.count}{" "}
              {deactivating?.count === 1 ? "turno futuro" : "turnos futuros"} sin realizar. Si la
              desactivás, deja de aparecer en el sitio y no se le pueden sacar turnos nuevos, pero
              esos siguen en pie y la clienta no recibe ningún aviso.
              <span className="mt-3 block">
                Conviene reasignarlos o cancelarlos desde Turnos antes de seguir.
              </span>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Mejor no</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (deactivating) toggleActive.mutate({ id: deactivating.id, value: false });
                setDeactivating(null);
              }}
              disabled={toggleActive.isPending}
            >
              Desactivar igual
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
