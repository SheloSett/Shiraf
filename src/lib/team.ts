import { supabase } from "@/integrations/supabase/client";

/**
 * Ata (o suelta) la ficha de una profesional con una cuenta.
 *
 * Lo usan las dos pantallas que pueden hacerlo, porque se llega desde los dos
 * lados: en **Profesionales** ya existe la ficha y se le crea la cuenta; en
 * **Equipo** ya existe la cuenta y se le elige la ficha. Es la misma operación
 * mirada al revés, así que vive una sola vez.
 *
 * Se suelta primero lo que hubiera: la base tiene un índice único que impide que
 * dos fichas apunten a la misma cuenta, así que cambiar de ficha sin liberar la
 * anterior fallaría con un error de duplicado.
 *
 * Va directo contra la tabla y no por el servidor porque escribir
 * `professionals` ya pide el permiso 'team', y además un trigger exige el rol
 * admin para tocar `user_id`: sin eso, cualquiera con "Gestionar profesionales"
 * podría apuntarse una ficha ajena y quedarse leyendo los teléfonos y las notas
 * clínicas de las clientas de esa profesional. Ver 20260818020000.
 *
 * @param professionalId ficha a atar, o "" para dejar la cuenta sin ninguna.
 */
export async function linkProfessionalAccount(userId: string, professionalId: string) {
  const { error: clearError } = await supabase
    .from("professionals")
    .update({ user_id: null })
    .eq("user_id", userId);
  if (clearError) throw clearError;

  if (!professionalId) return;

  const { error } = await supabase
    .from("professionals")
    .update({ user_id: userId })
    .eq("id", professionalId);
  if (error) throw error;
}
