import { prisma } from "@/server/db";
import type { Permission } from "@/lib/permissions";

/**
 * Quién puede hacer qué.
 *
 * Reemplaza a `has_role()` y `has_permission()` de Postgres, que eran la base
 * sobre la que se apoyaban las 39 policies. **Este archivo es el que sostiene
 * la seguridad del sistema entero** después de salir de Supabase: si acá hay un
 * error, no hay una segunda red que lo atrape.
 *
 * ── DOS REGLAS QUE VIENEN DE LA BASE Y NO SE TOCAN ────────────────────────
 *
 * 1. **La dueña pasa siempre, sin mirar la tabla de permisos.** Es literal el
 *    criterio de `has_permission()` en la migración 20260813070000: el admin
 *    está por encima del sistema de permisos, no adentro. Si fuera "un usuario
 *    con todas las casillas tildadas", destildárselas la dejaría afuera de su
 *    propio panel.
 *
 * 2. **Ningún permiso se amplía a sí mismo.** Quien tiene 'team' no puede
 *    darse 'team' a otro ni atarse una ficha ajena. Eso lo garantizaba un
 *    trigger; en la Fase 5 lo tiene que garantizar el controller.
 *
 * ── POR QUÉ SE LEE DE LA BASE EN CADA PEDIDO ──────────────────────────────
 *
 * Y no del JWT, que es lo que hace Ecommerce_mm. El token dura 7 días: con los
 * permisos adentro, sacarle "Ver notas clínicas" a una empleada no surte efecto
 * hasta que se le venza. Una semana de acceso a historias clínicas que alguien
 * ya decidió quitarle.
 *
 * Son dos consultas sobre tablas de 5 y 6 filas. El costo es irrelevante y a
 * cambio destildar una casilla se siente en el acto.
 */

export type Acceso = {
  userId: string;
  esAdmin: boolean;
  // No hay `esStaff`: se calculaba y no lo leía nadie. Ser del equipo no
  // habilita nada por sí solo —lo que habilita es cada permiso de
  // `user_permissions`—, así que tenerlo acá sugería un poder que no existe.
  permisos: Permission[];
  /** La ficha de profesional atada, si tiene. Habilita "Mi agenda". */
  fichaProfesionalId: string | null;
};

export async function accesoDe(userId: string): Promise<Acceso> {
  const [roles, permisos, ficha] = await Promise.all([
    prisma.user_roles.findMany({ where: { user_id: userId }, select: { role: true } }),
    prisma.user_permissions.findMany({
      where: { user_id: userId },
      select: { permission: true },
    }),
    prisma.professionals.findFirst({
      where: { user_id: userId, is_active: true },
      select: { id: true },
    }),
  ]);

  const nombres = roles.map((r) => r.role as string);

  return {
    userId,
    esAdmin: nombres.includes("admin"),
    permisos: permisos.map((p) => p.permission as Permission),
    fichaProfesionalId: ficha?.id ?? null,
  };
}

/** ¿Tiene este permiso? La dueña siempre. Era `has_permission()`. */
export function puede(acceso: Acceso, permiso: Permission): boolean {
  return acceso.esAdmin || acceso.permisos.includes(permiso);
}

/**
 * Exige el permiso, o tira.
 *
 * Se usa así, y el orden importa: **el chequeo va antes de la consulta, no
 * después de traer los datos**. Traerlos y después decidir si se muestran es la
 * forma de que un día alguien devuelva el objeto entero por error.
 *
 *     const acceso = await accesoDe(ctx.user!.id);
 *     exigirPermiso(acceso, "catalog");
 *     return prisma.services.findMany();
 */
export function exigirPermiso(acceso: Acceso, permiso: Permission): void {
  if (!puede(acceso, permiso)) {
    throw new ErrorDeAcceso("No tenés el acceso necesario para esto.");
  }
}

/**
 * ¿Tiene ALGUNO de estos permisos? La dueña siempre.
 *
 * Existe por una policy concreta y no por generalidad: `read profiles` decía
 *
 *     uid = id OR has_permission('clients_contact') OR has_permission('appointments')
 *
 * Los dos permisos, no uno. El motivo está escrito en la migración
 * 20260813070000: la pantalla de turnos muestra el nombre y el teléfono de
 * quien reservó, así que una empleada que sólo gestiona turnos tiene que poder
 * leer la ficha. **Si se traduce con un solo `puede()`, la agenda queda
 * mostrando una lista de «—» en vez de nombres.**
 *
 * ⚠️ Esto NO es lo mismo que `impliedPermissions()` de @/lib/permissions.
 * Ese helper existe para que la pantalla de accesos no ofrezca una casilla que
 * promete un candado inexistente, y es cosa de la interfaz. Acá los permisos se
 * chequean explícitos, igual que los enumeraba la policy.
 */
export function puedeAlguno(acceso: Acceso, permisos: Permission[]): boolean {
  return acceso.esAdmin || permisos.some((p) => acceso.permisos.includes(p));
}

/** Exige alguno de estos permisos, o tira. Ver `puedeAlguno`. */
export function exigirAlguno(acceso: Acceso, permisos: Permission[]): void {
  if (!puedeAlguno(acceso, permisos)) {
    throw new ErrorDeAcceso("No tenés el acceso necesario para esto.");
  }
}

/** Sólo la dueña. Era `has_role(uid, 'admin')`. */
export function exigirAdmin(acceso: Acceso): void {
  if (!acceso.esAdmin) {
    throw new ErrorDeAcceso("Es una sección reservada a la dueña del centro.");
  }
}

/**
 * Un error propio para poder contestar 403 y no 500.
 *
 * Sin esto, un permiso faltante sale por el handler genérico como "Error
 * interno del servidor", que le dice a la empleada que la app está rota cuando
 * en realidad le falta una casilla.
 */
export class ErrorDeAcceso extends Error {
  readonly status = 403;
  constructor(mensaje: string) {
    super(mensaje);
    this.name = "ErrorDeAcceso";
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Sólo la dueña ata una ficha a una cuenta
//    (guard_professional_account_link)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 🔴 **Sin esto hay una filtración, no una inconsistencia.**
 *
 * Quien tiene el permiso `team` puede editar las fichas de las profesionales. Si
 * además pudiera escribir `professionals.user_id`, se ataría a sí mismo la ficha
 * de otra y pasaría a ver los teléfonos y las notas clínicas de las clientas de
 * esa profesional, vía «Mi agenda».
 *
 * Por eso el chequeo es `exigirAdmin()` y no `exigirPermiso(acceso, "team")`:
 * `team` es exactamente lo que tiene quien haría el abuso.
 *
 * Se llama sólo cuando el cambio toca `user_id`. Editar el nombre, la
 * especialidad o la bio de una ficha sigue siendo cosa de `team`.
 */
export function exigirPoderAtarFicha(acceso: Acceso): void {
  if (!acceso.esAdmin) {
    throw new ErrorDeAcceso("Sólo la dueña puede darle acceso al panel a una profesional.");
  }
}
