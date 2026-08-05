import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { AlertTriangle, Minus, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { supabase } from "@/integrations/supabase/client";
import { formatDateTime } from "@/lib/shiraf";

export const Route = createFileRoute("/_authenticated/admin/stock")({
  component: AdminStock,
});

function AdminStock() {
  const queryClient = useQueryClient();
  const [amounts, setAmounts] = useState<Record<string, string>>({});

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

  const movements = useQuery({
    queryKey: ["admin-movements"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("stock_movements")
        .select("id, quantity, reason, created_at, products(name, unit)")
        .order("created_at", { ascending: false })
        .limit(15);
      if (error) throw error;
      return data;
    },
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
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin-products"] });
      queryClient.invalidateQueries({ queryKey: ["admin-movements"] });
      toast.success("Stock actualizado.");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const low = (products.data ?? []).filter((p) => Number(p.stock) <= Number(p.min_stock));

  function amountFor(id: string) {
    const value = Number(amounts[id] ?? 1);
    return Number.isFinite(value) && value > 0 ? value : 1;
  }

  return (
    <div>
      <p className="text-eyebrow text-muted-foreground">Cremas, lociones e insumos</p>
      <h1 className="mt-3 font-display text-4xl text-foreground">Stock</h1>

      {low.length > 0 && (
        <div className="mt-6 flex items-start gap-3 rounded-sm border border-gold/50 bg-gold/10 p-4">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-gold" />
          <p className="text-sm text-foreground">
            {low.length} producto{low.length > 1 ? "s" : ""} en o por debajo del mínimo:{" "}
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
              <TableHead>Stock</TableHead>
              <TableHead>Mínimo</TableHead>
              <TableHead className="text-right">Movimiento</TableHead>
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
                  <TableCell>
                    <span className={isLow ? "text-gold" : "text-foreground"}>
                      {Number(p.stock)} {p.unit}
                    </span>
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {Number(p.min_stock)} {p.unit}
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
                        onClick={() => move.mutate({ productId: p.id, quantity: amountFor(p.id) })}
                      >
                        <Plus className="h-4 w-4" />
                      </Button>
                      <Button
                        size="icon"
                        variant="outline"
                        className="h-9 w-9"
                        onClick={() => move.mutate({ productId: p.id, quantity: -amountFor(p.id) })}
                      >
                        <Minus className="h-4 w-4" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>

      <h2 className="mt-12 font-display text-2xl text-foreground">Últimos movimientos</h2>
      <div className="mt-4 divide-y divide-border border-y border-border">
        {movements.data?.map((m) => (
          <div key={m.id} className="flex flex-wrap items-center justify-between gap-3 py-3 text-sm">
            <span className="text-foreground">
              {m.products?.name}{" "}
              <span className={m.quantity > 0 ? "text-primary" : "text-gold"}>
                {m.quantity > 0 ? "+" : ""}
                {Number(m.quantity)} {m.products?.unit}
              </span>
            </span>
            <span className="text-xs text-muted-foreground">
              {m.reason} · {formatDateTime(m.created_at)}
            </span>
          </div>
        ))}
        {movements.data?.length === 0 && (
          <p className="py-4 text-sm text-muted-foreground">Sin movimientos registrados.</p>
        )}
      </div>
    </div>
  );
}
