import bcrypt from "bcryptjs";
import { randomBytes } from "node:crypto";
import { prisma } from "@/server/db";
import { miFichaDeProfesional } from "@/server/services/agenda.service";
import { json, type Ctx } from "@/server/http";
import { cookieDeCierre, crearCookieDeSesion } from "@/server/middleware/auth.middleware";
import { resetearIntentos } from "@/server/middleware/loginLimiter";
import { enviarMailDeCuenta } from "@/server/services/email.service";

/**
 * Las cuentas: entrar, salir, registrarse, recuperar la contraseña.
 *
 * Es `auth.controller.js` más la parte de cuentas de `customer.controller.js`
 * de Ecommerce_mm, con los mismos números: bcrypt con 10 rondas, tokens de 32
 * bytes en hex, una hora de vida, un solo uso.
 *
 * ── UNA REGLA QUE ATRAVIESA TODO EL ARCHIVO ───────────────────────────────
 *
 * **Nunca decir si un mail existe.** Ni al entrar, ni al registrarse, ni al
 * pedir recuperar la contraseña. Las tres respuestas son iguales exista o no.
 *
 * No es paranoia genérica: la lista de clientas de un centro de estética es
 * información de las personas, no del negocio. Un formulario que contesta
 * distinto según si el mail está registrado es una forma de averiguar quién se
 * atiende acá, probando direcciones de a una.
 *
 * Por eso `forgotPassword` contesta lo mismo siempre, y por eso el login dice
 * "credenciales inválidas" y no "esa cuenta no existe".
 */

const RONDAS = 10;
const MINIMO_CONTRASENA = 8;
const VIDA_TOKEN_MS = 60 * 60 * 1000;
/** Lo que hay que esperar entre dos mails de confirmación. Ver `resendVerification`. */
const ESPERA_ENTRE_REENVIOS_MS = 5 * 60 * 1000;

function token(): string {
  return randomBytes(32).toString("hex");
}

function normalizarMail(valor: unknown): string {
  return typeof valor === "string" ? valor.trim().toLowerCase() : "";
}

function texto(valor: unknown): string {
  return typeof valor === "string" ? valor : "";
}

function urlDelSitio(): string {
  return process.env["APP_URL"] ?? "http://localhost:8081";
}

/**
 * Lo que la app necesita saber de quien está conectada.
 *
 * Los roles y los permisos se leen de la base y NO del token, para que
 * destildar una casilla surta efecto en el acto. Ver auth.middleware.ts.
 */
async function retrato(userId: string) {
  const usuario = await prisma.users.findUnique({
    where: { id: userId },
    select: {
      id: true,
      email: true,
      email_verified_at: true,
      pending_email: true,
      profile: { select: { full_name: true, phone: true } },
      roles: { select: { role: true } },
      permissions: { select: { permission: true } },
    },
  });
  if (!usuario) return null;

  return {
    id: usuario.id,
    email: usuario.email,
    emailVerificado: usuario.email_verified_at !== null,
    // La dirección nueva que está esperando su enlace, si pidió cambiarla. La
    // pantalla la necesita para poder decir "te mandamos un mail a X y hasta que
    // no lo abras seguís entrando con el de siempre" — sin esto, pedir el cambio
    // y no ver nada se lee como que no se guardó.
    emailPendiente: usuario.pending_email,
    nombre: usuario.profile?.full_name ?? null,
    telefono: usuario.profile?.phone ?? null,
    roles: usuario.roles.map((r) => r.role as string),
    permisos: usuario.permissions.map((p) => p.permission as string),
    // Va acá y no en una consulta aparte para que la pantalla no tenga que
    // juntar su idea de quién sos con tres respuestas que pueden llegar
    // desincronizadas. Antes esto era la RPC `my_professional_id`.
    //
    // ⚠️ Se pregunta con `miFichaDeProfesional` y no consultando `professionals`
    // derecho, para que esto y `miAgenda()` contesten siempre lo mismo: la
    // función incluye el `is_active`, así que una profesional dada de baja deja
    // de ver la agenda en el acto.
    professionalId: await miFichaDeProfesional(usuario.id),
  };
}

