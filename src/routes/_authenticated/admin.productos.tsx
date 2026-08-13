import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { AlertTriangle, Check, Minus, Pencil, Plus, Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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

export const Route = createFileRoute("/_authenticated/admin/productos")({
  component: AdminProducts,
});

type ProductForm = {
  name: string;
  brand: string;
  category: string;
  unit: string;
  stock: string;
  min_stock: string;
  cost: string;
};

const EMPTY_FORM: ProductForm = {
  name: "",
  brand: "",
  category: "",
  unit: "unidad",
  stock: "0",
  min_stock: "0",
  cost: "",
};

function AdminProducts() {
  const queryClient = useQueryClient();
  const [amounts, setAmounts] = useState<Record<string, string>>({});
  const [open, setOpen] = useState(false);
  /** id del producto en edición; null = alta nueva. */
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<ProductForm>(EMPTY_FORM);
  const [deleting, setDeleting] = useState<{ id: string; name: string } | null>(null);
  const [addingCategory, setAddingCategory] = useState(false);
  const [newCategory, setNewCategory] = useState("");

  const products = useQuery({
    queryKey: ["admin-products"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("products")
        .select("id, name, brand, category, unit, stock, min_stock, cost")
        .order("category")
        .order("name");
      if (error) throw error;
      return data;
    },
  });

  const categories = useQuery({
    queryKey: ["product-categories"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("product_categories")
        .select("id, name")
        .order("name");
      if (error) throw error;
      return data;
    },
  });

  // Alta de categoría sin salir del formulario: se crea, se refresca la lista
  // y queda seleccionada en el producto que estabas cargando.
  const createCategory = useMutation({
    mutationFn: async (name: string) => {
      const { error } = await supabase.from("product_categories").insert({ name: name.trim() });
      if (error) throw error;
      return name.trim();
    },
    onSuccess: async (name) => {
      await queryClient.invalidateQueries({ queryKey: ["product-categories"] });
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

  const save = useMutation({
    mutationFn: async () => {
      const payload = {
        name: form.name.trim(),
        brand: form.brand.trim() || null,
        category: form.category.trim() || "Sin categoría",
        unit: form.unit.trim() || "unidad",
        min_stock: Number(form.min_stock) || 0,
        cost: form.cost === "" ? null : Number(form.cost),
      };

      if (editingId) {
        const { error } = await supabase.from("products").update(payload).eq("id", editingId);
        if (error) throw error;

        // El stock se edita desde la ficha, pero no se escribe la columna a
        // mano: se calcula la diferencia contra el valor actual y se registra
        // como movimiento. El trigger aplica el saldo, igual que con + / −, y
        // así el historial nunca se separa del stock real.
        const current = products.data?.find((p) => p.id === editingId);
        const delta = (Number(form.stock) || 0) - Number(current?.stock ?? 0);

        if (delta !== 0) {
          const { data: auth } = await supabase.auth.getUser();
          const { error: moveError } = await supabase.from("stock_movements").insert({
            product_id: editingId,
            quantity: delta,
            reason: "Ajuste desde la ficha del producto",
            created_by: auth.user?.id ?? null,
          });
          if (moveError) throw moveError;
        }
      } else {
        const { error } = await supabase
          .from("products")
          .insert({ ...payload, stock: Number(form.stock) || 0 });
        if (error) throw error;
      }
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["admin-products"] });
      setOpen(false);
      setEditingId(null);
      setForm(EMPTY_FORM);
      toast.success(editingId ? "Producto actualizado." : "Producto creado.");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const remove = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("products").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["admin-products"] });
      setDeleting(null);
      toast.success("Producto eliminado.");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const move = useMutation({
    mutationFn: async ({ productId, quantity }: { productId: string; quantity: number }) => {
      const { data: auth } = await supabase.auth.getUser();
      const { error } = await supabase.from("stock_movements").insert({
        product_id: productId,
        quantity,
        reason: quantity > 0 ? "Ingreso de mercadería" : "Consumo en cabina",
        created_by: auth.user?.id ?? null,
      });
      if (error) throw error;
    },
    // Se espera a que la tabla se refresque ANTES de avisar. Antes el toast
    // salía al instante y el número tardaba en cambiar, así que parecía que el
    // movimiento no había hecho nada.
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["admin-products"] });
      toast.success("Stock actualizado.");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const low = (products.data ?? []).filter((p) => Number(p.stock) <= Number(p.min_stock));

  function amountFor(id: string) {
    const value = Number(amounts[id] ?? 1);
    return Number.isFinite(value) && value > 0 ? value : 1;
  }

  function openCreate() {
    setEditingId(null);
    setForm(EMPTY_FORM);
    setOpen(true);
  }

  function openEdit(p: NonNullable<typeof products.data>[number]) {
    setEditingId(p.id);
    setForm({
      name: p.name,
      brand: p.brand ?? "",
      category: p.category,
      unit: p.unit,
      stock: String(Number(p.stock)),
      min_stock: String(Number(p.min_stock)),
      cost: p.cost === null ? "" : String(Number(p.cost)),
    });
    setOpen(true);
  }

  return (
    <div>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-eyebrow text-muted-foreground">Cremas, lociones e insumos</p>
          <h1 className="mt-3 font-display text-4xl text-foreground">Productos</h1>
        </div>

        <Dialog
          open={open}
          onOpenChange={(next) => {
            setOpen(next);
            if (!next) {
              setEditingId(null);
              setForm(EMPTY_FORM);
            }
          }}
        >
          <DialogTrigger asChild>
            <Button onClick={openCreate}>
              <Plus className="mr-2 h-4 w-4" /> Nuevo producto
            </Button>
          </DialogTrigger>

          <DialogContent>
            <DialogHeader>
              <DialogTitle className="font-display text-2xl">
                {editingId ? "Editar producto" : "Nuevo producto"}
              </DialogTitle>
            </DialogHeader>

            <div className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="p-name">Nombre</Label>
                <Input
                  id="p-name"
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="p-brand">Marca</Label>
                  <Input
                    id="p-brand"
                    value={form.brand}
                    onChange={(e) => setForm({ ...form, brand: e.target.value })}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="p-category">Categoría</Label>

                  {addingCategory ? (
                    <div className="flex gap-2">
                      <Input
                        id="p-category"
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
                        id="p-category"
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
                        {/* Si el producto tiene una categoría que ya no está en
                            la lista (se borró), igual hay que poder verla. */}
                        {form.category &&
                          !categories.data?.some((c) => c.name === form.category) && (
                            <option value={form.category}>{form.category} (sin lista)</option>
                          )}
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
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="p-unit">Unidad</Label>
                  <Input
                    id="p-unit"
                    placeholder="pote 250g, botella 1L…"
                    value={form.unit}
                    onChange={(e) => setForm({ ...form, unit: e.target.value })}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="p-cost">Costo</Label>
                  <Input
                    id="p-cost"
                    type="number"
                    min={0}
                    value={form.cost}
                    onChange={(e) => setForm({ ...form, cost: e.target.value })}
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="p-stock">{editingId ? "Stock" : "Stock inicial"}</Label>
                  <Input
                    id="p-stock"
                    type="number"
                    min={0}
                    value={form.stock}
                    onChange={(e) => setForm({ ...form, stock: e.target.value })}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="p-min">Quiebre de stock</Label>
                  <Input
                    id="p-min"
                    type="number"
                    min={0}
                    value={form.min_stock}
                    onChange={(e) => setForm({ ...form, min_stock: e.target.value })}
                  />
                </div>
              </div>

              <Button
                className="w-full"
                disabled={!form.name.trim() || save.isPending}
                onClick={() => save.mutate()}
              >
                {editingId ? "Guardar cambios" : "Crear producto"}
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      {low.length > 0 && (
        <div className="mt-6 flex items-start gap-3 rounded-sm border border-gold/50 bg-gold/10 p-4">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-gold" />
          <p className="text-sm text-foreground">
            {low.length} producto{low.length > 1 ? "s" : ""} en o por debajo del quiebre de stock:{" "}
            <span className="text-muted-foreground">{low.map((p) => p.name).join(", ")}</span>
          </p>
        </div>
      )}

      <div className="mt-8 rounded-sm border border-border bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Producto</TableHead>
              <TableHead>Categoría</TableHead>
              <TableHead>Unidad</TableHead>
              <TableHead>Stock</TableHead>
              <TableHead>Quiebre de Stock</TableHead>
              <TableHead>Costo</TableHead>
              <TableHead className="text-right">Movimiento</TableHead>
              <TableHead className="w-24 text-right">Acciones</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {products.data?.map((p) => {
              const isLow = Number(p.stock) <= Number(p.min_stock);
              return (
                <TableRow key={p.id}>
                  <TableCell>
                    <span className="block text-foreground">{p.name}</span>
                    <span className="text-xs text-muted-foreground">{p.brand}</span>
                  </TableCell>
                  <TableCell>
                    <Badge variant="secondary" className="font-normal">
                      {p.category}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-muted-foreground">{p.unit}</TableCell>
                  <TableCell>
                    <span className={isLow ? "text-gold" : "text-foreground"}>
                      {Number(p.stock)}
                    </span>
                  </TableCell>
                  <TableCell className="text-muted-foreground">{Number(p.min_stock)}</TableCell>
                  <TableCell className="text-muted-foreground">
                    {p.cost === null ? "—" : formatMoney(p.cost)}
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center justify-end gap-2">
                      <Input
                        className="h-9 w-20"
                        type="number"
                        min={1}
                        value={amounts[p.id] ?? "1"}
                        onChange={(e) => setAmounts({ ...amounts, [p.id]: e.target.value })}
                      />
                      <Button
                        size="icon"
                        variant="outline"
                        className="h-9 w-9"
                        aria-label={`Sumar stock de ${p.name}`}
                        disabled={move.isPending}
                        onClick={() => move.mutate({ productId: p.id, quantity: amountFor(p.id) })}
                      >
                        <Plus className="h-4 w-4" />
                      </Button>
                      <Button
                        size="icon"
                        variant="outline"
                        className="h-9 w-9"
                        aria-label={`Restar stock de ${p.name}`}
                        disabled={move.isPending}
                        onClick={() => move.mutate({ productId: p.id, quantity: -amountFor(p.id) })}
                      >
                        <Minus className="h-4 w-4" />
                      </Button>
                    </div>
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center justify-end gap-1">
                      <Button
                        size="icon"
                        variant="ghost"
                        className="h-9 w-9"
                        aria-label={`Editar ${p.name}`}
                        onClick={() => openEdit(p)}
                      >
                        <Pencil className="h-4 w-4" />
                      </Button>
                      <Button
                        size="icon"
                        variant="ghost"
                        className="h-9 w-9 text-destructive hover:text-destructive"
                        aria-label={`Eliminar ${p.name}`}
                        onClick={() => setDeleting({ id: p.id, name: p.name })}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              );
            })}

            {products.data?.length === 0 && (
              <TableRow>
                <TableCell colSpan={8} className="py-10 text-center text-sm text-muted-foreground">
                  Todavía no hay productos cargados.
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
              Se borra el producto y todo su historial de movimientos. No se puede deshacer.
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
