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
    server_name shiraf.com.ar;

    # ssl_certificate ... (certbot)

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Host              $host;

        # 🔴 LAS DOS CON $remote_addr, Y NO ES LO MISMO QUE $proxy_add_x_forwarded_for.
        #
        # $remote_addr PISA el header con la IP de quien se conectó.
        # $proxy_add_x_forwarded_for AGREGA esa IP al final de lo que ya venía —
        # y lo que "ya venía" lo escribió quien llama, porque X-Forwarded-For es
        # un header común y corriente que cualquiera puede mandar.
        #
        # Acá decía $proxy_add_x_forwarded_for, y con eso el freno a los intentos
        # de login quedaba salteable AUNQUE nginx estuviera puesto: bastaba mandar
        # "X-Forwarded-For: loquesea" para que el contador viera una persona nueva
        # en cada intento. Con $remote_addr eso no sobrevive.
        #
        # Si algún día hace falta la cadena completa de proxies, se vuelve a
        # $proxy_add_x_forwarded_for PERO leyendo el valor desde la derecha, no
        # desde la izquierda. Hoy no hace falta: el limitador lee X-Real-IP.
        proxy_set_header X-Real-IP         $remote_addr;
        proxy_set_header X-Forwarded-For   $remote_addr;

        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header Upgrade           $http_upgrade;
        proxy_set_header Connection        "upgrade";
    }
}
```

Y en el `.env` del servidor, las tres que van juntas con esto:

```sh
TRUST_PROXY=loopback          # de dónde sale la IP de quien llama
APP_URL=https://shiraf.com.ar # de acá sale el flag Secure de la cookie
APP_BIND=127.0.0.1            # que no se le pueda pegar al contenedor salteando nginx
```

Las tres o ninguna. Con `APP_BIND` en `0.0.0.0` el contenedor sigue expuesto en
el 3000 y se puede entrar salteando nginx —sin HTTPS y sin que `TRUST_PROXY`
sirva de nada—, y sin `APP_URL` en `https://` el sitio queda con certificado y
la cookie de sesión viajando sin el flag `Secure`.

### Si en vez de nginx va Cloudflare

Sirve igual y ahorra el certbot, pero **no alcanza con prender la nube naranja**.
Tres cosas, y la tercera es la que se olvida:

1. **SSL/TLS en «Full (strict)»**, nunca en «Flexible». En Flexible, Cloudflare
   habla HTTPS con la clienta y **HTTP con el VPS**: el tramo donde viajan las
   contraseñas queda igual de descubierto que hoy, con un candado en la barra
   que dice lo contrario. Necesita un certificado en el origen — sirve un
   _Origin Certificate_ de Cloudflare, que dura 15 años y no pide certbot.

2. **`TRUST_PROXY=cloudflare`** en el `.env`, más `APP_URL=https://…`.

3. 🔴 **Cerrarle el origen a todo lo que no sea Cloudflare.** La IP del VPS es
   pública y está escrita en `TODO.md`. Si el puerto queda abierto, cualquiera
   le pega directo y manda su propio `CF-Connecting-IP`, que es exactamente el
   header en el que el limitador va a confiar. O sea que sin este paso, poner
   Cloudflare **empeora** el problema en vez de arreglarlo.

   Se hace con el firewall del VPS, dejando entrar al 443 sólo desde los rangos
   publicados de Cloudflare (`cloudflare.com/ips`), o con un Cloudflare Tunnel,
   que no abre ningún puerto.

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
servidor, `SMTP_USER` y `SMTP_PASS`— son de runtime y van en `environment`.

## ⚠️ Lo que anda en tu máquina y falla en el contenedor

El 27/8/2026 el mail de recuperar contraseña falló **dos veces seguidas** en el
VPS, andando perfecto en desarrollo. Los dos bugs eran de clases distintas y
ninguno se podía ver sin levantar la imagen. Van anotados porque la próxima vez
que algo funcione acá y falle allá, es probable que sea uno de estos dos.

**Siempre empezar por el log.** Las dos veces el mensaje decía exactamente qué
pasaba, y sin él cada uno era una tarde:

```sh
docker compose logs app | grep -i mail
```

### 1. Un archivo que el repo tiene y la imagen no

> `[cuenta] No salió el mail: No se encontró la plantilla del mail.`

La etapa `runtime` del Dockerfile **se arma copiando archivo por archivo**, no
copiando el repo. Cualquier cosa que el código lea del disco en tiempo de
ejecución tiene que estar en esa lista, o no existe adentro del contenedor. En
desarrollo no se nota: ahí `process.cwd()` es la raíz del repo y está todo.

Fue `emails/`, que `plantilla()` lee con `join(process.cwd(), "emails", …)`.

**Antes de agregar cualquier lectura de disco nueva**, agregar el `COPY` en el
mismo commit. Para revisar qué hay adentro:

```sh
docker run --rm --entrypoint sh shiraf-app:latest -c "ls -a /app"
```

### 2. Una variable de entorno definida pero vacía

> `connect ECONNREFUSED 127.0.0.1:587`

El compose mapea las opcionales así:

```yaml
SMTP_HOST: ${SMTP_HOST:-}
```

y `:-` sin nada a la derecha **no deja la variable sin definir: la define
vacía**. En JavaScript eso rompe el patrón más común que hay:

```js
process.env.SMTP_HOST ?? "smtp.gmail.com"; // "" NO cae al default
```

`??` cae con `null` y `undefined`, con `""` no. Así que el valor queda vacío, la
librería de turno lo lee como falsy y usa **su** default — nodemailer, localhost.
Y el error que sale de ahí no menciona ninguna variable de entorno, que es lo
que hace difícil encontrarlo.

En desarrollo es invisible: una variable que no está en el `.env` **no existe**,
así que el `??` funciona.

**Toda variable opcional que venga del compose se lee con `||` o pasando por un
ayudante que trate `""` como ausente.** En `email.service.ts` es `variable()`.
Para ver qué le llega de verdad al contenedor:

```sh
docker compose exec app sh -c 'echo "HOST=[$SMTP_HOST] PORT=[$SMTP_PORT] FROM=[$MAIL_FROM]"'
```

Los corchetes importan: `HOST=[]` y `HOST=` se ven parecido y son cosas
distintas.

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
