import "./lib/error-capture";

import { consumeLastCapturedError } from "./lib/error-capture";
import { renderErrorPage } from "./lib/error-page";

type ServerEntry = {
  fetch: (request: Request, env: unknown, ctx: unknown) => Promise<Response> | Response;
};

/**
 * El endpoint que dispara los recordatorios del día siguiente.
 *
 * Va acá, interceptado antes de TanStack, y no como una server function, porque
 * quien lo llama es un cron: no tiene sesión, no manda un JWT y no puede pasar
 * por requireSupabaseAuth. Se identifica con un secreto en el header.
 *
 * POST y no GET a propósito. Un GET lo dispara cualquier cosa que ande mirando
 * URLs —un prefetch del navegador, un escáner, el preview de un enlace pegado en
 * un chat— y esto le manda mails a clientas reales. Que haga falta un POST no es
 * seguridad (el secreto es la seguridad), es evitar que se ejecute por accidente.
 *
 * Cómo programarlo está en supabase/emails/README.md.
 */
const REMINDERS_PATH = "/api/recordatorios";

async function handleReminders(request: Request): Promise<Response> {
  const { isAuthorizedReminderRequest, runDailyReminders } = await import("./lib/reminders.server");

  if (request.method !== "POST") {
    return json({ error: "Usá POST." }, 405);
  }

  if (!isAuthorizedReminderRequest(request)) {
    // Sin detalle de por qué falló: decir "falta configurar el secreto" le
    // cuenta a quien está probando la puerta que la puerta existe y no tiene
    // llave puesta.
    return json({ error: "No autorizado." }, 401);
  }

  try {
    return json(await runDailyReminders(), 200);
  } catch (error) {
    console.error("[recordatorios]", error);
    return json({ error: error instanceof Error ? error.message : "Falló la corrida." }, 500);
  }
}

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

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

      // Antes de TanStack: esta ruta no es una página ni una server function.
      if (pathname === REMINDERS_PATH) {
        return await handleReminders(request);
      }

      // Las cuentas: /api/auth/*. Van acá y no como server functions por el
      // mismo motivo que los recordatorios —no son páginas— y por uno propio:
      // el login TIENE que poder correr sin sesión, y las server functions de
      // este proyecto pasan todas por el middleware que exige una.
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