/**
 * ¿Esto que está guardado es un hash de bcrypt de verdad?
 *
 * Se mira la FORMA, no el contenido: 60 caracteres que arrancan con `$2`. Es lo
 * que produce bcrypt siempre, y alcanza para separar un hash real de un
 * marcador como el del seed.
 *
 * Existe para que el login tarde lo mismo en los tres casos —mail inexistente,
 * contraseña mala, cuenta sin estrenar—. Lo que NO hace es autorizar nada: si
 * devuelve false se compara igual contra el hash de descarte, que tampoco da
 * true nunca. Es una decisión sobre el reloj, no sobre el acceso.
 */
function esHash(valor: string | undefined): valor is string {
  return typeof valor === "string" && valor.length === 60 && valor.startsWith("$2");
}

// ── Entrar ──────────────────────────────────────────────────────────────────

export async function login(ctx: Ctx) {
  const email = normalizarMail(ctx.body["email"]);
  const password = texto(ctx.body["password"]);

  if (!email || !password) {
    return json({ error: "Mail y contraseña son obligatorios." }, 400);
  }

  const usuario = await prisma.users.findUnique({
    where: { email },
    select: {
      id: true,
      email: true,
      password: true,
      is_active: true,
      roles: { select: { role: true } },
    },
  });

  // Se compara igual cuando la cuenta no existe, contra un hash de descarte.
  // Sin esto, un login con mail inexistente contesta más rápido que uno con
  // mail real y contraseña mala — y esa diferencia de tiempo alcanza para ir
  // averiguando qué direcciones están registradas.
  //
  // 🔴 Y TAMBIÉN cuando lo guardado NO ES UN HASH, que es el caso que se
  // escapaba. El seed escribe `!sin-contrasena-todavia!` en las cuentas que
  // todavía no fijaron contraseña (ver `SIN_CONTRASENA` en prisma/seed.ts): es
  // deliberado —no hay contraseña que lo haga dar true— pero bcrypt lo descarta
  // por la forma, sin llegar a calcular nada, y contesta en 0 ms contra los ~90
  // de un hash de verdad.
  //
  // Medido el 28/8/2026: mail inexistente 92 ms, cuenta con contraseña real
  // 92 ms, cuenta del equipo todavía sin fijarla **0 ms**. O sea que el mismo
  // reloj que este bloque cierra por un lado lo abría por el otro, y encima
  // señalaba justo las casillas del centro.
  //
  // No delata ninguna contraseña, pero sí cuáles de un listado de mails son
  // cuentas del panel que nunca se estrenaron. Se arregla acá y no en el seed a
  // propósito: en el seed sólo valdría para las bases que se siembren de ahora
  // en más, y las cuatro cuentas del VPS ya tienen el texto guardado.
  const HASH_DESCARTE = "$2a$10$" + "x".repeat(53);
  const guardado = usuario?.password;
  const valida = await bcrypt.compare(password, esHash(guardado) ? guardado : HASH_DESCARTE);

  if (!usuario || !valida) {
    return json({ error: "Credenciales inválidas." }, 401);
  }

  // La cuenta dada de baja se rechaza DESPUÉS de verificar la contraseña, no
  // antes. Si se contestara "está dada de baja" sin mirarla, cualquiera podría
  // ir probando direcciones hasta encontrar las que existen — es el mismo
  // cuidado que el hash de descarte de acá arriba. Con la contraseña correcta ya
  // no hay nada que delatar: quien la sabe es la dueña de la cuenta, y merece
  // saber por qué no entra en vez de pelearse con "credenciales inválidas".
  if (!usuario.is_active) {
    return json({ error: "Esta cuenta está dada de baja. Hablá con el centro." }, 403);
  }

  // El rol que va en el token es el de más alcance. Los permisos finos NO van
  // acá: se leen de la base en cada pedido.
  const roles = usuario.roles.map((r) => r.role as string);
  const rol = roles.includes("admin") ? "admin" : roles.includes("staff") ? "staff" : "client";

  ctx.cookies.push(crearCookieDeSesion({ id: usuario.id, email: usuario.email, role: rol }));
  resetearIntentos(ctx);

  return json({ user: await retrato(usuario.id) });
}

