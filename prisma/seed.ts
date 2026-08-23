/**
 * Carga la base propia con los datos que salieron de Supabase.
 *
 * Fase 4 de MIGRACION-A-PRISMA.md. Lee lo que dejó `scripts/export-supabase.mjs`
 * y lo inserta en orden de claves foráneas.
 *
 * ── UNA DECISIÓN QUE SE APARTA DEL PLAN, Y POR QUÉ ─────────────────────────
 *
 * El plan decía de crear las 4 cuentas a mano en la Fase 2 y después traducir
 * cada `id` viejo al nuevo, con un mapeo, en las cinco columnas que apuntan a
 * una cuenta (profiles.id, appointments.client_id, professionals.user_id,
 * user_roles.user_id, user_permissions.user_id).
 *
 * Acá se hace al revés: **se conservan los UUID originales**. Es estrictamente
 * mejor y no cuesta nada — el `id` es nuestro, no de Supabase — y ninguna de
 * esas cinco columnas necesita traducción. Un mapeo que hay que acordarse de
 * aplicar en cinco lugares es justo la clase de cosa que se aplica en cuatro.
 *
 * La contraseña queda en un valor imposible de acertar, no en una de prueba: la
 * cuenta existe con todo su historial atado, pero no se puede entrar hasta que
 * alguien le ponga una de verdad.
 *
 * Es idempotente: se puede correr de nuevo sin duplicar nada.
 *
 *   docker compose -f docker-compose.dev.yml run --rm app bun prisma/seed.ts
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { aSlug } from "../src/lib/shiraf";

const DATOS = join(process.cwd(), "scripts", "datos");

function leer<T>(nombre: string): T[] {
  return JSON.parse(readFileSync(join(DATOS, nombre + ".json"), "utf8")) as T[];
}

/**
 * El primer slug libre de la tanda: "masaje", "masaje-2", "masaje-3"...
 *
 * Es la version en memoria de `slugLibre` (src/server/services/catalogo.service.ts),
 * que hace lo mismo preguntandole a la base. Aca no hace falta ir a la base: la
 * tabla arranca vacia y lo unico con lo que se puede chocar es con otra fila de
 * este mismo archivo JSON.
 */
function slugLibreEnMemoria(base: string, usados: Set<string>): string {
  for (let n = 1; ; n++) {
    const candidato = n === 1 ? base : base + "-" + n;
    if (!usados.has(candidato)) {
      usados.add(candidato);
      return candidato;
    }
  }
}

/** Los `timestamptz` vienen como ISO; Prisma quiere Date. */
function fecha(v: string | null | undefined): Date | null {
  return v ? new Date(v) : null;
}

/**
 * Las columnas TIME llegan como "09:00:00" y Prisma espera un Date. La parte de
 * fecha la descarta Postgres; 1970-01-01 es la convención y deja claro que no
 * significa nada.
 */
function hora(v: string): Date {
  return new Date("1970-01-01T" + v + "Z");
}

/**
 * Contraseña imposible. bcrypt siempre produce 60 caracteres que empiezan con
 * "$2"; esto no lo es, así que ninguna comparación lo va a dar por bueno — ni
 * siquiera mandando la cadena literal. La cuenta queda inutilizable a propósito.
 */
const SIN_CONTRASENA = "!sin-contrasena-todavia!";

type Usuario = {
  id: string;
  email: string;
  email_confirmed_at: string | null;
  created_at: string;
};

