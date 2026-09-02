import { useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Check, Image as ImageIcon, Pencil, Plus, Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
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
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { api, apiDelete, apiPost, apiPut } from "@/lib/api";
import type {
  RtaCategorias,
  RtaMediaSacada,
  RtaServiciosAdmin,
  ServicioAdmin,
  VarianteAdmin,
} from "@/lib/api-tipos";
import { aSlug, formatMoney, precioYDuracion } from "@/lib/shiraf";
import { imageUrl } from "@/lib/cloudinary";
import { removeServiceMedia, uploadServiceMedia } from "@/lib/storage";
import { ServiceMediaEditor, type MediaItem } from "@/components/admin/service-media-editor";
import {
  ServiceVariantsEditor,
  type VariantItem,
} from "@/components/admin/service-variants-editor";

export const Route = createFileRoute("/_authenticated/admin/servicios")({
  component: AdminServices,
});

type ServiceForm = {
  name: string;
  category: string;
  description: string;
  duration_minutes: number;
  /** Los minutos de limpieza que van DESPUÉS de este tratamiento. */
  buffer_minutes: number;
  price: number;
  /** Cuántas sesiones son y cada cuántos días. 1 y 0 = tratamiento de una sola visita. */
  sessions_count: number;
  session_interval_days: number;
  /**
   * La galería, en orden. La primera imagen es la portada.
   *
   * `services.image_url` NO se toca desde acá: lo mantiene el trigger
   * trg_sync_service_cover a partir de esta lista (migración 20260818010000).
   * Escribirlo a mano además del trigger es la forma de que los dos terminen
   * diciendo cosas distintas.
   */
  media: MediaItem[];
  /**
   * Las opciones del tratamiento, en orden. Vacía en el que no tiene.
   *
   * Cuando hay alguna, es de ella de donde salen el precio y la duración del
   * turno — los de acá arriba quedan como el valor del tratamiento "a secas",
   * que ya no se le cobra a nadie. La regla la aplica `validarTurno` en el
   * servidor; la pantalla sólo lo dice.
   */
  variants: VariantItem[];
};

const EMPTY_FORM: ServiceForm = {
  name: "",
  category: "",
  description: "",
  duration_minutes: 60,
  // El que el centro definió el 18/8/2026 y hasta ahora valía para todo el
  // catálogo. Un tratamiento nuevo arranca con eso y se ajusta si hace falta.
  buffer_minutes: 10,
  price: 0,
  sessions_count: 1,
  session_interval_days: 0,
  media: [],
  variants: [],
};

/**
 * A qué hora queda libre la cabina para la clienta siguiente, arrancando 12:00.
 *
 * Es para el formulario de tratamientos: poner un número y ver el horario que
 * sale dice mucho más que el número solo. Vale para mostrar, nada más — la
 * agenda de verdad la calcula `buildSlots`.
 */
function horaSiguiente(duracion: number, margen: number): string {
  const desde = new Date(2000, 0, 1, 12, 0, 0);
  const total = (Number(duracion) || 0) + (Number(margen) || 0);
  const libre = new Date(desde.getTime() + total * 60_000);
  return libre.toLocaleTimeString("es-AR", {
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  });
}

/**
 * Lo mismo que `precioYDuracion`, pero mirando sólo las opciones ACTIVAS.
 *
 * El panel recibe también las apagadas —es donde se vuelven a prender— y una
 * opción apagada no se puede reservar: contarla en el "desde" haría que la tabla
 * anuncie un precio que ya nadie puede pedir.
 */
function resumenDeVariantes(s: ServicioAdmin) {
  return precioYDuracion({ ...s, variants: s.variants.filter((v) => v.is_active) });
}

function AdminServices() {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<ServiceForm>({ ...EMPTY_FORM });
  const [uploading, setUploading] = useState(false);
  /**
   * La galería tal como estaba al abrir el diálogo.
   *
   * Sirve para dos cosas al guardar: saber qué filas de service_media hay que
   * borrar (las que estaban y ya no están) y qué archivos de Cloudinary hay que
   * tirar después, una vez que el guardado salió bien.
   */
  const [addingCategory, setAddingCategory] = useState(false);
  const [newCategory, setNewCategory] = useState("");
  /** id del tratamiento en edición; null = alta nueva. */
  const [editingId, setEditingId] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<{ id: string; name: string } | null>(null);

  /**
   * Los filtros de la tabla: texto libre, categoría y si está publicado.
   *
   * La tabla se lee de arriba abajo y ya son más de veinte tratamientos: para
   * corregirle el precio a uno había que recorrerla con el dedo. Los tres viven
   * sólo en la pantalla —no en la URL ni en la consulta— porque son una lupa
   * momentánea sobre una lista que ya está entera en memoria.
   */
  const [busca, setBusca] = useState("");
  const [filtroCategoria, setFiltroCategoria] = useState("");
  const [filtroPublicado, setFiltroPublicado] = useState<"todos" | "si" | "no">("todos");

  function closeForm() {
    setOpen(false);
    setEditingId(null);
    setAddingCategory(false);
    setNewCategory("");
    setForm({ ...EMPTY_FORM });
  }

  /**
   * Cerrar sin guardar.
   *
   * Los archivos se suben apenas se eligen, antes de tocar "Guardar": es lo que
   * permite ver la vista previa. Si después se cierra el diálogo, esos archivos
   * ya están arriba y no los referencia nadie — huérfanos, consumiendo cuota.
   *
   * Se borran los que NO tienen id: ese es exactamente el conjunto de los que
   * se subieron en esta sesión del formulario y todavía no tienen fila en
   * service_media. Los que ya tenían id siguen guardados y no se tocan, aunque
   * la persona los haya sacado de la lista: como no guardó, no los sacó.
   *
   * Va aparte de closeForm() y no adentro porque save.onSuccess también cierra
   * el formulario, y ahí los archivos SÍ se están usando.
   */
  function cancelForm() {
    for (const item of form.media) {
      if (!item.id) void removeServiceMedia(item.url, item.kind);
    }
    closeForm();
  }

  function openCreate() {
    setEditingId(null);
    setForm({ ...EMPTY_FORM });
    setOpen(true);
  }

  function openEdit(s: {
    id: string;
    name: string;
    category: string;
    description: string | null;
    duration_minutes: number;
    buffer_minutes: number;
    price: number;
    sessions_count: number;
    session_interval_days: number;
    service_media: { id: string; url: string; kind: "image" | "video"; position: number }[];
    variants: VarianteAdmin[];
  }) {
    // La consulta ya ordena por position, pero el orden de un embed de
    // PostgREST no está garantizado si alguien le agrega un select: ordenar acá
    // cuesta nada y hace que la portada no dependa de eso.
    const media: MediaItem[] = [...s.service_media]
      .sort((a, b) => a.position - b.position)
      .map(({ id, url, kind }) => ({ id, url, kind }));

    setEditingId(s.id);
    setForm({
      name: s.name,
      category: s.category,
      description: s.description ?? "",
      duration_minutes: s.duration_minutes,
      buffer_minutes: s.buffer_minutes,
      price: Number(s.price),
      sessions_count: s.sessions_count,
      session_interval_days: s.session_interval_days,
      media,
      // Ya vienen ordenadas por `position` del servidor. Se copian a la forma
      // del formulario —con `id`, que es lo que le dice al servidor cuáles ya
      // existen— y el orden de esta lista es el que se va a guardar.
      variants: s.variants.map((v) => ({
        id: v.id,
        name: v.name,
        duration_minutes: v.duration_minutes,
        buffer_minutes: v.buffer_minutes,
        price: Number(v.price),
        is_active: v.is_active,
      })),
    });
    setOpen(true);
  }

  /**
   * Sube los archivos elegidos y los agrega al final de la galería.
   *
   * De a uno y no en paralelo: son archivos grandes —un video puede ser de 100
   * MB— y mandarlos todos juntos por una conexión de casa hace que se peleen
   * entre ellos y tarden más que en fila. Además, si el tercero falla, los dos
   * primeros ya quedaron cargados y a la vista.
   */
  async function pickFiles(files: FileList | null) {
    if (!files || files.length === 0) return;
    setUploading(true);
    try {
      for (const file of Array.from(files)) {
        try {
          const item = await uploadServiceMedia(file);
          setForm((prev) => ({ ...prev, media: [...prev.media, item] }));
        } catch (e) {
          toast.error(
            `${file.name}: ${e instanceof Error ? e.message : "no se pudo subir."}`.trim(),
          );
        }
      }
    } finally {
      setUploading(false);
    }
  }

  const categories = useQuery({
    queryKey: ["service-categories"],
    queryFn: async () => (await api<RtaCategorias>("/api/categorias/servicios")).categorias,
  });

  // Alta de categoría sin salir del formulario: se crea, se refresca la lista y
  // queda elegida en el tratamiento que estabas cargando.
  const createCategory = useMutation({
    mutationFn: async (name: string) => {
      await apiPost("/api/categorias/servicios", { name: name.trim() });
      return name.trim();
    },
    onSuccess: async (name) => {
      await queryClient.invalidateQueries({ queryKey: ["service-categories"] });
      setForm((prev) => ({ ...prev, category: name }));
      setNewCategory("");
      setAddingCategory(false);
      toast.success(`Categoría "${name}" creada.`);
    },
    // El mensaje del nombre repetido lo arma el servidor, que es quien sabe que
    // chocó contra el UNIQUE. Antes se adivinaba buscando "duplicate" adentro
    // del error crudo de Postgres.
    onError: (e: Error) => toast.error(e.message),
  });

  const services = useQuery({
    queryKey: ["admin-services"],
    // image_url sigue viniendo para la miniatura de la tabla: es la portada que
    // mantiene el trigger. service_media es para el formulario.
    queryFn: async () => (await api<RtaServiciosAdmin>("/api/catalogo/servicios")).servicios,
  });

  /**
   * Lo que se ve en la tabla: los tratamientos que pasan los tres filtros.
   *
   * La búsqueda compara por slug y no por texto crudo, así "depilacion"
   * encuentra "Depilación" — quien busca en el panel escribe rápido y sin
   * tildes. Mira nombre y categoría; la descripción no, porque son párrafos
   * enteros y cualquier palabra común devolvía media tabla.
   */
  const visibles = useMemo(() => {
    const texto = aSlug(busca);
    return (services.data ?? []).filter((s) => {
      if (texto && !aSlug(`${s.name} ${s.category}`).includes(texto)) return false;
      if (filtroCategoria && s.category !== filtroCategoria) return false;
      if (filtroPublicado === "si" && !s.is_published) return false;
      if (filtroPublicado === "no" && s.is_published) return false;
      return true;
    });
  }, [services.data, busca, filtroCategoria, filtroPublicado]);

  const filtrando = busca !== "" || filtroCategoria !== "" || filtroPublicado !== "todos";

  function limpiarFiltros() {
    setBusca("");
    setFiltroCategoria("");
    setFiltroPublicado("todos");
  }

  const save = useMutation({
    mutationFn: async () => {
      // Sin image_url: la portada la escribe trg_sync_service_cover a partir de
      // service_media. Mandarla desde acá la pisaría con un valor viejo hasta
      // que el trigger la vuelva a calcular.
      const payload = {
        name: form.name.trim(),
        category: form.category.trim() || "Sin categoría",
        description: form.description.trim() || null,
        duration_minutes: Number(form.duration_minutes),
        buffer_minutes: Number(form.buffer_minutes),
        price: Number(form.price),
        sessions_count: Number(form.sessions_count),
        session_interval_days: Number(form.session_interval_days),
        // La galería tal como quedó. Las nuevas no tienen id todavía.
        media: form.media.map((m) => ({ ...(m.id ? { id: m.id } : {}), url: m.url, kind: m.kind })),
        // Las opciones, en el orden de la pantalla: el servidor escribe
        // `position` por el índice. Las que se agregaron y quedaron sin nombre
        // las descarta él, así que no hace falta filtrarlas acá.
        variants: form.variants.map((v) => ({
          ...(v.id ? { id: v.id } : {}),
          name: v.name.trim(),
          duration_minutes: Number(v.duration_minutes),
          buffer_minutes: Number(v.buffer_minutes),
          price: Number(v.price),
          is_active: v.is_active,
        })),
      };

      // Un solo pedido. Antes esto eran hasta cuatro viajes sueltos desde el
      // navegador —el tratamiento, las bajas de la galería, los cambios de
      // posición y las altas— y si el segundo fallaba la galería quedaba a
      // medio guardar. Ahora el servidor lo hace en una transacción.
      if (!editingId) {
        await apiPost("/api/catalogo/servicios", payload);
        return;
      }

      const { sacadas } = await apiPut<RtaMediaSacada>(
        `/api/catalogo/servicios/${editingId}`,
        payload,
      );

      // Los archivos de Cloudinary recién ahora, con todo lo demás guardado: si
      // algo de arriba fallara, la galería seguiría apuntando a archivos que ya
      // no existirían.
      for (const item of sacadas) {
        await removeServiceMedia(item.url, item.kind);
      }
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["admin-services"] });
      await queryClient.invalidateQueries({ queryKey: ["services"] });
      const wasEditing = !!editingId;
      closeForm();
      toast.success(wasEditing ? "Tratamiento actualizado." : "Tratamiento creado y publicado.");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const remove = useMutation({
    mutationFn: async (id: string) => {
      // El servidor devuelve las URLs DESPUÉS de que la baja salió bien. Puede
      // no salir: un tratamiento con turnos pendientes o confirmados no se
      // borra. Si mandáramos a borrar los archivos antes, en ese caso habríamos
      // tirado la foto de un tratamiento vivo.
      const { sacadas } = await apiDelete<RtaMediaSacada>(`/api/catalogo/servicios/${id}`);

      // Antes esto no se hacía y el archivo quedaba huérfano para siempre. Con
      // Supabase Storage era 1 GB gratis y molestaba poco; ahora consume cuota
      // de Cloudinary, que en el plan gratuito es finita — y un video pesa
      // mucho más que una foto.
      for (const item of sacadas) {
        await removeServiceMedia(item.url, item.kind);
      }
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["admin-services"] });
      await queryClient.invalidateQueries({ queryKey: ["services"] });
      setDeleting(null);
      toast.success("Tratamiento eliminado.");
    },
    // El mensaje de "hay N turnos pendientes o confirmados" lo arma el servidor,
    // que es el único que tiene la cuenta a mano. Acá ya llega en castellano.
    onError: (e: Error) => toast.error(e.message),
  });

  const togglePublish = useMutation({
    mutationFn: ({ id, value }: { id: string; value: boolean }) =>
      apiPut(`/api/catalogo/servicios/${id}/publicado`, { is_published: value }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin-services"] });
      queryClient.invalidateQueries({ queryKey: ["services"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-eyebrow text-muted-foreground">Catálogo</p>
          <h1 className="mt-3 font-display text-4xl text-foreground">Servicios</h1>
        </div>
        {/* cancelForm y no closeForm: cerrar sin guardar tiene que limpiar la
            foto que se haya subido para la vista previa. */}
        <Dialog open={open} onOpenChange={(next) => (next ? setOpen(true) : cancelForm())}>
          <DialogTrigger asChild>
            <Button onClick={openCreate}>
              <Plus className="mr-2 h-4 w-4" /> Nuevo servicio
            </Button>
          </DialogTrigger>
          {/* El formulario es largo (descripción, fotos, duración, precio, margen):
              sin scroll propio los botones del final quedan abajo de la pantalla. */}
          <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
            <DialogHeader>
              <DialogTitle className="font-display text-2xl">
                {editingId ? "Editar tratamiento" : "Nuevo tratamiento"}
              </DialogTitle>
            </DialogHeader>
            <div className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="name">Nombre</Label>
                <Input
                  id="name"
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="category">Categoría</Label>

                {addingCategory ? (
                  <div className="flex gap-2">
                    <Input
                      id="category"
                      autoFocus
                      placeholder="Nombre nuevo"
                      value={newCategory}
                      onChange={(e) => setNewCategory(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          e.preventDefault();
                          if (newCategory.trim()) createCategory.mutate(newCategory);
                        }
                        if (e.key === "Escape") {
                          e.preventDefault();
                          setAddingCategory(false);
                          setNewCategory("");
                        }
                      }}
                    />
                    <Button
                      type="button"
                      size="icon"
                      variant="outline"
                      className="shrink-0"
                      aria-label="Guardar categoría"
                      disabled={!newCategory.trim() || createCategory.isPending}
                      onClick={() => createCategory.mutate(newCategory)}
                    >
                      <Check className="h-4 w-4" />
                    </Button>
                    <Button
                      type="button"
                      size="icon"
                      variant="ghost"
                      className="shrink-0"
                      aria-label="Cancelar"
                      onClick={() => {
                        setAddingCategory(false);
                        setNewCategory("");
                      }}
                    >
                      <X className="h-4 w-4" />
                    </Button>
                  </div>
                ) : (
                  <div className="flex gap-2">
                    <select
                      id="category"
                      value={form.category}
                      onChange={(e) => setForm({ ...form, category: e.target.value })}
                      className="h-10 w-full rounded-sm border border-input bg-background px-3 text-sm text-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none"
                    >
                      <option value="">Sin categoría</option>
                      {categories.data?.map((c) => (
                        <option key={c.id} value={c.name}>
                          {c.name}
                        </option>
                      ))}
                    </select>
                    <Button
                      type="button"
                      size="icon"
                      variant="outline"
                      className="shrink-0"
                      aria-label="Crear categoría nueva"
                      onClick={() => setAddingCategory(true)}
                    >
                      <Plus className="h-4 w-4" />
                    </Button>
                  </div>
                )}
              </div>
              <div className="space-y-2">
                <Label htmlFor="description">Descripción</Label>
                <Textarea
                  id="description"
                  value={form.description}
                  onChange={(e) => setForm({ ...form, description: e.target.value })}
                />
              </div>

              <div className="space-y-3">
                <Label htmlFor="media">Fotos y videos</Label>

                <ServiceMediaEditor
                  items={form.media}
                  onChange={(media) => setForm({ ...form, media })}
                  disabled={uploading}
                />

                <p className="text-xs leading-relaxed text-muted-foreground">
                  {form.media.length === 0
                    ? "Podés elegir varios archivos de una. Las fotos se achican solas a 1600px y se convierten a WebP, así que mandalas tal como salieron de la cámara."
                    : "La primera foto de la lista es la portada: es la que sale en el catálogo y en el inicio. Usá las flechas para cambiar el orden."}
                </p>

                <Input
                  id="media"
                  type="file"
                  multiple
                  accept="image/jpeg,image/png,image/webp,image/avif,video/mp4,video/quicktime,video/webm"
                  disabled={uploading}
                  onChange={(e) => {
                    void pickFiles(e.target.files);
                    // Permite volver a elegir el mismo archivo después de quitarlo.
                    e.target.value = "";
                  }}
                />

                {uploading && (
                  <p className="text-xs text-muted-foreground">
                    Subiendo… los videos pueden tardar un rato largo.
                  </p>
                )}
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="duration">Duración (min)</Label>
                  <Input
                    id="duration"
                    type="number"
                    value={form.duration_minutes}
                    onChange={(e) => setForm({ ...form, duration_minutes: Number(e.target.value) })}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="price">Precio</Label>
                  <Input
                    id="price"
                    type="number"
                    value={form.price}
                    onChange={(e) => setForm({ ...form, price: Number(e.target.value) })}
                  />
                </div>
              </div>
              {/*
                Va en su propia fila y no al lado de la duración a propósito: son
                dos minutos distintos y pegados se confunden. Con la ayuda debajo,
                queda claro que este rato no se le cobra a nadie.
              */}
              <div className="space-y-2">
                <Label htmlFor="buffer">Tiempo entre turnos (min)</Label>
                <Input
                  id="buffer"
                  type="number"
                  min={0}
                  value={form.buffer_minutes}
                  onChange={(e) => setForm({ ...form, buffer_minutes: Number(e.target.value) })}
                />
                <p className="text-xs text-muted-foreground">
                  El rato para limpiar y preparar la cabina después de este tratamiento. La clienta
                  siguiente no puede reservar antes de que pase. Un turno de {form.duration_minutes}{" "}
                  minutos a las 12:00 deja libre las{" "}
                  {horaSiguiente(form.duration_minutes, form.buffer_minutes)}.
                </p>
              </div>

              {/* Las sesiones. Van pegadas al precio a propósito: es ahí donde
                  hay que entender que ese número es el del tratamiento COMPLETO
                  y no el de cada visita. */}
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="sessions">Sesiones</Label>
                  <Input
                    id="sessions"
                    type="number"
                    min={1}
                    value={form.sessions_count}
                    onChange={(e) => setForm({ ...form, sessions_count: Number(e.target.value) })}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="interval">Días entre sesiones</Label>
                  <Input
                    id="interval"
                    type="number"
                    min={0}
                    // Un tratamiento de una sola sesión no tiene entre qué
                    // esperar: el campo se apaga en vez de esconderse, así se ve
                    // que existe y por qué no aplica.
                    disabled={form.sessions_count <= 1}
                    value={form.session_interval_days}
                    onChange={(e) =>
                      setForm({ ...form, session_interval_days: Number(e.target.value) })
                    }
                  />
                </div>
              </div>
              {form.sessions_count > 1 && (
                <p className="-mt-1 text-xs text-muted-foreground">
                  Este tratamiento son {form.sessions_count} sesiones
                  {form.session_interval_days > 0 ? ` cada ${form.session_interval_days} días` : ""}
                  . El precio de arriba es el del{" "}
                  <strong className="font-medium text-foreground">tratamiento completo</strong> y se
                  cobra una sola vez. La clienta reserva la primera sesión; las siguientes las
                  agendás vos desde Turnos.
                </p>
              )}

              {/* Las opciones van DESPUÉS del precio y la duración, y no antes,
                  porque una opción nueva nace copiando esos dos números: en el
                  orden inverso habría que volver a subir a corregirlos. */}
              <div className="space-y-3">
                <Label>Opciones del tratamiento</Label>
                <p className="text-xs text-muted-foreground">
                  Para el tratamiento que se ofrece de más de una forma —“solo espalda” y “cuerpo
                  completo”—, con su propio precio y su propia duración. Si no tiene, dejalo vacío.
                </p>
                <ServiceVariantsEditor
                  items={form.variants}
                  onChange={(variants) => setForm({ ...form, variants })}
                  duracionBase={form.duration_minutes}
                  margenBase={form.buffer_minutes}
                />
              </div>

              <Button
                className="w-full"
                disabled={!form.name.trim() || save.isPending}
                onClick={() => save.mutate()}
              >
                {editingId ? "Guardar cambios" : "Crear y publicar"}
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      {/* Buscador y filtros de la tabla. Van acá arriba y no adentro de la
          tarjeta para que se lean como controles de la pantalla y no como una
          fila más de la grilla. */}
      <div className="mt-8 flex flex-wrap items-center gap-3">
        <Input
          className="w-full sm:max-w-xs"
          placeholder="Buscar por nombre o categoría…"
          value={busca}
          onChange={(e) => setBusca(e.target.value)}
          aria-label="Buscar tratamiento"
        />

        <select
          value={filtroCategoria}
          onChange={(e) => setFiltroCategoria(e.target.value)}
          aria-label="Filtrar por categoría"
          className="h-10 rounded-sm border border-input bg-background px-3 text-sm text-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none"
        >
          <option value="">Todas las categorías</option>
          {categories.data?.map((c) => (
            <option key={c.id} value={c.name}>
              {c.name}
            </option>
          ))}
        </select>

        {/* Despublicado es justamente lo que cuesta encontrar: no sale en el
            sitio, así que la única forma de darse cuenta de que quedó apagado
            es mirar esta columna tratamiento por tratamiento. */}
        <select
          value={filtroPublicado}
          onChange={(e) => setFiltroPublicado(e.target.value as typeof filtroPublicado)}
          aria-label="Filtrar por estado de publicación"
          className="h-10 rounded-sm border border-input bg-background px-3 text-sm text-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none"
        >
          <option value="todos">Publicados y no publicados</option>
          <option value="si">Sólo publicados</option>
          <option value="no">Sólo no publicados</option>
        </select>

        {filtrando && (
          <Button variant="ghost" onClick={limpiarFiltros}>
            Limpiar
          </Button>
        )}

        <p className="ml-auto text-sm text-muted-foreground">
          {filtrando
            ? `${visibles.length} de ${services.data?.length ?? 0} tratamientos`
            : `${services.data?.length ?? 0} tratamientos`}
        </p>
      </div>

      <div className="mt-4 rounded-sm border border-border bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Servicio</TableHead>
              <TableHead>Categoría</TableHead>
              <TableHead>Duración</TableHead>
              <TableHead>Precio</TableHead>
              <TableHead className="text-right">Publicado</TableHead>
              <TableHead className="w-24 text-right">Acciones</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {visibles.map((s) => (
              <TableRow key={s.id}>
                <TableCell>
                  <div className="flex items-start gap-3">
                    {s.image_url ? (
                      <img
                        src={imageUrl(s.image_url, "thumb") ?? undefined}
                        alt=""
                        className="h-12 w-12 shrink-0 rounded-sm object-cover"
                      />
                    ) : (
                      <span
                        className="flex h-12 w-12 shrink-0 items-center justify-center rounded-sm border border-dashed border-border"
                        title="Sin foto"
                      >
                        <ImageIcon className="h-4 w-4 text-muted-foreground/60" />
                      </span>
                    )}
                    <span className="min-w-0">
                      <span className="block text-foreground">{s.name}</span>
                      {/* `line-clamp-2`: una descripción larga estiraba la fila hasta
                          tapar la lista entera. El texto completo queda en el título. */}
                      <span
                        className="line-clamp-2 text-xs text-muted-foreground"
                        title={s.description ?? undefined}
                      >
                        {s.description}
                      </span>
                    </span>
                  </div>
                </TableCell>
                <TableCell>
                  <Badge variant="secondary" className="font-normal">
                    {s.category}
                  </Badge>
                </TableCell>
                {/* Con opciones, la tabla muestra el rango y el precio más
                    barato con "desde": el precio de la fila `services` en ese
                    caso no se le cobra a nadie, y verlo acá haría dudar de si
                    quedó bien cargado. Se cuentan sólo las ACTIVAS, que son las
                    que se pueden reservar. */}
                <TableCell>{resumenDeVariantes(s).duracion}</TableCell>
                <TableCell>
                  {resumenDeVariantes(s).desde && (
                    <span className="text-xs text-muted-foreground">desde </span>
                  )}
                  {formatMoney(resumenDeVariantes(s).precio)}
                  {s.variants.filter((v) => v.is_active).length > 0 && (
                    <span className="block text-xs text-muted-foreground">
                      {s.variants.filter((v) => v.is_active).length} opciones
                    </span>
                  )}
                </TableCell>
                <TableCell className="text-right">
                  <Switch
                    checked={s.is_published}
                    onCheckedChange={(value) => togglePublish.mutate({ id: s.id, value })}
                    aria-label={`${s.is_published ? "Despublicar" : "Publicar"} ${s.name}`}
                  />
                </TableCell>
                <TableCell>
                  <div className="flex items-center justify-end gap-1">
                    <Button
                      size="icon"
                      variant="ghost"
                      className="h-9 w-9"
                      aria-label={`Editar ${s.name}`}
                      onClick={() => openEdit(s)}
                    >
                      <Pencil className="h-4 w-4" />
                    </Button>
                    <Button
                      size="icon"
                      variant="ghost"
                      className="h-9 w-9 text-destructive hover:text-destructive"
                      aria-label={`Eliminar ${s.name}`}
                      onClick={() => setDeleting({ id: s.id, name: s.name })}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </TableCell>
              </TableRow>
            ))}

            {/* Dos vacíos distintos: no hay nada cargado, o lo que hay no
                coincide con el filtro. Con un solo mensaje, filtrar por una
                categoría sin tratamientos hacía pensar que se borró el catálogo. */}
            {/* `services.data &&`: mientras carga, la lista todavía es vacía y
                sin esto se veía por un instante "no hay tratamientos". */}
            {services.data && visibles.length === 0 && (
              <TableRow>
                <TableCell colSpan={6} className="py-10 text-center text-sm text-muted-foreground">
                  {services.data.length
                    ? "Ningún tratamiento coincide con la búsqueda."
                    : "Todavía no hay tratamientos cargados."}
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>

      <AlertDialog open={!!deleting} onOpenChange={(next) => !next && setDeleting(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="font-display text-2xl">
              ¿Eliminar {deleting?.name}?
            </AlertDialogTitle>
            <AlertDialogDescription>
              Se quita del catálogo y de las profesionales que lo realizan. Los turnos que ya
              pasaron o se cancelaron quedan como están: guardan el nombre y el precio de ese día.
              Si hay turnos pendientes o confirmados no se va a poder borrar hasta que pasen o se
              cancelen — mientras tanto podés despublicarlo, que lo saca del sitio.
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
    </div>
  );
}
