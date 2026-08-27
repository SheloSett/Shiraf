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

export async function register(ctx: Ctx) {
  const email = normalizarMail(ctx.body["email"]);
  const password = texto(ctx.body["password"]);
  const nombre = texto(ctx.body["fullName"]).trim();
  const telefono = texto(ctx.body["phone"]).trim();

  if (!email.includes("@")) return json({ error: "El mail no parece válido." }, 400);
  if (password.length < MINIMO_CONTRASENA) {
    return json(
      { error: "La contraseña necesita al menos " + MINIMO_CONTRASENA + " caracteres." },
      400,
    );
  }
  if (!nombre) return json({ error: "Falta el nombre." }, 400);

  const yaExiste = await prisma.users.findUnique({ where: { email }, select: { id: true } });

  // Si el mail ya está tomado se contesta EXACTAMENTE lo mismo que en el alta
  // buena, y no se manda ningún mail. Quien está registrado no se entera de
  // nada, y quien prueba direcciones ajenas tampoco.
  if (yaExiste) {
    return json({ ok: true, mensaje: "Te mandamos un mail para confirmar tu cuenta." });
  }

  const verifyToken = token();

  await prisma.users.create({
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

  const envio = await enviarMailDeCuenta(
    "confirmar-cuenta",
    email,
    urlDelSitio() + "/confirmar?token=" + verifyToken,
  );

  return json({
    ok: true,
    mensaje: "Te mandamos un mail para confirmar tu cuenta.",
    // Si el mail no salió hay que decirlo: la cuenta quedó creada pero sin
    // forma de confirmarse, y sin este aviso el silencio parece éxito.
    ...(envio.ok ? {} : { avisoMail: envio.motivo }),
  });
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

  // ── El traspaso de los turnos de invitada ─────────────────────────────────
  // Esto lo hacía el trigger claim_guest_appointments sobre auth.users. Ahora
  // vive acá, y es EL motivo por el que Shiraf confirma el mail y el ecommerce
  // no: sin verificar, cualquiera se registra con el mail de otra persona y se
  // queda con su historial de turnos.
  const traspasados = await prisma.appointments.updateMany({
    where: { client_id: null, guest_email: usuario.email },
    data: { client_id: usuario.id, guest_name: null, guest_phone: null, guest_email: null },
  });

  return json({ ok: true, turnosTraspasados: traspasados.count });
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
