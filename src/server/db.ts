import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

/**
 * La única conexión a la base.
 *
 * ── 🔴 ESTE ARCHIVO NO SE IMPORTA DESDE UNA PANTALLA ───────────────────────
 *
 * Ni desde `src/routes/`, ni desde `src/components/`, ni desde `src/hooks/`.
 * Hay un `no-restricted-imports` en eslint.config.js que lo hace cumplir, y no
 * está de adorno: es lo único que sostiene la seguridad después de salir de
 * Supabase.
 *
 * El motivo, dicho una vez: mientras la base era Supabase, quien decidía qué
 * podía ver cada persona era Postgres, con 39 policies. Si el código se olvidaba
 * un chequeo, la base lo frenaba igual. Acá esa red no existe — esta conexión es
 * dueña de todo y no le pregunta a nadie. Lo que decide ahora es el código, y
 * por eso el acceso a datos vive sólo en `src/server/**`, donde toda función
 * empieza verificando la sesión y el permiso.
 *
 * A cambio se ganó algo real: el navegador dejó de tener una conexión directa a
 * la base. Antes la clave publishable viajaba en el bundle y cualquiera podía
 * intentar leer `appointments`; lo único que lo frenaba era la RLS. Ahora sólo
 * puede llamar las funciones que existen.
 *
 * ── POR QUÉ HACE FALTA EL ADAPTADOR ────────────────────────────────────────
 *
 * Prisma 7 dejó de traer un motor nativo: el que arma las consultas es un
 * compilador en WASM, que no sabe hablar TCP. Quien abre la conexión de verdad
 * es `pg`, a través de este adaptador. Sin él, `new PrismaClient()` ni siquiera
 * se instancia — tira "A driver adapter is required to connect to your
 * database".
 *
 * ── POR QUÉ EL SINGLETON EN globalThis ─────────────────────────────────────
 *
 * En desarrollo, Vite recarga los módulos en caliente en cada guardado. Sin
 * esto, cada recarga abriría un pool nuevo y dejaría el anterior colgado; a los
 * veinte guardados Postgres empieza a rechazar conexiones por
 * `too many clients`. En producción el módulo se carga una vez y la rama del
 * globalThis no se usa.
 */

function crear(): PrismaClient {
  const connectionString = process.env["DATABASE_URL"];

  if (!connectionString) {
    // Explícito y temprano. Sin esto el error aparece recién en la primera
    // consulta, con un mensaje de `pg` que no menciona la variable que falta.
    throw new Error(
      "Falta DATABASE_URL. En desarrollo la pone docker-compose.dev.yml; en producción, el docker-compose.yml. Ver .env.example.",
    );
  }

  return new PrismaClient({
    adapter: new PrismaPg({ connectionString }),
  });
}

const globalParaPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma: PrismaClient = globalParaPrisma.prisma ?? crear();

if (process.env["NODE_ENV"] !== "production") {
  globalParaPrisma.prisma = prisma;
}
