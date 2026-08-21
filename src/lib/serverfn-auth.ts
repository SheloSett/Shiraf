import { createMiddleware } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";

/**
 * La sesión, para las server functions.
 *
 * ── POR QUÉ ESTE ARCHIVO NO ESTÁ EN `src/server/` ─────────────────────────
 *
 * Porque no puede. TanStack Start trae su propia protección de imports y
 * **prohíbe que el código alcanzable desde el navegador importe todo lo que cuelgue de `src/server/`**.
 * Y estas tres server functions SÍ son alcanzables: `admin.servicios` importa
 * `storage.ts`, que importa `cloudinary.functions.ts`. La cadena existe aunque
 * el cuerpo del handler nunca corra en el cliente.
 *
 * Ese guard es más estricto que el lint de LA REGLA y conviene tenerlo: falla el
 * build, no una revisión.
 *
 * ── POR QUÉ EL IMPORT DE ADENTRO ES DINÁMICO ──────────────────────────────
 *
 * Por lo mismo. Un `import` arriba de todo lo ve el bundler del cliente y lo
 * rechaza; un `await import()` adentro del callback de `.server()` no, porque
 * ese código sólo existe del lado servidor. **Es el mismo patrón que ya usaba
 * este proyecto** para `supabaseAdmin`, que tampoco podía bajar al bundle.
 *
 * ── QUÉ REEMPLAZA ─────────────────────────────────────────────────────────
 *
 * A `requireSupabaseAuth`, que validaba un JWT de Supabase leído del header
 * `Authorization`. Ese header lo pegaba `auth-attacher.ts`, que se borró al
 * pasar a la cookie httpOnly — así que el middleware viejo dejó de recibir nada
 * y estas funciones quedaron rechazando todo, incluida la firma de subida de las
 * fotos del catálogo.
 *
 * **El nombre del campo y la forma del contexto se mantienen a propósito**: los
 * tres archivos que lo consumen leen `context.userId` y no hubo que tocarlos.
 */
export const requireAuth = createMiddleware({ type: "function" }).server(async ({ next }) => {
  const { leerSesion } = await import("@/server/middleware/auth.middleware");

  const request = getRequest();
  const sesion = request ? leerSesion(request) : null;

  if (!sesion) {
    // El texto importa: es el que ve la persona en un toast. "Unauthorized" no
    // le dice nada a nadie.
    throw new Error("Se cerró tu sesión. Volvé a entrar.");
  }

  return next({ context: { userId: sesion.id } });
});