// ── Salir ───────────────────────────────────────────────────────────────────

export function logout(ctx: Ctx) {
  ctx.cookies.push(cookieDeCierre());
  return json({ ok: true });
}

// ── Quién soy ───────────────────────────────────────────────────────────────

export async function me(ctx: Ctx) {
  const usuario = await retrato(ctx.user!.id);
  if (!usuario) {
    // El token es válido pero la cuenta ya no está: la dieron de baja mientras
    // la sesión seguía abierta. Se cierra acá para que no quede dando vueltas.
    ctx.cookies.push(cookieDeCierre());
    return json({ error: "La cuenta ya no existe." }, 401);
  }
  return json({ user: usuario });
}

// ── Registrarse ─────────────────────────────────────────────────────────────

/**
 * El resultado del alta, para que cada puerta conteste como le corresponde.
 *
 * Son dos puertas y **no pueden contestar igual**: `register` es pública y
 * tiene que callar si el mail ya existe, y el alta del panel tiene que decirlo.
 * Ver el comentario de `"tomado"` abajo.
 */
type AltaDeCuenta =
  | { estado: "mal"; error: string }
  | { estado: "tomado" }
  | { estado: "creada"; id: string; email: string; avisoMail?: string };

/**
 * Crea una cuenta de clienta: la fila de `users`, su ficha y su rol.
 *
 * Vive acá y no en `clientas.controller` a propósito: **es el único lugar del
 * proyecto que escribe una contraseña**, y tenerlo junto a `login` es lo que
 * permite ver de un vistazo que las dos puntas usan el mismo bcrypt. Que la use
 * el panel es lo de menos; lo que no puede pasar es que haya dos altas
 * distintas, cada una con su propio criterio de qué es una contraseña válida.
 *
 * Devuelve un resultado en vez de una respuesta HTTP porque las dos puertas que
 * la llaman contestan distinto ante el mismo hecho.
 */
async function crearCuentaDeClienta(datos: {
  email: unknown;
  password: unknown;
  nombre: unknown;
  telefono: unknown;
}): Promise<AltaDeCuenta> {
  const email = normalizarMail(datos.email);
  const password = texto(datos.password);
  const nombre = texto(datos.nombre).trim();
  const telefono = texto(datos.telefono).trim();

  if (!email.includes("@")) return { estado: "mal", error: "El mail no parece válido." };
  if (password.length < MINIMO_CONTRASENA) {
    return {
      estado: "mal",
      error: "La contraseña necesita al menos " + MINIMO_CONTRASENA + " caracteres.",
    };
  }
  if (!nombre) return { estado: "mal", error: "Falta el nombre." };

  const yaExiste = await prisma.users.findUnique({ where: { email }, select: { id: true } });
  if (yaExiste) return { estado: "tomado" };

  const verifyToken = token();

  const creada = await prisma.users.create({
    select: { id: true, email: true },
    data: {
      email,
      password: await bcrypt.hash(password, RONDAS),
      verify_token: verifyToken,
      verify_token_expiry: new Date(Date.now() + VIDA_TOKEN_MS),
      // La ficha y el rol se crean junto con la cuenta, en la misma
      // transacción. En Supabase esto lo hacía el trigger handle_new_user sobre
      // auth.users; acá no hay trigger que valga, porque la tabla es nuestra.
      profile: { create: { full_name: nombre, phone: telefono || null } },
      roles: { create: { role: "client" } },
    },
  });

  // 🔴 El mail queda SIN confirmar, la cree quien la cree.
  //
  // Es la regla que sostiene todo lo demás: confirmar es lo único que prueba que
  // la casilla es de quien dice, y es lo que habilita el traspaso de los turnos
  // de invitada. Si el alta del panel la marcara confirmada, cargar una clienta
  // con el mail de otra persona le pasaría el historial ajeno — la misma puerta
  // de atrás que `verifyEmail` cierra, abierta desde adentro del centro.
  const envio = await enviarMailDeCuenta(
    "confirmar-cuenta",
    email,
    urlDelSitio() + "/confirmar?token=" + verifyToken,
  );

  // 🔴 El fallo se cuenta por los DOS lados, y hace falta que sean los dos.
  //
  // A quien se registró se le devuelve `avisoMail` —acá no hay nada que ocultar,
  // la cuenta la acaba de crear— y la pantalla lo muestra. Pero eso sólo lo ve
  // ella: si no vuelve a escribir, el centro no se entera nunca. Por eso además
  // queda en el log del contenedor, igual que en `forgotPassword`.
  //
  // 4/9/2026, el caso que lo motivó: una clienta de Hotmail no recibió ni el
  // mail de confirmación ni el aviso de su turno, y el sistema no tenía una sola
  // línea que lo dijera. Se supo cuatro días después, porque ella lo comentó por
  // WhatsApp. El envío andaba —el problema era del lado de Microsoft—, pero eso
  // costó una tarde de diagnóstico que un renglón de log habría ahorrado.
  if (!envio.ok) {
    console.error(`[cuenta] No salió el mail de confirmación para ${email}: ${envio.motivo}`);
  }

  return {
    estado: "creada",
    id: creada.id,
    email: creada.email,
    ...(envio.ok ? {} : { avisoMail: envio.motivo }),
  };
}

