import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Check, ChevronsUpDown, Link2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { api, apiPut } from "@/lib/api";
import type { RtaClientasParaElegir, RtaCorreccion } from "@/lib/api-tipos";
import { cn } from "@/lib/utils";

export type GuestToLink = { name: string; phone: string | null };

/**
 * Pasa los turnos de una invitada al historial de una clienta registrada.
 *
 * POR QUÉ ESTO ES MANUAL Y NO AUTOMÁTICO:
 *
 * Cuando el mail coincide, el traspaso ocurre solo al confirmarse la cuenta —
 * Supabase manda el enlace de confirmación, así que hay prueba de que la
 * casilla es suya. Por teléfono no hay ninguna prueba: nadie lo verifica.
 *
 * Si esto fuera automático por teléfono, alguien podría registrarse poniendo el
 * celular de otra persona y quedarse con su historial: qué tratamientos se
 * hizo, cuándo y con quién. En un centro de estética eso incluye embarazos y
 * problemas de piel. Quien atiende el mostrador sabe si esa Mica es la misma;
 * el sistema no puede saberlo, así que pregunta.
 */
export function LinkGuestDialog({
  guest,
  onOpenChange,
}: {
  /** Invitada a vincular, o null si el diálogo está cerrado. */
  guest: GuestToLink | null;
  onOpenChange: (open: boolean) => void;
}) {
  const queryClient = useQueryClient();
  const [clientId, setClientId] = useState<string | undefined>();
  const [pickerOpen, setPickerOpen] = useState(false);

  const clients = useQuery({
    queryKey: ["appointment-form", "clients"],
    enabled: !!guest,
    queryFn: async () => (await api<RtaClientasParaElegir>("/api/turnos/clientas")).clientas,
  });

  const client = clients.data?.find((c) => c.id === clientId);

  const link = useMutation({
    mutationFn: async () =>
      (
        await apiPut<RtaCorreccion>("/api/turnos/invitada/vincular", {
          phone: guest!.phone!,
          clientId: clientId!,
        })
      ).count,
    onSuccess: async (count) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["admin-appointments"] }),
        queryClient.invalidateQueries({ queryKey: ["admin-clients"] }),
      ]);
      // Se avisa el número porque agarra TODOS los turnos con ese teléfono, no
      // sólo el que se estaba mirando: si vino cuatro veces, se vinculan los
      // cuatro y conviene que quede claro.
      toast.success(
        count === 1 ? "Se vinculó 1 turno." : `Se vincularon ${count} turnos de ese teléfono.`,
      );
      setClientId(undefined);
      onOpenChange(false);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <Dialog
      open={!!guest}
      onOpenChange={(next) => {
        onOpenChange(next);
        if (!next) setClientId(undefined);
      }}
    >
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="font-display text-2xl">Vincular a una cuenta</DialogTitle>
          <DialogDescription>
            {guest?.name} reservó sin tener cuenta. Si ya se registró en el sitio, elegila acá y sus
            turnos pasan a su historial.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="rounded-sm border border-border bg-secondary/40 p-3 text-sm">
            <span className="text-muted-foreground">Turno a nombre de </span>
            <span className="text-foreground">{guest?.name}</span>
            {guest?.phone && (
              <>
                <span className="text-muted-foreground"> · tel. </span>
                <span className="text-foreground">{guest.phone}</span>
              </>
            )}
          </div>

          <div className="space-y-2">
            <Label>Cuenta de la clienta</Label>
            <Popover open={pickerOpen} onOpenChange={setPickerOpen}>
              <PopoverTrigger asChild>
                <Button
                  variant="outline"
                  role="combobox"
                  aria-expanded={pickerOpen}
                  className="w-full justify-between font-normal"
                >
                  {client ? (
                    <span className="truncate">
                      {client.full_name ?? "Sin nombre"}
                      {client.phone && (
                        <span className="text-muted-foreground"> · {client.phone}</span>
                      )}
                    </span>
                  ) : (
                    <span className="text-muted-foreground">Buscar clienta…</span>
                  )}
                  <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-(--radix-popover-trigger-width) p-0" align="start">
                <Command>
                  <CommandInput placeholder="Nombre o teléfono…" />
                  <CommandList>
                    <CommandEmpty>
                      <span className="block px-2 py-3 text-xs leading-relaxed">
                        No aparece ninguna. Todavía no se registró en el sitio.
                      </span>
                    </CommandEmpty>
                    <CommandGroup>
                      {clients.data?.map((c) => (
                        <CommandItem
                          key={c.id}
                          value={`${c.full_name ?? "sin nombre"} ${c.phone ?? ""}`}
                          onSelect={() => {
                            setClientId(c.id);
                            setPickerOpen(false);
                          }}
                        >
                          <Check
                            className={cn(
                              "mr-2 h-4 w-4",
                              clientId === c.id ? "opacity-100" : "opacity-0",
                            )}
                          />
                          <span className="truncate">
                            {c.full_name ?? "Sin nombre"}
                            {c.phone && <span className="text-muted-foreground"> · {c.phone}</span>}
                          </span>
                        </CommandItem>
                      ))}
                    </CommandGroup>
                  </CommandList>
                </Command>
              </PopoverContent>
            </Popover>
          </div>

          <p className="text-xs leading-relaxed text-muted-foreground">
            Se vinculan <span className="font-medium">todos</span> los turnos que tengan ese
            teléfono, no sólo este. Confirmá que sea la misma persona: una vez vinculados, la
            clienta ve esos turnos en su cuenta.
          </p>

          <Button
            className="w-full"
            disabled={!clientId || link.isPending}
            onClick={() => link.mutate()}
          >
            <Link2 className="mr-2 h-4 w-4" />
            {link.isPending ? "Vinculando…" : "Vincular turnos"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
