import "./lib/error-capture";

import { consumeLastCapturedError } from "./lib/error-capture";
import { renderErrorPage } from "./lib/error-page";

type ServerEntry = {
  fetch: (request: Request, env: unknown, ctx: unknown) => Promise<Response> | Response;
};

/**
 * El reloj de los recordatorios del día siguiente.
 *
 * Acá había un endpoint —`POST /api/recordatorios`, con un secreto en un
 * header— porque quien lo disparaba era un cron de afuera: `pg_cron` desde
 * Supabase primero, el crontab del VPS después. Ninguno de los dos tenía sesión,
 * y de ahí el secreto.
 *
 * Ya no hace falta ninguna de las dos cosas. La app corre como un proceso Node
 * en su propio contenedor, así que el reloj vive adentro, igual que en
 * `Ecommerce_mm`. El detalle —y los dos casos en los que no arranca— está en
 * `server/services/reminders.service.ts`.
 *
 * Va en el cuerpo del módulo y no adentro de `fetch`: se programa una vez, al
 * arrancar el servidor, y no una vez por pedido. El import es dinámico por lo
 * mismo que los routers de más abajo —para no arrastrar Prisma al arranque de
 * una petición que sólo quiere servir una página— y el `.catch` está para que
 * un problema al programarlo quede en el log en vez de tumbar el arranque: el
 * sitio tiene que levantar aunque los recordatorios no.
 */
void import("./server/services/reminders.service")
  .then((m) => m.iniciarRecordatorios())
  .catch((error: unknown) => console.error("[recordatorios] No se pudieron programar:", error));

let serverEntryPromise: Promise<ServerEntry> | undefined;

async function getServerEntry(): Promise<ServerEntry> {
  if (!serverEntryPromise) {
    serverEntryPromise = import("@tanstack/react-start/server-entry").then(
      (m) => (m.default ?? m) as ServerEntry,
    );
  }
  return serverEntryPromise;
}

// h3 swallows in-handler throws into a normal 500 Response with body
// {"unhandled":true,"message":"HTTPError"} — try/catch alone never fires for those.
async function normalizeCatastrophicSsrResponse(response: Response): Promise<Response> {
  if (response.status < 500) return response;
  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.includes("application/json")) return response;

  const body = await response.clone().text();
  if (!isH3SwallowedErrorBody(body)) return response;

  console.error(consumeLastCapturedError() ?? new Error(`h3 swallowed SSR error: ${body}`));
  return new Response(renderErrorPage(), {
    status: 500,
    headers: { "content-type": "text/html; charset=utf-8" },
  });
}

function isH3SwallowedErrorBody(body: string): boolean {
  try {
    const payload = JSON.parse(body) as { unhandled?: unknown; message?: unknown };
    return payload.unhandled === true && payload.message === "HTTPError";
  } catch {
    return false;
  }
}

export default {
  async fetch(request: Request, env: unknown, ctx: unknown) {
    try {
      const pathname = new URL(request.url).pathname;

      // Las cuentas: /api/auth/*. Van acá y no como server functions porque el
      // login TIENE que poder correr sin sesión, y las server functions de este
      // proyecto pasan todas por el middleware que exige una.
      //
      // El import va adentro y no arriba para que el router y sus controllers
      // —que arrastran Prisma, bcrypt y jsonwebtoken— no entren en el arranque
      // de una petición que sólo quiere servir una página.
      if (pathname.startsWith("/api/auth/")) {
        const { authRouter } = await import("./server/routes/auth.routes");
        const respuesta = await authRouter.handle(request);
        // null = ninguna ruta matcheó. Sigue de largo y termina en el 404 de
        // TanStack, que es lo correcto: /api/auth/inventado no existe.
        if (respuesta) return respuesta;
      }

      // El catálogo y el equipo: /api/publico/*. Sin sesión, como las policies
      // `TO anon` que reemplaza. El filtro por is_published / is_active vive en
      // el controller, que es donde se puede leer al lado de cada consulta.
      if (pathname.startsWith("/api/publico/")) {
        const { publicoRouter } = await import("./server/routes/publico.routes");
        const respuesta = await publicoRouter.handle(request);
        if (respuesta) return respuesta;
      }

      // Las categorías del catálogo y del stock. Cada mitad pide su permiso,
      // que se declara en el archivo de rutas.
      if (pathname.startsWith("/api/categorias/")) {
        const { categoriasRouter } = await import("./server/routes/categorias.routes");
        const respuesta = await categoriasRouter.handle(request);
        if (respuesta) return respuesta;
      }

      // El catálogo desde el panel: los tratamientos y su galería.
      if (pathname.startsWith("/api/catalogo/")) {
        const { catalogoRouter } = await import("./server/routes/catalogo.routes");
        const respuesta = await catalogoRouter.handle(request);
        if (respuesta) return respuesta;
      }

      // El stock: productos, costos y movimientos.
      if (pathname.startsWith("/api/stock/")) {
        const { stockRouter } = await import("./server/routes/stock.routes");
        const respuesta = await stockRouter.handle(request);
        if (respuesta) return respuesta;
      }

      // Las fichas del equipo, sus tratamientos y sus horarios.
      if (pathname.startsWith("/api/equipo/")) {
        const { equipoRouter } = await import("./server/routes/equipo.routes");
        const respuesta = await equipoRouter.handle(request);
        if (respuesta) return respuesta;
      }

      // Las clientas: la lista del panel y el espacio propio de cada una. Los
      // dos prefijos van al mismo router porque comparten controller.
      if (pathname.startsWith("/api/clientas") || pathname.startsWith("/api/mi-cuenta")) {
        const { clientasRouter } = await import("./server/routes/clientas.routes");
        const respuesta = await clientasRouter.handle(request);
        if (respuesta) return respuesta;
      }

      // Los turnos: la lista del panel, el calendario y «mi agenda».
      if (pathname.startsWith("/api/turnos")) {
        const { turnosRouter } = await import("./server/routes/turnos.routes");
        const respuesta = await turnosRouter.handle(request);
        if (respuesta) return respuesta;
      }

      // Reservar: los horarios libres y el alta del turno.
      if (pathname.startsWith("/api/reservar")) {
        const { reservarRouter } = await import("./server/routes/reservar.routes");
        const respuesta = await reservarRouter.handle(request);
        if (respuesta) return respuesta;
      }

      const handler = await getServerEntry();
      const response = await handler.fetch(request, env, ctx);
      return await normalizeCatastrophicSsrResponse(response);
    } catch (error) {
      console.error(error);
      return new Response(renderErrorPage(), {
        status: 500,
        headers: { "content-type": "text/html; charset=utf-8" },
      });
    }
  },
};
