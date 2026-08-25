import jwt from "jsonwebtoken";
import { prisma } from "@/server/db";
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
  if (cookieSegura()) partes.push("Secure");
  return partes.join("; ");
}

/**
 * ¿La cookie de sesión lleva el flag `Secure`?
 *
 * ── LA PREGUNTA QUE HAY QUE HACERSE ───────────────────────────────────────
 *
 * `Secure` quiere decir "esta cookie sólo viaja por HTTPS", así que la pregunta
 * es **cómo se sirve el sitio**, no si el build es de producción. Son dos cosas
 * distintas y se separan más seguido de lo que parece.
 *
 * Antes esto decía `NODE_ENV === "production"`, y el 25/8/2026 eso dejó a la
 * dueña afuera de su propio panel. El VPS corre con NODE_ENV=production —como
 * corresponde— pero todavía se entra por `http://IP:3000`, sin certificado. La
 * cookie salía con `Secure`, el navegador la descartaba **en silencio**, y el
 * síntoma era el peor posible: el login contestaba 200, no había ningún mensaje
 * de error, y la pantalla simplemente no te dejaba entrar. Con curl andaba, que
 * es lo que más despista: curl no respeta `Secure`.
 *
 * ── DE DÓNDE SALE LA RESPUESTA ────────────────────────────────────────────
 *
 * De `APP_URL`, que es la variable que ya dice con qué dirección se llega al
 * sitio — la misma con la que se arman los links de los mails. Si empieza con
 * `https://`, la cookie va segura; si es `http://`, no.
 *
 * Sin `APP_URL` se cae a la regla vieja. No debería pasar: el compose la exige
 * con `:?` y el contenedor no arranca sin ella. Está para que un script suelto
 * que importe este archivo sin entorno completo no termine mandando cookies sin
 * `Secure` en un sitio que sí tiene HTTPS.
 *
 * ⚠️ Cuando el sitio pase a HTTPS hay que actualizar `APP_URL` en el .env del
 *    servidor. Es lo mismo que ya hace falta para que los links de los mails no
 *    apunten a la IP, así que no es un paso nuevo — pero acá, si se olvida, la
 *    cookie queda sin `Secure` y viaja también por HTTP.
 */
function cookieSegura(): boolean {
  const url = process.env["APP_URL"];
  if (url) return url.startsWith("https://");
  return process.env["NODE_ENV"] === "production";
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

/**
 * Exige sesión. Es el `authMiddleware` del ecommerce, con una consulta más.
 *
 * ── POR QUÉ TOCA LA BASE ──────────────────────────────────────────────────
 *
 * Para ver que la cuenta siga habilitada. Una cuenta se puede dar de baja sin
 * borrarla —`users.is_active`— y el token dura 7 días: si esto se mirara sólo
 * en el login, dar de baja a alguien un lunes lo dejaría trabajando hasta el
 * lunes siguiente. Que es justo lo que no se quiere cuando alguien da de baja
 * una cuenta a las apuradas.
 *
 * Es un `findUnique` por clave primaria, la consulta más barata que hay. Es el
 * mismo canje que ya se hizo con los permisos y por el mismo motivo: una
 * consulta más a cambio de que la decisión valga en el acto.
 */
export const authMiddleware: Handler = async (ctx: Ctx) => {
  const sesion = leerSesion(ctx.req);
  if (!sesion) return json({ error: "No autorizado." }, 401);

  const cuenta = await prisma.users.findUnique({
    where: { id: sesion.id },
    select: { is_active: true },
  });

  // Sin fila: la cuenta se borró y el token todavía no venció.
  if (!cuenta) return json({ error: "No autorizado." }, 401);
  if (!cuenta.is_active) {
    return json({ error: "Esta cuenta está dada de baja. Hablá con el centro." }, 403);
  }

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
