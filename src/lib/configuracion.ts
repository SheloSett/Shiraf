import { CalendarOff, FileText, type LucideIcon } from "lucide-react";
import type { AccessRequirement } from "@/lib/permissions";

/**
 * Las subsecciones de Configuración, escritas una sola vez.
 *
 * Las leen dos lugares que tienen que decir exactamente lo mismo: el
 * desplegable del menú lateral (`admin.tsx`) y la portada de la sección
 * (`admin.configuracion.index.tsx`). Con dos listas, el día que entre una
 * subsección nueva aparecería en el menú y no en la portada —o al revés— y
 * nadie lo notaría hasta ir a buscarla.
 *
 * Cada una declara su propio acceso. Hoy las dos piden `admin`, pero el campo
 * se queda: el menú y la portada muestran sólo las que la persona puede abrir,
 * y el día que entre una subsección delegable la regla ya está escrita.
 *
 * 7/9/2026 — Días cerrados pedía `appointments`, con la idea de que "el 25 no
 * abrimos" era algo que se le podía pedir anotar a la secretaria. La dueña lo
 * vio en producción con una empleada de prueba y lo pidió al revés: cerrar el
 * centro lo decide ella y nadie más, y una empleada no tiene por qué ver
 * Configuración. Con las dos subsecciones en `admin`, la sección entera
 * desaparece del menú para todo el equipo.
 *
 * ⚠️ Lo que NO sale de acá es lo que exige cada ruta del lado del guard: eso
 * sigue en `ADMIN_ROUTES` (permissions.ts), y no puede importar este archivo
 * porque permissions.ts lo carga también el servidor y esto trae los íconos
 * de lucide. Al agregar una subsección hay que tocar los dos — y el
 * `requiredAccessFor` de la fila nueva tiene que decir lo mismo que `access`
 * acá, o el menú va a ofrecer una puerta que la pantalla después cierra.
 */
export const SECCIONES_DE_CONFIGURACION = [
  {
    to: "/admin/configuracion/dias-cerrados",
    label: "Días cerrados",
    icon: CalendarOff,
    // Era "appointments". Ver la nota de arriba (7/9/2026).
    access: "admin",
    descripcion:
      "Los días que el centro no abre para nadie: feriados, vacaciones de todo el equipo. Esos días no se puede reservar, y si ya había turnos dados, acá quedan a la vista hasta que se resuelvan.",
  },
  {
    to: "/admin/configuracion/contenido",
    label: "Contenido del sitio",
    icon: FileText,
    access: "admin",
    descripcion:
      "Los textos y las fotos del sitio público: lo que dice la portada, la página de tratamientos y los datos del centro.",
  },
] as const satisfies readonly {
  to: string;
  label: string;
  icon: LucideIcon;
  access: AccessRequirement;
  descripcion: string;
}[];
