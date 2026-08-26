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
 *
 * ── ⚠️ EN WINDOWS, LA BASE SE CAE SI LA CONSOLA RECIBE UNA SEÑAL ──────────
 *
 * Esto arranca el servidor con `detached`, que alcanza para que sobreviva a que
 * ESTE script termine, pero NO para sacarlo de la consola: en Windows el
 * proceso sigue en el mismo grupo, así que un Ctrl+C —o cerrar la terminal, o
 * cualquier herramienta que mande una señal al grupo— se lo lleva puesto. En el
 * registro aparece como `0xC000013A`, o directamente como un corte sin mensaje.
 *
 * Pasó tres veces durante el desarrollo y el síntoma NO apunta para nada acá:
 * la app sigue respondiendo 200 en todas las páginas y lo único que falla es el
 * login, con un 500. Si ves eso, lo primero que hay que mirar es
 * `npm run db:local:status`.
 *
 * Se intentó desprenderlo de verdad con `Start-Process` de PowerShell —que a
 * mano funciona— pero lanzado desde Node no hace nada y no informa ningún
 * error, así que no sirve como solución.
 *
 * La salida definitiva es registrarlo como servicio de Windows, que necesita
 * permisos de administrador:
 *
 *     pg_ctl register -N shiraf-pg -D <carpeta> -o "-p 5433"
 *     net start shiraf-pg
 *
 * Con eso arranca solo al prender la máquina y ninguna consola lo puede matar.
 */
import { spawn, spawnSync } from "node:child_process";
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

/**
 * Arrancar es distinto de parar y de preguntar, y por una sola razón: en Windows
 * `pg_ctl start` NO devuelve el control.
 *
 * El servidor que deja andando hereda los descriptores de la consola y no los
 * suelta, así que `pg_ctl` se queda esperando un final que no llega —con `-w` y
 * sin `-w` igual—. La primera versión de este script usaba `spawnSync` para las
 * tres acciones y colgaba el terminal para siempre: el servidor quedaba
 * perfectamente arriba y la orden no terminaba nunca.
 *
 * Así que arrancar va DESPRENDIDO —`detached` y `stdio: "ignore"`, que cortan esa
 * herencia— y después se pregunta con `pg_isready` hasta que conteste. Eso además
 * da una respuesta más honesta: no dice «arrancó» porque el comando salió bien,
 * sino porque la base contestó.
 */
if (accion === "start") {
  /**
   * En Windows NO alcanza con `detached`.
   *
   * Se probó y falla: el servidor queda en la misma CONSOLA que lo lanzó, así
   * que cualquier Ctrl+C —o el cierre de la terminal, o que el proceso padre
   * reciba una señal— se lo lleva puesto. En el registro aparece como
   * `0xC000013A`, o directamente como un corte sin mensaje. Pasó tres veces
   * durante el desarrollo: la base se caía sola y el síntoma era un 500 en el
   * login, que no apunta para nada a esto.
   *
   * `Start-Process` de PowerShell sí lo desprende de verdad: arranca el proceso
   * fuera de esta consola, así que las señales de acá no lo alcanzan.
   *
   * En Linux y macOS `detached: true` hace exactamente eso mismo y no hace falta
   * PowerShell.
   */
  const hijo = spawn(pgCtl, ["-D", DATA, "-o", "-p " + PUERTO, "-l", LOG, "start"], {
    detached: true,
    stdio: "ignore",
  });
  hijo.unref();
  const isReady = pgCtl.replace("pg_ctl", "pg_isready");
  // 60 y no 30: si la base venía de un corte sucio, primero recupera —se midió
  // en 25 segundos— y recién ahí acepta conexiones.
  const hasta = Date.now() + 60_000;
  for (;;) {
    const r = spawnSync(isReady, ["-h", "localhost", "-p", PUERTO], { stdio: "ignore" });
    if (r.status === 0) {
      console.log(`[pg-local] Postgres escuchando en localhost:${PUERTO} — datos en ${DATA}`);
      console.log(`[pg-local] El registro del servidor va a ${LOG}`);
      process.exit(0);
    }
    if (Date.now() > hasta) {
      console.error(`[pg-local] No contestó en 60 segundos. Mirá ${LOG}.`);
      process.exit(1);
    }
    // Espera corta entre intentos. Son un par de vueltas: no vale traer una
    // dependencia para dormir medio segundo.
    spawnSync(process.execPath, ["-e", "setTimeout(()=>{},400)"], { stdio: "ignore" });
  }
}

// Parar y preguntar sí terminan solos: no dejan ningún proceso atrás.
const args = accion === "stop" ? ["-D", DATA, "-m", "fast", "stop"] : ["-D", DATA, "status"];
const r = spawnSync(pgCtl, args, { stdio: "inherit" });
process.exit(r.status ?? 1);
