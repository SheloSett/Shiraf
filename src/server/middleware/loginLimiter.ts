import { json, type Ctx, type Handler } from "@/server/http";

/**
 * Frena los intentos de adivinar una contraseña.
 *
 * Es `loginLimiter.js` de Ecommerce_mm, con **dos contadores en vez de uno** y
 * con la IP resuelta a propósito en lugar de leída de cualquier header. El
 * porqué de las dos cosas está más abajo.
 *
 * ── POR QUÉ EN MEMORIA Y NO EN LA BASE ────────────────────────────────────
 *
 * Allá usan `express-rate-limit`, que también guarda en memoria por defecto.
 * Acá se escribe a mano porque no hay Express y sumar una dependencia para esto
 * no se justifica.
 *
 * Lo que hay que saber de guardarlo en memoria: **se pierde al reiniciar el
 * contenedor**, y no se comparte si algún día hay más de una réplica. Para un
 * centro con cuatro cuentas del equipo eso está bien — lo que esto frena es el
 * script que prueba mil contraseñas seguidas, y ése se frena igual. Si alguna
 * vez hay varias réplicas, esto se muda a la base o a Redis.
 */

const VENTANA_IP_MS = 5 * 60 * 1000;
const MAX_POR_IP = 10;

/**
 * El contador por cuenta es más largo que el de IP, y no al revés.
 *
 * Son dos ataques distintos. El de la IP es "una máquina probando de todo", y
 * cinco minutos alcanzan para cortarle el ritmo. El de la cuenta es "alguien
 * quiere entrar A ESTA casilla", que es paciente y puede venir de mil lugares
 * distintos: ahí lo que sirve es que la ventana sea larga.
 */
const VENTANA_MAIL_MS = 15 * 60 * 1000;
const MAX_POR_MAIL = 10;

type Registro = { cuenta: number; hasta: number };

const porIp = new Map<string, Registro>();
const porMail = new Map<string, Registro>();

// ─────────────────────────────────────────────────────────────────────────────
// De dónde sale la IP
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 🔴 **Qué hay adelante de la app.** De esto depende que el limitador sirva o
 * sea decorativo, así que se declara y no se adivina.
 *
 * ── EL PROBLEMA QUE ESTO RESUELVE ─────────────────────────────────────────
 *
 * Hasta el 28/8/2026 acá se leía `x-forwarded-for` sin ninguna condición y se
 * tomaba el primer valor. Ese header **lo escribe quien llama**: no está
 * firmado ni lo valida nadie, igual que `User-Agent`. O sea que bastaba mandar
 * uno inventado y distinto en cada pedido para tener intentos infinitos desde
 * una sola máquina — el contador veía una persona nueva cada vez.
 *
 * Y no se arreglaba solo poniendo el proxy: el ejemplo de nginx de `DOCKER.md`
 * usaba `$proxy_add_x_forwarded_for`, que **agrega** la IP real al final de lo
 * que ya venía en vez de pisarlo. El primer valor seguía siendo el inventado.
 *
 * ── LOS TRES ESCENARIOS ───────────────────────────────────────────────────
 *
 *   "none" (o sin definir)
 *       Nada adelante: el contenedor recibe las conexiones directo. Es el
 *       estado de hoy en el VPS (`APP_BIND=0.0.0.0`, se entra por IP).
 *       **No se lee ningún header.** La IP sale del socket, que no se puede
 *       falsificar porque es de donde vino el paquete.
 *
 *   "loopback"
 *       nginx en la misma máquina, que es el plan de `TODO.md`. Se lee
 *       `X-Real-IP` y NO `X-Forwarded-For`, porque el ejemplo de nginx escribe
 *       la primera con `$remote_addr` —que PISA— y la segunda con
 *       `$proxy_add_x_forwarded_for` —que AGREGA—. Y se lee sólo si la conexión
 *       entró por el loopback: si alguien le pega al contenedor directo desde
 *       afuera, su `X-Real-IP` se ignora.
 *
 *   "cloudflare"
 *       Cloudflare adelante. Se lee `CF-Connecting-IP`, que Cloudflare
 *       reescribe siempre, así que lo que mande el cliente no sobrevive.
 *
 *       ⚠️ Esto vale **sólo si al origen no se le puede pegar directo**. La IP
 *       del VPS es pública y está escrita en `TODO.md`; si el puerto queda
 *       abierto, cualquiera saltea Cloudflare y manda su propio
 *       `CF-Connecting-IP`. Con esta opción hay que cerrarle el firewall a todo
 *       lo que no venga de los rangos de Cloudflare, o volvemos al principio.
 */
