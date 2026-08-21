import { apiPut } from "@/lib/api";

/**
 * Ata (o suelta) la ficha de una profesional con una cuenta.
 *
 * Lo usan las dos pantallas que pueden hacerlo, porque se llega desde los dos
 * lados: en **Profesionales** ya existe la ficha y se le crea la cuenta; en
 * **Equipo** ya existe la cuenta y se le elige la ficha. Es la misma operación
 * mirada al revés, así que vive una sola vez.
 *
 * ⚠️ Antes esto escribía `professionals.user_id` derecho desde el navegador, y
 * se apoyaba en la RLS y en el trigger `guard_professional_account_link`. Sin
 * ninguno de los dos, el candado tiene que estar del lado del servidor: el
 * porqué está en `vincularCuenta`, en equipo.controller.ts, y no es un detalle
 * de prolijidad — es la diferencia entre un permiso y una filtración.
 *
 * @param professionalId ficha a atar, o "" para dejar la cuenta sin ninguna.
 */
export async function linkProfessionalAccount(userId: string, professionalId: string) {
  await apiPut("/api/equipo/vinculo", { userId, professionalId });
}
