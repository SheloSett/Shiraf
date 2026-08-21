/**
 * Aplica lo que `prisma db push` no sabe manejar.
 *
 * Corre despues de cada push, en el arranque del contenedor. Es el mismo lugar
 * que ocupa `post-migrate.js` en Ecommerce_mm.
 *
 * `db push` sincroniza la base con schema.prisma y nada mas. Los triggers y las
 * funciones no los conoce —sobreviven, pero en una base nueva nadie los crea— y
 * el CHECK de turnos y los cuatro indices parciales los BORRA por drift, sin
 * decir nada. Este script los vuelve a poner.
 *
 * Todo lo que aplica es idempotente, asi que correrlo mil veces da lo mismo.
 *
 * Uso:  node scripts/post-push.mjs
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const raiz = join(dirname(fileURLToPath(import.meta.url)), "..");
const archivo = join(raiz, "prisma", "sql", "reglas.sql");

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("[post-push] Falta DATABASE_URL.");
  process.exit(1);
}

const sql = readFileSync(archivo, "utf8");
const cliente = new pg.Client({ connectionString: url });

try {
  await cliente.connect();

  // Todo en UNA transaccion: si algo falla, la base queda como estaba en vez de
  // con la mitad de las reglas puestas, que es el estado dificil de diagnosticar.
  await cliente.query("BEGIN");
  await cliente.query(sql);
  await cliente.query("COMMIT");

  // Se cuenta lo que quedo, no se confia en que el script "corrio bien": el
  // objetivo es que las reglas ESTEN, no que el archivo se haya ejecutado.
  const { rows } = await cliente.query(`
    SELECT
      (SELECT count(*) FROM pg_trigger WHERE NOT tgisinternal)                              AS triggers,
      (SELECT count(*) FROM pg_constraint WHERE conname = 'appointments_identifies_someone') AS checks,
      (SELECT count(*) FROM pg_indexes
        WHERE schemaname = 'public' AND indexdef ILIKE '%WHERE%')                            AS indices_parciales,
      (SELECT count(*) FROM pg_proc p
         JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname = 'public' AND p.proname = 'normalize_phone')                        AS normalize_phone
  `);
  const r = rows[0];

  console.log(
    `[post-push] triggers: ${r.triggers}/3 | CHECK: ${r.checks}/1 | ` +
      `indices parciales: ${r.indices_parciales}/4 | normalize_phone: ${r.normalize_phone}/1`,
  );

  const faltan =
    Number(r.triggers) < 3 ||
    Number(r.checks) < 1 ||
    Number(r.indices_parciales) < 4 ||
    Number(r.normalize_phone) < 1;

  if (faltan) {
    // Fallar fuerte y no seguir: si el CHECK no esta, la base acepta turnos sin
    // dueno, y eso no se ve hasta que alguien mira la agenda y encuentra un
    // turno de nadie.
    console.error("[post-push] Falta alguna regla. La app NO deberia arrancar asi.");
    process.exit(1);
  }
} catch (e) {
  await cliente.query("ROLLBACK").catch(() => {});
  console.error("[post-push] Fallo al aplicar las reglas:", e.message);
  process.exit(1);
} finally {
  await cliente.end().catch(() => {});
}
