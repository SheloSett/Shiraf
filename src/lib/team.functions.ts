import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { PERMISSION_VALUES, type Permission } from "@/lib/permissions";

/**
 * Alta de empleadas desde el panel.
 *
 * Es el primer createServerFn del proyecto, y existe por un motivo concreto:
 * crear una cuenta exige la Admin API de Supabase, que sólo funciona con la
 * service role. Esa clave bypasea toda la RLS, así que no puede acercarse ni de
 * lejos al navegador — tiene que correr acá.
 *
 * Cómo se sostiene la seguridad, en capas:
 *   1. requireSupabaseAuth valida el JWT del lado servidor y devuelve el userId
 *      real. Nada de lo que mande el cliente decide quién es.
 *   2. El rol admin se verifica ACÁ, contra la base, con la service role. No se
 *      confía en un flag del formulario ni en lo que diga el front.
 *   3. Recién entonces se crea la cuenta.
 *
 * Ojo con el import de client.server: va adentro del handler, no arriba. Este
 * archivo se compila también para el bundle del navegador, y un import de nivel
 * superior arrastraría la service role al browser. Está avisado en el propio
 * client.server.ts.
 */

const CreateEmployeeInput = z.object({
  email: z.string().email("El mail no parece válido."),
  password: z.string().min(8, "La contraseña necesita al menos 8 caracteres."),
  fullName: z.string().trim().min(1, "Falta el nombre."),
  phone: z.string().trim().optional(),
  permissions: z.array(z.enum(PERMISSION_VALUES as [Permission, ...Permission[]])).default([]),
});

export const createEmployee = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((data: unknown) => CreateEmployeeInput.parse(data))
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    // ── 1. ¿Quien llama es realmente la dueña? ───────────────────────────────
    // Con la service role, así que la respuesta no depende de ninguna policy.
    const { data: callerRoles, error: rolesError } = await supabaseAdmin
      .from("user_roles")
      .select("role")
      .eq("user_id", context.userId);

    if (rolesError) throw new Error("No se pudo verificar el permiso.");
    if (!(callerRoles ?? []).some((r) => r.role === "admin")) {
      throw new Error("Sólo la dueña puede dar de alta empleadas.");
    }

    // ── 2. Crear la cuenta ──────────────────────────────────────────────────
    // email_confirm en true porque la cuenta la crea el centro, no la persona:
    // no hay un mail que ella tenga que ir a confirmar para poder entrar.
    const { data: created, error: createError } = await supabaseAdmin.auth.admin.createUser({
      email: data.email,
      password: data.password,
      email_confirm: true,
      user_metadata: { full_name: data.fullName, phone: data.phone ?? null },
    });

    if (createError || !created.user) {
      const already = createError?.message?.toLowerCase().includes("already");
      throw new Error(
        already
          ? "Ya existe una cuenta con ese mail."
          : (createError?.message ?? "No se pudo crear la cuenta."),
      );
    }

    const newUserId = created.user.id;

    // A partir de acá, si algo falla hay que borrar la cuenta: una empleada a
    // medio crear —con login pero sin rol ni permisos— es peor que ninguna,
    // porque el mail queda ocupado y el alta no se puede reintentar.
    try {
      // El trigger handle_new_user le puso el rol 'client' a todo el que se da
      // de alta. Se lo saca: es una empleada, no una clienta.
      const { error: cleanupError } = await supabaseAdmin
        .from("user_roles")
        .delete()
        .eq("user_id", newUserId)
        .eq("role", "client");
      if (cleanupError) throw cleanupError;

      const { error: roleError } = await supabaseAdmin
        .from("user_roles")
        .insert({ user_id: newUserId, role: "staff" });
      if (roleError) throw roleError;

      if (data.permissions.length > 0) {
        const { error: permsError } = await supabaseAdmin
          .from("user_permissions")
          .insert(data.permissions.map((permission) => ({ user_id: newUserId, permission })));
        if (permsError) throw permsError;
      }
    } catch (error) {
      await supabaseAdmin.auth.admin.deleteUser(newUserId);
      throw new Error(
        `Se creó la cuenta pero falló la asignación de accesos, así que se deshizo el alta. ${
          error instanceof Error ? error.message : ""
        }`.trim(),
      );
    }

    return { id: newUserId, email: data.email, fullName: data.fullName };
  });

/**
 * Baja de una empleada: borra la cuenta entera.
 *
 * Sus turnos cargados no se pierden: appointments.client_id apunta a la clienta,
 * no a quien lo cargó. Lo único que se va con ella es el login.
 */
export const deleteEmployee = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((data: unknown) => z.object({ userId: z.string().uuid() }).parse(data))
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data: callerRoles, error: rolesError } = await supabaseAdmin
      .from("user_roles")
      .select("role")
      .eq("user_id", context.userId);

    if (rolesError) throw new Error("No se pudo verificar el permiso.");
    if (!(callerRoles ?? []).some((r) => r.role === "admin")) {
      throw new Error("Sólo la dueña puede dar de baja empleadas.");
    }

    if (data.userId === context.userId) {
      throw new Error("No podés borrar tu propia cuenta.");
    }

    // Que la víctima sea staff y no otra admin: el alta de admins vive fuera de
    // la app a propósito, y la baja tiene que respetar la misma puerta.
    const { data: targetRoles } = await supabaseAdmin
      .from("user_roles")
      .select("role")
      .eq("user_id", data.userId);

    if ((targetRoles ?? []).some((r) => r.role === "admin")) {
      throw new Error("No se puede dar de baja a una administradora desde el panel.");
    }
    if (!(targetRoles ?? []).some((r) => r.role === "staff")) {
      throw new Error("Esa cuenta no es de una empleada.");
    }

    const { error } = await supabaseAdmin.auth.admin.deleteUser(data.userId);
    if (error) throw new Error(error.message);

    return { ok: true };
  });
