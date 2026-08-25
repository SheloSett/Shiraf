import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireAuth } from "@/lib/serverfn-auth";
import { PERMISSION_VALUES, type Permission } from "@/lib/permissions";

/**
 * Alta y baja de empleadas. **Sólo la dueña.**
 *
 * ── QUÉ CAMBIÓ AL SALIR DE SUPABASE ───────────────────────────────────────
 *
 * Esto era lo único que no se podía hacer desde el navegador: crear una cuenta
 * ajena necesitaba la Admin API de Supabase y la service role, que nunca puede
 * bajar al bundle. Por eso vive en una server function.
 *
 * Con la tabla `users` propia, "crear una cuenta" es un INSERT como cualquier
 * otro. Lo que sigue justificando que esté acá es lo mismo de antes: **la
 * contraseña llega en texto plano y no puede pasar por ninguna pantalla más que
 * la que la escribe.**
 *
 * Y hay algo que mejora solo: el alta ahora es **una transacción**. Antes eran
 * cuatro pedidos sueltos a Supabase —crear la cuenta, sacarle el rol `client`
 * que le ponía el trigger, ponerle `staff`, cargarle los permisos— con un
 * `try/catch` que borraba la cuenta a mano si alguno fallaba, porque una
 * empleada a medio crear deja el mail ocupado y el alta no se puede reintentar.
 * Ese rollback manual ya no hace falta: si algo falla, no queda nada.
 */

const RONDAS = 10;

const CreateEmployeeInput = z.object({
  email: z.string().trim().email("El mail no parece válido."),
  password: z.string().min(8, "La contraseña necesita al menos 8 caracteres."),
  fullName: z.string().trim().min(1, "Falta el nombre."),
  phone: z.string().trim().optional(),
  permissions: z.array(z.enum(PERMISSION_VALUES as [Permission, ...Permission[]])).default([]),
});

export const createEmployee = createServerFn({ method: "POST" })
  .middleware([requireAuth])
  .validator((data: unknown) => CreateEmployeeInput.parse(data))
  .handler(async ({ data, context }) => {
    // Import dinámico: este archivo es alcanzable desde el navegador y el
    // guard de TanStack prohíbe importar todo lo que cuelgue de `src/server/` desde ahí. Adentro del
    // handler no hay problema — ese código sólo corre en el servidor.
    const bcrypt = (await import("bcryptjs")).default;
    const { prisma } = await import("@/server/db");
    const { accesoDe, exigirAdmin } = await import("@/server/services/authz.service");

    // ── 1. ¿Quien llama es realmente la dueña? ───────────────────────────────
    // Es el ROL admin y no un permiso, a propósito: repartir accesos no se
    // delega. Era la policy `admin grants permissions`.
    exigirAdmin(await accesoDe(context.userId));

    const email = data.email.toLowerCase();

    const yaExiste = await prisma.users.findUnique({ where: { email }, select: { id: true } });
    if (yaExiste) throw new Error("Ya existe una cuenta con ese mail.");

    // ── 2. Crear la cuenta, con todo lo suyo, de una sola vez ───────────────
    const creada = await prisma.users.create({
      data: {
        email,
        password: await bcrypt.hash(data.password, RONDAS),
        // Verificada de entrada: la cuenta la crea el centro, no la persona, así
        // que no hay ningún mail que ella tenga que ir a confirmar para entrar.
        // Es lo que hacía `email_confirm: true` en la Admin API.
        email_verified_at: new Date(),
        profile: { create: { full_name: data.fullName, phone: data.phone ?? null } },
        // `staff` directo. Antes había que CREAR con rol client —se lo ponía el
        // trigger handle_new_user— y después borrárselo. Acá no hay trigger que
        // valga: la tabla es nuestra y el rol se elige al escribir.
        roles: { create: { role: "staff" } },
        ...(data.permissions.length > 0
          ? { permissions: { create: data.permissions.map((permission) => ({ permission })) } }
          : {}),
      },
      select: { id: true },
    });

    return { id: creada.id, email, fullName: data.fullName };
  });

/**
 * Baja de una empleada: borra la cuenta entera.
 *
 * Sus turnos cargados no se pierden: `appointments.client_id` apunta a la
 * clienta, no a quien lo cargó. Lo único que se va con ella es el login.
 */