/**
 * El alta de una clienta desde el panel: la carga el centro, con su mail y una
 * contraseña, y la clienta entra con eso.
 *
 * ── POR QUÉ ACÁ SÍ SE DICE QUE EL MAIL ESTÁ TOMADO ────────────────────────
 *
 * `register` calla —contesta lo mismo exista o no la cuenta— porque cualquiera
 * puede golpear esa puerta y la respuesta distinta sería un buscador de
 * clientas. Acá no: del otro lado hay una empleada con sesión y permiso, que ya
 * puede ver la lista entera. Callarle no esconde nada de nadie; lo único que
 * lograría es que cargue a la clienta, no vea ningún error, y crea que quedó
 * registrada cuando en realidad no se creó nada.
 *
 * No abre sesión, por lo mismo: la cuenta es de la clienta, no de quien la
 * carga. Si empujara una cookie, la empleada terminaría con la sesión de la
 * clienta que acaba de dar de alta.
 */
export async function crearClienta(ctx: Ctx) {
  const alta = await crearCuentaDeClienta({
    email: ctx.body["email"],
    password: ctx.body["password"],
    nombre: ctx.body["fullName"],
    telefono: ctx.body["phone"],
  });

  if (alta.estado === "mal") return json({ error: alta.error }, 400);
  if (alta.estado === "tomado") {
    return json({ error: "Ese mail ya tiene cuenta. Buscala en la lista." }, 409);
  }

  return json({
    ok: true,
    id: alta.id,
    email: alta.email,
    // La contraseña NO viaja de vuelta ni sale por mail: se la dice el centro a
    // la clienta. Mandarla escrita la deja guardada para siempre en una casilla.
    ...(alta.avisoMail ? { avisoMail: alta.avisoMail } : {}),
  });
}

