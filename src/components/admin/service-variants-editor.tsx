import { ChevronDown, ChevronUp, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import type { VarianteAGuardar } from "@/lib/api-tipos";

/**
 * Una opción tal como la maneja el formulario.
 *
 * `id` es el de service_variants y falta mientras la opción se está cargando y
 * el tratamiento todavía no se guardó. Es la misma diferencia que usa el editor
 * de la galería, y el servidor la lee igual: sin id, es nueva.
 */
export type VariantItem = VarianteAGuardar;

/**
 * Editor de las opciones de un tratamiento: "Solo espalda", "Cuerpo completo".
 *
 * ── CUÁNDO USARLO Y CUÁNDO NO ────────────────────────────────────────────────
 *
 * Sin opciones, el tratamiento vale lo que dice su precio y dura lo que dice su
 * duración: es el caso de casi todo el catálogo y esta lista queda vacía. En
 * cuanto hay una sola opción cargada, MANDAN LAS OPCIONES — la reserva obliga a
 * elegir una y el precio del tratamiento deja de cobrarse. Por eso el aviso de
 * abajo aparece recién cuando hay alguna: antes sería ruido.
 *
 * ── APAGAR EN VEZ DE BORRAR ──────────────────────────────────────────────────
 *
 * Una opción que se dejó de ofrecer tiene turnos viejos apuntando a ella.
 * Apagarla la saca de la reserva y deja el historial en pie; borrarla corta el
 * vínculo y el turno viejo se queda sólo con el nombre congelado. Las dos cosas
 * están, pero el interruptor es lo que se ve primero.
 *
 * Se reordena con flechas, por lo mismo que la galería: son dos o tres opciones
 * y el drag and drop pide una librería, no anda con el teclado y en el celular
 * pelea con el scroll.
 */
export function ServiceVariantsEditor({
  items,
  onChange,
  /** La duración y el margen del tratamiento: con qué nace una opción nueva. */
  duracionBase,
  margenBase,
}: {
  items: VariantItem[];
  onChange: (next: VariantItem[]) => void;
  duracionBase: number;
  margenBase: number;
}) {
  function actualizar(index: number, cambio: Partial<VariantItem>) {
    onChange(items.map((v, i) => (i === index ? { ...v, ...cambio } : v)));
  }

  function mover(from: number, to: number) {
    if (to < 0 || to >= items.length) return;
    const next = [...items];
    const [movida] = next.splice(from, 1);
    if (movida) next.splice(to, 0, movida);
    onChange(next);
  }

  function agregar() {
    onChange([
      ...items,
      {
        name: "",
        // Arranca con lo del tratamiento: la primera opción casi siempre es "lo
        // de siempre" y la segunda es la variación. Escribir los números de cero
        // cada vez es trabajo que la pantalla puede ahorrar.
        duration_minutes: duracionBase,
        buffer_minutes: margenBase,
        price: 0,
        is_active: true,
      },
    ]);
  }

  return (
    <div className="space-y-3">
      {items.length > 0 && (
        <p className="text-xs text-muted-foreground">
          Con opciones cargadas, la clienta elige una al reservar y se le cobra{" "}
          <strong className="font-medium text-foreground">el precio de la opción</strong>: el precio
          y la duración de acá abajo dejan de usarse.
        </p>
      )}

      <ul className="space-y-3">
        {items.map((v, i) => (
          <li
            key={v.id ?? `nueva-${i}`}
            className={`rounded-sm border border-border p-3 ${v.is_active ? "" : "bg-muted/40"}`}
          >
            <div className="flex items-start gap-2">
              <div className="min-w-0 flex-1 space-y-3">
                <div className="space-y-1.5">
                  <Label htmlFor={`var-name-${i}`} className="text-xs">
                    Opción
                  </Label>
                  <Input
                    id={`var-name-${i}`}
                    placeholder="Solo espalda"
                    value={v.name}
                    onChange={(e) => actualizar(i, { name: e.target.value })}
                  />
                </div>

                <div className="grid gap-3 sm:grid-cols-3">
                  <div className="space-y-1.5">
                    <Label htmlFor={`var-dur-${i}`} className="text-xs">
                      Duración (min)
                    </Label>
                    <Input
                      id={`var-dur-${i}`}
                      type="number"
                      min={1}
                      value={v.duration_minutes}
                      onChange={(e) => actualizar(i, { duration_minutes: Number(e.target.value) })}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor={`var-buf-${i}`} className="text-xs">
                      Margen (min)
                    </Label>
                    <Input
                      id={`var-buf-${i}`}
                      type="number"
                      min={0}
                      value={v.buffer_minutes}
                      onChange={(e) => actualizar(i, { buffer_minutes: Number(e.target.value) })}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor={`var-price-${i}`} className="text-xs">
                      Precio
                    </Label>
                    <Input
                      id={`var-price-${i}`}
                      type="number"
                      min={0}
                      value={v.price}
                      onChange={(e) => actualizar(i, { price: Number(e.target.value) })}
                    />
                  </div>
                </div>

                <div className="flex items-center justify-between gap-3">
                  <span className="text-xs text-muted-foreground">
                    {v.is_active
                      ? "Se puede reservar."
                      : "Apagada: no se ofrece, pero los turnos que la usaron la conservan."}
                  </span>
                  <Switch
                    checked={v.is_active}
                    onCheckedChange={(value) => actualizar(i, { is_active: value })}
                    aria-label={`Ofrecer la opción ${v.name || i + 1}`}
                  />
                </div>
              </div>

              <div className="flex shrink-0 flex-col gap-1">
                <Button
                  type="button"
                  size="icon"
                  variant="ghost"
                  aria-label="Subir"
                  disabled={i === 0}
                  onClick={() => mover(i, i - 1)}
                >
                  <ChevronUp className="h-4 w-4" />
                </Button>
                <Button
                  type="button"
                  size="icon"
                  variant="ghost"
                  aria-label="Bajar"
                  disabled={i === items.length - 1}
                  onClick={() => mover(i, i + 1)}
                >
                  <ChevronDown className="h-4 w-4" />
                </Button>
                <Button
                  type="button"
                  size="icon"
                  variant="ghost"
                  aria-label={`Borrar la opción ${v.name || i + 1}`}
                  onClick={() => onChange(items.filter((_, j) => j !== i))}
                >
                  <Trash2 className="h-4 w-4 text-destructive" />
                </Button>
              </div>
            </div>
          </li>
        ))}
      </ul>

      <Button type="button" variant="outline" onClick={agregar}>
        <Plus className="mr-2 h-4 w-4" />
        {items.length === 0 ? "Agregar opciones (solo espalda, cuerpo completo…)" : "Otra opción"}
      </Button>
    </div>
  );
}
