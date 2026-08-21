import { defineConfig } from "prisma/config";

/**
 * Configuración de Prisma.
 *
 * ── POR QUÉ EXISTE ESTE ARCHIVO ────────────────────────────────────────────
 *
 * Hasta Prisma 6 la URL de la base vivía adentro de schema.prisma:
 *
 *     datasource db {
 *       provider = "postgresql"
 *       url      = env("DATABASE_URL")   // ← ya no se puede
 *     }
 *
 * Prisma 7 lo prohíbe y falla la validación con P1012. La URL se mudó acá, y el
 * schema.prisma queda declarando sólo el provider.
 *
 * El motivo del cambio es que schema.prisma pasó a ser sólo la forma de los
 * datos, y todo lo que depende del entorno —a qué base apuntás, dónde están las
 * migraciones, cómo se siembra— vive en un archivo de configuración de verdad,
 * que además es TypeScript y se puede leer con el tipo delante.
 *
 * ── QUÉ ESPERA ENCONTRAR ───────────────────────────────────────────────────
 *
 * `DATABASE_URL`. Ojo con el host, que es distinto según desde dónde corras:
 *
 *   · adentro de la red de compose  →  postgresql://shiraf:...@db:5432/shiraf
 *   · desde tu máquina              →  postgresql://shiraf:...@localhost:5432/shiraf
 *
 * El `docker-compose.dev.yml` la pisa a propósito con la primera, para que el
 * .env pueda tener la segunda sin que se pisen. Es el error más frecuente de
 * todo el armado y el mensaje —getaddrinfo ENOTFOUND db— no lo sugiere.
 */
export default defineConfig({
  schema: "prisma/schema.prisma",

  migrations: {
    path: "prisma/migrations",
  },

  // Sólo lo usan los comandos que tocan la base: migrate, db pull, studio. La
  // app en runtime NO lee esto — se conecta por el adaptador, ver src/lib/db.ts
  // cuando se escriba en la Fase 5.
  //
  // ⚠️ `process.env.DATABASE_URL` y NO el helper `env("DATABASE_URL")` de
  //    prisma/config. Parece lo mismo y no lo es: el helper TIRA si la variable
  //    no está, y este archivo se carga en TODOS los comandos, incluido
  //    `prisma generate`.
  //
  //    `generate` no necesita la base para nada —sólo lee el schema y escribe el
  //    cliente— pero con el helper fallaba igual, con
  //    "PrismaConfigEnvError: Cannot resolve environment variable: DATABASE_URL".
  //    Eso rompía el `docker build`, donde la variable no existe ni tiene por
  //    qué: la URL de la base no se hornea en una imagen.
  //
  //    Así queda `undefined` cuando no está, que es lo correcto: `generate`
  //    anda igual, y `migrate` —que sí la necesita— se queja solo.
  datasource: {
    url: process.env.DATABASE_URL,
  },
});
