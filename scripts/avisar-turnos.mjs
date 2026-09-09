/**
 * Reenvía el aviso de "turno confirmado" a los turnos por venir, desde el VPS.
 *
 * Es el comando que pidió la dueña el 9/9/2026: los turnos cargados a mano
 * desde el panel no le avisaban a la clienta hasta el 8/9, y el WhatsApp recién
 * se encendió el 9/9, así que quedó un lote de turnos ya cargados a los que no
 * les salió nada. El envío vive adentro de la app —los textos están en un solo
 * lugar a propósito, `src/lib/notifications.ts`— así que esto no manda nada por
 * su cuenta: entra al panel con una cuenta del centro y le pide a la app que
 * mande, por `POST /api/turnos/avisar-pendientes`. Cada resultado vuelve con su
 * motivo, que es lo que hoy nadie ve.
 *
 * Corre ADENTRO del contenedor de la app, donde está `node` y el puerto 3000:
 *
 *   docker exec -e SHIRAF_MAIL=duena@mail.com -e SHIRAF_PASS='la clave' \
 *     shiraf-app node scripts/avisar-turnos.mjs --desde 2026-09-08 --listar
 *
 * Primero SIEMPRE con `--listar`, que muestra qué turnos entrarían sin mandar
 * nada. Después, el mismo comando con el canal en vez de `--listar`:
 *
 *   --whatsapp        Sólo por WhatsApp.
 *   --mail            Sólo por mail.
 *   --whatsapp --mail Los dos.
 *   --profesional     Además, a la profesional que atiende cada turno.
 *   --desde AAAA-MM-DD  Turnos CARGADOS desde ese día (por fecha de alta).
 *   --ids a,b,c         O turnos puntuales, por id, en vez de la fecha.
 *
 * Sólo entran los confirmados y por venir. La cuenta tiene que tener el permiso
 * de turnos —la dueña o cualquiera de Accesos que lo tenga—. La contraseña va
 * por variable y no por argumento para que no quede en el historial de
 * comandos del VPS; igual conviene ponerle un espacio adelante al `docker
 * exec` para que bash no lo guarde.
 */

const args = process.argv.slice(2);

function opcion(nombre) {
  const i = args.indexOf(nombre);
  return i === -1 ? null : (args[i + 1] ?? null);
}
const bandera = (nombre) => args.includes(nombre);

const base = (process.env.SHIRAF_URL ?? "http://127.0.0.1:3000").replace(/\/+$/, "");
const mail = process.env.SHIRAF_MAIL;
const pass = process.env.SHIRAF_PASS;

if (!mail || !pass) {
  console.error("Faltan SHIRAF_MAIL y SHIRAF_PASS: la cuenta del panel con la que se manda.");
  process.exit(1);
}

const listar = bandera("--listar");
const canales = [
  bandera("--mail") ? "mail" : null,
  bandera("--whatsapp") ? "whatsapp" : null,
].filter(Boolean);
const desde = opcion("--desde");
const ids = (opcion("--ids") ?? "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

if (!listar && canales.length === 0) {
  console.error("Decí por dónde: --whatsapp, --mail o los dos. O --listar para ver sin mandar.");
  process.exit(1);
}
if (!desde && ids.length === 0) {
  console.error("Falta --desde AAAA-MM-DD o --ids a,b,c.");
  process.exit(1);
}

// ── Entrar ──────────────────────────────────────────────────────────────────
const login = await fetch(`${base}/api/auth/login`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ email: mail, password: pass }),
});
if (!login.ok) {
  const detalle = await login.json().catch(() => ({}));
  console.error(`No se pudo entrar (${login.status}): ${detalle.error ?? "sin detalle"}`);
  process.exit(1);
}
// La cookie de sesión viene en `set-cookie`; alcanza con el primer par nombre=valor.
const cookie = (login.headers.get("set-cookie") ?? "").split(";")[0];
if (!cookie) {
  console.error("Entró pero no vino la cookie de sesión.");
  process.exit(1);
}

// ── Pedir el envío ──────────────────────────────────────────────────────────
const pedido = await fetch(`${base}/api/turnos/avisar-pendientes`, {
  method: "POST",
  headers: { "Content-Type": "application/json", cookie },
  body: JSON.stringify({
    listar,
    canales,
    profesional: bandera("--profesional"),
    ...(ids.length > 0 ? { ids } : { desde }),
  }),
});
const rta = await pedido.json().catch(() => ({}));
if (!pedido.ok) {
  console.error(`La app contestó ${pedido.status}: ${rta.error ?? "sin detalle"}`);
  process.exit(1);
}

// ── Contar lo que pasó ─────────────────────────────────────────────────────
const cuando = (iso) =>
  new Date(iso).toLocaleString("es-AR", {
    weekday: "short",
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
    timeZone: "America/Argentina/Buenos_Aires",
  });
const como = (envio) => (envio ? (envio.sent ? "salió" : `NO: ${envio.reason}`) : "—");

console.log(
  listar
    ? `${rta.total} turno(s) entrarían. Nada se mandó.`
    : `${rta.total} turno(s), por ${rta.canales.join(" y ")}.`,
);
for (const t of rta.turnos) {
  const quien = `${t.quien}${t.telefono ? ` · ${t.telefono}` : " · SIN TELÉFONO"}${t.mail ? "" : " · sin mail"}`;
  console.log(`\n${cuando(t.cuando)} · ${quien}${t.profesional ? ` · con ${t.profesional}` : ""}`);
  console.log(`  id ${t.id}`);
  if (!listar) {
    if ("envio_whatsapp" in t) console.log(`  whatsapp: ${como(t.envio_whatsapp)}`);
    if ("envio_mail" in t) console.log(`  mail: ${como(t.envio_mail)}`);
    if ("envio_profesional" in t) {
      const p = t.envio_profesional;
      console.log(
        `  profesional: ${como(p)}${p?.whatsapp ? ` · whatsapp: ${como(p.whatsapp)}` : ""}`,
      );
    }
  }
}
