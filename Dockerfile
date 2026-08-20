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
# 3. Prisma NO es sólo JavaScript: lleva un motor nativo por plataforma. La
#    etapa de build es alpine y la de runtime es debian, así que el motor que
#    hace falta en runtime hay que pedirlo explícitamente en schema.prisma
#    (binaryTargets). Está explicado ahí.

# ---------- deps ----------
# bun porque bun.lock es el lockfile versionado del repo. Un package-lock.json
# generado en Windows suele romper acá por las dependencias opcionales de
# rollup/esbuild, que son específicas de plataforma.
FROM oven/bun:1-alpine AS deps
WORKDIR /app
COPY package.json bun.lock bunfig.toml ./
RUN bun install --frozen-lockfile

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
# y ese paquete no existe hasta que generate lo escribe. Acá se bajan los tres
# motores de binaryTargets, incluido el de debian que usa la etapa de runtime.
RUN bunx prisma generate

RUN bun run build

# ---------- runtime ----------
# node:22-slim y no alpine, a propósito. Prisma sobre musl es un problema
# clásico: hay que pelearse con la versión de openssl y el modo de fallar es
# oscuro. Debian pesa unas decenas de MB más y ese problema no existe.
FROM node:22-slim AS runtime
WORKDIR /app

# Prisma necesita libssl para su motor de consultas. node:22-slim no la trae.
RUN apt-get update \
 && apt-get install -y --no-install-recommends openssl \
 && rm -rf /var/lib/apt/lists/*

ENV NODE_ENV=production \
    PORT=3000 \
    HOST=0.0.0.0

COPY --from=build --chown=node:node /app/.output ./.output

# Las cuatro de Prisma, y cada una por un motivo distinto:
#   .prisma y @prisma/client · para que la APP pueda consultar
#   prisma y prisma/         · para que el servicio `migrate` del compose pueda
#                              correr `migrate deploy`. Sin la carpeta prisma/ no
#                              tiene migraciones que aplicar.
COPY --from=build --chown=node:node /app/node_modules/.prisma        ./node_modules/.prisma
COPY --from=build --chown=node:node /app/node_modules/@prisma/client ./node_modules/@prisma/client
COPY --from=build --chown=node:node /app/node_modules/prisma         ./node_modules/prisma
COPY --from=build --chown=node:node /app/prisma                      ./prisma

USER node
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", ".output/server/index.mjs"]