export async function register(ctx: Ctx) {
  const alta = await crearCuentaDeClienta({
    email: ctx.body["email"],
    password: ctx.body["password"],
    nombre: ctx.body["fullName"],
    telefono: ctx.body["phone"],
  });

  if (alta.estado === "mal") return json({ error: alta.error }, 400);

  // Si el mail ya está tomado se contesta EXACTAMENTE lo mismo que en el alta
  // buena, y no se manda ningún mail. Quien está registrado no se entera de
  // nada, y quien prueba direcciones ajenas tampoco.
  if (alta.estado === "tomado") {
    return json({ ok: true, mensaje: "Te mandamos un mail para confirmar tu cuenta." });
  }

  // ── LA SESIÓN SE ABRE ACÁ, SIN ESPERAR LA CONFIRMACIÓN ────────────────────
  //
  // Antes el alta no dejaba entrar: había que ir al mail, abrir el enlace y
  // recién ahí ingresar. Eso pedía prueba de la casilla para TODO, cuando en
  // realidad hace falta para una sola cosa —el traspaso de los turnos de
  // invitada, en `verifyEmail`—, y encima no frenaba nada: `login` nunca miró
  // `email_verified_at`, así que quien cerraba esa pantalla y tocaba "Ingresar"
  // entraba igual. Era una puerta pintada.
  //
  // Ahora la cuenta sirve desde el primer segundo —reservar, ver la ficha— y lo
  // único que espera al mail confirmado es el historial de lo que reservó como
  // invitada, que es lo que de verdad no se le puede mostrar a quien todavía no
  // demostró que la casilla es suya.
  //
  // El rol va fijo en "client" y no leído de la base: es el único que le pone
  // `crearCuentaDeClienta`.
  ctx.cookies.push(crearCookieDeSesion({ id: alta.id, email: alta.email, role: "client" }));

  return json({
    ok: true,
    mensaje: "Te mandamos un mail para confirmar tu cuenta.",
    user: await retrato(alta.id),
    // Si el mail no salió hay que decirlo: la cuenta quedó creada pero sin
    // forma de confirmarse, y sin este aviso el silencio parece éxito.
    ...(alta.avisoMail ? { avisoMail: alta.avisoMail } : {}),
  });
}

// ── Que me lo manden de nuevo ───────────────────────────────────────────────

/**
 * Reenvía el mail de confirmación a quien está conectada.
 *
 * Pide sesión, así que acá NO rige la regla de no decir si un mail existe: la
 * cuenta es suya, ya entró. Por eso esta es la única de las cuatro que puede
 * contestar de verdad —"ya estabas confirmada", "el mail no salió"— en vez del
 * mensaje parejo de siempre.
 */
export async function resendVerification(ctx: Ctx) {
  const usuario = await prisma.users.findUnique({
    where: { id: ctx.user!.id },
    select: { id: true, email: true, email_verified_at: true, verify_token_expiry: true },
  });
  if (!usuario) return json({ error: "La cuenta ya no existe." }, 401);

  if (usuario.email_verified_at) {
    return json({ ok: true, mensaje: "Tu mail ya estaba confirmado." });
  }

  // Un freno para que el botón no sea una forma cómoda de bombardear una
  // casilla. No hace falta un contador aparte: el token que ya está guardado
  // dice cuándo se mandó el anterior, porque vence a la hora exacta de emitido.
  const vence = usuario.verify_token_expiry?.getTime() ?? 0;
  if (vence - Date.now() > VIDA_TOKEN_MS - ESPERA_ENTRE_REENVIOS_MS) {
    return json(
      { error: "Recién te mandamos uno. Esperá unos minutos y fijate en el correo no deseado." },
      429,
    );
  }

  const verifyToken = token();
  await prisma.users.update({
    where: { id: usuario.id },
    data: { verify_token: verifyToken, verify_token_expiry: new Date(Date.now() + VIDA_TOKEN_MS) },
  });

  const envio = await enviarMailDeCuenta(
    "confirmar-cuenta",
    usuario.email,
    urlDelSitio() + "/confirmar?token=" + verifyToken,
  );

  if (!envio.ok) {
    console.error(
      `[cuenta] No salió el reenvío de confirmación para ${usuario.email}: ${envio.motivo}`,
    );
    return json({ error: "No se pudo mandar el mail: " + envio.motivo }, 502);
  }

  return json({ ok: true, mensaje: "Listo, te lo mandamos de nuevo." });
}

// ── Cambiar el mail de la cuenta ────────────────────────────────────────────

