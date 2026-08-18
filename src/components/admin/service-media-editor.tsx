import { ChevronLeft, ChevronRight, Play, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { imageUrl, videoPosterUrl } from "@/lib/cloudinary";
import { cn } from "@/lib/utils";

/**
 * Un elemento de la galería, tal como lo maneja el formulario.
 *
 * `id` es el de service_media y falta mientras el archivo está subido a
 * Cloudinary pero todavía no se guardó el tratamiento. Esa diferencia es la que
 * usa el formulario para saber qué insertar y qué borrar si se cancela.
 */
export type MediaItem = {
  id?: string;
  url: string;
  kind: "image" | "video";
};

/**
 * Editor de la galería de un tratamiento: fotos y videos mezclados y en orden.
 *
 * EL ORDEN IMPORTA Y NO ES DECORATIVO: la primera IMAGEN de la lista es la
 * portada, que es la que sale en la tarjeta del catálogo, en el panel del inicio
 * y en la miniatura de esta misma pantalla. Por eso está marcada — sin el
 * cartel, mover una foto al primer lugar cambia el catálogo entero y no hay
 * nada en pantalla que lo anticipe.
 *
 * Se reordena con flechas y no arrastrando. Son tres o cuatro elementos por
 * tratamiento, y el drag and drop necesita una librería, no funciona con el
 * teclado y en un celular pelea con el scroll de la página.
 */
export function ServiceMediaEditor({
  items,
  onChange,
  disabled,
}: {
  items: MediaItem[];
  onChange: (next: MediaItem[]) => void;
  disabled?: boolean;
}) {
  /** Índice de la primera imagen: la que la base va a tomar como portada. */
  const coverIndex = items.findIndex((m) => m.kind === "image");

  function move(from: number, to: number) {
    if (to < 0 || to >= items.length) return;
    const next = [...items];
    const [moved] = next.splice(from, 1);
    if (moved) next.splice(to, 0, moved);
    onChange(next);
  }

  function removeAt(index: number) {
    onChange(items.filter((_, i) => i !== index));
  }

  if (items.length === 0) return null;

  return (
    <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3">
      {items.map((item, index) => (
        <li
          key={item.id ?? item.url}
          className="group relative overflow-hidden rounded-sm border border-border bg-muted"
        >
          <div className="relative aspect-[4/5]">
            <img
              /* El video no se puede mostrar en la tira: habría que bajar el
                 archivo entero para pintar un cuadradito. Cloudinary devuelve
                 un fotograma como jpg desde la misma URL. */
              src={
                (item.kind === "video"
                  ? videoPosterUrl(item.url, "card")
                  : imageUrl(item.url, "card")) ?? undefined
              }
              alt=""
              className="h-full w-full object-cover"
            />

            {item.kind === "video" && (
              <span
                className="absolute inset-0 flex items-center justify-center bg-black/25"
                aria-hidden="true"
              >
                <Play className="h-8 w-8 fill-white text-white" />
              </span>
            )}

            {index === coverIndex && (
              <span className="absolute left-1.5 top-1.5 rounded-xs bg-foreground/85 px-1.5 py-0.5 text-[10px] font-medium tracking-wide text-background uppercase">
                Portada
              </span>
            )}
          </div>

          <div className="flex items-center justify-between gap-1 border-t border-border bg-card px-1.5 py-1">
            <div className="flex gap-0.5">
              <Button
                type="button"
                size="icon"
                variant="ghost"
                className="h-7 w-7"
                disabled={disabled || index === 0}
                onClick={() => move(index, index - 1)}
                aria-label={`Mover al lugar ${index}`}
              >
                <ChevronLeft className="h-4 w-4" />
              </Button>
              <Button
                type="button"
                size="icon"
                variant="ghost"
                className="h-7 w-7"
                disabled={disabled || index === items.length - 1}
                onClick={() => move(index, index + 1)}
                aria-label={`Mover al lugar ${index + 2}`}
              >
                <ChevronRight className="h-4 w-4" />
              </Button>
            </div>

            <Button
              type="button"
              size="icon"
              variant="ghost"
              className={cn("h-7 w-7 text-destructive hover:text-destructive")}
              disabled={disabled}
              onClick={() => removeAt(index)}
              aria-label={item.kind === "video" ? "Quitar el video" : "Quitar la foto"}
            >
              <X className="h-4 w-4" />
            </Button>
          </div>
        </li>
      ))}
    </ul>
  );
}
