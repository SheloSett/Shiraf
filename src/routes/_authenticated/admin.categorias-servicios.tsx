import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { CategoryManager } from "@/components/admin/category-manager";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/_authenticated/admin/categorias-servicios")({
  component: AdminServiceCategories,
});

function AdminServiceCategories() {
  const queryClient = useQueryClient();

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

  const usage = useQuery({
    queryKey: ["service-category-usage"],
    queryFn: async () => {
      const { data, error } = await supabase.from("services").select("category");
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
      queryClient.invalidateQueries({ queryKey: ["service-categories"] }),
      queryClient.invalidateQueries({ queryKey: ["service-category-usage"] }),
      queryClient.invalidateQueries({ queryKey: ["admin-services"] }),
      // El sitio público agrupa la carta de tratamientos por categoría.
      queryClient.invalidateQueries({ queryKey: ["services"] }),
    ]);
  }

  const create = useMutation({
    mutationFn: async (name: string) => {
      const { error } = await supabase.from("service_categories").insert({ name });
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
    // Una sola llamada a la base en vez de dos UPDATE sueltos. Antes se
    // renombraba la categoría y después se arrastraba el nombre a los
    // tratamientos; si lo segundo fallaba, quedaban apuntando a un nombre que ya
    // no existía en la lista. La función mete las dos escrituras en la misma
    // transacción: o pasan las dos o no pasa ninguna.
    mutationFn: async ({ id, to }: { id: string; from: string; to: string }) => {
      const { error } = await supabase.rpc("rename_service_category", { _id: id, _to: to });
      if (error) throw error;
    },
    onSuccess: async () => {
      await refresh();
      toast.success("Categoría renombrada.");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const remove = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("service_categories").delete().eq("id", id);
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
      eyebrow="Organización de la carta"
      title="Categorías de tratamientos"
      description="Agrupan los tratamientos en el sitio público. Renombrar una categoría actualiza también todos los tratamientos que la usan."
      itemLabel="tratamientos"
      categories={categories.data}
      usage={usage.data}
      onCreate={(name) => create.mutate(name)}
      onRename={(args) => rename.mutate(args)}
      onRemove={(id) => remove.mutate(id)}
      isBusy={create.isPending || rename.isPending || remove.isPending}
    />
  );
}
