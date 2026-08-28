import { Link } from "@tanstack/react-router";
import { TriangleAlert } from "lucide-react";
import { comoPlata } from "@/lib/metricas-formato";

/**
 * El aviso de turnos vencidos sin cerrar.
 *
 * Va arriba de los números en las dos pantallas, y no abajo ni en un costado,
 * porque es la explicación de los números que están debajo: mientras haya
 * turnos atendidos que nadie pasó a «Realizado», la facturación y las visitas
 * que muestra el panel son MENORES que las reales.
 *
 * Sin esto, el error es de los caros: se mira un mes flojo, se concluye que se
 * vendió poco y se toma una decisión —bajar precios, cambiar horarios— sobre un
 * número que estaba incompleto por un problema administrativo.
 */
export function AvisoDeVencidos({ cantidad, monto }: { cantidad: number; monto: number }) {
  if (cantidad === 0) return null;

  return (
    <div className="mt-8 flex flex-wrap items-center gap-4 rounded-sm border-2 border-destructive bg-destructive/10 p-4">
      <TriangleAlert className="h-5 w-5 shrink-0 text-destructive" />
      <div className="flex-1">
        <p className="font-medium text-foreground">
          {cantidad === 1
            ? "Hay 1 turno vencido sin cerrar"
            : `Hay ${cantidad} turnos vencidos sin cerrar`}
        </p>
        <p className="mt-0.5 text-sm leading-relaxed text-muted-foreground">
          Ya pasaron y siguen en pendiente o confirmado. Todo lo que dice «facturado» y «visitas» en
          esta pantalla cuenta sólo los turnos marcados como <strong>Realizado</strong>, así que
          estos {cantidad === 1 ? "no está" : "no están"} contados:{" "}
          <strong className="text-foreground">{comoPlata(monto)}</strong> que el panel no ve. Si se
          atendieron, marcalos y los números suben solos.
        </p>
      </div>
      <Link
        to="/admin/turnos"
        search={{ estado: "confirmed" }}
        className="shrink-0 rounded-md border border-input bg-background px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-accent/20"
      >
        Ir a cerrarlos
      </Link>
    </div>
  );
}
