# syntax=docker/dockerfile:1

# Shiraf — imagen de producción.
#
# Dos detalles que no son obvios y explican cómo está armado esto:
#
# 1. El build por defecto del proyecto apunta a Cloudflare Workers (es a donde
#    publica Lovable). Ese artefacto no corre en un contenedor Node, así que acá
#    forzamos el preset `node-server` de Nitro vía variable de entorno. Se hace
#    con env var a propósito: tocar vite.config.ts rompería el deploy de Lovable.
#
# 2. Las variables VITE_* se hornean en el bundle del navegador EN TIEMPO DE
#    BUILD, no de runtime. Por eso entran como build args. Si sólo las pasás en
#    `environment`, el frontend queda sin configurar y falla al arrancar.

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

ARG VITE_SUPABASE_URL
ARG VITE_SUPABASE_PUBLISHABLE_KEY
ARG VITE_SUPABASE_PROJECT_ID

ENV VITE_SUPABASE_URL=$VITE_SUPABASE_URL \
    VITE_SUPABASE_PUBLISHABLE_KEY=$VITE_SUPABASE_PUBLISHABLE_KEY \
    VITE_SUPABASE_PROJECT_ID=$VITE_SUPABASE_PROJECT_ID \
    NITRO_PRESET=node-server

# Fallar acá y no en runtime: sin estas dos, la imagen compila igual pero la app
# tira "Missing Supabase environment variable(s)" en el navegador.
RUN if [ -z "$VITE_SUPABASE_URL" ]; then \
      echo "ERROR: falta el build-arg VITE_SUPABASE_URL" >&2; exit 1; \
    fi; \
    if [ -z "$VITE_SUPABASE_PUBLISHABLE_KEY" ]; then \
      echo "ERROR: falta el build-arg VITE_SUPABASE_PUBLISHABLE_KEY" >&2; exit 1; \
    fi

RUN bun run build

# ---------- runtime ----------
# node y no bun: el preset node-server emite ESM plano para Node y es el runtime
# que Nitro tiene como objetivo. La imagen final sólo lleva .output, sin
# node_modules ni código fuente.
FROM node:22-alpine AS runtime
WORKDIR /app

ENV NODE_ENV=production \
    PORT=3000 \
    HOST=0.0.0.0

COPY --from=build --chown=node:node /app/.output ./.output

USER node
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", ".output/server/index.mjs"]
