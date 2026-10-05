import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Save } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { PasswordInput } from "@/components/password-input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { apiPut } from "@/lib/api";
import type { FichaDeClienta, RtaEdicionDeClienta } from "@/lib/api-tipos";

/** Lo mismo que `MINIMO_CONTRASENA` en el servidor, que es quien lo hace cumplir. */
const MINIMO_CONTRASENA = 8;

export type ClientToEdit = Pick<
  FichaDeClienta,
  "id" | "full_name" | "phone" | "birth_date" | "email" | "notes"
>;

/**
 * Editar una clienta desde el panel.
 *
 * ── DOS MITADES, Y LAS DOS SON DE QUIEN VE LA FICHA ───────────────────────
 *
 * Arriba, la ficha: nombre, teléfono, cumpleaños y la nota clínica. Abajo, con
 * qué entra: el mail y la contraseña. No hay una mitad reservada a la dueña —
 * quien atiende a la clienta que llama porque no puede entrar es la secretaria.
 * Ver `editarClienta` en auth.controller.ts.
 *
 * ── SE MANDA SÓLO LO QUE SE TOCÓ ──────────────────────────────────────────
 *
 * Igual que en el acceso de una empleada: la contraseña vacía significa "no la
 * cambies", y el mail viene cargado con el actual y si no se toca no viaja. Lo
 * mismo con la nota, y ahí importa más: es la misma que la clienta escribe
 * desde «Mi cuenta», así que mandarla de vuelta sin haberla tocado le pisaría
 * lo que haya escrito mientras este formulario estaba abierto.
 *
 * ── A LA CLIENTA NO LE LLEGA NADA, Y HAY QUE DECÍRSELO ────────────────────
 *
 * La contraseña no sale por correo, como en el alta. Y el mail nuevo queda
 * puesto en el acto, sin enlace para confirmar. Las dos cosas se le avisan de
 * palabra, y por eso el cartel de después de guardar las nombra.
 */
export function EditClientDialog({
  client,
  onOpenChange,
}: {
  /** Clienta a editar, o null si el diálogo está cerrado. */
  client: ClientToEdit | null;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Dialog open={!!client} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-md">
        {/* Montado recién al abrir y con `key`, como el de la invitada: los
            campos arrancan con los datos de ESTA clienta sin un useEffect que
            los sincronice, y una contraseña a medio escribir no sobrevive al
            cierre. */}
        {client && (
          <EditClientForm key={client.id} client={client} onDone={() => onOpenChange(false)} />
        )}
      </DialogContent>
    </Dialog>
  );
}

