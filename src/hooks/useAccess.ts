import { useQuery } from "@tanstack/react-query";
import { puedeEntrarAlPanel, sesionQuery } from "@/lib/sesion";
import { impliedPermissions } from "@/lib/permissions";
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
  const otorgados = sesion.data?.permisos ?? [];
  /** La ficha de profesional atada a esta cuenta, si hay alguna. */
  const professionalId = sesion.data?.professionalId ?? null;

  /**
   * Los tildados MÁS los que otro permiso arrastra.
   *
   * 🔴 27/8/2026 — sin esto el panel se contradecía consigo mismo. A una
   * empleada con «Gestionar turnos» y nada más:
   *
   *   · Accesos le mostraba a la dueña «Ver datos de clientas» tildado y
   *     bloqueado, con el cartel "Incluido en Gestionar turnos".
   *   · La API la dejaba entrar: `/api/clientas` pide `clients_contact` **o**
   *     `appointments` (ver clientas.routes).
   *   · Y el panel le escondía Clientes igual, porque acá se preguntaba por la
   *     lista cruda y ahí `clients_contact` no está. Escribiendo la URL a mano
   *     tampoco entraba: el guard de admin.tsx pasa por este mismo `can`.
   *
   * O sea que el acceso estaba dado por todos lados menos por el menú. Se
   * resuelve donde nace la contradicción: `implies` ya declara que gestionar
   * turnos arrastra la ficha de la clienta, y esta pantalla no lo estaba
   * leyendo.
   *
   * ⚠️ Esto vale SÓLO de este lado. Del otro, cada endpoint sigue enumerando
   * los permisos explícitos con `puedeAlguno()` —así lo pide PERMISOS.md, y por
   * eso `puede()` no aplica `implies`—: acá se decide qué se muestra, allá qué
   * se puede hacer. Que este hook sea más generoso no abre ninguna puerta que
   * el servidor no haya abierto antes.
   */
  const permissions = [...new Set([...otorgados, ...impliedPermissions(otorgados)])];

  const can = (permission: Permission) => isAdmin || permissions.includes(permission);

  return {
    loading: sesion.isLoading,
    isAdmin,
    isStaff,
    professionalId,
    /**
     * Con qué cuenta se está mirando el panel.
     *
     * No decide nada — no es un permiso —, pero el panel lo necesita para
     * poder DECIRLO. Conviven la dueña, las empleadas y las profesionales, y
     * cada una ve un menú distinto; sin el nombre a la vista, la única forma
     * de saber con cuál entraste es deducirla de qué secciones te faltan.
     */
    nombre: sesion.data?.nombre ?? null,
    email: sesion.data?.email ?? null,
    /**
     * Entra al panel quien administra, quien trabaja en el centro, y también la
     * profesional que tiene su ficha vinculada: adentro no va a ver más que su
     * propia agenda, pero la puerta es la misma.
     */
    // La misma función que usa el `beforeLoad` de /admin, y no la condición
    // escrita otra vez: si las dos se separan, un día una suma un caso y la otra
    // no, y el síntoma es una pantalla que rebota a alguien que sí puede entrar.
    canEnterPanel: puedeEntrarAlPanel(sesion.data ?? null),
    /**
     * Lo que REALMENTE tiene, no lo que la dueña tildó: van también los
     * arrastrados. Es lo que lista "Tus accesos" en /admin/cuenta, y esa
     * pantalla existe para que una empleada que no encuentra una sección sepa
     * si le falta el acceso o si la app está rota — con la lista cruda decía
     * que no tiene «Ver datos de clientas» al lado de un menú donde Clientes
     * está. Para el reparto —quién tildó qué— está Accesos, que usa `implies`
     * por su cuenta con `impliedBy`.
     */
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
     * alcanza con vincularle la suya desde Accesos.
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
