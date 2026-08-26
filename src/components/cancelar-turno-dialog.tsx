import { useEffect, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

/**
 * Cancelar un turno, diciendo por qué.
 *
 * ── POR QUÉ EL MOTIVO NO ES UNA NOTA INTERNA ──────────────────────────────
 *
 * Cuando cancela el centro, **lo que se escriba acá le llega a la clienta en el
 * mail**. Esa es la razón de que exista: un "tuvimos que cancelar tu turno" a
 * secas obliga a la clienta a llamar para saber qué pasó, y el centro termina
 * explicando por teléfono lo mismo veinte veces. Con el motivo escrito, el mail
 * ya lo dice.
 *
 * Y por eso el cartel avisa a quién va a parar el texto. Sin ese aviso, alguien
 * escribe "cliente pesada, no atender más" pensando que es una nota del panel y
 * se lo manda a la persona. Para eso está `admin_notes`, que no sale de la app.
 *
 * Cuando cancela la clienta, el texto viaja al revés: llega al centro con el
 * aviso de que se liberó el horario, y queda en la ficha del turno.
 *
 * ── OPCIONAL, SIEMPRE ─────────────────────────────────────────────────────
 *
 * El botón cancela con el campo vacío. Obligar a escribir algo para poder
 * cancelar un turno es la forma segura de que todo el mundo escriba "x" y el
 * dato deje de servir. Vacío, el mail cae al texto genérico de siempre.
 *
 * ── ES UN Dialog Y NO UN AlertDialog ──────────────────────────────────────
 *
 * Los otros carteles de confirmación de la app son `AlertDialog`, y acá no
 * sirve: su botón de acción cierra el cartel al tocarlo, sin esperar nada. Con
 * un pedido de por medio eso deja el campo escrito desapareciendo antes de saber
 * si el servidor lo aceptó. Con `Dialog` el cierre lo decide quien llama, y sólo
 * cuando la cancelación salió bien.
 */
export type TurnoACancelar = {
  id: string;
  /** El nombre de quien tiene el turno. En «Mi cuenta» sobra: es la propia. */
  quien?: string;
  /** La fecha ya formateada, tal como se ve en la pantalla que abrió esto. */
  cuando: string;
};

export function CancelarTurnoDialog({
  turno,
  quien,
  pendiente,
  onOpenChange,
  onConfirmar,
}: {
  /** El turno a cancelar, o null con el cartel cerrado. */
  turno: TurnoACancelar | null;
  /** Quién está cancelando. Cambia los textos y a dónde va a parar el motivo. */
  quien: "centro" | "clienta";
  pendiente: boolean;
  onOpenChange: (abierto: boolean) => void;
  onConfirmar: (motivo: string) => void;
}) {
  const [motivo, setMotivo] = useState("");

  // El campo se vacía cada vez que se abre para otro turno. Sin esto, cancelar
  // dos seguidos le pega al segundo el motivo que se escribió para el primero,
  // y ese texto se lo manda a otra persona.
  useEffect(() => {
    if (turno) setMotivo("");
  }, [turno]);

  const delCentro = quien === "centro";

  return (
    <Dialog open={turno !== null} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="font-display text-2xl">
            {delCentro ? "¿Cancelar este turno?" : "¿Cancelás tu turno?"}
          </DialogTitle>
          <DialogDescription>
            {turno?.quien ? `${turno.quien} · ` : ""}
            {turno?.cuando}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-2">
          <Label htmlFor="motivo-cancelacion">
            {delCentro ? "Motivo (se lo contamos a la clienta)" : "¿Por qué? (opcional)"}
          </Label>
          <Textarea
            id="motivo-cancelacion"
            rows={3}
            value={motivo}
            onChange={(e) => setMotivo(e.target.value)}
            placeholder={
              delCentro
                ? "Se nos rompió el equipo y no podemos hacerlo ese día."
                : "Me surgió un viaje."
            }
          />
          <p className="text-xs text-muted-foreground">
            {delCentro
              ? "Va tal cual en el mail que le llega. Si lo dejás vacío, el mail avisa la cancelación sin explicación."
              : "Nos ayuda a saber si podemos mejorar algo. Podés dejarlo vacío."}
          </p>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={pendiente}>
            Volver
          </Button>
          <Button
            variant="destructive"
            disabled={pendiente}
            onClick={() => onConfirmar(motivo.trim())}
          >
            {pendiente ? "Cancelando…" : "Cancelar el turno"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