type QueHayAdelante = "none" | "loopback" | "cloudflare";

function queHayAdelante(): QueHayAdelante {
  const valor = process.env["TRUST_PROXY"];
  if (valor === "loopback" || valor === "cloudflare") return valor;
  // Cualquier otra cosa —vacía, sin definir, mal escrita— cae en el más
  // desconfiado. Un typo tiene que dejar el limitador de más y no de menos.
  return "none";
}

/**
 * La IP del socket, que es la única que no se puede mentir.
 *
 * La pone `srvx`, que es el servidor sobre el que corre Nitro con el preset
 * `node-server`: su `Request` trae un `.ip` sacado de `req.socket.remoteAddress`.
 * No está en el tipo `Request` de la web, de ahí el cast.
 *
 * ⚠️ En desarrollo NO existe: ahí el pedido lo arma el plugin de Vite con un
 * `Request` común y corriente. Ver `claveDeQuienLlama`.
 */
function ipDelSocket(ctx: Ctx): string | undefined {
  return (ctx.req as Request & { ip?: string }).ip;
}

function esLoopback(ip: string | undefined): boolean {
  if (!ip) return false;
  return ip === "::1" || ip.startsWith("127.") || ip.startsWith("::ffff:127.");
}

/** Ya se avisó que el contador por IP está apagado. Una vez por arranque. */
let avisado = false;

/**
 * Con qué clave se cuenta a quien llama, o `null` si no se lo puede identificar.
 *
 * ── POR QUÉ `null` Y NO UNA CLAVE FIJA ────────────────────────────────────
 *
 * Porque una clave fija —"local", que es lo que había antes— mete a TODO EL
 * MUNDO en el mismo balde: diez logins fallidos de diez personas distintas
 * dejarían al centro entero afuera durante cinco minutos. El limitador se
 * convertiría en la forma más barata de tirar abajo el sitio.
 *
 * Con `null` el contador por IP se abstiene, lo dice en el log, y queda
 * trabajando el de por mail, que no necesita saber de dónde vino el pedido.
 */
function claveDeQuienLlama(ctx: Ctx): string | null {
  const socket = ipDelSocket(ctx);

  switch (queHayAdelante()) {
    case "cloudflare": {
      const cf = ctx.req.headers.get("cf-connecting-ip");
      if (cf) return cf.trim();
      break;
    }
    case "loopback": {
      // Sólo si el pedido entró por el loopback es que lo puso nuestro nginx.
      // `socket` sin definir es desarrollo, donde no hay nginx del que
      // desconfiar.
      if (esLoopback(socket) || socket === undefined) {
        const real = ctx.req.headers.get("x-real-ip");
        if (real) return real.trim();
      }
      break;
    }
    case "none":
      break;
  }

  if (socket) return socket;

  if (!avisado) {
    avisado = true;
    console.warn(
      "[limiter] No se puede identificar la IP de quien llama: el contador por IP queda " +
        "apagado y sólo cuenta el de por mail. En desarrollo es lo esperado; en el " +
        "contenedor NO, y querría decir que TRUST_PROXY no coincide con lo que hay adelante.",
    );
  }
  return null;
}

// ─────────────────────────────────────────────────────────────────────────────
// El contador
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Suma uno y dice si se pasó.
 *
 * La purga va acá adentro y no en un `setInterval`: sin ella el Map no borra
 * nunca lo vencido, y como la clave la elegía quien llamaba —ése era el bug de
 * más arriba— un millón de valores inventados eran un millón de entradas que no
 * se iban más. Un `setInterval` sería un reloj más que mantener; hacerlo de a
 * poco en cada pedido cuesta lo mismo y no necesita que nadie lo apague.
 */