/**
 * Pide cambiar el mail. La dirección nueva NO se aplica todavía.
 *
 * ── POR QUÉ EN DOS PASOS ──────────────────────────────────────────────────
 *
 * El mail es con lo que se entra. Si el cambio se aplicara al apretar el botón,
 * un dedazo —`gmial.com`, una letra de más— dejaría a la clienta afuera de su
 * propia cuenta, sin sesión y sin forma de recuperarla: «olvidé mi contraseña»
 * mandaría el enlace a la casilla equivocada. Con la dirección esperando en
 * `pending_email` eso no puede pasar: hasta que no abre el enlace que le llega A
 * LA NUEVA, sigue entrando con la de siempre y no se perdió nada.
 *
 * El segundo motivo es el de siempre: al aplicarse, el mail nuevo se lleva los
 * turnos de invitada anotados con esa dirección. Sin la prueba de que la casilla
 * es suya, cambiar el mail sería la puerta de atrás para quedarse con el
 * historial de otra persona — justo la que `verifyEmail` cierra en el alta.
 *
 * ── Y POR QUÉ NO DICE SI LA DIRECCIÓN YA TIENE CUENTA ─────────────────────
 *
 * Porque contestar distinto convierte este formulario en el buscador de clientas
 * que el resto del archivo se cuida de no ser (ver el comentario de arriba de
 * todo). Cuando la dirección está tomada se responde lo mismo y no se manda
 * nada: quien de verdad es la dueña de esa casilla no recibe ningún mail y no se
 * entera de nada, que es exactamente lo que corresponde.
 */
export async function requestEmailChange(ctx: Ctx) {
  const nuevo = normalizarMail(ctx.body["email"]);

  const usuario = await prisma.users.findUnique({
    where: { id: ctx.user!.id },
    select: { id: true, email: true },
  });
  if (!usuario) return json({ error: "La cuenta ya no existe." }, 401);

  if (!nuevo.includes("@")) return json({ error: "El mail no parece válido." }, 400);
  // Este sí se puede decir: es su propia dirección, no delata la de nadie.
  if (nuevo === usuario.email) return json({ error: "Ése es el mail que ya tenés." }, 400);

  const respuesta = json({
    ok: true,
    mensaje: "Te mandamos un enlace a la dirección nueva. Abrilo para terminar el cambio.",
    pendiente: nuevo,
  });

  const cambioToken = token();
  await prisma.users.update({
    where: { id: usuario.id },
    data: {
      pending_email: nuevo,
      email_change_token: cambioToken,
      email_change_expiry: new Date(Date.now() + VIDA_TOKEN_MS),
    },
  });

  // Tomada por otra cuenta: se guarda el pendiente igual —así la pantalla
  // muestra lo mismo que en el caso bueno— pero no sale ningún mail, y por lo
  // tanto no hay enlace que abrir. El cambio simplemente vence en una hora.
  const tomado = await prisma.users.findUnique({ where: { email: nuevo }, select: { id: true } });
  if (tomado) return respuesta;

  const envio = await enviarMailDeCuenta(
    "cambiar-mail",
    nuevo,
    urlDelSitio() + "/confirmar-mail?token=" + cambioToken,
  );

  // Como el mail va a la dirección NUEVA, a quien lo pidió no le llega nada por
  // el camino viejo: si no salió y no lo dijéramos, se quedaría esperando un
  // enlace que no existe. Acá sí se puede contar, es su propia cuenta.
  if (!envio.ok) {
    console.error(`[cuenta] No salió el mail de cambio de dirección a ${nuevo}: ${envio.motivo}`);
    return json({ error: "No se pudo mandar el mail: " + envio.motivo }, 502);
  }

  return respuesta;
}

/**
 * Aplica el cambio de mail con el token que llegó a la dirección nueva.
 *
 * Es público —sin sesión— a propósito: el enlace se abre donde esté esa casilla,
 * que casi siempre es el teléfono, y ahí no hay ninguna sesión abierta.
 */
