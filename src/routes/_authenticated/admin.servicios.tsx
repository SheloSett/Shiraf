import { useState } from "react";
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
import type { RtaCategorias, RtaMediaSacada, RtaServiciosAdmin } from "@/lib/api-tipos";
import { formatMoney } from "@/lib/shiraf";
import { imageUrl } from "@/lib/cloudinary";
import { removeServiceMedia, uploadServiceMedia } from "@/lib/storage";
import { ServiceMediaEditor, type MediaItem } from "@/components/admin/service-media-editor";

export const Route = createFileRoute("/_authenticated/admin/servicios")({
  component: AdminServices,
});

type ServiceForm = {
  name: string;
  category: string;
  description: string;
  duration_minutes: number;
  price: number;
  /**
   * La galería, en orden. La primera imagen es la portada.
   *
   * `services.image_url` NO se toca desde acá: lo mantiene el trigger
   * trg_sync_service_cover a partir de esta lista (migración 20260818010000).
   * Escribirlo a mano además del trigger es la forma de que los dos terminen
   * diciendo cosas distintas.
   */
  media: MediaItem[];
};

const EMPTY_FORM: ServiceForm = {
  name: "",
  category: "",
  description: "",
  duration_minutes: 60,
  price: 0,
  media: [],
};

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
    price: number;
    service_media: { id: string; url: string; kind: "image" | "video"; position: number }[];
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
      price: Number(s.price),
      media,
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
        price: Number(form.price),
        // La galería tal como quedó. Las nuevas no tienen id todavía.
        media: form.media.map((m) => ({ ...(m.id ? { id: m.id } : {}), url: m.url, kind: m.kind })),
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
          <DialogContent>
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

      <div className="mt-8 rounded-sm border border-border bg-card">
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
            {services.data?.map((s) => (
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
                      <span className="text-xs text-muted-foreground">{s.description}</span>
                    </span>
                  </div>
                </TableCell>
                <TableCell>
                  <Badge variant="secondary" className="font-normal">
                    {s.category}
                  </Badge>
                </TableCell>
                <TableCell>{s.duration_minutes} min</TableCell>
                <TableCell>{formatMoney(s.price)}</TableCell>
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

            {services.data?.length === 0 && (
              <TableRow>
                <TableCell colSpan={6} className="py-10 text-center text-sm text-muted-foreground">
                  Todavía no hay tratamientos cargados.
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
