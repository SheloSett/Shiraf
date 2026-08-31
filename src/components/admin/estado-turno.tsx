import { ESTADO_VISIBLE_LABEL, estadoVisible, type EstadoVisible } from "@/lib/shiraf";
import { cn } from "@/lib/utils";

/**
 * El cartelito de estado de un turno.
 *
 * Existe para que la lista de Turnos, la ficha y el calendario digan lo mismo
 * del mismo turno. Antes cada pantalla resolvía el estado por su cuenta: la
 * lista mostraba el \`status\` crudo de la base, la ficha también, y sólo el
 * calendario sabía de «Vencido». Un turno del martes pasado sin cerrar salía
 * «Confirmado» en dos pantallas y rojo en la tercera.
 *
 * Los colores son los MISMOS de las pastillas del calendario, a propósito: quien
 * mira la agenda y después abre la lista tiene que reconocer el estado por el
 * color sin volver a leer. Ver \`appointmentTone\` en admin.index.tsx.
 */
const TONO: Record<EstadoVisible, string> = {
  // Dorado: espera una respuesta del centro.
  pending: "border-gold/40 bg-gold/15 text-foreground",
  // Oliva claro: está todo bien, el turno viene.
  confirmed: "border-primary/30 bg-primary/10 text-foreground",
  // Oliva cargado, el único tono medio: cerrado, no hay nada que hacer.
  completed: "border-primary/40 bg-primary/35 text-foreground",
  // Rojizo: es lo único que pide que alguien haga algo.
  overdue: "border-destructive/40 bg-destructive/12 text-foreground",
  // Gris y tachado, igual que en la grilla.
  cancelled: "border-border bg-muted text-muted-foreground line-through",
};

export function EstadoTurno({
  status,
  startsAt,
  minutos,
  now,
  className,
}: {
  status: string;
  startsAt: string;
  /** Cuánto dura. Hace falta para saber cuándo TERMINA: ver `yaVencio`. */
  minutos: number;
  /** El reloj. En null mientras no hidrató: ver `estadoVisible`. */
  now: number | null;
  className?: string;
}) {
  const estado = estadoVisible({ status, startsAt, minutos }, now);
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-md border px-2 py-0.5 text-xs font-medium whitespace-nowrap",
        TONO[estado],
        className,
      )}
    >
      {ESTADO_VISIBLE_LABEL[estado]}
    </span>
  );
}
