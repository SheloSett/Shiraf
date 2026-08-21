import jwt from "jsonwebtoken";
import { json, leerCookie, type Ctx, type Handler } from "@/server/http";
import { accesoDe, exigirPermiso } from "@/server/services/authz.service";
import type { Permission } from "@/lib/permissions";

/**
 * Verifica la sesión y decide quién puede llamar qué.
 *
 * Es `auth.middleware.js` de Ecommerce_mm, con **una** diferencia deliberada y
 * dos que se explican solas.
 *
 * ── LA DIFERENCIA: cookie en vez de header ────────────────────────────────
 *
 * Allá el token viaja en `Authorization: Bearer`, guardado en localStorage.
 * Acá va en una cookie `httpOnly`, y no es preferencia: Shiraf renderiza en el
 * servidor. Con cookie, el navegador la manda sola en cada navegación, incluida
 * la primera carga de la página. Con header habría que ir pegándola a mano en
 * cada llamada — que es exactamente lo que hacía `auth-attacher.ts` para
 * Supabase, y por eso se pudo borrar.
 *
 * De yapa: `httpOnly` significa que el JavaScript de la página no puede leerla,
 * así que un XSS no se lleva la sesión. Desde localStorage sí se la lleva.
 *
 * ── EL PAYLOAD NO LLEVA LOS PERMISOS ──────────────────────────────────────
 *
 * En el ecommerce el JWT incluye `permissions`, y `requirePermission` los lee de
 * ahí. Acá no, y el motivo es concreto: el token dura 7 días. Si la dueña le
 * saca "Ver notas clínicas" a una empleada, con los permisos adentro del token
 * la empleada los sigue teniendo hasta que se le venza — una semana de acceso a
 * historias clínicas que alguien ya decidió quitarle.
 *
 * Se leen de la base en cada pedido. Es una consulta más, sobre una tabla de 6
 * filas, y a cambio destildar una casilla surte efecto en el acto.
 */

const NOMBRE_COOKIE = "shiraf_sesion";
const DIAS = 7;
/** Lo que espera el tipo de jsonwebtoken: un literal, no una cadena armada. */
const VENCIMIENTO = "7d" as const;

export type Payload = { id: string; email: string; role: string };

function secreto(): string {
  const valor = process.env["JWT_SECRET"];
  if (!valor) {
    // Explícito y temprano. Sin esto, `jwt.sign` tira un error genérico y el
    // síntoma es "no puedo entrar" sin ninguna pista de por qué.
    throw new Error("Falta JWT_SECRET. Ver .env.example.");
  }
  return valor;
}

/** Firma el token y devuelve la cookie lista para mandar. */
export function crearCookieDeSesion(payload: Payload): string {
  const token = jwt.sign(payload, secreto(), { expiresIn: VENCIMIENTO });
  return armarCookie(token, DIAS * 24 * 60 * 60);
}

/** La cookie que borra la sesión: mismo nombre, vacía y vencida. */
export function cookieDeCierre(): string {
  return armarCookie("", 0);
}

function armarCookie(valor: string, maxAge: number): string {
  const partes = [
    NOMBRE_COOKIE + "=" + encodeURIComponent(valor),
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    "Max-Age=" + maxAge,
  ];
  // Secure sólo en producción: en desarrollo el sitio es http://localhost y una
  // cookie Secure ahí no se guarda, así que no se podría entrar nunca.
  if (process.env["NODE_ENV"] === "production") partes.push("Secure");
  return partes.join("; ");
}

/** El payload de la sesión, o null. No tira: sirve para rutas que aceptan las dos cosas. */
export function leerSesion(req: Request): Payload | null {
  const token = leerCookie(req, NOMBRE_COOKIE);
  if (!token) return null;
  try {
    return jwt.verify(token, secreto()) as Payload;
  } catch {
    // Vencido o manipulado. Las dos cosas son "no hay sesión".
    return null;
  }
}

/** Exige sesión. Es el `authMiddleware` del ecommerce. */
export const authMiddleware: Handler = (ctx: Ctx) => {
  const sesion = leerSesion(ctx.req);
  if (!sesion) return json({ error: "No autorizado." }, 401);
  ctx.user = sesion;
  // `undefined` explícito y no una salida implícita: con noImplicitReturns
  // prendido, TypeScript no acepta que una función a veces devuelva y a veces
  // no. Acá "no devolver nada" es la señal de "dejalo pasar", así que se dice.
  return undefined;
};

/** Exige que sea la dueña. Es el `adminMiddleware` del ecommerce. */
export const adminMiddleware: Handler = (ctx: Ctx) => {
  if (ctx.user?.role !== "admin") {
    return json({ error: "Acceso denegado: es una sección de la dueña." }, 403);
  }
  return undefined;
};

/**
 * Exige un permiso concreto. Es el hermano fino de `adminMiddleware`.
 *
 * Se usa como una función, no como un valor, porque el permiso cambia por ruta:
 *
 *     categoriasRouter.post("/", authMiddleware, exigeMiddleware("catalog"), crear);
 *
 * ── POR QUÉ VA EN LA RUTA Y NO ADENTRO DEL CONTROLLER ─────────────────────
 *
 * Porque así el archivo de rutas se lee como el de `Ecommerce_mm`: abriendo
 * veinte líneas se ve **quién puede hacer qué** en toda un área. Si el chequeo
 * queda enterrado en el controller, para auditarlo hay que leer todo, y lo que
 * se quiere poder responder de un vistazo es justamente esa pregunta.
 *
 * ⚠️ Va SIEMPRE después de `authMiddleware`, que es quien deja el `ctx.user`.
 * Sin sesión no hay a quién preguntarle los permisos: por eso, si falta,
 * contesta 401 —"no sé quién sos"— y no 403 —"sé quién sos y no podés"—.
 *
 * La regla de que la dueña pasa siempre no está acá: la aplica `puede()`, que
 * es donde estaba en la base. Ver authz.service.ts.
 */
export function exigeMiddleware(permiso: Permission): Handler {
  return async (ctx: Ctx) => {
    if (!ctx.user) return json({ error: "No autorizado." }, 401);
    exigirPermiso(await accesoDe(ctx.user.id), permiso);
    return undefined;
  };
}
