import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { CategoryManager } from "@/components/admin/category-manager";
import { api, apiDelete, apiPost, apiPut } from "@/lib/api";
import type { RtaCategorias, RtaUsoDeCategorias } from "@/lib/api-tipos";

export const Route = createFileRoute("/_authenticated/admin/categorias-productos")({
  component: AdminProductCategories,
});

function AdminProductCategories() {
  const queryClient = useQueryClient();

  const categories = useQuery({
    queryKey: ["product-categories"],
    queryFn: async () => (await api<RtaCategorias>("/api/categorias/productos")).categorias,
  });

  // Cuántos productos usa cada categoría: sirve para avisar antes de borrar.
  const usage = useQuery({
    queryKey: ["product-category-usage"],
    // El conteo lo hace la base con un group by. Vuelve como objeto y se
    // convierte en Map acá: un Map no sobrevive a JSON.stringify, y el
    // componente que lo consume espera un Map.
    queryFn: async () => {
      const { uso } = await api<RtaUsoDeCategorias>("/api/categorias/productos/uso");
      return new Map(Object.entries(uso));
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
    mutationFn: (name: string) => apiPost("/api/categorias/productos", { name }),
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
    // productos; si lo segundo fallaba, quedaban apuntando a un nombre que ya
    // no existía en la lista. La función mete las dos escrituras en la misma
    // transacción: o pasan las dos o no pasa ninguna.
    mutationFn: ({ id, to }: { id: string; from: string; to: string }) =>
      apiPut(`/api/categorias/productos/${id}`, { name: to }),
    onSuccess: async () => {
      await refresh();
      toast.success("Categoría renombrada.");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const remove = useMutation({
    mutationFn: ({ id, destino, crear }: { id: string; destino: string; crear: boolean }) =>
      // `destino` es a dónde mudar lo que usaba la categoría. El servidor lo
      // exige si hay algo usándola: sin eso quedaban huérfanos.
      // `crear` avisa que ese destino todavía no existe y hay que darlo de alta.
      apiDelete<{ mudados: number }>(`/api/categorias/productos/${id}`, { destino, crear }),
    onSuccess: async (rta) => {
      await refresh();
      toast.success(
        rta.mudados > 0
          ? `Categoría eliminada. Se mudaron ${rta.mudados} producto${rta.mudados > 1 ? "s" : ""}.`
          : "Categoría eliminada.",
      );
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
      onRemove={(args) => remove.mutate(args)}
      isBusy={create.isPending || rename.isPending || remove.isPending}
    />
  );
}
