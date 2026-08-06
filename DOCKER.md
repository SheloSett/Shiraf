# Shiraf en Docker

La app corre como un único contenedor sin estado que habla con Supabase. No
guarda nada en disco: todos los datos viven en Supabase.

## Requisitos

Docker Engine 24+ con el plugin `compose`. En el VPS:

```sh
curl -fsSL https://get.docker.com | sh
```

## Levantar

Con el `.env` presente en la raíz (ya trae las 6 variables):

```sh
docker compose up -d --build
docker compose logs -f app
```

Queda escuchando en `127.0.0.1:3000`. Para probar en tu máquina, verificá que
responda:

```sh
curl -I http://localhost:3000/
```

## Deploy en el VPS

```sh
git clone <repo> shiraf && cd shiraf
cp /ruta/a/tu/.env .env        # el .env NO va al repo
docker compose up -d --build
```

Después, un `server` block de nginx junto a los otros dos sitios:

```nginx
server {
    listen 443 ssl http2;
    server_name shiraf.tudominio.com;

    # ssl_certificate ... (certbot)

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Host              $host;
        proxy_set_header X-Real-IP         $remote_addr;
        proxy_set_header X-Forwarded-For   $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header Upgrade           $http_upgrade;
        proxy_set_header Connection        "upgrade";
    }
}
```

Actualizar a una versión nueva:

```sh
git pull && docker compose up -d --build
```

## Dos cosas que conviene entender antes de tocar esto

**El preset de Nitro.** El build por defecto del proyecto genera un Worker de
Cloudflare, que es a donde publica Lovable — ese artefacto no arranca en un
contenedor Node. El `Dockerfile` fuerza `NITRO_PRESET=node-server` por variable
de entorno, a propósito: si lo pusieras en `vite.config.ts` romperías el deploy
de Lovable. Los dos destinos conviven porque el override vive sólo acá.

**Las variables `VITE_*` son de build, no de runtime.** Vite las reemplaza por su
valor literal dentro del bundle del navegador cuando compila. Por eso van como
`args` en el compose y no como `environment`. Si las movés a `environment`, la
imagen igual se construye pero la app rompe en el navegador con
`Missing Supabase environment variable(s)`. Cambiar de proyecto Supabase exige
reconstruir la imagen, no alcanza con reiniciar el contenedor.

Las `SUPABASE_*` sin prefijo sí son de runtime: las lee el cliente del lado
servidor durante el SSR.

## Si más adelante self-hosteás Supabase

La app usa **sólo auth + PostgREST** — nada de storage, realtime, edge functions
ni RPC. Así que no necesitás el stack completo de Supabase (~10 contenedores):
alcanza con `postgres`, `gotrue`, `postgrest` y `kong`, que rondan 1,5 GB de RAM.

Del lado de la app el cambio es sólo apuntar `VITE_SUPABASE_URL` a tu dominio y
reconstruir. Lo que hay que resolver del otro lado es el SMTP para los mails de
confirmación y reseteo de contraseña, y los backups de Postgres.