function registrar(mapa: Map<string, Registro>, clave: string, ventana: number, maximo: number) {
  const ahora = Date.now();

  if (mapa.size > 1000) {
    for (const [k, v] of mapa) if (ahora > v.hasta) mapa.delete(k);
  }

  const registro = mapa.get(clave);

  if (!registro || ahora > registro.hasta) {
    mapa.set(clave, { cuenta: 1, hasta: ahora + ventana });
    return { pasado: false, minutos: 0 };
  }

  registro.cuenta += 1;
  return {
    pasado: registro.cuenta > maximo,
    minutos: Math.ceil((registro.hasta - ahora) / 60000),
  };
}

/** El mail del cuerpo, normalizado igual que en el controller. */
function mailDelPedido(ctx: Ctx): string | null {
  const valor = ctx.body["email"];
  if (typeof valor !== "string") return null;
  return valor.trim().toLowerCase() || null;
}

/**
 * Frena por IP **y** por cuenta.
 *
 * ── POR QUÉ NO ALCANZABA CON LA IP ────────────────────────────────────────
 *
 * Porque la IP es lo más fácil de cambiar que hay: un proxy de dos pesos, una
 * red móvil que rota, o directamente el header falseado de antes. Contar por
 * cuenta ataca lo otro: si alguien probó diez contraseñas contra la casilla de
 * la dueña, se frena esa casilla **venga de donde venga**.
 *
 * Es la defensa que de verdad importa acá, porque el objetivo es chiquito y
 * conocido: son cuatro mails y quien ataca los sabe.
 *
 * ── EL CONTADOR POR MAIL NO PUEDE DELATAR SI LA CUENTA EXISTE ─────────────
 *
 * Se cuenta CUALQUIER dirección que llegue, exista o no. Si sólo se contaran
 * las reales, el 429 sería la respuesta a "¿esta cuenta existe?" — que es justo
 * lo que todo `auth.controller.ts` está escrito para no contestar. Un mail
 * inventado gasta su cupo igual que uno real.
 *
 * ── LO QUE SE PAGA A CAMBIO ───────────────────────────────────────────────
 *
 * Que alguien puede gastarle los intentos a una cuenta ajena a propósito y
 * dejar a esa persona sin entrar por quince minutos. Es la contra conocida de
 * cualquier límite por cuenta, y se elige igual: quince minutos de molestia
 * pesan menos que una contraseña adivinada. Quien entra bien resetea su
 * contador, así que a quien sabe la suya no lo alcanza salvo que justo lo estén
 * atacando.
 */
export const loginLimiter: Handler = (ctx: Ctx) => {
  const ip = claveDeQuienLlama(ctx);
  if (ip) {
    const { pasado, minutos } = registrar(porIp, ip, VENTANA_IP_MS, MAX_POR_IP);
    if (pasado) return frenado(minutos);
  }

  const mail = mailDelPedido(ctx);
  if (mail) {
    const { pasado, minutos } = registrar(porMail, mail, VENTANA_MAIL_MS, MAX_POR_MAIL);
    if (pasado) return frenado(minutos);
  }

  return undefined;
};

/**
 * El mismo texto para los dos contadores, a propósito.
 *
 * Si el de la cuenta dijera algo distinto del de la IP, la diferencia contaría
 * cuál de los dos saltó — y el de la cuenta sólo salta sobre una dirección que
 * alguien viene probando. Es información de más sobre a quién están atacando.
 */
function frenado(minutos: number): Response {
  return json({ error: "Demasiados intentos. Probá de nuevo en " + minutos + " minutos." }, 429);
}

/**
 * Se llama al entrar bien. Es el `loginLimiter.resetKey(req.ip)` del ecommerce.
 *
 * Limpia los DOS contadores: quien acaba de probar que sabe su contraseña no
 * tiene por qué arrastrar ni los intentos de su IP ni los de su casilla. Es lo
 * que hace que el limitador no moleste a las personas reales — quien se
 * equivoca dos veces y después acierta vuelve a cero.
 */
export function resetearIntentos(ctx: Ctx): void {
  const ip = claveDeQuienLlama(ctx);
  if (ip) porIp.delete(ip);

  const mail = mailDelPedido(ctx);
  if (mail) porMail.delete(mail);
}