export const deleteEmployee = createServerFn({ method: "POST" })
  .middleware([requireAuth])
  .validator((data: unknown) => z.object({ userId: z.string().uuid() }).parse(data))
  .handler(async ({ data, context }) => {
    const { prisma } = await import("@/server/db");
    const { accesoDe, exigirAdmin } = await import("@/server/services/authz.service");

    exigirAdmin(await accesoDe(context.userId));

    if (data.userId === context.userId) {
      throw new Error("No podés borrar tu propia cuenta.");
    }

    // Que la víctima sea staff y no otra admin: el alta de admins vive fuera de
    // la app a propósito, y la baja tiene que respetar la misma puerta.
    const roles = await prisma.user_roles.findMany({
      where: { user_id: data.userId },
      select: { role: true },
    });

    if (roles.some((r) => r.role === "admin")) {
      throw new Error("No se puede dar de baja a una administradora desde el panel.");
    }
    if (!roles.some((r) => r.role === "staff")) {
      throw new Error("Esa cuenta no es de una empleada.");
    }

    // El resto cae solo por las claves foráneas: profile, roles, permisos y la
    // nota clínica son ON DELETE CASCADE. La ficha de profesional, en cambio, es
    // SET NULL — se le suelta la cuenta pero la ficha queda, que es lo correcto:
    // la persona dejó de tener acceso, no de haber existido.
    await prisma.users.delete({ where: { id: data.userId } });

    return { ok: true };
  });

const UpdateEmployeeAccessInput = z
  .object({
    userId: z.string().uuid(),
    email: z.string().trim().email("El mail no parece válido.").optional(),
    password: z.string().min(8, "La contraseña necesita al menos 8 caracteres.").optional(),
  })
  // Al menos una de las dos: sin esto, "guardar" sin haber tocado nada pasaría
  // por todos los chequeos y contestaría que salió bien sin haber hecho nada.
  .refine((v) => v.email !== undefined || v.password !== undefined, {
    message: "No hay nada para cambiar.",
  });

/**
 * Cambiarle el mail o la contraseña a una empleada. **Sólo la dueña.**
 *
 * ── POR QUÉ ESTÁ ACÁ Y NO EN UN ENDPOINT MÁS ──────────────────────────────
 *
 * Por lo mismo que `createEmployee`: **la contraseña llega en texto plano.** Una
 * server function es el único lugar donde eso entra sin pasar por ninguna
 * pantalla intermedia. El mail podría ir por la API común, pero separarlos
 * dejaría el formulario mandando dos pedidos y pudiendo salir uno bien y el otro
 * mal, con la dueña sin saber cuál quedó.
 *
 * ── LO QUE PASA CUANDO SE LE CAMBIA LA CONTRASEÑA ─────────────────────────
 *
 * Nada más que eso: la nueva anda y la vieja no. La sesión que la empleada tenga
 * abierta SIGUE viva, porque el token está firmado y no guarda la contraseña.
 * Para cortarle el acceso ya mismo está el interruptor «Puede entrar», que sí se
 * mira en cada pedido. Son dos herramientas para dos cosas distintas: cambiar la
 * contraseña es "no entres más con esa"; dar de baja es "no entres más".
 *
 * ── LOS MISMOS TRES CANDADOS QUE LA BAJA ──────────────────────────────────
 *
 * Sólo la dueña; no sobre la cuenta propia —para eso está `/admin/cuenta`, que
 * pide la contraseña actual—; y nunca sobre otra administradora.
 */
export const updateEmployeeAccess = createServerFn({ method: "POST" })
  .middleware([requireAuth])
  .validator((data: unknown) => UpdateEmployeeAccessInput.parse(data))
  .handler(async ({ data, context }) => {
    const bcrypt = (await import("bcryptjs")).default;
    const { prisma } = await import("@/server/db");
    const { accesoDe, exigirAdmin } = await import("@/server/services/authz.service");

    exigirAdmin(await accesoDe(context.userId));

    if (data.userId === context.userId) {
      throw new Error("Para cambiar tus propios datos entrá a «Mi cuenta».");
    }

    const roles = await prisma.user_roles.findMany({
      where: { user_id: data.userId },
      select: { role: true },
    });

    if (roles.length === 0) throw new Error("Esa cuenta no existe.");
    if (roles.some((r) => r.role === "admin")) {
      throw new Error("No se pueden cambiar los datos de una administradora desde el panel.");
    }
    if (!roles.some((r) => r.role === "staff")) {
      throw new Error("Esa cuenta no es de una empleada.");
    }

    const cambios: { email?: string; password?: string } = {};

    if (data.email !== undefined) {
      const email = data.email.toLowerCase();
      // El choque se avisa acá y no se deja fallar contra el índice único: el
      // error de Prisma sale como "error interno" y la dueña no se entera de que
      // el mail ya está usado, que es un caso normal y no una falla.
      const ocupado = await prisma.users.findUnique({ where: { email }, select: { id: true } });
      if (ocupado && ocupado.id !== data.userId) {
        throw new Error("Ya existe una cuenta con ese mail.");
      }
      cambios.email = email;
    }

    if (data.password !== undefined) {
      cambios.password = await bcrypt.hash(data.password, RONDAS);
    }

    await prisma.users.update({ where: { id: data.userId }, data: cambios });

    // Se devuelve qué se tocó y NUNCA la contraseña: la pantalla la necesita
    // para el aviso, y el valor no tiene por qué volver a viajar.
    return { emailCambiado: data.email !== undefined, claveCambiada: data.password !== undefined };
  });
