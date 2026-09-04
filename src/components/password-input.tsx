import * as React from "react";
import { Eye, EyeOff } from "lucide-react";

import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

/**
 * Campo de contraseña con el ojito para mostrar lo que se está escribiendo.
 *
 * Escribir una contraseña a ciegas en el teléfono es la forma más común de
 * quedarse afuera de la propia cuenta: se erra una letra, no se ve, y el error
 * que vuelve es "credenciales inválidas" sin decir cuál de las dos falló. Poder
 * mirar lo tecleado saca ese tropiezo del medio, tanto al ingresar como al
 * elegir una contraseña nueva.
 *
 * El estado arranca oculto siempre y no se recuerda entre montajes: destapar es
 * un gesto puntual de quien está mirando la pantalla en ese momento, no una
 * preferencia que convenga dejar pegada por si al lado hay alguien más.
 *
 * `type="button"` no es opcional: adentro de un `<form>` un botón sin type es
 * submit, así que tocar el ojito mandaría el formulario en vez de destapar.
 * Y `tabIndex={-1}` lo saca del recorrido del tabulador para que quien navega
 * con teclado siga yendo del campo directo al botón de enviar; el ojito sigue
 * siendo alcanzable con el mouse y anunciado por el lector de pantalla.
 */
const PasswordInput = React.forwardRef<
  HTMLInputElement,
  Omit<React.ComponentProps<"input">, "type">
>(({ className, ...props }, ref) => {
  const [visible, setVisible] = React.useState(false);
  const Icon = visible ? EyeOff : Eye;

  return (
    <div className="relative">
      <Input
        {...props}
        ref={ref}
        type={visible ? "text" : "password"}
        // Espacio a la derecha para que el texto largo no pase por debajo del ojito.
        className={cn("pr-10", className)}
      />
      <button
        type="button"
        tabIndex={-1}
        onClick={() => setVisible((v) => !v)}
        aria-label={visible ? "Ocultar contraseña" : "Mostrar contraseña"}
        aria-pressed={visible}
        className="absolute inset-y-0 right-0 flex w-10 items-center justify-center text-muted-foreground transition-colors hover:text-foreground"
      >
        <Icon className="h-4 w-4" aria-hidden="true" />
      </button>
    </div>
  );
});
PasswordInput.displayName = "PasswordInput";

export { PasswordInput };
