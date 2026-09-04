import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { UserPlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PasswordInput } from "@/components/password-input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { apiPost } from "@/lib/api";
import type { RtaAltaDeClienta } from "@/lib/api-tipos";

/** Lo mismo que `MINIMO_CONTRASENA` en el servidor, que es quien lo hace cumplir. */
const MINIMO_CONTRASENA = 8;

/**
 * Dar de alta una clienta desde el panel.
 *
 * ── QUÉ CREA ESTO, Y QUÉ NO ───────────────────────────────────────────────
 *
 * Crea una **cuenta entera**: la clienta después entra al sitio con el mail y la
 * contraseña que se le cargan acá, reserva sola y ve su historial. No es lo
 * mismo que anotar a una invitada al cargarle un turno —eso guarda el nombre y
 * el teléfono en la fila del turno y no crea ninguna cuenta—; es el alta que la
 * clienta habría hecho ella misma desde «Crear cuenta», hecha por el centro.
 *
 * ── LA CONTRASEÑA SE LA DICE EL CENTRO, NO EL MAIL ────────────────────────
 *
 * No se manda por correo, y es deliberado: una contraseña escrita en un mail
 * queda guardada para siempre en esa casilla, y en la de cualquiera que después
 * lo reenvíe. Se la dictan por teléfono o por WhatsApp, y la clienta la cambia
 * desde «Mi cuenta» cuando quiera.
 *
 * ── EL MAIL QUEDA SIN CONFIRMAR, Y ESTÁ BIEN ──────────────────────────────
 *
 * Que el centro escriba una dirección no prueba que sea de esa persona, así que
 * la cuenta nace sin confirmar y le sale el mail de siempre con el enlace. Eso
 * no le impide nada: entra y reserva igual. Lo único que espera al enlace es que
 * se le sumen los turnos que haya sacado antes como invitada — y justamente por
 * eso no se puede dar por confirmada desde acá, o cargar a alguien con el mail
 * de otra le pasaría el historial ajeno.
 */
export function NewClientDialog() {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [password, setPassword] = useState("");

  const queryClient = useQueryClient();

  const limpiar = () => {
    setName("");
    setEmail("");
    setPhone("");
    setPassword("");
  };

  const crear = useMutation({
    mutationFn: async () =>
      await apiPost<RtaAltaDeClienta>("/api/clientas", {
        fullName: name.trim(),
        email: email.trim(),
        phone: phone.trim() || null,
        password,
      }),
    onSuccess: async (r) => {
      await queryClient.invalidateQueries({ queryKey: ["admin-clients"] });
      // El buscador de «Nuevo turno» sale de otra consulta: sin esto, la clienta
      // recién creada no aparecería ahí hasta recargar la página, que es
      // justamente lo primero que se quiere hacer después de darla de alta.
      await queryClient.invalidateQueries({ queryKey: ["appointment-form", "clients"] });

      // Si el mail no salió hay que decirlo acá y no tragárselo: la cuenta quedó
      // creada y la clienta entra igual, pero nadie le mandó el enlace, así que
      // sus turnos de invitada no se le van a sumar solos. Quien la cargó es la
      // única persona en condiciones de avisarle.
      if (r.avisoMail) {
        toast.warning(`Clienta creada, pero el mail de confirmación no salió: ${r.avisoMail}`);
      } else {
        toast.success("Clienta creada. Pasale la contraseña que le pusiste.");
      }
      limpiar();
      setOpen(false);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const listo =
    name.trim() !== "" && email.trim().includes("@") && password.length >= MINIMO_CONTRASENA;

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        setOpen(v);
        // Al cerrar se descarta lo tecleado. Una contraseña a medio escribir que
        // sobrevive a la siguiente apertura del formulario es la forma de crear
        // una cuenta con una contraseña que nadie recuerda haber elegido.
        if (!v) limpiar();
      }}
    >
      <DialogTrigger asChild>
        <Button size="sm">
          <UserPlus className="mr-2 h-4 w-4" aria-hidden="true" />
          Nueva clienta
        </Button>
      </DialogTrigger>

      <DialogContent>
        <DialogHeader>
          <DialogTitle>Nueva clienta</DialogTitle>
          <DialogDescription>
            Le queda una cuenta para entrar al sitio con el mail y la contraseña que pongas acá.
            Pasásela vos: no se la mandamos por mail.
          </DialogDescription>
        </DialogHeader>

        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (listo && !crear.isPending) crear.mutate();
          }}
        >
          <div className="space-y-2">
            <Label htmlFor="nueva-clienta-nombre">Nombre y apellido</Label>
            <Input
              id="nueva-clienta-nombre"
              value={name}
              onChange={(e) => setName(e.target.value)}
              autoComplete="off"
              required
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="nueva-clienta-mail">Mail</Label>
            <Input
              id="nueva-clienta-mail"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoComplete="off"
              required
            />
            <p className="text-xs text-muted-foreground">
              Es con lo que va a entrar, así que tiene que ser el suyo de verdad.
            </p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="nueva-clienta-tel">Teléfono</Label>
            <Input
              id="nueva-clienta-tel"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              autoComplete="off"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="nueva-clienta-pass">Contraseña</Label>
            {/* Sin `type="password"` a ciegas: acá la contraseña la elige una
                persona para otra y hay que poder dictarla mirándola. */}
            <PasswordInput
              id="nueva-clienta-pass"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="new-password"
              required
            />
            <p className="text-xs text-muted-foreground">
              Al menos {MINIMO_CONTRASENA} caracteres. La clienta la puede cambiar después desde Mi
              cuenta.
            </p>
          </div>

          <Button type="submit" className="w-full" disabled={!listo || crear.isPending}>
            {crear.isPending ? "Creando…" : "Crear clienta"}
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}
