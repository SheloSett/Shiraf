import { useQuery } from "@tanstack/react-query";
import { puedeEntrarAlPanel, sesionQuery } from "@/lib/sesion";
import type { AccessRequirement, Permission } from "@/lib/permissions";

/**
 * Qué puede hacer quien está conectada.
 *
 * ── 🔴 ESTO DECIDE QUÉ SE MUESTRA, NO QUÉ SE PUEDE HACER ──────────────────
 *
 * La frase valía antes y vale más ahora, porque cambió quién la sostiene.
 * **Antes** lo que valía era la RLS: aunque esta pantalla se equivocara y
 * mostrara un botón de más, la base rechazaba la operación igual.
 *
 * **Ahora no hay RLS.** Lo que vale es el chequeo del controller, del otro lado
 * de la API. Este hook sigue existiendo para no ofrecer botones que van a
 * fallar, pero ya no hay una segunda red debajo: si un endpoint se olvida de
 * exigir su permiso, que acá no se muestre el botón **no protege nada** — un
 * pedido hecho a mano no pasa por esta pantalla.
 *
 * `can()` devuelve true para la dueña siempre, sin mirar la tabla de permisos:
 * es el mismo criterio que `has_permission()` en la base y que `puede()` en
 * `authz.service.ts`. El admin está por encima del sistema de permisos, no
 * adentro; si fuera "un usuario con todas las casillas tildadas", destildárselas
 * la dejaría afuera de su propio panel.
 */
export function useAccess() {
  const sesion = useQuery(sesionQuery());

  const roles = sesion.data?.roles ?? [];
  const isAdmin = roles.includes("admin");
  const isStaff = roles.includes("staff");
  const permissions = sesion.data?.permisos ?? [];
  /** La ficha de profesional atada a esta cuenta, si hay alguna. */
  const professionalId = sesion.data?.professionalId ?? null;

  const can = (permission: Permission) => isAdmin || permissions.includes(permission);

  return {
    loading: sesion.isLoading,
    isAdmin,
    isStaff,
    professionalId,
    /**
     * Entra al panel quien administra, quien trabaja en el centro, y también la
     * profesional que tiene su ficha vinculada: adentro no va a ver más que su
     * propia agenda, pero la puerta es la misma.
     */
    // La misma función que usa el `beforeLoad` de /admin, y no la condición
    // escrita otra vez: si las dos se separan, un día una suma un caso y la otra
    // no, y el síntoma es una pantalla que rebota a alguien que sí puede entrar.
    canEnterPanel: puedeEntrarAlPanel(sesion.data ?? null),
    permissions,
    can,
    /**
     * Lo mismo que `can`, pero entendiendo los tres niveles que no son
     * permisos. Es lo que usa el panel para decidir qué secciones mostrar y
     * cuáles dejar entrar, con una sola regla en vez de tres condiciones
     * repetidas en cada lugar.
     *
     * Ojo con "own_agenda": es el ÚNICO que la dueña no pasa por ser dueña. No
     * es un candado, es que no habría nada que mostrarle — una agenda propia
     * sale de tener una ficha de profesional, y si la dueña también atiende,
     * alcanza con vincularle la suya desde Equipo.
     */
    allows: (requirement: AccessRequirement) =>
      requirement === "admin"
        ? isAdmin
        : requirement === "panel"
          ? isAdmin || isStaff || Boolean(professionalId)
          : requirement === "own_agenda"
            ? Boolean(professionalId)
            : can(requirement),
  };
}
