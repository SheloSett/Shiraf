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
import { supabase } from "@/integrations/supabase/client";
import { formatMoney } from "@/lib/shiraf";
import { imageUrl } from "@/lib/cloudinary";
import { removeServiceImage, uploadServiceImage } from "@/lib/storage";

export const Route = createFileRoute("/_authenticated/admin/servicios")({
  component: AdminServices,
});

type ServiceForm = {
  name: string;
  category: string;
  description: string;
  duration_minutes: number;
  price: number;
  /** URL pública en Storage, o "" si el tratamiento no tiene foto. */
  image_url: string;
};

const EMPTY_FORM: ServiceForm = {
  name: "",
  category: "",
  description: "",
  duration_minutes: 60,
  price: 0,
  image_url: "",
};

function AdminServices() {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<ServiceForm>({ ...EMPTY_FORM });
  const [uploading, setUploading] = useState(false);
  /** URL que había al abrir el diálogo: sirve para borrarla si se reemplaza. */
  const [originalImage, setOriginalImage] = useState<string>("");
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
    setOriginalImage("");
  }

  /**
   * Cerrar sin guardar.
   *
   * La foto se sube apenas se elige, antes de tocar "Guardar": es lo que
   * permite ver la vista previa. Si después se cierra el diálogo, esa foto ya
   * está arriba y no la referencia nadie — huérfana, consumiendo cuota.
   *
   * Va aparte de closeForm() y no adentro porque save.onSuccess también cierra
   * el formulario, y ahí la foto SÍ se está usando: borrarla dejaría al
   * tratamiento recién guardado apuntando a un archivo que ya no existe.
   */
  function cancelForm() {
    if (form.image_url && form.image_url !== originalImage) {
      void removeServiceImage(form.image_url);
    }
    closeForm();
  }

  function openCreate() {
    setEditingId(null);
    setForm({ ...EMPTY_FORM });
    setOriginalImage("");
    setOpen(true);
  }

  function openEdit(s: {
    id: string;
    name: string;
    category: string;
    description: string | null;
    duration_minutes: number;
    price: number;
    image_url: string | null;
  }) {
    setEditingId(s.id);
    setForm({
      name: s.name,
      category: s.category,
      description: s.description ?? "",
      duration_minutes: s.duration_minutes,
      price: Number(s.price),
      image_url: s.image_url ?? "",
    });
    setOriginalImage(s.image_url ?? "");
    setOpen(true);
  }

  async function pickImage(file: File | undefined) {
    if (!file) return;
    setUploading(true);
    try {
      const url = await uploadServiceImage(file);
      setForm((prev) => ({ ...prev, image_url: url }));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "No se pudo subir la imagen.");
    } finally {
      setUploading(false);
    }
  }

  const categories = useQuery({
    queryKey: ["service-categories"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("service_categories")
        .select("id, name")
        .order("name");
      if (error) throw error;
      return data;
    },
  });

  // Alta de categoría sin salir del formulario: se crea, se refresca la lista y
  // queda elegida en el tratamiento que estabas cargando.
  const createCategory = useMutation({
    mutationFn: async (name: string) => {
      const { error } = await supabase.from("service_categories").insert({ name: name.trim() });
      if (error) throw error;
      return name.trim();
    },
    onSuccess: async (name) => {
      await queryClient.invalidateQueries({ queryKey: ["service-categories"] });
      setForm((prev) => ({ ...prev, category: name }));
      setNewCategory("");
      setAddingCategory(false);
      toast.success(`Categoría "${name}" creada.`);
    },
    onError: (e: Error) =>
      toast.error(
        e.message.includes("duplicate") ? "Ya existe una categoría con ese nombre." : e.message,
      ),
  });

  const services = useQuery({
    queryKey: ["admin-services"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("services")
        .select("id, name, category, description, duration_minutes, price, is_published, image_url")
        .order("category")
        .order("name");
      if (error) throw error;
      return data;
    },
  });

  const save = useMutation({
    mutationFn: async () => {
      const payload = {
        name: form.name.trim(),
        category: form.category.trim() || "Sin categoría",
        description: form.description.trim() || null,
        duration_minutes: Number(form.duration_minutes),
        price: Number(form.price),
        image_url: form.image_url || null,
      };

      if (editingId) {
        const { error } = await supabase.from("services").update(payload).eq("id", editingId);
        if (error) throw error;
      } else {
        const { error } = await supabase
          .from("services")
          .insert({ ...payload, is_published: true });
        if (error) throw error;
      }

      // La foto vieja se borra recién cuando el guardado salió bien: si fallara,
      // el tratamiento seguiría apuntando a un archivo que ya no existe.
      if (originalImage && originalImage !== form.image_url) {
        await removeServiceImage(originalImage);
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
      // La URL se lee ANTES de borrar: después la fila ya no está y la foto
      // quedaría sin forma de encontrarse.
      const imageUrl = services.data?.find((s) => s.id === id)?.image_url ?? null;

      const { error } = await supabase.from("services").delete().eq("id", id);
      if (error) throw error;

      // Y se borra DESPUÉS de que la baja salió bien: si el borrado del
      // tratamiento fallara —pasa, porque appointments.service_id es ON DELETE
      // RESTRICT— habríamos tirado la foto de un tratamiento que sigue vivo.
      //
      // Antes esto no se hacía y el archivo quedaba huérfano para siempre. Con
      // Supabase Storage era 1 GB gratis y molestaba poco; ahora consume cuota
      // de Cloudinary, que en el plan gratuito es finita.
      await removeServiceImage(imageUrl);
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["admin-services"] });
      await queryClient.invalidateQueries({ queryKey: ["services"] });
      setDeleting(null);
      toast.success("Tratamiento eliminado.");
    },
    // appointments.service_id es ON DELETE RESTRICT: la base frena el borrado si
    // hay turnos con ese tratamiento. El mensaje crudo de Postgres no le dice
    // nada a nadie, así que se traduce.
    onError: (e: Error) => {
      const hasAppointments =
        e.message.includes("violates foreign key") || e.message.includes("23503");
      toast.error(
        hasAppointments
          ? "No se puede eliminar: hay turnos con este tratamiento. Despublicalo en su lugar."
          : e.message,
      );
    },
  });

  const togglePublish = useMutation({
    mutationFn: async ({ id, value }: { id: string; value: boolean }) => {
      const { error } = await supabase
        .from("services")
        .update({ is_published: value })
        .eq("id", id);
      if (error) throw error;
    },
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

              <div className="space-y-2">
                <Label htmlFor="image">Foto</Label>

                {form.image_url ? (
                  <div className="flex items-start gap-4">
                    <img
                      src={imageUrl(form.image_url, "card") ?? undefined}
                      alt="Vista previa del tratamiento"
                      className="h-28 w-24 shrink-0 rounded-sm object-cover"
                    />
                    <div className="space-y-2">
                      <p className="text-xs leading-relaxed text-muted-foreground">
                        Se muestra en la ficha del tratamiento y en el panel del inicio.
                      </p>
                      <div className="flex gap-2">
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          disabled={uploading}
                          onClick={() => document.getElementById("image")?.click()}
                        >
                          Reemplazar
                        </Button>
                        <Button
                          type="button"
                          size="sm"
                          variant="ghost"
                          className="text-destructive hover:text-destructive"
                          onClick={() => setForm({ ...form, image_url: "" })}
                        >
                          Quitar
                        </Button>
                      </div>
                    </div>
                  </div>
                ) : (
                  <p className="text-xs leading-relaxed text-muted-foreground">
                    Formato apaisado o vertical. Se achica sola a 1600px y se convierte a WebP antes
                    de subirse, así que podés mandar la foto tal como salió de la cámara.
                  </p>
                )}

                <Input
                  id="image"
                  type="file"
                  accept="image/jpeg,image/png,image/webp,image/avif"
                  disabled={uploading}
                  className={form.image_url ? "sr-only" : ""}
                  onChange={(e) => {
                    void pickImage(e.target.files?.[0]);
                    // Permite volver a elegir el mismo archivo después de quitarlo.
                    e.target.value = "";
                  }}
                />

                {uploading && (
                  <p className="text-xs text-muted-foreground">Optimizando y subiendo…</p>
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
              Se quita del catálogo y de las profesionales que lo realizan. Si ya hay turnos con
              este tratamiento la base no va a dejar borrarlo — en ese caso despublicalo, que lo
              saca del sitio sin tocar el historial.
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