export async function verifyEmailChange(ctx: Ctx) {
  const valor = texto(ctx.body["token"]);
  if (!valor) return json({ error: "Falta el token." }, 400);

  const usuario = await prisma.users.findFirst({
    where: { email_change_token: valor },
    select: { id: true, pending_email: true, email_change_expiry: true },
  });

  if (
    !usuario ||
    !usuario.pending_email ||
    !usuario.email_change_expiry ||
    usuario.email_change_expiry < new Date()
  ) {
    return json({ error: "El enlace venció o ya se usó. Pedí uno nuevo." }, 400);
  }

  // Se vuelve a preguntar acá y no alcanza con haberlo preguntado al pedirlo:
  // entre una cosa y la otra pasa una hora, y en el medio alguien pudo
  // registrarse con esa misma dirección. Si se aplicara igual, la base lo
  // frenaría con un error de índice único que no le dice nada a nadie.
  const tomado = await prisma.users.findUnique({
    where: { email: usuario.pending_email },
    select: { id: true },
  });
  if (tomado) {
    await prisma.users.update({
      where: { id: usuario.id },
      data: { pending_email: null, email_change_token: null, email_change_expiry: null },
    });
    return json({ error: "Esa dirección ya está en uso. Probá con otra." }, 409);
  }

  const nuevo = usuario.pending_email;

  await prisma.users.update({
    where: { id: usuario.id },
    data: {
      email: nuevo,
      // Queda verificada de una vez: acabamos de comprobar que la casilla es
      // suya, que es lo mismo que prueba el enlace del alta.
      email_verified_at: new Date(),
      pending_email: null,
      email_change_token: null,
      email_change_expiry: null,
      // Si tenía a medias la confirmación del alta, ese token ya no sirve para
      // nada: apuntaba a una dirección que la cuenta dejó de tener.
      verify_token: null,
      verify_token_expiry: null,
    },
  });

  return json({
    ok: true,
    email: nuevo,
    turnosTraspasados: await traspasarTurnosDeInvitada(usuario.id, nuevo),
  });
}

// ── El traspaso de los turnos de invitada ───────────────────────────────────

/**
 * Le pasa a la cuenta los turnos que el centro anotó con ese mail antes de que
 * existiera.
 *
 * Esto lo hacía el trigger claim_guest_appointments sobre auth.users. Ahora vive
 * acá, y es EL motivo por el que Shiraf confirma el mail y el ecommerce no: sin
 * verificar, cualquiera se registra con el mail de otra persona y se queda con
 * su historial de turnos.
 *
 * Se llama desde los dos lugares donde una dirección queda demostrada: al
 * confirmar el alta y al aplicar un cambio de mail. El segundo no es un extra —
 * quien se registró con un mail y después puso el bueno tiene sus turnos viejos
 * anotados con el bueno, y sin esto no los vería nunca.
 *
 * ⚠️ Es un disparo único, no una regla que se revise sola. Si el centro corrige
 * el mail de una invitada DESPUÉS de que esa persona ya confirmó, esto no vuelve
 * a correr: para ese caso está el diálogo de vincular a mano del panel.
 */
async function traspasarTurnosDeInvitada(userId: string, email: string): Promise<number> {
  const { count } = await prisma.appointments.updateMany({
    where: { client_id: null, guest_email: email },
    data: { client_id: userId, guest_name: null, guest_phone: null, guest_email: null },
  });
  return count;
}

// ── Confirmar el mail ───────────────────────────────────────────────────────

export async function verifyEmail(ctx: Ctx) {
  const valor = texto(ctx.body["token"]);
  if (!valor) return json({ error: "Falta el token." }, 400);

  const usuario = await prisma.users.findUnique({
    where: { verify_token: valor },
    select: { id: true, email: true, verify_token_expiry: true },
  });

  if (!usuario || !usuario.verify_token_expiry || usuario.verify_token_expiry < new Date()) {
    return json({ error: "El enlace venció o ya se usó. Pedí uno nuevo." }, 400);
  }

  await prisma.users.update({
    where: { id: usuario.id },
    data: { email_verified_at: new Date(), verify_token: null, verify_token_expiry: null },
  });

  return json({
    ok: true,
    turnosTraspasados: await traspasarTurnosDeInvitada(usuario.id, usuario.email),
  });
}

// ── Olvidé la contraseña ────────────────────────────────────────────────────

