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
  esStaff: boolean;
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
    esStaff: nombres.includes("staff"),
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
