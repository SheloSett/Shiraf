import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { apiDelete } from "@/lib/api";

/**
 * Borrar un turno para siempre.
 *
 * ── POR QUÉ ESTO EXISTE SI YA SE PUEDE CANCELAR ───────────────────────────
 *
 * Cancelar y borrar no son lo mismo y las dos hacen falta. Un turno cancelado
 * sigue contando algo: que ese horario se había tomado y que después se cayó.
 * Un turno cargado dos veces, o cargado el jueves cuando era el viernes, no
 * cuenta nada — es basura en la agenda, y cancelarlo deja la basura ahí, en gris
 * y tachada, para siempre.
 *
 * ── EL SERVIDOR NO DEJA BORRAR UN TURNO QUE SE VA A ATENDER ───────────────
 *
 * Contesta 409 con el motivo escrito y el toast lo muestra tal cual. La pantalla
 * además esconde el botón en ese caso, pero eso es cortesía: quien decide es
 * `turnos.controller → borrar`, y el motivo está explicado allá.
 *
 * ── QUÉ SE REFRESCA ───────────────────────────────────────────────────────
 *
 * Un turno que desaparece se ve en cuatro lugares: la lista, sus contadores por
 * estado, el calendario y la ficha de la clienta —que muestra cuántos turnos
 * tuvo y cuándo vino la última vez—. Vive en un hook compartido justamente por
 * esto: la lista y la ficha del turno borran igual, y si cada una tuviera su
 * copia, el día que se sume una pantalla más una de las dos se queda vieja.
 *
 * La navegación no va acá: desde la lista se queda donde está y desde la ficha
 * del turno hay que irse, porque la pantalla que se está mirando dejó de
 * existir. Cada una lo resuelve con el `onSuccess` de su `mutate`.
 */
export function useBorrarTurno() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (id: string) => await apiDelete(`/api/turnos/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin-appointments"] });
      queryClient.invalidateQueries({ queryKey: ["admin-calendar"] });
      queryClient.invalidateQueries({ queryKey: ["admin-clients"] });
      toast.success("Turno eliminado.");
    },
    onError: (e: Error) => toast.error(e.message),
  });
}
