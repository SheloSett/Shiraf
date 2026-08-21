/**
 * Un router mínimo con la forma de Express.
 *
 * ── POR QUÉ EXISTE ────────────────────────────────────────────────────────
 *
 * `Ecommerce_mm` usa Express, y sus archivos de rutas se leen de un vistazo:
 *
 *     router.post("/login", loginLimiter, validateLogin, login);
 *     router.put("/:id", authMiddleware, adminMiddleware, updateCategory);
 *
 * Veinte líneas, ningún `if`, ningún Prisma. Ese es el patrón que se quiso
 * repetir acá. Pero Shiraf no puede montar Express: no es un proceso aparte —
 * es TanStack Start, que ya trae su propio servidor y habla el `Request`/
 * `Response` de la web, no `req`/`res` de Node.
 *
 * Entonces se escribe el pedacito de Express que hace falta, que son 80 líneas,
 * y los archivos de rutas quedan idénticos a los de allá. La alternativa era
 * levantar un segundo proceso sólo para poder usar Express, con su CORS, su
 * puerto y su deploy, para no ganar nada.
 *
 * ── CÓMO SE ENCADENAN LOS HANDLERS ────────────────────────────────────────
 *
 * Un handler devuelve `Response` para contestar y cortar, o nada para dejar
 * pasar al siguiente. Es el `next()` de Express dado vuelta: en vez de llamar a
 * una función para seguir, seguís por no devolver nada. Se eligió así porque el
 * olvido más común en Express —no llamar a `next()` y dejar el pedido colgado
 * para siempre— acá no se puede cometer.
 */

/** Lo que ve un handler. Es el `req` de Express, con lo que hace falta. */
export type Ctx = {
  req: Request;
  url: URL;
  /** Los `:params` de la ruta. */
  params: Record<string, string>;
  /** El JSON del cuerpo, ya parseado. `{}` si no vino ninguno. */
  body: Record<string, unknown>;
  /** Lo que puso authMiddleware. `undefined` si la ruta es pública. */
  user?: { id: string; email: string; role: string };
  /**
   * Cookies a mandar en la respuesta. Las escribe el controller y las adjunta
   * el router al final — así un handler no necesita construir la Response para
   * poder poner una cookie.
   */
  cookies: string[];
};

export type Handler = (ctx: Ctx) => Promise<Response | void> | Response | void;

type Ruta = { metodo: string; partes: string[]; handlers: Handler[] };

export function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

export function createRouter(prefijo: string) {
  const rutas: Ruta[] = [];

  const agregar =
    (metodo: string) =>
    (path: string, ...handlers: Handler[]) => {
      rutas.push({ metodo, partes: (prefijo + path).split("/").filter(Boolean), handlers });
    };

  return {
    get: agregar("GET"),
    post: agregar("POST"),
    put: agregar("PUT"),
    delete: agregar("DELETE"),

    /** Devuelve la respuesta, o null si ninguna ruta matchea (para seguir de largo). */
    async handle(req: Request): Promise<Response | null> {
      const url = new URL(req.url);
      const partesUrl = url.pathname.split("/").filter(Boolean);

      for (const ruta of rutas) {
        if (ruta.partes.length !== partesUrl.length) continue;

        const params: Record<string, string> = {};
        let coincide = true;
        for (let i = 0; i < ruta.partes.length; i++) {
          const esperado = ruta.partes[i]!;
          const recibido = partesUrl[i]!;
          if (esperado.startsWith(":")) params[esperado.slice(1)] = decodeURIComponent(recibido);
          else if (esperado !== recibido) {
            coincide = false;
            break;
          }
        }
        if (!coincide) continue;

        // El path coincide pero el método no: 405 y no 404. Un 404 haría pensar
        // que la ruta no existe, que es una pista falsa cuando existe y se la
        // llamó con el verbo equivocado.
        if (ruta.metodo !== req.method) return json({ error: "Método no permitido." }, 405);

        let body: Record<string, unknown> = {};
        if (req.method !== "GET") {
          try {
            body = (await req.json()) as Record<string, unknown>;
          } catch {
            // Cuerpo vacío o no-JSON. Varias rutas (logout) no mandan ninguno.
            body = {};
          }
        }

        const ctx: Ctx = { req, url, params, body, cookies: [] };

        try {
          for (const handler of ruta.handlers) {
            const salida = await handler(ctx);
            if (salida) return conCookies(salida, ctx.cookies);
          }
        } catch (error) {
          return conCookies(respuestaDeError(req, url, error), ctx.cookies);
        }

        // Ningún handler contestó: es un error de programación, no del cliente.
        console.error(`[router] ${req.method} ${url.pathname} no devolvió respuesta`);
        return json({ error: "Error interno del servidor." }, 500);
      }

      return null;
    },
  };
}

