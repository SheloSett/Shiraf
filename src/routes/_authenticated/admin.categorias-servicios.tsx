import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { CategoryManager } from "@/components/admin/category-manager";
import { api, apiDelete, apiPost, apiPut } from "@/lib/api";
import type { RtaCategorias, RtaUsoDeCategorias } from "@/lib/api-tipos";

export const Route = createFileRoute("/_authenticated/admin/categorias-servicios")({
  component: AdminServiceCategories,
});

function AdminServiceCategories() {
  const queryClient = useQueryClient();

  const categories = useQuery({
    queryKey: ["service-categories"],
    queryFn: async () => (await api<RtaCategorias>("/api/categorias/servicios")).categorias,
  });

  const usage = useQuery({
    queryKey: ["service-category-usage"],
    // El conteo lo hace la base con un group by. Vuelve como objeto y se
    // convierte en Map acá: un Map no sobrevive a JSON.stringify, y el
    // componente que lo consume espera un Map.
    queryFn: async () => {
      const { uso } = await api<RtaUsoDeCategorias>("/api/categorias/servicios/uso");
      return new Map(Object.entries(uso));
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
    mutationFn: (name: string) => apiPost("/api/categorias/servicios", { name }),
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
    mutationFn: ({ id, to }: { id: string; from: string; to: string }) =>
      apiPut(`/api/categorias/servicios/${id}`, { name: to }),
    onSuccess: async () => {
      await refresh();
      toast.success("Categoría renombrada.");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const remove = useMutation({
    mutationFn: (id: string) => apiDelete(`/api/categorias/servicios/${id}`),
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
