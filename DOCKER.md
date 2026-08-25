# Shiraf en Docker

Cuatro contenedores. Antes era uno solo que le hablaba a Supabase; desde el
21/8/2026 la base es propia y viaja acá adentro.

```
db  ──sano──>  migrate  ──termina bien──>  app
└── pg-backup
```

| Servicio    | Qué hace                                                                 |
| ----------- | ------------------------------------------------------------------------ |
| `db`        | Postgres 17. **El único que guarda algo**, en el volumen `shiraf-pgdata` |
| `migrate`   | Sincroniza el esquema y aplica las reglas SQL. Corre una vez y se apaga  |
| `app`       | El sitio. Sin estado, `read_only`, publica en `127.0.0.1:3000`           |
| `pg-backup` | Volcado diario a `./backups`, rotación 7/4/6                             |

**`migrate` es el que hay que mirar si algo no arranca.** Hace `prisma db push`
y después `scripts/post-push.mjs`, que vuelve a poner los 3 triggers, el `CHECK`
de turnos, `normalize_phone` y los 4 índices parciales — y **verifica que estén**.
Si falta alguno sale con error y `app` no llega a levantar. Es a propósito: sin
el CHECK, la base acepta turnos sin dueño y eso no se ve hasta que alguien mira
la agenda.

## Requisitos

Docker Engine 24+ con el plugin `compose`. En el VPS:

```sh
curl -fsSL https://get.docker.com | sh
```

## Levantar

Con el `.env` presente en la raíz. Las que no pueden faltar son
`POSTGRES_PASSWORD`, `JWT_SECRET`, `APP_URL` y las cuatro de Cloudinary — el
compose corta el arranque si alguna no está. Ver `.env.example`.

**Para desarrollo** hay un compose aparte, con el código montado en vivo:

```sh
docker compose -f docker-compose.dev.yml up     # http://localhost:8081
```

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
imagen igual se construye pero el sitio queda **sin una sola foto**, que es un
síntoma que tarda en atribuirse al build.

Hoy sobrevive **una sola**: `VITE_CLOUDINARY_CLOUD_NAME`. Cambiarla exige
reconstruir la imagen, no alcanza con reiniciar el contenedor.

⚠️ Docker **ignora en silencio** cualquier build arg que el Dockerfile no
declare con `ARG`. Ese fue un bug real: el compose mandaba el cloud name, el
Dockerfile no lo declaraba, y la imagen se venía armando con el valor vacío.

El resto —`DATABASE_URL`, `JWT_SECRET`, `APP_URL`, las de Cloudinary del lado
servidor, `RESEND_API_KEY`— son de runtime y van en `environment`.

## La base: backups y restauración

El contenedor `pg-backup` deja un `.sql.gz` diario en `./backups`, con rotación
de 7 diarios, 4 semanales y 6 mensuales. Es el mismo que usa `Ecommerce_mm`.

⚠️ **Dos cosas que hay que hacer y no las hace el contenedor:**

1. **Copiar los backups fuera del VPS.** Un backup en el mismo disco que la base
   no es un backup: si se pierde el disco, se pierden los dos.
2. **Restaurar uno, al menos una vez.** Un backup que nunca se restauró es una
   suposición, no una copia de seguridad.

```sh
# restaurar sobre una base vacía
gunzip -c backups/shiraf-2026-08-21.sql.gz | docker exec -i shiraf-db psql -U shiraf -d shiraf
```

**A mano, cuando haga falta:**

```sh
docker exec shiraf-db pg_dump -U shiraf shiraf | gzip > shiraf-$(date +%F).sql.gz
```

## Tocar el esquema

Se edita `prisma/schema.prisma` y se sincroniza. **Nunca `db push` solo** — sin
el post-push la base queda sin las reglas:

```sh
docker compose run --rm app sh -c   "node node_modules/prisma/build/index.js db push && node scripts/post-push.mjs"
```

En el VPS eso ya pasa solo en cada `docker compose up`, porque es lo que hace el
servicio `migrate`.

### Una vez, después del push que agrega `services.slug` (23/8/2026)

La columna entra vacía —`db push` no puede darle valor a filas que ya existen—
y hasta que se rellene, la ficha de cada tratamiento cae al UUID en la URL. Se
arregla con un comando, que no hace nada si ya está hecho:

```sh
docker compose run --rm app bun scripts/rellenar-slugs.ts
```

No hace falta repetirlo: de ahí en más el slug lo escribe el panel al crear y al
editar un tratamiento.