/** Pega las cookies acumuladas en el ctx a la respuesta que salga. */
function conCookies(respuesta: Response, cookies: string[]): Response {
  if (cookies.length === 0) return respuesta;
  const headers = new Headers(respuesta.headers);
  for (const cookie of cookies) headers.append("set-cookie", cookie);
  return new Response(respuesta.body, {
    status: respuesta.status,
    statusText: respuesta.statusText,
    headers,
  });
}

/** Lee una cookie del pedido. */
export function leerCookie(req: Request, nombre: string): string | null {
  const cabecera = req.headers.get("cookie");
  if (!cabecera) return null;
  for (const parte of cabecera.split(";")) {
    const corte = parte.indexOf("=");
    if (corte === -1) continue;
    if (parte.slice(0, corte).trim() === nombre) return decodeURIComponent(parte.slice(corte + 1));
  }
  return null;
}

/**
 * Convierte un error en una respuesta.
 *
 * ── POR QUÉ ESTO TIENE QUE ESTAR ──────────────────────────────────────────
 *
 * Sin este catch, un error tirado por un controller sube hasta el try/catch de
 * `src/server.ts`, que devuelve **la página HTML de error**. Para una llamada a
 * la API eso es doblemente malo:
 *
 *   · la pantalla recibe HTML donde esperaba JSON, y el mensaje que ve la
 *     persona termina siendo "El servidor contestó algo inesperado (500)";
 *   · y sobre todo, **el status se pierde**. `ErrorDeAcceso` lleva un 403 y un
 *     texto escrito para que se entienda —"No tenés el acceso necesario"— y
 *     todo eso se convertía en un 500 genérico. O sea: a la empleada a la que
 *     le falta una casilla la app le decía que estaba rota.
 *
 * Va en el router y no en cada controller por el mismo motivo por el que Express
 * tiene error middleware: es el único lugar por el que pasan todas las rutas, y
 * un `try/catch` por controller es uno que alguien se va a olvidar de poner.
 *
 * ── QUÉ SE LE CUENTA A QUIEN LLAMA ────────────────────────────────────────
 *
 * Sólo el mensaje de los errores que llevan `status` propio, que son los que
 * escribimos nosotros para ser leídos (`ErrorDeAcceso`, `ErrorDeRegla`).
 * Cualquier otro sale como "Error interno" y su detalle va al log del servidor
 * y a ningún otro lado: un error de Prisma trae nombres de tablas y de columnas,
 * y eso es un mapa de la base para quien esté probando la puerta.
 */
function respuestaDeError(req: Request, url: URL, error: unknown): Response {
  const status = (error as { status?: unknown })?.status;

  if (typeof status === "number" && status >= 400 && status < 500) {
    const mensaje = error instanceof Error ? error.message : "No se pudo completar.";
    return json({ error: mensaje }, status);
  }

  console.error(`[router] ${req.method} ${url.pathname}`, error);
  return json({ error: "Error interno del servidor." }, 500);
}
