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
import { api, apiDelete, apiPost, apiPut } from "@/lib/api";
import type {
  RtaProfesionalesAdmin,
  RtaServiciosParaElegir,
  RtaTurnosProximos,
} from "@/lib/api-tipos";
import { useAccess } from "@/hooks/useAccess";
import { agruparPorDia, diaConTramosSuperpuestos, soloHoraYMinutos, WEEKDAYS } from "@/lib/shiraf";
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

/** Fila que se agrega al tocar "Agregar tramo" con la lista vacía. */
const DEFAULT_SCHEDULE: DraftSchedule = { weekday: 1, start_time: "09:00", end_time: "17:00" };

/**
 * Dos horas después, en "HH:MM", sin pasarse de la medianoche.
 *
 * Es sólo el valor con el que nace un tramo nuevo para que no salga vacío ni
 * dado vuelta; después se edita a mano. El tope en 23:59 evita que un tramo que
 * arranca 23:00 proponga "25:00", que el input de hora rechaza en silencio.
 */
function sumarDosHoras(hora: string): string {
  const [h = 0, m = 0] = hora.split(":").map(Number);
  const minutos = Math.min(h * 60 + m + 120, 23 * 60 + 59);
  return `${String(Math.floor(minutos / 60)).padStart(2, "0")}:${String(minutos % 60).padStart(2, "0")}`;
}

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

  /**
   * El acceso al panel, cargado en el mismo alta.
   *
   * Es lo mismo que hace el botón "Dar acceso al panel" de cada tarjeta, pero
   * sin el segundo viaje: dar de alta a alguien que va a trabajar en el centro y
   * darle con qué entrar es un solo movimiento en la cabeza de quien lo hace, y
   * partirlo en dos pantallas hacía que la mitad de las fichas quedaran sin
   * cuenta hasta que alguien se acordaba.
   *
   * Van vacíos por defecto y son OPCIONALES: hay profesionales que no entran al
   * panel —la agenda se la maneja el centro— y obligarlas a tener usuario sería
   * inventar cuentas que nadie usa. El botón de la tarjeta sigue existiendo para
   * las que ya estaban cargadas y hoy no tienen.
   */
  const [altaEmail, setAltaEmail] = useState("");
  const [altaPassword, setAltaPassword] = useState("");

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
    queryFn: async () =>
      (await api<RtaProfesionalesAdmin>("/api/equipo/profesionales")).profesionales,
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
    // Endpoint propio y no /api/catalogo/servicios: ese pide el permiso
    // `catalog` y esta pantalla la abre quien tiene `team`. El de equipo
    // devuelve los publicados, y los despublicados sólo si además edita el
    // catálogo — igual que hacía la policy.
    queryFn: async () => (await api<RtaServiciosParaElegir>("/api/equipo/servicios")).servicios,
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
   * Reasignar se hace turno por turno, desde la ficha de cada uno: «Pasárselo a
   * otra profesional». Hasta que eso existió, este aviso recomendaba algo que
   * no se podía hacer.
   *
   * Ojo: leer turnos ajenos exige el permiso `appointments`. Sin él la RLS
   * devuelve vacío y el aviso no aparece. Es una limitación conocida y no un
   * bug: quien gestiona el equipo sin ver la agenda no tiene con qué avisar.
   */
  const upcoming = useQuery({
    queryKey: ["professionals-upcoming"],
    // El conteo lo hace la base. Vuelve como objeto —un Map no sobrevive a
    // JSON— y se reconstruye acá, que es lo que espera upcomingFor().
    queryFn: async () => {
      const { turnos } = await api<RtaTurnosProximos>("/api/equipo/turnos-proximos");
      return new Map(Object.entries(turnos));
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
        // Los tratamientos y los horarios como quedaron. El servidor compara
        // contra lo que hay y agrega, actualiza o saca lo que corresponda, todo
        // en una transacción. Antes esto eran hasta seis pedidos sueltos desde
        // el navegador —altas y bajas de vínculos, altas, cambios y bajas de
        // horarios— y una falla en el medio dejaba la ficha a mitad de camino.
        services: [...draftServices],
        schedules: draftSchedules.map((s) => ({
          ...(s.id ? { id: s.id } : {}),
          weekday: s.weekday,
          start_time: s.start_time,
          end_time: s.end_time,
        })),
      };

      // La validación del horario dado vuelta también está en el servidor: un
      // pedido hecho a mano no pasa por este formulario. Acá se conserva para
      // poder nombrar el día en el mensaje.
      const invalid = draftSchedules.find((s) => s.start_time >= s.end_time);
      if (invalid) {
        throw new Error(
          `El horario del ${WEEKDAYS[invalid.weekday]} termina antes de empezar. Corregilo para guardar.`,
        );
      }

      // Dos tramos del mismo día que se pisan. No rompe nada visible —el
      // buscador de horarios libres simplemente ofrece dos veces los mismos—,
      // pero es siempre un error de carga, y el momento de decirlo es este.
      // La misma validación está en el servidor, por el mismo motivo que la de
      // arriba: un pedido hecho a mano no pasa por este formulario.
      const superpuesto = diaConTramosSuperpuestos(draftSchedules);
      if (superpuesto !== null) {
        throw new Error(
          `Hay dos tramos del ${WEEKDAYS[superpuesto]} que se pisan. Revisá las horas.`,
        );
      }

      // El acceso al panel es opcional, pero A MEDIAS no existe: sin los dos
      // datos no hay cuenta posible. Se avisa ANTES de crear la ficha, que es
      // cuando todavía alcanza con completar el campo que falta — después la
      // profesional ya existe y el mensaje tiene que ser otro.
      //
      // El zod del servidor valida lo mismo; acá se conserva para no gastar el
      // viaje y para que el mensaje diga qué falta.
      const mail = altaEmail.trim();
      if (!editingId && (mail.length > 0 || altaPassword.length > 0)) {
        if (!mail) throw new Error("Pusiste una contraseña pero falta el mail de la profesional.");
        if (!mail.includes("@")) throw new Error("Ese mail no parece válido.");
        if (altaPassword.length < 8) {
          throw new Error("La contraseña necesita al menos 8 caracteres.");
        }
      }

      if (editingId) {
        await apiPut(`/api/equipo/profesionales/${editingId}`, payload);
        return { cuenta: null };
      }

      // El alta devuelve el id de la ficha recién creada, que es justo lo que
      // hace falta para atarle la cuenta.
      const { id } = await apiPost<{ id: string }>("/api/equipo/profesionales", payload);

      const quiereCuenta = altaEmail.trim().length > 0 || altaPassword.length > 0;
      if (!quiereCuenta) return { cuenta: null };

      // La ficha YA está creada a esta altura. Si la cuenta falla no se
      // deshace: la profesional existe, sus horarios y tratamientos también, y
      // borrarla por un mail repetido sería tirar el trabajo de cargarla. Se
      // avisa distinto y la cuenta se hace después desde su tarjeta.
      try {
        const cuenta = await createEmployee({
          data: {
            email: altaEmail.trim(),
            password: altaPassword,
            fullName: payload.full_name,
            // Sin ningún acceso tildado, igual que el botón de la tarjeta: con
            // eso ve "Mi agenda" y nada más. Lo demás se decide en Equipo.
            permissions: [],
          },
        });
        await linkProfessionalAccount(cuenta.id, id);
        return { cuenta: { ok: true as const } };
      } catch (error) {
        return {
          cuenta: {
            ok: false as const,
            motivo: error instanceof Error ? error.message : "No se pudo crear la cuenta.",
          },
        };
      }
    },
    onSuccess: async (resultado) => {
      await refresh();
      // Equipo lista las mismas cuentas: si acá se creó una, allá tiene que
      // aparecer sin recargar a mano.
      await queryClient.invalidateQueries({ queryKey: ["admin-team"] });
      await queryClient.invalidateQueries({ queryKey: ["admin-team-professionals"] });

      const wasEditing = !!editingId;
      closeForm();

      if (resultado.cuenta && !resultado.cuenta.ok) {
        // La ficha se guardó igual: el aviso tiene que decir las dos cosas, o
        // parece que no se creó nada.
        toast.warning(
          `Se creó la profesional, pero su cuenta no: ${resultado.cuenta.motivo} Podés crearla desde su tarjeta.`,
          { duration: 10000 },
        );
        return;
      }

      toast.success(
        wasEditing
          ? "Profesional actualizada."
          : resultado.cuenta
            ? "Profesional creada, con su acceso al panel."
            : "Profesional creada.",
      );
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const remove = useMutation({
    mutationFn: (id: string) => apiDelete(`/api/equipo/profesionales/${id}`),
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
    mutationFn: ({ id, value }: { id: string; value: boolean }) =>
      apiPut(`/api/equipo/profesionales/${id}/activa`, { is_active: value }),
    onSuccess: refresh,
    onError: (e: Error) => toast.error(e.message),
  });

  function closeForm() {
    setFormOpen(false);
    setEditingId(null);
    setForm(EMPTY_FORM);
    setDraftServices(new Set());
    setDraftSchedules([]);
    // La contraseña sobre todo: queda en pantalla en texto plano y no tiene por
    // qué seguir ahí cuando se vuelve a abrir el formulario para otra persona.
    setAltaEmail("");
    setAltaPassword("");
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

  /**
   * Agrega un tramo, arrancando donde terminó el anterior.
   *
   * Antes era siempre `{ ...DEFAULT_SCHEDULE }`: lunes de 09:00 a 17:00, sin
   * mirar lo que ya había. Para el caso que motivó esto —el día partido por el
   * almuerzo— eso obligaba a corregir las tres cosas a mano cada vez.
   *
   * Ahora el tramo nuevo hereda el DÍA del último y empieza a la hora en que
   * ese terminó. Cargando "Lunes 09:00–13:00" y tocando el botón sale
   * "Lunes 13:00–15:00": ya es el segundo tramo del mismo lunes y sólo hay que
   * correrle el inicio. Para pasar a otro día se cambia el selector, que es un
   * gesto y no tres.
   */
  // ⬇️ Reemplazada por `agregarDia` y `agregarTramoAlDia`, acá abajo.
  //
  // Se comenta y no se borra porque explica un paso intermedio: cuando el
  // editor era una lista plana de filas —cada una con su propio selector de
  // día—, esto hacía que la fila nueva heredara el día de la anterior para que
  // cargar un día partido no fueran tres correcciones a mano. Con el editor
  // agrupado por día el problema desapareció: el tramo nuevo nace ADENTRO de su
  // día y no hay ningún día que adivinar.
  //
  // function addDraftSchedule() {
  //   setDraftSchedules((prev) => {
  //     const ultimo = prev[prev.length - 1];
  //     if (!ultimo) return [{ ...DEFAULT_SCHEDULE }];
  //
  //     return [
  //       ...prev,
  //       {
  //         weekday: ultimo.weekday,
  //         start_time: ultimo.end_time,
  //         end_time: sumarDosHoras(ultimo.end_time),
  //       },
  //     ];
  //   });
  // }

  /**
   * Los tramos agrupados por día, cada uno con su posición en la lista plana.
   *
   * La lista sigue siendo plana porque así viaja al servidor —una fila de
   * `professional_schedules` por tramo— pero se DIBUJA agrupada. El índice se
   * arrastra porque es con lo que se edita y se borra cada tramo.
   *
   * Adentro de un día NO se reordena por hora: si se ordenara, corregir el
   * inicio de un tramo lo haría saltar de lugar mientras se escribe. Se ordena
   * al mostrar la ficha, que es donde importa.
   */
  const diasDelBorrador = (() => {
    const porDia = new Map<number, { tramo: DraftSchedule; index: number }[]>();
    draftSchedules.forEach((tramo, index) => {
      porDia.set(tramo.weekday, [...(porDia.get(tramo.weekday) ?? []), { tramo, index }]);
    });
    return [...porDia.entries()]
      .sort(([a], [b]) => a - b)
      .map(([weekday, tramos]) => ({ weekday, tramos }));
  })();

  /** Los días que ya tienen algún tramo. Sirve para no ofrecerlos dos veces. */
  const diasUsados = new Set(draftSchedules.map((s) => s.weekday));

  /**
   * Agrega un día entero, con su primer tramo.
   *
   * Elige el primer día de la semana laboral que todavía no esté cargado —lunes
   * primero, domingo último— en vez de proponer siempre lunes: cargando una
   * agenda de corrido, cada toque ofrece el día que sigue.
   */
  function agregarDia() {
    const libre = [1, 2, 3, 4, 5, 6, 0].find((d) => !diasUsados.has(d));
    if (libre === undefined) return; // los siete ya están cargados
    setDraftSchedules((prev) => [...prev, { ...DEFAULT_SCHEDULE, weekday: libre }]);
  }

  /** Suma un tramo a un día que ya existe, arrancando donde terminó el último. */
  function agregarTramoAlDia(weekday: number) {
    setDraftSchedules((prev) => {
      const delDia = prev.filter((s) => s.weekday === weekday);
      const ultimo = delDia[delDia.length - 1];
      const desde = ultimo ? ultimo.end_time : DEFAULT_SCHEDULE.start_time;
      return [...prev, { weekday, start_time: desde, end_time: sumarDosHoras(desde) }];
    });
  }

  /** Cambia el día de TODOS sus tramos: el selector es del día, no del tramo. */
  function cambiarDiaDelGrupo(viejo: number, nuevo: number) {
    setDraftSchedules((prev) =>
      prev.map((s) => (s.weekday === viejo ? { ...s, weekday: nuevo } : s)),
    );
  }

  function quitarTramo(index: number) {
    setDraftSchedules((prev) => prev.filter((_, i) => i !== index));
  }

  /** Saca el día entero. Si tenía dos tramos, se van los dos. */
  function quitarDia(weekday: number) {
    setDraftSchedules((prev) => prev.filter((s) => s.weekday !== weekday));
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
                  {/* Un renglón por DÍA con todos sus tramos, igual que en el
                      sitio. Un lunes partido en dos es un lunes con un corte, no
                      dos lunes. */}
                  <ul className="mt-3 space-y-1 text-sm text-muted-foreground">
                    {agruparPorDia(p.professional_schedules).map(({ weekday, tramos }) => (
                      <li key={weekday}>
                        {WEEKDAYS[weekday]} ·{" "}
                        {tramos
                          .map(
                            (t) =>
                              `${soloHoraYMinutos(t.start_time)}–${soloHoraYMinutos(t.end_time)}`,
                          )
                          .join(" · ")}
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

              {/* Que un día pueda tener dos tramos SIEMPRE funcionó —la base no
                  lo limita y el buscador de horarios libres recorre todas las
                  ventanas del día—, pero no había forma de darse cuenta mirando
                  esta pantalla. Decirlo cuesta un renglón. */}
              <p className="mt-3 text-xs text-muted-foreground">
                Un día puede tener más de un tramo: cargá “Lunes 09:00–13:00” y “Lunes 15:00–17:00”
                para el corte del mediodía.
              </p>

              {/* ⬇️ EL EDITOR VIEJO: una fila por TRAMO, cada una con su propio
                  selector de día.

                  Se comenta y no se borra para dejar ver qué cambió y por qué.
                  El problema era que un lunes partido se cargaba como dos filas
                  "Lunes", una arriba de la otra, cada una repitiendo el día. Se
                  leía como dos lunes distintos —el mismo malentendido que había
                  en el sitio— y además obligaba a elegir el día dos veces.

                  Ahora el día se elige UNA vez y sus tramos van adentro.

                  El editor viejo está comentado al pie de este archivo: acá
                  adentro no puede estar, porque en el cuerpo de un JSX las
                  barras `//` no comentan nada — son texto, y las etiquetas
                  que quedan abajo se siguen leyendo como JSX de verdad. */}
              {/* Un bloque por DÍA, y adentro los tramos de ese día. */}
              <ul className="mt-4 space-y-3">
                {diasDelBorrador.map(({ weekday, tramos }) => (
                  <li key={weekday} className="rounded-sm border border-border p-3">
                    <div className="flex items-center gap-3">
                      <div className="min-w-0 flex-1 space-y-1.5">
                        <Label htmlFor={`sch-day-${weekday}`} className="text-xs">
                          Día
                        </Label>
                        <select
                          id={`sch-day-${weekday}`}
                          value={weekday}
                          onChange={(e) => cambiarDiaDelGrupo(weekday, Number(e.target.value))}
                          className="h-10 w-full rounded-sm border border-input bg-background px-2 text-sm text-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none"
                        >
                          {WEEKDAYS.map((day, dayIndex) => (
                            <option
                              key={day}
                              value={dayIndex}
                              // Un día que ya está cargado más abajo no se vuelve
                              // a ofrecer: elegirlo juntaría los dos bloques en
                              // uno sin avisar, y lo que se quería era mover este
                              // día, no fusionarlo con el otro.
                              disabled={dayIndex !== weekday && diasUsados.has(dayIndex)}
                            >
                              {day}
                            </option>
                          ))}
                        </select>
                      </div>

                      <Button
                        type="button"
                        size="icon"
                        variant="ghost"
                        className="mt-6 h-10 w-10 shrink-0 text-destructive hover:text-destructive"
                        aria-label={`Quitar el ${WEEKDAYS[weekday]} entero`}
                        onClick={() => quitarDia(weekday)}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>

                    <ul className="mt-3 space-y-2">
                      {tramos.map(({ tramo, index }, orden) => {
                        const invalid = tramo.start_time >= tramo.end_time;
                        return (
                          <li key={tramo.id ?? `nuevo-${index}`}>
                            <div className="flex items-end gap-3">
                              <div className="space-y-1.5">
                                {/* Las etiquetas van sólo en el primer tramo:
                                    repetir "Desde" y "Hasta" en cada renglón del
                                    mismo día es ruido. Para quien usa lector de
                                    pantalla el dato no se pierde — va en el
                                    aria-label de cada campo. */}
                                {orden === 0 && (
                                  <Label htmlFor={`sch-start-${index}`} className="text-xs">
                                    Desde
                                  </Label>
                                )}
                                <Input
                                  id={`sch-start-${index}`}
                                  type="time"
                                  aria-label={`${WEEKDAYS[weekday]}, tramo ${orden + 1}: desde`}
                                  value={tramo.start_time}
                                  onChange={(e) =>
                                    updateDraftSchedule(index, { start_time: e.target.value })
                                  }
                                />
                              </div>

                              <div className="space-y-1.5">
                                {orden === 0 && (
                                  <Label htmlFor={`sch-end-${index}`} className="text-xs">
                                    Hasta
                                  </Label>
                                )}
                                <Input
                                  id={`sch-end-${index}`}
                                  type="time"
                                  aria-label={`${WEEKDAYS[weekday]}, tramo ${orden + 1}: hasta`}
                                  value={tramo.end_time}
                                  onChange={(e) =>
                                    updateDraftSchedule(index, { end_time: e.target.value })
                                  }
                                />
                              </div>

                              {/* El tacho del tramo aparece sólo cuando hay más
                                  de uno: con un solo tramo, sacarlo es sacar el
                                  día, y para eso está el de arriba. Dos tachos
                                  que hacen lo mismo en el mismo bloque
                                  confunden. */}
                              {tramos.length > 1 && (
                                <Button
                                  type="button"
                                  size="icon"
                                  variant="ghost"
                                  className="h-10 w-10 shrink-0 text-destructive hover:text-destructive"
                                  aria-label={`Quitar el tramo del ${WEEKDAYS[weekday]} de ${tramo.start_time} a ${tramo.end_time}`}
                                  onClick={() => quitarTramo(index)}
                                >
                                  <Trash2 className="h-4 w-4" />
                                </Button>
                              )}
                            </div>

                            {invalid && (
                              <p className="mt-2 text-xs text-destructive">
                                La hora de fin tiene que ser posterior a la de inicio.
                              </p>
                            )}
                          </li>
                        );
                      })}
                    </ul>

                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="mt-2"
                      onClick={() => agregarTramoAlDia(weekday)}
                    >
                      <Plus className="mr-2 h-3.5 w-3.5" /> Agregar tramo a este día
                    </Button>
                  </li>
                ))}

                {draftSchedules.length === 0 && (
                  <li className="text-sm text-muted-foreground">
                    Sin horarios. Agregá al menos un día para que se le puedan sacar turnos.
                  </li>
                )}
              </ul>

              <Button
                type="button"
                variant="outline"
                className="mt-3 w-full"
                onClick={agregarDia}
                disabled={diasUsados.size === 7}
              >
                <Plus className="mr-2 h-4 w-4" /> Agregar día
              </Button>
            </div>

            {/* El acceso al panel, en el alta.
                
                Sólo en el ALTA y sólo para la dueña. En una edición no va: la
                ficha ya puede tener cuenta, y "cambiarle la contraseña a
                alguien" es otra cosa que esta pantalla no hace. Para las que ya
                estaban cargadas está el botón de su tarjeta. */}
            {!editingId && isAdmin && (
              <div>
                <p className="text-eyebrow border-b border-border pb-3 text-gold">
                  Acceso al panel (opcional)
                </p>

                <p className="mt-3 text-xs leading-relaxed text-muted-foreground">
                  Si completás estos dos campos, se le crea la cuenta y queda atada a esta ficha. Al
                  entrar ve “Mi agenda”: sus próximos turnos con el tratamiento, el día, la hora y
                  la clienta. Ningún otro acceso — si además carga turnos o toca el catálogo, eso se
                  tilda después en Equipo.
                </p>

                <div className="mt-4 space-y-4">
                  <div className="space-y-2">
                    <Label htmlFor="alta-email">Mail</Label>
                    <Input
                      id="alta-email"
                      type="email"
                      autoComplete="off"
                      placeholder="Dejalo vacío si no entra al panel"
                      value={altaEmail}
                      onChange={(e) => setAltaEmail(e.target.value)}
                    />
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="alta-password">Contraseña inicial</Label>
                    <Input
                      id="alta-password"
                      type="text"
                      autoComplete="off"
                      placeholder="Mínimo 8 caracteres"
                      value={altaPassword}
                      onChange={(e) => setAltaPassword(e.target.value)}
                      aria-invalid={altaPassword.length > 0 && altaPassword.length < 8}
                    />
                    {altaPassword.length > 0 && altaPassword.length < 8 && (
                      <p className="text-xs text-destructive">
                        Le faltan {8 - altaPassword.length}{" "}
                        {8 - altaPassword.length === 1 ? "caracter" : "caracteres"}: el mínimo es 8.
                      </p>
                    )}
                    <p className="flex items-start gap-2 text-xs leading-relaxed text-muted-foreground">
                      <KeyRound className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                      Se muestra en texto plano a propósito: tenés que poder copiarla para dársela.
                      Después ella la cambia desde Mi cuenta.
                    </p>
                  </div>
                </div>
              </div>
            )}

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
                Para pasárselos a otra: entrá a <strong>Turnos</strong>, abrí cada uno y usá
                «Pasárselo a otra profesional». Sólo te va a ofrecer las que realizan ese
                tratamiento.
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

// ─────────────────────────────────────────────────────────────────────────────
// EL EDITOR DE HORARIOS VIEJO — una fila por TRAMO, cada una con su día
// ─────────────────────────────────────────────────────────────────────────────
//
// Guardado tal cual estaba, para dejar ver qué cambió. Vivía adentro del
// diálogo de alta y edición, donde ahora está el editor agrupado por día.
//
// Qué tenía de malo: un lunes partido se cargaba como dos filas "Lunes", una
// arriba de la otra, cada una repitiendo el selector del día. Se leía como dos
// lunes distintos —el mismo malentendido que había en el sitio— y obligaba a
// elegir el día dos veces para lo que es un solo día con un corte al mediodía.
//
// Ojo si alguna vez se lo quiere resucitar: llamaba a `addDraftSchedule`, que
// también está comentada más arriba y ya no existe.
//               {/* Cada fila es editable en el lugar: antes sólo se podían borrar
//                   y volver a cargar para corregir un horario. */}
//               <ul className="mt-4 space-y-2">
//                 {draftSchedules.map((s, index) => {
//                   const invalid = s.start_time >= s.end_time;
//                   return (
//                     <li
//                       key={s.id ?? `nuevo-${index}`}
//                       className="rounded-sm border border-border p-3"
//                     >
//                       <div className="flex items-end gap-3">
//                         <div className="min-w-0 flex-1 space-y-1.5">
//                           <Label htmlFor={`sch-day-${index}`} className="text-xs">
//                             Día
//                           </Label>
//                           <select
//                             id={`sch-day-${index}`}
//                             value={s.weekday}
//                             onChange={(e) =>
//                               updateDraftSchedule(index, { weekday: Number(e.target.value) })
//                             }
//                             className="h-10 w-full rounded-sm border border-input bg-background px-2 text-sm text-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none"
//                           >
//                             {WEEKDAYS.map((day, dayIndex) => (
//                               <option key={day} value={dayIndex}>
//                                 {day}
//                               </option>
//                             ))}
//                           </select>
//                         </div>
//
//                         <div className="space-y-1.5">
//                           <Label htmlFor={`sch-start-${index}`} className="text-xs">
//                             Desde
//                           </Label>
//                           <Input
//                             id={`sch-start-${index}`}
//                             type="time"
//                             value={s.start_time}
//                             onChange={(e) =>
//                               updateDraftSchedule(index, { start_time: e.target.value })
//                             }
//                           />
//                         </div>
//
//                         <div className="space-y-1.5">
//                           <Label htmlFor={`sch-end-${index}`} className="text-xs">
//                             Hasta
//                           </Label>
//                           <Input
//                             id={`sch-end-${index}`}
//                             type="time"
//                             value={s.end_time}
//                             onChange={(e) =>
//                               updateDraftSchedule(index, { end_time: e.target.value })
//                             }
//                           />
//                         </div>
//
//                         <Button
//                           type="button"
//                           size="icon"
//                           variant="ghost"
//                           className="h-10 w-10 shrink-0 text-destructive hover:text-destructive"
//                           aria-label={`Quitar el tramo del ${WEEKDAYS[s.weekday]} de ${s.start_time} a ${s.end_time}`}
//                           onClick={() =>
//                             setDraftSchedules((prev) => prev.filter((_, i) => i !== index))
//                           }
//                         >
//                           <Trash2 className="h-4 w-4" />
//                         </Button>
//                       </div>
//
//                       {invalid && (
//                         <p className="mt-2 text-xs text-destructive">
//                           La hora de fin tiene que ser posterior a la de inicio.
//                         </p>
//                       )}
//                     </li>
//                   );
//                 })}
//
//                 {draftSchedules.length === 0 && (
//                   <li className="text-sm text-muted-foreground">
//                     Sin horarios. Agregá al menos un tramo para que se le puedan sacar turnos.
//                   </li>
//                 )}
//               </ul>
//
//               <Button
//                 type="button"
//                 variant="outline"
//                 className="mt-3 w-full"
//                 onClick={addDraftSchedule}
//               >
//                 <Plus className="mr-2 h-4 w-4" /> Agregar tramo
//               </Button>
