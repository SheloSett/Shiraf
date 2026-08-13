import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { CategoryManager } from "@/components/admin/category-manager";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/_authenticated/admin/categorias-productos")({
  component: AdminProductCategories,
});

function AdminProductCategories() {
  const queryClient = useQueryClient();

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

  // Cuántos productos usa cada categoría: sirve para avisar antes de borrar.
  const usage = useQuery({
    queryKey: ["product-category-usage"],
    queryFn: async () => {
      const { data, error } = await supabase.from("products").select("category");
      if (error) throw error;
      const counts = new Map<string, number>();
      for (const row of data ?? []) {
        counts.set(row.category, (counts.get(row.category) ?? 0) + 1);
      }
      return counts;
    },
  });

  async function refresh() {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["product-categories"] }),
      queryClient.invalidateQueries({ queryKey: ["product-category-usage"] }),
      queryClient.invalidateQueries({ queryKey: ["admin-products"] }),
    ]);
  }

  const create = useMutation({
    mutationFn: async (name: string) => {
      const { error } = await supabase.from("product_categories").insert({ name });
      if (error) throw error;
    },
    onSuccess: async () => {
      await refresh();
      toast.success("Categoría creada.");
    },
    onError: (e: Error) =>
      toast.error(
        e.message.includes("duplicate") ? "Ya existe una categoría con ese nombre." : e.message,
      ),
  });

  const rename = useMutation({
    mutationFn: async ({ id, from, to }: { id: string; from: string; to: string }) => {
      const { error } = await supabase.from("product_categories").update({ name: to }).eq("id", id);
      if (error) throw error;

      // products.category guarda el nombre, no el id: sin esto los productos
      // quedarían apuntando a una categoría que ya no existe.
      const { error: productsError } = await supabase
        .from("products")
        .update({ category: to })
        .eq("category", from);
      if (productsError) throw productsError;
    },
    onSuccess: async () => {
      await refresh();
      toast.success("Categoría renombrada.");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const remove = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("product_categories").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: async () => {
      await refresh();
      toast.success("Categoría eliminada.");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <CategoryManager
      eyebrow="Organización del depósito"
      title="Categorías de productos"
      description="Agrupan las cremas, lociones e insumos. Renombrar una categoría actualiza también todos los productos que la usan."
      itemLabel="productos"
      categories={categories.data}
      usage={usage.data}
      onCreate={(name) => create.mutate(name)}
      onRename={(args) => rename.mutate(args)}
      onRemove={(id) => remove.mutate(id)}
      isBusy={create.isPending || rename.isPending || remove.isPending}
    />
  );
}
