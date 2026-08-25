import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

/**
 * "Equipo" al lado del nombre, en las listas que salen de `profiles`.
 *
 * Existe porque esas listas —el buscador de Nuevo turno y la pantalla de
 * Clientes— traen una fila por CADA cuenta, y ahí adentro están las empleadas y
 * la dueña. Marcarlas es la alternativa a esconderlas: una empleada también se
 * atiende en el centro, así que tiene que poder recibir un turno, pero no tiene
 * que confundirse con una clienta al primer vistazo.
 *
 * Va en `secondary` y no en un color de aviso a propósito: no es un error ni
 * algo que haya que corregir, es un dato.
 */
export function TeamTag({ className }: { className?: string }) {
  return (
    <Badge variant="secondary" className={cn("ml-2 shrink-0 font-normal", className)}>
      Equipo
    </Badge>
  );
}
