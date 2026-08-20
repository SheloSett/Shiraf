import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Save } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { supabase } from "@/integrations/supabase/client";

export type GuestToEdit = {
  appointmentId: string;
  name: string;
  phone: string | null;
  email: string | null;
};

/**
 * Corregir los datos de una invitada.
 *
 * Los turnos de quien no tiene cuenta guardan el nombre, el teléfono y el mail
 * en la fila del turno (`guest_*`), no en una ficha: no hay ficha porque no hay
 * cuenta. Hasta acá eso significaba que un teléfono mal anotado no se podía
 * arreglar desde ningún lado.
 *
 * ── A CUÁNTOS TURNOS ALCANZA EL CAMBIO, Y POR QUÉ ──────────────────────────
 *
 * Ésta es la única decisión de fondo de esta pantalla, y la respuesta NO es
 * "todos los turnos con ese teléfono", que era lo primero que uno escribe.
 *
 * El teléfono no identifica a nadie. En esta misma base hay hoy dos personas
 * distintas con el 1131754087: una invitada y una clienta registrada. Si el
 * cambio se guiara por ahí, corregirle el nombre a una le pisaría los datos a
 * la otra. Y es peor todavía cuando el teléfono es justo el dato que está mal,
 * que es el caso que se vino a resolver: se saldría a buscar por el número
 * equivocado, que puede ser el número correcto de otra persona.
 *
 * El mail sí identifica: es lo que usa claim_guest_appointments() para pasarle
 * los turnos a su cuenta el día que se registra, y nadie tiene el mail de otro
 * por casualidad. Entonces:
 *
 *   · La invitada TIENE mail  → se corrigen todos los turnos con ese mail.
 *   · La invitada NO tiene    → se corrige sólo este turno, y nada más.
 *
 * El segundo caso es deliberadamente conservador: es preferible que queden dos
 * turnos con el nombre a medio corregir —que se ve y se arregla— a escribir
 * encima de los datos de una persona que no era.
 *
 * Ojo con un detalle del primer caso: el conjunto se arma con el mail que la
 * invitada tiene AHORA, antes de tocar nada. Si en este mismo formulario le
 * cargás un mail que antes no tenía, el alcance sigue siendo este turno solo —
 * ese mail todavía no era de nadie acá.
 */
