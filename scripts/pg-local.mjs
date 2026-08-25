/**
 * Arranca y para el Postgres de desarrollo LOCAL.
 *
 * ── POR QUÉ EXISTE ─────────────────────────────────────────────────────────
 *
 * En el VPS la base es el contenedor `db` y la levanta compose. En una máquina
 * de desarrollo sin Docker no hay tal cosa, así que Shiraf usa un cluster
 * propio hecho con `initdb`.
 *
 * Es un cluster APARTE del PostgreSQL que pueda estar instalado como servicio
 * de Windows: escucha en otro puerto y tiene sus propios datos y su propio
 * superusuario. Eso es a propósito — así no hace falta la contraseña de
 * superusuario del otro (que puede no saberse) y no se le toca nada.
 *
 * La contra de no ser un servicio es que no arranca solo al prender la máquina.
 * Para eso está esto:
 *
 *     npm run db:local          arranca
 *     npm run db:local:stop     para
 *     npm run db:local:status   dice si está corriendo
 *
 * ── ARMAR EL CLUSTER LA PRIMERA VEZ ────────────────────────────────────────
 *
 * Este script NO lo crea, sólo lo prende y lo apaga. Si todavía no existe:
 *
 *     initdb -D <carpeta> -U shiraf --pwfile=<archivo con la contraseña> \
 *            --encoding=UTF8 --locale=C -A scram-sha-256
 *     pg_ctl -D <carpeta> -o "-p 5433" -l <log> start
 *     createdb -h localhost -p 5433 -U shiraf shiraf
 *     npm run db:sync && npm run db:seed
 *
 * La contraseña tiene que ser la misma que la del DATABASE_URL del .env.
 */
import { spawnSync } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

// Se puede pisar con PGDATA_LOCAL si el cluster está en otro lado.
const DATA = process.env["PGDATA_LOCAL"] ?? join(homedir(), ".shiraf-pg");
const PUERTO = process.env["PGPORT_LOCAL"] ?? "5433";
const LOG = join(DATA, "servidor.log");

/**
 * Encuentra `pg_ctl`.
 *
 * Primero en el PATH, que es lo normal en Linux y macOS. En Windows el
 * instalador de EDB no lo agrega, así que se busca en las instalaciones de
 * `C:\Program Files\PostgreSQL\<version>\bin`, de la más nueva a la más vieja.
 */
function buscarPgCtl() {
  const enPath = spawnSync(process.platform === "win32" ? "where" : "which", ["pg_ctl"], {
    encoding: "utf8",
  });
  if (enPath.status === 0) return enPath.stdout.split(/\r?\n/)[0].trim();

  const raiz = "C:\\Program Files\\PostgreSQL";
  if (!existsSync(raiz)) return null;
  const versiones = readdirSync(raiz)
    .filter((v) => /^\d+$/.test(v))
    .sort((a, b) => Number(b) - Number(a));
  for (const v of versiones) {
    const p = join(raiz, v, "bin", "pg_ctl.exe");
    if (existsSync(p)) return p;
  }
  return null;
}

const pgCtl = buscarPgCtl();
if (!pgCtl) {
  console.error("[pg-local] No encuentro pg_ctl. ¿Está instalado PostgreSQL?");
  process.exit(1);
}
if (!existsSync(DATA)) {
  console.error(`[pg-local] No existe el cluster en ${DATA}.`);
  console.error("[pg-local] Ver el encabezado de este archivo para armarlo la primera vez.");
  process.exit(1);
}

const accion = process.argv[2] ?? "start";
const args =
  accion === "start"
    ? ["-D", DATA, "-o", `-p ${PUERTO}`, "-l", LOG, "-w", "start"]
    : accion === "stop"
      ? ["-D", DATA, "-m", "fast", "stop"]
      : ["-D", DATA, "status"];

// `stdio: inherit` y no capturar la salida: en Windows, si el proceso hijo
// hereda una tubería, el servidor recién arrancado la deja abierta y pg_ctl no
// vuelve nunca. Con las consolas heredadas tal cual, vuelve al terminar.
const r = spawnSync(pgCtl, args, { stdio: "inherit" });

if (accion === "start" && r.status === 0) {
  console.log(`[pg-local] Postgres escuchando en localhost:${PUERTO} — datos en ${DATA}`);
  console.log(`[pg-local] El registro del servidor va a ${LOG}`);
}
process.exit(r.status ?? 1);