export async function forgotPassword(ctx: Ctx) {
  const email = normalizarMail(ctx.body["email"]);

  // La respuesta es la misma exista o no la cuenta. Ver el comentario de arriba
  // del archivo: acá es donde más importa.
  const respuesta = json({
    ok: true,
    mensaje: "Si esa dirección tiene cuenta, te llega un mail con el enlace.",
  });

  if (!email) return respuesta;

  const usuario = await prisma.users.findUnique({ where: { email }, select: { id: true } });
  if (!usuario) return respuesta;

  const resetToken = token();
  await prisma.users.update({
    where: { id: usuario.id },
    data: { reset_token: resetToken, reset_token_expiry: new Date(Date.now() + VIDA_TOKEN_MS) },
  });

  const envio = await enviarMailDeCuenta(
    "recuperar-contrasena",
    email,
    urlDelSitio() + "/recuperar?token=" + resetToken,
  );

  // 🔴 El resultado del envío se descartaba, y eso hacía el fracaso MUDO por los
  // dos lados: la pantalla contesta lo mismo pase lo que pase —no puede decir si
  // la cuenta existe— y en la terminal no quedaba nada. Con el correo sin
  // configurar, pedir la contraseña se veía exactamente igual que si el mail
  // hubiera salido, y no había forma de darse cuenta.
  //
  // A quien llamó no se le puede contar (ver el comentario de arriba del
  // archivo), así que el único lugar donde esto puede constar es el log.
  // `register`, más arriba, sí lo devuelve: ahí no hay nada que ocultar, la
  // persona acaba de crear esa cuenta.
  if (!envio.ok) {
    console.error(`[cuenta] No salió el mail de recuperación para ${email}: ${envio.motivo}`);
  }

  return respuesta;
}

// ── Poner una contraseña nueva con el token del mail ────────────────────────

export async function resetPassword(ctx: Ctx) {
  const valor = texto(ctx.body["token"]);
  const password = texto(ctx.body["password"]);

  if (password.length < MINIMO_CONTRASENA) {
    return json(
      { error: "La contraseña necesita al menos " + MINIMO_CONTRASENA + " caracteres." },
      400,
    );
  }

  const usuario = await prisma.users.findUnique({
    where: { reset_token: valor },
    select: { id: true, reset_token_expiry: true },
  });

  if (!usuario || !usuario.reset_token_expiry || usuario.reset_token_expiry < new Date()) {
    return json({ error: "El enlace venció o ya se usó. Pedí uno nuevo." }, 400);
  }

  await prisma.users.update({
    where: { id: usuario.id },
    data: {
      password: await bcrypt.hash(password, RONDAS),
      // Los dos campos se limpian: el token es de un solo uso.
      reset_token: null,
      reset_token_expiry: null,
      // Recuperar la contraseña por mail PRUEBA que la casilla es suya, así que
      // de paso queda verificada. Si no, alguien que se registró y nunca
      // confirmó quedaría en el limbo: puede entrar pero no está verificada.
      email_verified_at: new Date(),
    },
  });

  return json({ ok: true });
}

// ── Cambiar la contraseña estando adentro ───────────────────────────────────

export async function changePassword(ctx: Ctx) {
  const actual = texto(ctx.body["currentPassword"]);
  const nueva = texto(ctx.body["newPassword"]);

  if (nueva.length < MINIMO_CONTRASENA) {
    return json(
      { error: "La contraseña necesita al menos " + MINIMO_CONTRASENA + " caracteres." },
      400,
    );
  }

  const usuario = await prisma.users.findUnique({
    where: { id: ctx.user!.id },
    select: { password: true },
  });
  if (!usuario) return json({ error: "La cuenta ya no existe." }, 401);

  if (!(await bcrypt.compare(actual, usuario.password))) {
    return json({ error: "La contraseña actual no es correcta." }, 400);
  }

  await prisma.users.update({
    where: { id: ctx.user!.id },
    data: { password: await bcrypt.hash(nueva, RONDAS) },
  });

  return json({ ok: true });
}