async function main() {
  const adapter = new PrismaPg({ connectionString: process.env["DATABASE_URL"] ?? "" });
  const prisma = new PrismaClient({ adapter });

  const usuarios = JSON.parse(
    readFileSync(join(process.cwd(), "scripts", "usuarios.json"), "utf8"),
  ) as Usuario[];

  console.log("Cargando la base propia...\n");

  // ── 1. Cuentas ────────────────────────────────────────────────────────────
  for (const u of usuarios) {
    await prisma.users.upsert({
      where: { id: u.id },
      update: {},
      create: {
        id: u.id,
        email: u.email.toLowerCase(),
        password: SIN_CONTRASENA,
        // Se respeta quién tenía el mail confirmado: de eso depende que sus
        // turnos de invitada se le hayan pasado a la cuenta.
        email_verified_at: fecha(u.email_confirmed_at),
        created_at: new Date(u.created_at),
      },
    });
  }
  console.log("  users                   " + usuarios.length);

  // ── 2. Ficha, roles y permisos ────────────────────────────────────────────
  type Perfil = {
    id: string;
    full_name: string | null;
    phone: string | null;
    birth_date: string | null;
    notes: string | null;
    created_at: string;
  };
  const perfiles = leer<Perfil>("profiles");
  for (const p of perfiles) {
    await prisma.profiles.upsert({
      where: { id: p.id },
      update: {},
      create: {
        id: p.id,
        full_name: p.full_name,
        phone: p.phone,
        birth_date: p.birth_date ? new Date(p.birth_date + "T00:00:00Z") : null,
        notes: p.notes,
        created_at: new Date(p.created_at),
      },
    });
  }
  console.log("  profiles                " + perfiles.length);

  const roles = leer<{ id: string; user_id: string; role: string; created_at: string }>(
    "user_roles",
  );
  for (const r of roles) {
    await prisma.user_roles.upsert({
      where: { id: r.id },
      update: {},
      create: {
        id: r.id,
        user_id: r.user_id,
        role: r.role as never,
        created_at: new Date(r.created_at),
      },
    });
  }
  console.log("  user_roles              " + roles.length);

  const permisos = leer<{ id: string; user_id: string; permission: string; created_at: string }>(
    "user_permissions",
  );
  for (const p of permisos) {
    await prisma.user_permissions.upsert({
      where: { id: p.id },
      update: {},
      create: {
        id: p.id,
        user_id: p.user_id,
        permission: p.permission as never,
        created_at: new Date(p.created_at),
      },
    });
  }
  console.log("  user_permissions        " + permisos.length);

  // ── 3. Catálogo ───────────────────────────────────────────────────────────
  const catServicios = leer<{ id: string; name: string; created_at: string }>("service_categories");
  for (const c of catServicios) {
    await prisma.service_categories.upsert({
      where: { id: c.id },
      update: {},
      create: { id: c.id, name: c.name, created_at: new Date(c.created_at) },
    });
  }
  console.log("  service_categories      " + catServicios.length);

  type Servicio = {
    id: string;
    name: string;
    description: string | null;
    category: string;
    duration_minutes: number;
    price: number;
    is_published: boolean;
    created_at: string;
  };
  const servicios = leer<Servicio>("services");
  // Los slugs ya entregados en esta corrida. Los seis nombres del catalogo son
  // distintos entre si, asi que el desempate no se usa nunca — pero el JSON lo
  // edita una persona, y dos "Masaje" dejarian el seed a mitad de camino con un
  // error de indice unico que no dice cual fila lo causo.
  const slugsUsados = new Set<string>();
  for (const s of servicios) {
    // ⚠️ SIN image_url. La escribe sola el trigger trg_sync_service_cover en
    // cuanto se inserten las fotos, más abajo. Mandarla desde acá la pisaría con
    // un valor que el trigger recalcula igual.
    await prisma.services.upsert({
      where: { id: s.id },
      update: {},
      create: {
        id: s.id,
        name: s.name,
        // La misma funcion que usa el servidor al guardar desde el panel, y por
        // eso importada de src/lib en vez de copiada: si el seed slugificara
        // distinto, los seis del catalogo tendrian URLs que la app nunca
        // volveria a generar.
        slug: slugLibreEnMemoria(aSlug(s.name) || "tratamiento", slugsUsados),
        description: s.description,
        category: s.category,
        duration_minutes: s.duration_minutes,
        price: s.price,
        is_published: s.is_published,
        created_at: new Date(s.created_at),
      },
    });
  }
  console.log(
    "  services                " + servicios.length + "   (sin image_url: la pone el trigger)",
  );

  const medios = leer<{
    id: string;
    service_id: string;
    url: string;
    kind: string;
    position: number;
    created_at: string;
  }>("service_media");
  for (const m of medios) {
    await prisma.service_media.upsert({
      where: { id: m.id },
      update: {},
      create: {
        id: m.id,
        service_id: m.service_id,
        url: m.url,
        kind: m.kind as never,
        position: m.position,
        created_at: new Date(m.created_at),
      },
    });
  }
  console.log("  service_media           " + medios.length);

  // ── 4. Equipo ─────────────────────────────────────────────────────────────
  type Profesional = {
    id: string;
    user_id: string | null;
    full_name: string;
    specialty: string | null;
    bio: string | null;
    avatar_url: string | null;
    is_active: boolean;
    created_at: string;
  };
  const profesionales = leer<Profesional>("professionals");
  for (const p of profesionales) {
    await prisma.professionals.upsert({
      where: { id: p.id },
      update: {},
      create: {
        id: p.id,
        user_id: p.user_id,
        full_name: p.full_name,
        specialty: p.specialty,
        bio: p.bio,
        avatar_url: p.avatar_url,
        is_active: p.is_active,
        created_at: new Date(p.created_at),
      },
    });
  }
  console.log("  professionals           " + profesionales.length);

  const ps = leer<{ id: string; professional_id: string; service_id: string }>(
    "professional_services",
  );
  for (const x of ps) {
    await prisma.professional_services.upsert({
      where: { id: x.id },
      update: {},
      create: { id: x.id, professional_id: x.professional_id, service_id: x.service_id },
    });
  }
  console.log("  professional_services   " + ps.length);

  const horarios = leer<{
    id: string;
    professional_id: string;
    weekday: number;
    start_time: string;
    end_time: string;
    created_at: string;
  }>("professional_schedules");
  for (const h of horarios) {
    await prisma.professional_schedules.upsert({
      where: { id: h.id },
      update: {},
      create: {
        id: h.id,
        professional_id: h.professional_id,
        weekday: h.weekday,
        start_time: hora(h.start_time),
        end_time: hora(h.end_time),
        created_at: new Date(h.created_at),
      },
    });
  }
  console.log("  professional_schedules  " + horarios.length);

  // ── 5. Stock ──────────────────────────────────────────────────────────────
  const catProd = leer<{ id: string; name: string; created_at: string }>("product_categories");
  for (const c of catProd) {
    await prisma.product_categories.upsert({
      where: { id: c.id },
      update: {},
      create: { id: c.id, name: c.name, created_at: new Date(c.created_at) },
    });
  }
  console.log("  product_categories      " + catProd.length);

  type Producto = {
    id: string;
    name: string;
    brand: string | null;
    category: string;
    unit: string;
    stock: number;
    min_stock: number;
    cost: number | null;
    created_at: string;
  };
  const productos = leer<Producto>("products");
  for (const p of productos) {
    await prisma.products.upsert({
      where: { id: p.id },
      update: {},
      create: {
        id: p.id,
        name: p.name,
        brand: p.brand,
        category: p.category,
        unit: p.unit,
        stock: p.stock,
        min_stock: p.min_stock,
        cost: p.cost,
        created_at: new Date(p.created_at),
      },
    });
  }
  console.log("  products                " + productos.length);

  const costos = leer<{ product_id: string; cost: number | null }>("product_costs");
  for (const c of costos) {
    await prisma.product_costs.upsert({
      where: { product_id: c.product_id },
      update: {},
      create: { product_id: c.product_id, cost: c.cost },
    });
  }
  console.log("  product_costs           " + costos.length);

  // ── 6. Turnos ─────────────────────────────────────────────────────────────
  type Turno = {
    id: string;
    client_id: string | null;
    service_id: string;
    professional_id: string | null;
    starts_at: string;
    duration_minutes: number;
    status: string;
    client_notes: string | null;
    admin_notes: string | null;
    price: number;
    guest_name: string | null;
    guest_phone: string | null;
    guest_email: string | null;
    reminded_at: string | null;
    created_at: string;
  };
  const turnos = leer<Turno>("appointments");
  for (const t of turnos) {
    await prisma.appointments.upsert({
      where: { id: t.id },
      update: {},
      create: {
        id: t.id,
        // NULL a propósito en los turnos de invitada. No es un dato faltante.
        client_id: t.client_id,
        service_id: t.service_id,
        professional_id: t.professional_id,
        starts_at: new Date(t.starts_at),
        duration_minutes: t.duration_minutes,
        status: t.status as never,
        client_notes: t.client_notes,
        admin_notes: t.admin_notes,
        price: t.price,
        guest_name: t.guest_name,
        guest_phone: t.guest_phone,
        guest_email: t.guest_email,
        reminded_at: fecha(t.reminded_at),
        created_at: new Date(t.created_at),
      },
    });
  }
  console.log("  appointments            " + turnos.length);

  const notas = leer<{ client_id: string; body: string | null }>("client_notes");
  for (const n of notas) {
    await prisma.client_notes.upsert({
      where: { client_id: n.client_id },
      update: {},
      create: { client_id: n.client_id, body: n.body },
    });
  }
  console.log("  client_notes            " + notas.length);

  // ── 7. Movimientos de stock, AL FINAL y a propósito ───────────────────────
  // ⚠️ Insertarlos dispara trg_apply_stock_movement, que le SUMA cada uno al
  //    saldo de products.stock — que arriba ya se cargó con el saldo final. Sin
  //    corregir, el stock quedaría contado dos veces.
  //
  //    Se guarda el saldo bueno, se insertan dejando que el trigger haga lo suyo
  //    (así se comprueba de paso que funciona), y se restaura. La alternativa
  //    —desactivar el trigger— pide ser dueño de la tabla y deja la base a medio
  //    camino si el seed se corta en el medio.
  const saldos = new Map(productos.map((p) => [p.id, p.stock]));

  const movimientos = leer<{
    id: string;
    product_id: string;
    quantity: number;
    reason: string | null;
    created_by: string | null;
    created_at: string;
  }>("stock_movements");
  for (const m of movimientos) {
    await prisma.stock_movements.upsert({
      where: { id: m.id },
      update: {},
      create: {
        id: m.id,
        product_id: m.product_id,
        quantity: m.quantity,
        reason: m.reason,
        created_by: m.created_by,
        created_at: new Date(m.created_at),
      },
    });
  }
  for (const [id, saldo] of saldos) {
    await prisma.products.update({ where: { id }, data: { stock: saldo } });
  }
  console.log(
    "  stock_movements         " + movimientos.length + "   (saldo restaurado tras el trigger)",
  );

  // ── Verificación ──────────────────────────────────────────────────────────
  const conPortada = await prisma.services.count({ where: { NOT: { image_url: null } } });
  console.log("\n  portadas puestas por el trigger: " + conPortada + "/" + servicios.length);

  console.log(
    "\n  Las 4 cuentas quedaron SIN contrasena usable. Se les pone una al\n" +
      "  terminar el auth (Fase 2), o desde 'recuperar contrasena'.\n",
  );

  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
