/**
 * El cliente HTTP de las pantallas.
 *
 * Reemplaza a `supabase.from(...)`: todo lo que antes iba del navegador a
 * PostgREST ahora va a `/api/*`, que es código nuestro.
 *
 * ── POR QUÉ UN HELPER Y NO UN `fetch` EN CADA PANTALLA ────────────────────
 *
 * Porque el manejo del error es la parte que se hace mal, y hacerla mal acá
 * tiene un antecedente concreto en este proyecto: el commit `2fb6341` arregló
 * que **un error al pedir los horarios se leyera como "no hay turnos"**. Una
 * pantalla que trata una falla como una lista vacía miente con toda calma.
 *
 * Con esto, un pedido que falla **tira**, y react-query lo muestra como error en
 * vez de renderizar el estado vacío.
 *
 * ── LA SESIÓN VIAJA SOLA ──────────────────────────────────────────────────
 *
 * No hay que adjuntar ningún token: la sesión es una cookie `httpOnly` y el
 * navegador la manda en cada pedido al mismo origen. Es justo lo que hacía
 * `auth-attacher.ts`, que por eso se borra.
 */

export class ErrorDeApi extends Error {
  constructor(
    mensaje: string,
    readonly status: number,
    causa?: unknown,
  ) {
    super(mensaje, causa === undefined ? undefined : { cause: causa });
    this.name = "ErrorDeApi";
  }
}

export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  let respuesta: Response;
  try {
    respuesta = await fetch(path, {
      ...init,
      headers: {
        ...(init?.body ? { "content-type": "application/json" } : {}),
        ...init?.headers,
      },
    });
  } catch (causa) {
    // Sin conexión, o el servidor caído. `fetch` sólo rechaza acá: un 500 NO
    // tira, llega como respuesta y se maneja abajo.
    throw new ErrorDeApi("No se pudo conectar. Fijate si tenés internet.", 0, causa);
  }

  // 204 y compañía: no hay cuerpo que parsear.
  if (respuesta.status === 204) return undefined as T;

  const texto = await respuesta.text();
  let cuerpo: unknown = undefined;
  if (texto) {
    try {
      cuerpo = JSON.parse(texto);
    } catch {
      // El servidor contestó algo que no es JSON. Pasa cuando el pedido cae en
      // el 404 de TanStack y vuelve una página HTML: el síntoma clásico es
      // "Unexpected token '<'", que no le dice nada a nadie.
      throw new ErrorDeApi(
        `El servidor contestó algo inesperado (${respuesta.status}).`,
        respuesta.status,
      );
    }
  }

  if (!respuesta.ok) {
    const mensaje =
      cuerpo &&
      typeof cuerpo === "object" &&
      typeof (cuerpo as { error?: unknown }).error === "string"
        ? (cuerpo as { error: string }).error
        : `Error ${respuesta.status}.`;
    throw new ErrorDeApi(mensaje, respuesta.status);
  }

  return cuerpo as T;
}

/** Azúcar para los cuatro verbos, para que las pantallas se lean cortas. */
// El cuerpo se OMITE cuando no hay, en vez de mandarlo en undefined: con
// exactOptionalPropertyTypes las dos cosas no son lo mismo, y RequestInit no
// acepta la segunda.
const conCuerpo = (metodo: string, body: unknown): RequestInit =>
  body === undefined ? { method: metodo } : { method: metodo, body: JSON.stringify(body) };

export const apiPost = <T>(path: string, body?: unknown) => api<T>(path, conCuerpo("POST", body));

export const apiPut = <T>(path: string, body?: unknown) => api<T>(path, conCuerpo("PUT", body));

/**
 * DELETE, que **sí puede llevar cuerpo**.
 *
 * Lo necesita el borrado de una categoría: hay que decirle a dónde mudar los
 * productos que la usaban. Va en el cuerpo y no en la query string porque es un
 * dato del pedido, no un filtro — y porque un nombre con acentos o espacios en
 * la URL es una fuente de escapes mal hechos.
 */
export const apiDelete = <T>(path: string, body?: unknown) =>
  api<T>(path, conCuerpo("DELETE", body));