function EditClientForm({ client, onDone }: { client: ClientToEdit; onDone: () => void }) {
  const queryClient = useQueryClient();

  const [name, setName] = useState(client.full_name ?? "");
  const [phone, setPhone] = useState(client.phone ?? "");
  const [birthDate, setBirthDate] = useState(client.birth_date ?? "");
  const [notes, setNotes] = useState(client.notes ?? "");
  const [email, setEmail] = useState(client.email ?? "");
  const [password, setPassword] = useState("");

  // El mail se compara en minúscula porque el servidor lo guarda así: sin eso,
  // escribirlo con una mayúscula distinta contaría como cambio.
  const mail = email.trim().toLowerCase();

  const cambios: {
    fullName?: string;
    phone?: string;
    birthDate?: string;
    notes?: string;
    email?: string;
    password?: string;
  } = {};
  if (name.trim() !== (client.full_name ?? "")) cambios.fullName = name.trim();
  // La cadena vacía viaja igual: es cómo se borra un dato cargado por error.
  if (phone.trim() !== (client.phone ?? "")) cambios.phone = phone.trim();
  if (birthDate !== (client.birth_date ?? "")) cambios.birthDate = birthDate;
  if (notes.trim() !== (client.notes ?? "").trim()) cambios.notes = notes.trim();
  if (mail !== (client.email ?? "").toLowerCase()) cambios.email = mail;
  if (password !== "") cambios.password = password;

  const save = useMutation({
    mutationFn: async () =>
      await apiPut<RtaEdicionDeClienta>(`/api/clientas/${client.id}`, cambios),
    onSuccess: async (r) => {
      await Promise.all([
        // La lista y la ficha abierta: las dos claves empiezan igual.
        queryClient.invalidateQueries({ queryKey: ["admin-clients"] }),
        // El nombre y el teléfono también se leen en Turnos, en el calendario y
        // en el buscador de «Nuevo turno».
        queryClient.invalidateQueries({ queryKey: ["admin-appointments"] }),
        queryClient.invalidateQueries({ queryKey: ["admin-calendar"] }),
        queryClient.invalidateQueries({ queryKey: ["appointment-form", "clients"] }),
      ]);

      // Se dice lo que queda por hacer, no sólo que salió bien: a ella no le
      // llega ningún mail por ninguna de las dos cosas.
      const quedaPorHacer = [
        r.emailCambiado ? "Avisale que ahora entra con el mail nuevo." : null,
        r.claveCambiada ? "Pasale la contraseña que le pusiste." : null,
      ].filter((x): x is string => x !== null);

      toast.success(["Datos guardados.", ...quedaPorHacer].join(" "));
      onDone();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const hayAlgo = Object.keys(cambios).length > 0;
  // Borrar el nombre no se puede, pero a quien todavía no tiene uno cargado no
  // se le exige para poder corregirle otra cosa.
  const nombreBorrado = cambios.fullName === "";
  const claveCorta = password !== "" && password.length < MINIMO_CONTRASENA;
  const mailRoto = cambios.email !== undefined && !mail.includes("@");
  const ready = hayAlgo && !nombreBorrado && !claveCorta && !mailRoto && !save.isPending;

  return (
    <>
      <DialogHeader>
        <DialogTitle className="font-display text-2xl">Editar clienta</DialogTitle>
        <DialogDescription>
          Cambiá lo que haga falta y dejá el resto como está. La contraseña vacía significa que no
          se toca.
        </DialogDescription>
      </DialogHeader>

      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          if (ready) save.mutate();
        }}
      >
        <div className="space-y-2">
          <Label htmlFor="editar-clienta-nombre">Nombre y apellido</Label>
          <Input
            id="editar-clienta-nombre"
            value={name}
            onChange={(e) => setName(e.target.value)}
            autoComplete="off"
          />
          {nombreBorrado && (
            <p className="text-xs font-medium text-destructive">El nombre no puede quedar vacío.</p>
          )}
        </div>

        <div className="space-y-2">
          <Label htmlFor="editar-clienta-tel">Teléfono</Label>
          <Input
            id="editar-clienta-tel"
            value={phone}
            inputMode="tel"
            onChange={(e) => setPhone(e.target.value)}
            autoComplete="off"
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="editar-clienta-cumple">Cumpleaños</Label>
          <Input
            id="editar-clienta-cumple"
            type="date"
            value={birthDate}
            onChange={(e) => setBirthDate(e.target.value)}
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="editar-clienta-notas">Notas clínicas</Label>
          <Textarea
            id="editar-clienta-notas"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={4}
          />
          <p className="text-xs leading-relaxed text-muted-foreground">
            Alergias, embarazos, antecedentes. Es la misma nota que ella ve y escribe desde Mi
            cuenta: lo que pongas acá lo lee.
          </p>
        </div>

        <div className="space-y-4 border-t border-border pt-4">
          <p className="text-sm font-semibold text-foreground">Con qué entra al sitio</p>

          <div className="space-y-2">
            <Label htmlFor="editar-clienta-mail">Mail</Label>
            <Input
              id="editar-clienta-mail"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoComplete="off"
            />
            {cambios.email !== undefined && !mailRoto && (
              <p className="text-xs leading-relaxed text-muted-foreground">
                Desde que guardes entra con esta dirección y la anterior deja de servir. No le llega
                ningún aviso: revisá que esté bien escrita.
              </p>
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor="editar-clienta-pass">Contraseña nueva</Label>
            {/* Con el ojito, igual que en el alta: la elige una persona para
                otra y hay que poder dictarla mirándola. */}
            <PasswordInput
              id="editar-clienta-pass"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Dejala vacía para no cambiarla"
              autoComplete="new-password"
            />
            {claveCorta ? (
              <p className="text-xs font-medium text-destructive">
                Necesita al menos {MINIMO_CONTRASENA} caracteres.
              </p>
            ) : (
              password !== "" && (
                <p className="text-xs leading-relaxed text-muted-foreground">
                  Pasásela vos: no se la mandamos por mail. Si tiene el sitio abierto no se le
                  cierra; rige para la próxima vez que entre.
                </p>
              )
            )}
          </div>
        </div>

        <Button type="submit" className="w-full" disabled={!ready}>
          <Save className="mr-2 h-4 w-4" aria-hidden="true" />
          {save.isPending ? "Guardando…" : "Guardar cambios"}
        </Button>
      </form>
    </>
  );
}
