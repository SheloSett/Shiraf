/**
 * Respaldo y restauracion de la base de DESARROLLO.
 *
 * ── POR QUE EXISTE ────────────────────────────────────────────────────────
 *
 * El 23/8/2026 se perdio una tarde de trabajo. La duena habia estado probando
 * el panel —cargo tratamientos, profesionales, turnos y fotos— y despues, para
 * dejar la base limpia de unas pruebas mias, corri:
 *
 *     prisma db push --force-reset
 *
 * Eso borra la base entera y la reconstruye. El seed la volvio a llenar con los
 * datos originales, asi que todo parecia normal — y lo que la duena habia
 * cargado encima no estaba mas. No habia respaldo de la base de desarrollo: el
 * contenedor pg-backup existe solo en el compose de produccion.
 *
 * Esto es la red que faltaba. Es chico y sirve para lo unico que hace falta:
 * poder volver atras.
 *
 * ── USO ───────────────────────────────────────────────────────────────────
 *
 *     node scripts/respaldo.mjs guardar          → respaldos/<fecha>.sql
 *     node scripts/respaldo.mjs listar
 *     node scripts/respaldo.mjs restaurar <archivo>
 *
 * Los respaldos van a `respaldos/`, que esta en el .gitignore: son los datos
 * reales del centro y este repositorio es publico.
 *
 * ⚠️ REGLA, para mi y para cualquier sesion que venga: antes de CUALQUIER
 *    operacion destructiva —db push --force-reset, borrar el volumen, un seed
 *    encima de datos existentes— se corre `guardar` primero. Sin excepciones.
 *    Cuesta dos segundos y es la diferencia entre un susto y una tarde perdida.
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const CONTENEDOR = "shiraf-db-dev";
const DIRECTORIO = "respaldos";

const accion = process.argv[2];
const archivo = process.argv[3];

function docker(args, opciones = {}) {
  return execFileSync("docker", args, { encoding: "utf8", maxBuffer: 512 * 1024 * 1024, ...opciones });
}

function vivo() {
  try {
    return docker(["ps", "--filter", `name=${CONTENEDOR}`, "--format", "{{.Names}}"]).trim() !== "";
  } catch {
    return false;
  }
}

if (!vivo()) {
  console.error(`El contenedor ${CONTENEDOR} no esta corriendo.`);
  console.error("  docker compose -f docker-compose.dev.yml up -d db");
  process.exit(1);
}

if (accion === "guardar") {
  mkdirSync(DIRECTORIO, { recursive: true });
  // El nombre lleva fecha y hora: se guarda seguido y no se pisan entre si.
  const sello = new Date().toISOString().slice(0, 16).replace(/[:T]/g, "-");
  const destino = join(DIRECTORIO, `shiraf-${sello}.sql`);

  // --clean --if-exists para que el restore pueda correr sobre una base que ya
  // tiene cosas: primero tira lo que haya, despues carga. Sin eso, restaurar
  // encima falla con "already exists" en la primera tabla.
  const volcado = docker([
    "exec", CONTENEDOR,
    "pg_dump", "-U", "shiraf", "-d", "shiraf", "--clean", "--if-exists",
  ]);

  const fs = await import("node:fs");
  fs.writeFileSync(destino, volcado, "utf8");
  const kb = Math.round(statSync(destino).size / 1024);
  console.log(`Respaldo guardado: ${destino}  (${kb} KB)`);
  process.exit(0);
}

if (accion === "listar") {
  if (!existsSync(DIRECTORIO)) {
    console.log("Todavia no hay ningun respaldo. Corre: node scripts/respaldo.mjs guardar");
    process.exit(0);
  }
  const archivos = readdirSync(DIRECTORIO)
    .filter((f) => f.endsWith(".sql"))
    .sort()
    .reverse();
  if (archivos.length === 0) {
    console.log("Todavia no hay ningun respaldo.");
    process.exit(0);
  }
  console.log("Respaldos, del mas nuevo al mas viejo:");
  for (const f of archivos) {
    const kb = Math.round(statSync(join(DIRECTORIO, f)).size / 1024);
    console.log(`  ${f}  (${kb} KB)`);
  }
  process.exit(0);
}

if (accion === "restaurar") {
  if (!archivo) {
    console.error("Falta el archivo. Corre `listar` para ver cuales hay.");
    process.exit(1);
  }
  const origen = existsSync(archivo) ? archivo : join(DIRECTORIO, archivo);
  if (!existsSync(origen)) {
    console.error(`No existe: ${origen}`);
    process.exit(1);
  }

  const fs = await import("node:fs");
  const sql = fs.readFileSync(origen, "utf8");

  console.log(`Restaurando ${origen}...`);
  docker(["exec", "-i", CONTENEDOR, "psql", "-U", "shiraf", "-d", "shiraf", "-q"], { input: sql });

  // Las reglas que db push no maneja —los triggers, el CHECK, los indices
  // parciales— viajan en el volcado, asi que no hace falta post-push. Pero se
  // verifica igual: restaurar y quedarse sin el candado de los turnos seria
  // peor que no restaurar.
  const control = docker([
    "exec", CONTENEDOR, "psql", "-U", "shiraf", "-d", "shiraf", "-t", "-A", "-c",
    "SELECT (SELECT count(*) FROM pg_trigger WHERE NOT tgisinternal)||' triggers, '||(SELECT count(*) FROM pg_constraint WHERE conname='appointments_identifies_someone')||' CHECK, '||(SELECT count(*) FROM appointments)||' turnos, '||(SELECT count(*) FROM services)||' servicios'",
  ]).trim();
  console.log(`Listo: ${control}`);
  process.exit(0);
}

console.error("Uso: node scripts/respaldo.mjs guardar | listar | restaurar <archivo>");
process.exit(1);
