# syntax=docker/dockerfile:1

# Shiraf — imagen de producción.
#
# Tres detalles que no son obvios y explican cómo está armado esto:
#
# 1. El build por defecto del proyecto apunta a Cloudflare Workers (es a donde
#    publica Lovable). Ese artefacto no corre en un contenedor Node, así que acá
#    forzamos el preset `node-server` de Nitro vía variable de entorno. Se hace
#    con env var a propósito: tocar vite.config.ts rompería el deploy de Lovable.
#
# 2. Las variables VITE_* se hornean en el bundle del navegador EN TIEMPO DE
#    BUILD, no de runtime. Por eso entran como build args. Si sólo las pasás en
#    `environment`, el frontend queda sin configurar y falla al arrancar.
#
# 3. Prisma 7 genera un compilador en WASM, no un binario nativo por
#    plataforma. Eso simplifica bastante esta imagen y hay que saberlo, porque
#    todo lo que se lee sobre dockerizar Prisma —binaryTargets, la pelea con
#    musl, instalar openssl— es de la versión 6 para atrás y acá ya no aplica.
#    El corolario práctico es que el cliente generado se puede copiar de una
#    etapa a otra sin preocuparse por el sistema operativo de cada una.
#
#    Lo que sí cambió a cambio: el WASM arma el SQL pero no se conecta. De eso
#    se encarga @prisma/adapter-pg, que es una dependencia normal.

# ---------- deps ----------
# bun porque bun.lock es el lockfile versionado del repo. Un package-lock.json
# generado en Windows suele romper acá por las dependencias opcionales de
# rollup/esbuild, que son específicas de plataforma.
FROM oven/bun:1-alpine AS deps
WORKDIR /app
COPY package.json bun.lock bunfig.toml ./
RUN bun install --frozen-lockfile

# ---------- prod-deps ----------
# Las MISMAS dependencias pero sin las de desarrollo, para que la imagen final
# no cargue con vite, eslint ni typescript.
#
# Existe esta etapa en vez de ir copiando paquetes sueltos por nombre desde la
# etapa de build. Eso último se intentó y está mal: `pg` arrastra ocho
# dependencias transitivas (pg-pool, pg-types, postgres-array, postgres-date…) y
# la lista habría que mantenerla a mano. El día que una versión sume una novena,
# el build sigue pasando y la app se cae al conectarse. El gestor de paquetes ya
# sabe resolver eso; hay que dejarlo hacerlo.
FROM oven/bun:1-alpine AS prod-deps
WORKDIR /app
COPY package.json bun.lock bunfig.toml ./
RUN bun install --frozen-lockfile --production

# ---------- build ----------
FROM oven/bun:1-alpine AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .

# El cloud name de Cloudinary es lo único VITE_* que sobrevivió a la salida de
# Supabase. Es público —aparece en la URL de cada foto servida—, pero tiene que
# estar horneado o el sitio queda sin imágenes.
#
# ⚠️ Este ARG faltaba y el compose ya lo mandaba: Docker ignora en silencio todo
#    build arg que el Dockerfile no declare, así que la imagen se venía armando
#    con el cloud name vacío.
ARG VITE_CLOUDINARY_CLOUD_NAME

ENV VITE_CLOUDINARY_CLOUD_NAME=$VITE_CLOUDINARY_CLOUD_NAME \
    NITRO_PRESET=node-server

# Fallar acá y no en runtime: sin esto la imagen compila igual y el sitio queda
# sin una sola foto, que es un síntoma que tarda en atribuirse al build.
RUN if [ -z "$VITE_CLOUDINARY_CLOUD_NAME" ]; then \
      echo "ERROR: falta el build-arg VITE_CLOUDINARY_CLOUD_NAME" >&2; exit 1; \
    fi

# ⚠️ ANTES del build, no después: el código del servidor importa @prisma/client,
# y ese paquete está vacío hasta que generate lo escribe.
RUN bunx prisma generate

RUN bun run build

# ---------- runtime ----------
# node:22-slim. La razón original era esquivar la pelea de Prisma con musl y
# openssl en alpine; con el compilador WASM de Prisma 7 ese problema ya no
# existe, así que alpine volvería a ser viable. Se deja slim igual: son unas
# decenas de MB, y a cambio se evita reabrir una discusión ya cerrada.
FROM node:22-slim AS runtime
WORKDIR /app

# Acá iba la instalación de openssl:
#
#   RUN apt-get update \
#    && apt-get install -y --no-install-recommends openssl \
#    && rm -rf /var/lib/apt/lists/*
#
# Se comenta y no se borra para dejar constancia de por qué NO hace falta: era
# para el motor nativo de Prisma ≤6. El WASM de la 7 no enlaza contra libssl, y
# quien se conecta de verdad es `pg`, que es JavaScript puro. Verificado: el
# cliente generado no trae ningún .so ni .node.

ENV NODE_ENV=production \
    PORT=3000 \
    HOST=0.0.0.0

COPY --from=build --chown=node:node /app/.output ./.output

# Lo de Prisma, y cada cosa por un motivo distinto:
#
#   .prisma/ y @prisma/client · el cliente generado, con el .wasm adentro. Es lo
#                               que usa la APP para consultar.
#   adapter-pg y pg           · quien abre la conexión de verdad. El WASM arma
#                               el SQL y nada más; sin el adaptador,
#                               `new PrismaClient()` ni siquiera se instancia.
#   prisma/ y prisma.config   · para que el servicio `migrate` del compose pueda
#                               correr `migrate deploy`. Sin la carpeta prisma/
#                               no tiene migraciones que aplicar, y sin el
#                               config no sabe a qué base conectarse — en 7 la
#                               URL ya no vive en schema.prisma.
# Las dependencias de producción resueltas por bun: entran pg y
# @prisma/adapter-pg con todo lo que arrastran, y entra `prisma` —el CLI— que
# está en `dependencies` y no en `devDependencies` justamente porque el servicio
# `migrate` del compose lo necesita adentro de esta imagen.
COPY --from=prod-deps --chown=node:node /app/node_modules ./node_modules

# El cliente generado va DESPUÉS y pisa lo anterior: `bun install` deja
# @prisma/client vacío —se llena recién con `prisma generate`, que corrió en la
# etapa de build— y .prisma/ directamente no existe hasta entonces. Acá adentro
# viaja el .wasm, que es el mismo archivo para cualquier sistema operativo.
COPY --from=build --chown=node:node /app/node_modules/.prisma        ./node_modules/.prisma
COPY --from=build --chown=node:node /app/node_modules/@prisma/client ./node_modules/@prisma/client

# Para el servicio `migrate`: las migraciones y, en Prisma 7, el config —que es
# donde vive la URL de la base desde que schema.prisma dejó de aceptarla.
COPY --from=build --chown=node:node /app/prisma           ./prisma
COPY --from=build --chown=node:node /app/prisma.config.ts ./prisma.config.ts
COPY --from=build --chown=node:node /app/package.json     ./package.json

USER node
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", ".output/server/index.mjs"]