export function EditGuestDialog({
  guest,
  onOpenChange,
}: {
  /** Invitada a editar, o null si el diálogo está cerrado. */
  guest: GuestToEdit | null;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Dialog open={!!guest} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        {/* El formulario se monta recién cuando el diálogo se abre, y con `key`
            en el turno. Así los campos arrancan con los datos de ESTE turno sin
            un useEffect que los sincronice — que es de donde salen los
            formularios que te muestran lo de la fila anterior. */}
        {guest && (
          <EditGuestForm
            key={guest.appointmentId}
            guest={guest}
            onDone={() => onOpenChange(false)}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

function EditGuestForm({ guest, onDone }: { guest: GuestToEdit; onDone: () => void }) {
  const queryClient = useQueryClient();
  const [name, setName] = useState(guest.name);
  const [phone, setPhone] = useState(guest.phone ?? "");
  const [email, setEmail] = useState(guest.email ?? "");

  /** El mail con el que la invitada llegó acá. Es el que define el alcance. */
  const originalEmail = guest.email?.trim().toLowerCase() ?? "";

  /**
   * Los turnos que van a cambiar.
   *
   * Se comparan los mails en JavaScript y no con un `.eq()` porque la
   * comparación tiene que ser insensible a mayúsculas —que es como la hace
   * claim_guest_appointments()— y `.ilike()` no sirve: un guión bajo es un
   * comodín de un carácter en LIKE, y los mails llevan guiones bajos.
   */
  const targets = useQuery({
    queryKey: ["guest-siblings", originalEmail],
    enabled: originalEmail !== "",
    queryFn: async () => {
      const { data, error } = await supabase
        .from("appointments")
        .select("id, guest_email")
        .is("client_id", null)
        .not("guest_email", "is", null);
      if (error) throw error;
      return (data ?? [])
        .filter((a) => (a.guest_email ?? "").trim().toLowerCase() === originalEmail)
        .map((a) => a.id);
    },
  });

  // Sin mail, el alcance es este turno y se sabe sin preguntarle nada a la base.
  const ids = originalEmail === "" ? [guest.appointmentId] : (targets.data ?? []);
  const counting = originalEmail !== "" && targets.isLoading;

  const save = useMutation({
    mutationFn: async () => {
      if (ids.length === 0) {
        // Sólo puede pasar si la consulta de arriba falló: guardar con la lista
        // vacía no tocaría ninguna fila y diría "listo" sin haber hecho nada.
        throw new Error("No se pudo determinar qué turnos corregir. Probá de nuevo.");
      }

      const { data, error } = await supabase
        .from("appointments")
        .update({
          guest_name: name.trim(),
          guest_phone: phone.trim() || null,
          // En minúscula: es como compara claim_guest_appointments() cuando le
          // pasa los turnos a su cuenta. Guardarlo con mayúsculas haría que ese
          // traspaso dependiera de cómo se escribió el día que se cargó.
          guest_email: email.trim().toLowerCase() || null,
        })
        .in("id", ids)
        .select("id");
      if (error) throw error;
      return data?.length ?? 0;
    },
    onSuccess: async (count) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["admin-appointments"] }),
        queryClient.invalidateQueries({ queryKey: ["admin-calendar"] }),
        queryClient.invalidateQueries({ queryKey: ["guest-siblings"] }),
      ]);
      toast.success(count === 1 ? "Datos corregidos." : `Se corrigieron ${count} turnos.`);
      onDone();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  // El nombre es obligatorio en la base: appointments_identifies_someone exige
  // que un turno sin cuenta tenga al menos un nombre. Sin esto, guardarlo vacío
  // rebota con un error de constraint que no le dice nada a nadie.
  const ready = name.trim().length > 0 && !counting && !save.isPending;

  return (
    <>
      <DialogHeader>
        <DialogTitle className="font-display text-2xl">Editar invitada</DialogTitle>
        <DialogDescription>
          {guest.name} no tiene cuenta, así que estos datos viven en el turno. Corregilos si se
          anotaron mal por teléfono.
        </DialogDescription>
      </DialogHeader>

      <div className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="guest-name">Nombre</Label>
          <Input
            id="guest-name"
            value={name}
            autoFocus
            onChange={(e) => setName(e.target.value)}
            placeholder="Como lo dijo por teléfono"
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="guest-phone">Teléfono</Label>
          <Input
            id="guest-phone"
            value={phone}
            inputMode="tel"
            onChange={(e) => setPhone(e.target.value)}
            placeholder="1131754087"
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="guest-email">Mail</Label>
          <Input
            id="guest-email"
            value={email}
            type="email"
            inputMode="email"
            onChange={(e) => setEmail(e.target.value)}
            placeholder="Opcional, pero sirve para dos cosas"
          />
          <p className="text-xs leading-relaxed text-muted-foreground">
            Es la única dirección a la que le puede llegar el aviso del turno, y es lo que hace que
            estos turnos pasen solos a su historial el día que se registre en el sitio.
          </p>
        </div>

        {/* El alcance, dicho antes de guardar y no después. Cambia según tenga
            mail o no, así que se explica cada vez en vez de asumir que se
            acuerda de la regla. */}
        <div className="rounded-sm border border-border bg-secondary/40 p-3">
          {originalEmail === "" ? (
            <p className="text-xs leading-relaxed text-muted-foreground">
              Se corrige <span className="font-medium text-foreground">sólo este turno</span>. Sin
              mail no hay forma segura de saber qué otros turnos son de la misma persona: un
              teléfono se repite o se anota mal, y corregir de más sería escribirle encima a otra
              clienta. Cargale el mail y la próxima vez se corrigen todos juntos.
            </p>
          ) : counting ? (
            <p className="text-xs text-muted-foreground">Buscando sus otros turnos…</p>
          ) : targets.isError ? (
            <p className="text-xs leading-relaxed text-destructive">
              No se pudo averiguar a cuántos turnos alcanza el cambio. Cerrá y volvé a abrir: no
              conviene guardar sin saberlo.
            </p>
          ) : (
            <p className="text-xs leading-relaxed text-muted-foreground">
              {ids.length === 1 ? (
                <>
                  Se corrige <span className="font-medium text-foreground">sólo este turno</span>:
                  es el único con ese mail.
                </>
              ) : (
                <>
                  Se corrigen los{" "}
                  <span className="font-medium text-foreground">{ids.length} turnos</span> que
                  tienen ese mail, no sólo éste.
                </>
              )}
            </p>
          )}
        </div>

        <Button className="w-full" disabled={!ready} onClick={() => save.mutate()}>
          <Save className="mr-2 h-4 w-4" />
          {save.isPending ? "Guardando…" : "Guardar cambios"}
        </Button>
      </div>
    </>
  );
}
