# Migración de Supabase a Postgres propio + Prisma

> **Para el agente que ejecute esto: leé el archivo entero antes de tocar una
> línea.** Las fases están ordenadas por dependencia y cada una termina con la
> app funcionando. Hay una sección de trampas al final que explica por qué
> varias cosas que parecen obvias están mal.
>
> Escrito el 20/8/2026, contra el estado de la rama
> `panel-solo-para-el-equipo` en el commit `d63787b`.

---

## 0. Qué se decidió y por qué

La dueña del proyecto quiere el sitio corriendo en **su VPS**, con **Postgres en
Docker** y **Prisma** como capa de datos, sin depender de la nube de Supabase.

Se le señaló que Prisma **no elimina las migraciones** —`prisma migrate` genera
archivos `.sql` igual que ahora— y que el riesgo real está en reimplementar a
mano las 96 reglas de seguridad que hoy hace cumplir Postgres. Lo confirmó igual.
**Esa decisión está tomada: no hay que volver a discutirla, hay que ejecutarla
bien.**

Lo que sí cambia el plan es entender dónde está el riesgo, que no es donde
parece:

| | Riesgo |
| --- | --- |
| Reescribir 30 `.from()` en llamadas Prisma | Bajo. Es tedio mecánico. |
| Mover los datos | **Casi nulo.** Son 77 filas en total. |
| Reemplazar el auth | Medio. Hay 4 usuarios; se recrean a mano. |
| **Reemplazar las 61 policies RLS** | **Alto. Acá es donde se filtran datos.** |

Todo el documento está organizado alrededor de proteger esa última fila.

### Un beneficio que no era el motivo, pero llega solo

Hoy hay un bloqueo viejo en el `TODO.md`: **Supabase no deja editar las
plantillas de mail hasta que no configures SMTP propio**, así que a las clientas
les llega un mail en inglés desde `noreply@mail.app.supabase.io`. Las plantillas
en castellano ya están escritas en `supabase/emails/*.html` y hace semanas que no
se pueden usar.

Al migrar, esos mails los manda la app por Resend con esas mismas plantillas. El
bloqueo desaparece sin trabajo extra.

---

## 1. Punto de partida — inventario exacto

Medido sobre el repo y sobre la base, no estimado.

### La base tiene 77 filas

```
profiles                 4     professional_services   11
user_roles               5     professional_schedules  17
user_permissions         6     appointments             4
services                 6     products                 7
service_categories       4     product_categories       3
service_media            6     product_costs            7
professionals            4     stock_movements          3
client_notes             0
```

**Esto es lo que hace viable la migración.** No hay que planificar un traspaso
con ventana de mantenimiento ni verificar integridad de millones de filas: entra
en un JSON de unos pocos KB. Si algo sale mal, se vuelve a cargar.

**4 usuarios**: 1 admin, 1 staff, 2 clientas. **No migres los hashes de
contraseña de GoTrue: recreá las 4 cuentas a mano.** Ahorra el trabajo más
delicado de todos y el costo es un mensaje de WhatsApp a dos clientas.

### El frontend

- **46 archivos** mencionan `supabase`
- **30** llamadas `supabase.from(...)`
- **8** llamadas `supabase.rpc(...)`
- **26** llamadas `supabase.auth.*` — repartidas en: `getUser` (10),
  `getSession` (4), `updateUser` (3), `onAuthStateChange` (3), `signOut` (2),
  `signUp`, `signInWithPassword`, `resetPasswordForEmail`, `getClaims`
- **3** `supabase.storage` — de las cuales **2 están comentadas**. La única viva
  borra fotos viejas del bucket. Las fotos nuevas ya van a Cloudinary.

### La base de datos

- **61 policies RLS** — `appointments` 9, `services` 6, `professionals` 6,
  `profiles` 5, y el resto de a 1-3 por tabla
- **19 funciones** en `public`
- **15 triggers**
- **4 enums**: `app_role`, `app_permission`, `appointment_status`, `media_kind`

---

## 2. La arquitectura de destino

### No hace falta un backend separado

**Esto es lo más importante de toda la sección y lo más fácil de equivocar.** El
primer impulso es levantar un Express o un Nest al lado. **No lo hagas.**

La app ya es TanStack Start con SSR, y **ya tiene una capa de servidor**:
`createServerFn`. Hay tres archivos que la usan hoy y funcionan:

- `src/lib/team.functions.ts` — alta y baja de empleadas
- `src/lib/cloudinary.functions.ts` — firma de subidas
- `src/lib/notifications.functions.ts` — envío de mails

Esos archivos **son el backend**. La migración no agrega un servicio: mueve el
acceso a datos desde "el navegador le pega a PostgREST" hacia "el navegador
llama una server function que usa Prisma".

Un segundo servicio te obligaría a inventar autenticación entre servicios, CORS,
un segundo contenedor y un segundo deploy, para no ganar nada.

### El diagrama, antes y después

```
HOY
  navegador ──supabase-js──> PostgREST ──> Postgres
                                            └── RLS decide qué ve cada uno
  navegador ──createServerFn──> servidor ──service role──> Postgres
                                  (sólo para lo que necesita secretos)

DESPUÉS
  navegador ──createServerFn──> servidor ──Prisma──> Postgres
                                  └── el código decide qué ve cada uno
                                      (NO hay RLS: la conexión es dueña de todo)
```

La consecuencia está en el último renglón y hay que tenerla presente todo el
tiempo: **después de migrar, Postgres deja de protegerte.** Si una server
function se olvida de chequear el permiso, devuelve los datos. Hoy no: hoy la
policy la frena aunque el código esté mal.

Hay una compensación, y es real: **el navegador deja de tener una conexión
directa a la base.** Hoy cualquiera con la clave publishable —que viaja en el
bundle— puede intentar `SELECT * FROM appointments` y lo único que lo detiene es
la RLS. Después, sólo puede llamar las funciones que vos definiste. La superficie
se achica muchísimo.

Pero eso vale **sólo si se respeta una regla, sin excepciones**:

> ### 🔴 LA REGLA
> **Ningún archivo de `src/routes/` ni de `src/components/` importa Prisma,
> nunca.** El acceso a la base vive únicamente en archivos `*.functions.ts` y
> `*.server.ts`, y toda función exportada de ahí empieza verificando la sesión y
> el permiso.

En la Fase 1 se instala un lint que lo hace cumplir. No es opcional.

### Las piezas

| Pieza | Elección | Por qué |
| --- | --- | --- |
| Base | **Postgres 17** en Docker | Lo que ya corre en Supabase; evita sorpresas de versión |
| ORM | **Prisma** | Lo pedido |
| API | **`createServerFn`** de TanStack Start | Ya está en el proyecto |
| Auth | **better-auth** | Adaptador Prisma oficial, email+contraseña, verificación y recuperación incluidas, agnóstico del framework |
| Mails | **Resend** (sin cambios) | Ya está escrito en `notifications.functions.ts` |
| Imágenes | **Cloudinary** (sin cambios) | Ya migrado, no depende de Supabase |

### Sobre better-auth

Se elige por descarte:

- **Auth.js/NextAuth**: pensado para Next; fuera de Next es incómodo.
- **Lucia**: dejó de mantenerse como librería, hoy es material de lectura.
- **A mano** (argon2 + cookies): es más código del que parece — verificación de
  mail, recuperación, expiración, rotación. Es exactamente donde no conviene
  improvisar.
- **better-auth**: hace las cuatro cosas, tiene adaptador Prisma y se monta como
  un handler sobre cualquier servidor.

Se monta en `src/server.ts`, **con el mismo patrón que ya usa
`/api/recordatorios`**: interceptar el path antes de que TanStack lo tome. Andá
a mirar ese archivo, ya está resuelto ahí.

---

## 3. Todo dockerizado — requisito explícito

> **Pedido textual de la dueña: "quiero todo dockerizado".** No es una
> preferencia de deploy: aplica también al desarrollo. En la máquina de trabajo
> y en el VPS, lo único instalado en el host es **Docker**. Ni Node, ni Postgres,
> ni la CLI de Prisma.

Hoy eso se cumple a medias: el `Dockerfile` y el `docker-compose.yml` existen y
son buenos, pero el desarrollo corre en el host con `npm run dev`. Eso hay que
cerrarlo en esta migración.

### Lo que se gana además de la prolijidad

El `TODO.md` tiene anotado un problema que se resuelve solo acá: **el Node del
host es v20.20.2 y una dependencia pide ≥22.12**, así que `npm install` tira
`EBADENGINE` en cada instalación. Dentro del contenedor eso desaparece — la
imagen fija la versión y deja de depender de qué tiene puesto cada máquina.

### Los contenedores

| Servicio | Imagen | Para qué |
| --- | --- | --- |
| `db` | `postgres:17` | La base. Volumen nombrado, sólo loopback. |
| `migrate` | la del proyecto | Corre `prisma migrate deploy` **una vez** y termina. |
| `app` | la del proyecto | El sitio. |

El servicio `migrate` es la pieza que suele faltar. Que la app aplique
migraciones al arrancar está mal cuando hay más de una réplica —dos procesos
migrando la misma base a la vez— y además mezcla dos responsabilidades. Un
servicio de un solo uso lo resuelve y compose sabe encadenarlo:

```yaml
  migrate:
    image: shiraf-app:latest
    depends_on:
      db: { condition: service_healthy }
    environment:
      DATABASE_URL: ${DATABASE_URL}
    command: ["npx", "prisma", "migrate", "deploy"]
    restart: "no"

  app:
    depends_on:
      migrate: { condition: service_completed_successfully }
```

### 🔴 Prisma no entra en la imagen actual tal como está

**Leé esto antes de tocar el `Dockerfile`, porque el síntoma aparece recién en
runtime y en producción.**

El `Dockerfile` de hoy tiene una etapa final deliberadamente mínima:

```dockerfile
FROM node:22-alpine AS runtime
COPY --from=build --chown=node:node /app/.output ./.output   # ← y NADA más
```

Sin `node_modules` y sin código fuente. Está muy bien para lo que hay hoy, pero
**Prisma Client no es sólo JavaScript**: necesita su *query engine*, que es un
binario nativo, más el cliente generado. Nada de eso viaja en `.output`. La
imagen se construye sin quejarse y la primera consulta explota con
`Query engine binary not found`.

Hay que arreglarlo, y hay dos caminos:

1. **Recomendado: pasar la etapa de runtime a `node:22-slim`** (Debian) y copiar
   el cliente generado:

   ```dockerfile
   FROM node:22-slim AS runtime
   COPY --from=build /app/node_modules/.prisma ./node_modules/.prisma
   COPY --from=build /app/node_modules/@prisma/client ./node_modules/@prisma/client
   COPY --from=build /app/prisma ./prisma
   ```

2. **Seguir en alpine**, que es más chica, pero entonces hay que declarar el
   binario para musl en `schema.prisma`:

   ```prisma
   generator client {
     provider      = "prisma-client-js"
     binaryTargets = ["native", "linux-musl-openssl-3.0.x"]
   }
   ```

   y agregar `RUN apk add --no-cache openssl` en la etapa de runtime.

Se recomienda el 1. La diferencia de tamaño son unas decenas de MB; la
diferencia de horas perdidas con el `openssl` de alpine es bastante peor, y es
un problema clásico y conocido de Prisma sobre alpine.

⚠️ `prisma generate` tiene que correr **en la etapa de build**, no en la de
runtime: el cliente se genera contra el `schema.prisma` y tiene que estar hecho
antes de copiar.

### Desarrollo, también en contenedor

Creá `docker-compose.dev.yml`:

```yaml
services:
  db:
    extends:
      file: docker-compose.yml
      service: db
    ports: ["127.0.0.1:5432:5432"]   # para poder abrir Prisma Studio

  app:
    build:
      context: .
      target: deps        # la etapa con node_modules, sin build de producción
    command: ["bun", "run", "dev", "--host", "0.0.0.0"]
    volumes:
      - .:/app                       # el código, en vivo
      - /app/node_modules            # ← volumen anónimo, ver abajo
    ports: ["8081:8081"]
    env_file: .env
    depends_on:
      db: { condition: service_healthy }
```

Tres cosas que hay que entender de eso:

1. **El volumen anónimo sobre `node_modules` no es un detalle.** Sin esa línea,
   el bind mount de `.` tapa el `node_modules` del contenedor con el del host —
   que en Windows tiene binarios de rollup y esbuild compilados para Windows. La
   app no arranca y el error no dice eso.

2. **Nada de `read_only: true` acá.** El servicio de producción lo tiene y hay
   que dejarlo; en desarrollo, Vite escribe su caché y lo necesita.

3. `--host 0.0.0.0` es obligatorio: sin eso Vite escucha sólo en el loopback
   **del contenedor** y desde el navegador del host no se llega.

### Los comandos de Prisma, sin instalar nada

```bash
docker compose -f docker-compose.dev.yml run --rm app npx prisma migrate dev --name lo_que_hace
docker compose -f docker-compose.dev.yml run --rm app npx prisma studio
docker compose -f docker-compose.dev.yml run --rm app npx prisma db pull
```

**Dejá estos comandos escritos en el `README.md`.** Si no están a mano, la
próxima persona instala Prisma en el host "por esta vez" y el requisito se cae.

### Lo que queda fuera de Docker, a propósito

- **Cloudinary** y **Resend** son servicios de terceros. No se autohospedan acá.
- **El reverse proxy** ya existe en el VPS para los otros dos sitios. El
  contenedor sigue publicando en `127.0.0.1:3000` y el proxy le pega ahí. **No
  agregues un nginx ni un Traefik al compose**: duplicaría lo que ya está puesto.
- **El cron** de recordatorios: cron del sistema del VPS pegándole por HTTP.
  Meterlo en un contenedor propio es un contenedor más para mantener a cambio de
  nada.

### Los build args del Dockerfile cambian

El `Dockerfile` valida hoy que existan `VITE_SUPABASE_URL` y
`VITE_SUPABASE_PUBLISHABLE_KEY`, y aborta el build si faltan. **Después de la
migración esas dos no existen**, así que hay que sacar ese bloque `RUN if [ -z
... ]` y el `ARG`/`ENV` correspondiente.

De las `VITE_*` sobrevive **una sola**: `VITE_CLOUDINARY_CLOUD_NAME`. Dejá la
validación para ésa, que el motivo por el que se puso sigue valiendo: sin ella
la imagen compila igual y el sitio queda sin fotos.

---

## 4. Lo que NO se toca

Perder tiempo acá es el error más caro, porque además rompe cosas que hoy andan.
**Estos archivos no dependen de Supabase y quedan tal cual:**

- `src/lib/cloudinary.ts` y `src/lib/cloudinary.functions.ts` — Cloudinary puro
- `src/lib/notifications.ts` — texto de los avisos, sin I/O
- `src/lib/contact.ts`, `src/lib/shiraf.ts`, `src/lib/utils.ts`
- `src/lib/permissions.ts` — la definición de los permisos **se conserva y pasa a
  ser la fuente de verdad**, ver Fase 4
- Todo `src/components/ui/**` — shadcn, no sabe qué hay atrás
- Todo el CSS, el diseño y las páginas públicas en su parte visual

**Casi tocados:**

- `src/lib/storage.ts` — sólo hay que sacar la rama de Supabase Storage
  (`servicePathFromUrl` y el `.remove()`). La de Cloudinary queda.
- `src/lib/reminders.server.ts` — cambia únicamente la consulta del medio; la
  lógica de husos horarios y la marca `reminded_at` quedan igual.

---

## 5. Las fases

Cada fase termina con **la app corriendo y verificada**. No pases a la siguiente
sin que la verificación dé bien.

Trabajá en una rama nueva desde `panel-solo-para-el-equipo`:

```bash
git checkout -b migracion-prisma
```

---

### Fase 0 — Red de seguridad

**Antes de cualquier otra cosa.**

1. **Exportá los datos actuales a JSON.** Escribí
   `scripts/export-supabase.mjs` que lea las 15 tablas por la API REST con la
   `SUPABASE_SERVICE_ROLE_KEY` del `.env` y las guarde en
   `scripts/datos/<tabla>.json`. La forma exacta:

   ```js
   const r = await fetch(`${SUPABASE_URL}/rest/v1/${tabla}?select=*`, {
     headers: { apikey: KEY, Authorization: `Bearer ${KEY}` },
   });
   ```

   Exportá también los 4 usuarios con `GET /auth/v1/admin/users` — hacen falta
   los `id`, que son las claves foráneas de medio esquema.

2. **Commiteá ese JSON.** Son unos KB y es la red de seguridad entera.
   Excepción explícita a la regla de no commitear datos: acá no hay nada
   sensible más allá de 4 nombres y teléfonos, y el valor de tenerlo versionado
   supera al riesgo. Si preferís, agregalo al `.gitignore` y guardalo aparte,
   **pero guardalo**.

3. **No borres ni pauses el proyecto de Supabase.** Queda intacto hasta que el
   nuevo lleve dos semanas andando. Es el único rollback verdadero.

**Verificación:** los 15 JSON existen y suman 77 filas.

---

### Fase 1 — Postgres en Docker y el esquema en Prisma

1. Agregá el servicio al `docker-compose.yml` (ya existe, con el servicio `app`
   configurado; no lo reescribas, sumale uno):

   ```yaml
   db:
     image: postgres:17
     container_name: shiraf-db
     restart: unless-stopped
     environment:
       POSTGRES_USER: shiraf
       POSTGRES_PASSWORD: ${POSTGRES_PASSWORD:?falta POSTGRES_PASSWORD en .env}
       POSTGRES_DB: shiraf
     volumes:
       - shiraf-pgdata:/var/lib/postgresql/data
     # Sólo loopback: la app le pega por la red interna de compose.
     ports:
       - "127.0.0.1:5432:5432"
     healthcheck:
       test: ["CMD-SHELL", "pg_isready -U shiraf"]
       interval: 10s
       retries: 5
   volumes:
     shiraf-pgdata:
   ```

   ⚠️ El servicio `app` tiene hoy `read_only: true`. **Está bien y hay que
   dejarlo así** — la app sigue sin escribir en disco. El volumen es del
   contenedor de la base, que es otro.

   En esta misma fase armá el `docker-compose.dev.yml` y arreglá el
   `Dockerfile` para que Prisma funcione en la imagen: **los dos están escritos
   en la sección 3**, incluido el volumen anónimo sobre `node_modules` sin el
   cual el contenedor de desarrollo no arranca en Windows. A partir de acá no se
   corre más `npm run dev` en el host.

2. `npm i -D prisma && npm i @prisma/client && npx prisma init`

3. **Generá el esquema por introspección, no a mano.** Apuntá
   `DATABASE_URL` a la base **de Supabase** (Project Settings → Database →
   Connection string, modo *session*) y corré:

   ```bash
   npx prisma db pull
   ```

   Trae las 15 tablas, los 4 enums y todas las FK ya escritas. Escribir eso a
   mano son horas y un typo silencioso.

4. **Limpiá el esquema introspectado.** Cosas que hay que arreglar sí o sí:

   - Sacá todo lo del esquema `auth` (`auth.users`). Las columnas que hoy
     apuntan ahí (`profiles.id`, `appointments.client_id`,
     `professionals.user_id`, `user_roles.user_id`, `user_permissions.user_id`)
     pasan a apuntar a la tabla de usuarios de better-auth.
   - Poné `@updatedAt` en las 7 columnas `updated_at`. **Eso reemplaza los 7
     triggers `update_updated_at_column` de una.**
   - Revisá que los enums quedaron como enums de Postgres y no como texto.

5. `npx prisma migrate dev --name esquema_inicial` contra la base local nueva.

6. **El lint que hace cumplir LA REGLA.** En `eslint.config.js`:

   ```js
   {
     files: ["src/routes/**", "src/components/**", "src/hooks/**"],
     rules: {
       "no-restricted-imports": ["error", {
         paths: [
           { name: "@prisma/client", message: "Prisma sólo en *.functions.ts / *.server.ts. Ver MIGRACION-A-PRISMA.md, LA REGLA." },
           { name: "@/lib/db", message: "Idem: la base no se toca desde una pantalla." },
         ],
       }],
     },
   }
   ```

**Verificación:** `docker compose up db` levanta, `npx prisma migrate status` da
limpio, y `npx prisma studio` muestra las 15 tablas vacías.

---

### Fase 2 — Auth

La fase más delicada. **Hacela entera antes de tocar una sola pantalla de
datos.**

1. Instalá better-auth con adaptador Prisma. Sus tablas (`user`, `session`,
   `account`, `verification`) entran al mismo `schema.prisma` y a la misma
   migración.

2. **Montá el handler en `src/server.ts`.** Ya hay un path interceptado ahí
   (`/api/recordatorios`); copiá ese patrón para `/api/auth/*`. No inventes otro
   mecanismo.

3. **Reescribí `src/integrations/supabase/auth-middleware.ts`.**

   Esto es lo más importante de la fase: el middleware `requireSupabaseAuth`
   devuelve hoy `context.userId`, y **todas** las server functions existentes lo
   consumen así. Si el reemplazo devuelve la misma forma, **esos archivos no se
   tocan**:

   ```ts
   // Antes: valida el JWT de Supabase → context.userId
   // Después: lee la sesión de better-auth de la cookie → context.userId
   return next({ context: { userId: session.user.id } });
   ```

   Renombralo a `src/lib/auth-middleware.ts` y actualizá los imports. **No
   cambies el nombre de `userId` ni la forma del contexto.**

4. Reemplazá los 26 `supabase.auth.*` por el cliente de better-auth. El mapeo:

   | Supabase | better-auth |
   | --- | --- |
   | `signInWithPassword` | `signIn.email` |
   | `signUp` | `signUp.email` |
   | `signOut` | `signOut` |
   | `getUser` / `getSession` | `useSession` / `getSession` |
   | `onAuthStateChange` | la reactividad de `useSession` |
   | `updateUser` (contraseña) | `changePassword` |
   | `resetPasswordForEmail` | `forgetPassword` |
   | `getClaims` | ya no existe: la sesión se lee en el servidor |

5. **Los mails de auth por Resend, con las plantillas que ya existen.**
   Conectá los hooks de verificación y recuperación de better-auth a un envío
   por Resend, reusando `supabase/emails/confirmar-cuenta.html` y
   `recuperar-contrasena.html`. Los placeholders `{{ .ConfirmationURL }}` de
   Supabase pasan a interpolación normal. **Acá es donde se destraba el bloqueo
   viejo del TODO.**

6. **Los 2 triggers sobre `auth.users` se vuelven código:**
   - `handle_new_user` (crea el `profile` y le pone el rol `client`) → hook
     `after signup` de better-auth.
   - `claim_guest_appointments` (al confirmar el mail, le pasa los turnos de
     invitada) → hook `after email verified`. **No lo saltees**: es una
     funcionalidad viva, no un detalle.

7. **Creá las 4 cuentas a mano** con los mismos mails que hoy, y asignales los
   roles y permisos del JSON exportado en la Fase 0. Los `id` nuevos no van a
   coincidir con los viejos: **anotá el mapeo `id_viejo → id_nuevo`**, lo
   necesita la Fase 6.

**Verificación:** las 4 cuentas entran y salen; recuperar contraseña manda un
mail que funciona; una cuenta nueva recibe el mail de confirmación en castellano.

---

### Fase 3 — Los datos, pantalla por pantalla

Recién ahora se tocan las 30 `.from()`.

**Hacelo de a una pantalla, con commit por pantalla.** El orden sugerido va de
menos a más riesgo, para que los errores aparezcan donde hacen menos daño:

1. Páginas públicas — `servicios.index`, `servicios.$serviceId`,
   `profesionales`, `index` (sólo lectura, sin sesión)
2. `admin.categorias-servicios`, `admin.categorias-productos`
3. `admin.servicios`, `admin.productos`
4. `admin.profesionales`
5. `admin.clientes`, `mi-cuenta`
6. `admin.turnos`, `admin.index` (calendario), `reservar`
7. `admin.equipo`, `admin.cuenta`, `admin.mi-agenda` — las de permisos

Para cada pantalla:

```ts
// src/lib/<area>.functions.ts
export const listarServicios = createServerFn({ method: "GET" })
  .middleware([requireAuth])
  .handler(async ({ context }) => {
    // 1. EL CHEQUEO VA PRIMERO Y NO SE NEGOCIA
    await requirePermission(context.userId, "catalog");
    // 2. recién ahora la consulta
    return prisma.service.findMany({ include: { serviceMedia: true } });
  });
```

El `useQuery` de la pantalla cambia sólo el `queryFn`. **Las `queryKey` se
mantienen exactamente iguales** — hay invalidaciones cruzadas entre pantallas
que se rompen en silencio si les cambiás el nombre. (Ver `admin-professionals`
vs `admin-team-professionals`, que ya causó un bug.)

**Verificación por pantalla:** entrar con la cuenta admin y con la staff, y
comprobar que cada una ve lo que le toca.

---

### Fase 4 — Las 61 policies se vuelven código

**La fase de la que depende que esto no termine en una filtración de datos.**

1. Escribí `src/lib/authz.server.ts` con las tres primitivas, que reemplazan a
   `has_role()` y `has_permission()`:

   ```ts
   export async function getAccess(userId: string): Promise<Access>
   export async function requirePermission(userId: string, p: Permission): Promise<void>
   export async function requireAdmin(userId: string): Promise<void>
   ```

   **Respetá la regla que ya existe en la base**: el admin pasa siempre, sin
   mirar la tabla de permisos. Está explicada en `src/hooks/useAccess.ts` y en
   `src/lib/permissions.ts`; no la reinventes.

2. Recorré las 61 policies **una por una** y anotá para cada una dónde quedó su
   chequeo. La distribución:

   | Tabla | Policies | Qué protegen |
   | --- | --- | --- |
   | `appointments` | 9 | Lo más sensible: una clienta ve **sólo** sus turnos |
   | `services` | 6 | Público lee sólo publicados; escribe `catalog` |
   | `professionals` | 6 | Público lee activas; escribe `team` |
   | `profiles` | 5 | Teléfonos. Lee `clients_contact` **o** `appointments` |
   | `user_roles` | 3 | Cada uno lee el suyo; escribe sólo admin |
   | `user_permissions` | 3 | Ídem. **Ningún permiso se amplía a sí mismo** |
   | `client_notes` | 3 | **Notas clínicas.** Permiso `clients_notes` |
   | `product_costs` | 1 | Costos de compra. Permiso `stock_costs` |
   | `professional_services` | 3 | `team` |
   | `professional_schedules` | 3 | `team` |
   | `product_categories` | 3 | `stock` (ojo: **no** `catalog`, ver 20260814000000) |
   | `service_categories` | 2 | `catalog` |
   | `service_media` | 2 | Heredan de `services` |
   | `products` | 2 | `stock` |
   | `stock_movements` | 2 | `stock` |

   **Escribí esa tabla de traducción en un archivo y dejala en el repo.** Es lo
   que va a permitir auditar después si algo quedó sin cubrir.

3. Las 3 policies de `storage.objects` **se descartan**: el bucket de Supabase
   Storage muere con la migración y las fotos nuevas ya van a Cloudinary.

4. **Los 3 triggers de autorización pasan a código** y hay que leerlos antes,
   porque encierran decisiones que no son obvias:
   - `enforce_appointment_client_scope` — qué puede tocar una clienta de su
     propio turno. **Leé `20260819000000` antes**: esta función ya se rompió una
     vez por reescribirla desde una copia vieja.
   - `validate_appointment` — turno en el futuro, dentro del horario, con
     precio congelado.
   - `guard_professional_account_link` — sólo la dueña ata una ficha a una
     cuenta. Sin esto, cualquiera con `team` se apunta una ficha ajena y lee los
     teléfonos y las notas de esas clientas.

**Verificación:** escribí tests. Es la única fase donde son obligatorios. Como
mínimo, por cada tabla sensible: *"una clienta pide los turnos de otra y recibe
vacío"*, *"una staff sin `clients_notes` pide una nota clínica y recibe null"*,
*"una staff con `team` intenta atarse una ficha y recibe error"*.

---

### Fase 5 — Triggers y funciones: qué sobrevive en SQL

**No traduzcas los 15 triggers a código.** Tres tienen que quedarse en la base, y
el motivo importa.

#### Se quedan como SQL (van en una migración de Prisma con `--create-only`)

| Trigger / función | Por qué NO puede ir a código |
| --- | --- |
| `check_appointment_overlap` | **Condición de carrera.** "Consultar si el horario está libre" y después "insertar" son dos operaciones: entre una y otra entra otra reserva. La base lo resuelve dentro de la misma transacción. En código es un bug que aparece justo el sábado a la mañana. |
| `apply_stock_movement` | Ídem: el saldo de stock se actualiza atómicamente con el movimiento. |
| `sync_service_cover` | Mantiene `services.image_url` igual a la primera imagen de la galería. Es un invariante de datos, no una regla de negocio: vale aunque alguien escriba por fuera de la app. |

Prisma soporta SQL a mano: `npx prisma migrate dev --create-only` y pegás el
cuerpo. Copialos de `20260813020000`, `20260805165256` y `20260818010000`.

#### Se vuelven código

| Origen | Destino |
| --- | --- |
| 7 × `update_updated_at_column` | `@updatedAt` de Prisma (Fase 1) |
| `handle_new_user`, `claim_guest_appointments` | Hooks de better-auth (Fase 2) |
| `enforce_appointment_client_scope`, `validate_appointment`, `guard_professional_account_link` | `authz.server.ts` (Fase 4) |

#### Las 8 RPC

| RPC | Reemplazo |
| --- | --- |
| `professional_busy_slots` | **Dejala en SQL.** Es una consulta con generación de series; en Prisma queda peor. `$queryRaw`. |
| `my_agenda` | Server function con Prisma. ⚠️ Hoy la seguridad la da que **no toma parámetro** de profesional: el alcance sale de `auth.uid()`. **Mantené eso**: sacá el id de la sesión, nunca de un argumento. |
| `my_professional_id` | Consulta trivial. Ojo con `is_active`. |
| `team_member_ids` | Consulta trivial. |
| `rename_service_category`, `rename_product_category` | `prisma.$transaction`. El renombrado tiene que ser atómico — ver `20260816000000`. |
| `link_guest_appointments` | `updateMany`. Reusá `normalize_phone`: se queda como función SQL o se reescribe en TS, pero **una sola vez**. |
| `has_role`, `has_permission` | `authz.server.ts`. |

---

### Fase 6 — Cargar los datos

77 filas. Escribí `prisma/seed.ts` que lea los JSON de la Fase 0.

**El orden importa, por las claves foráneas:**

```
1. usuarios (ya creados a mano en la Fase 2)
2. profiles          ← usá el mapeo id_viejo → id_nuevo
3. user_roles, user_permissions
4. service_categories → services → service_media
5. professionals → professional_services, professional_schedules
6. product_categories → products → product_costs
7. stock_movements
8. appointments      ← client_id: mapeo, o NULL si es invitada
9. client_notes
```

⚠️ **Los `id` de usuario cambian.** Toda columna que apunte a una cuenta
(`profiles.id`, `appointments.client_id`, `professionals.user_id`,
`user_roles.user_id`, `user_permissions.user_id`) tiene que pasar por el mapeo.
Un `client_id` sin traducir apunta a nadie y el turno queda huérfano.

⚠️ `appointments.client_id` **es NULL a propósito** en los turnos de invitadas.
No lo trates como un dato faltante ni intentes completarlo.

⚠️ Al insertar en `service_media`, el trigger `sync_service_cover` va a
recalcular `image_url` solo. **Es lo correcto**: no seedees `services.image_url`
a mano, dejá que lo escriba el trigger.

**Verificación:** comparar los 15 conteos contra la tabla de la sección 1. Y
abrir el sitio: las 6 fotos del catálogo tienen que verse.

---

### Fase 7 — Deploy en el VPS

1. `docker compose up -d`. Ya está casi todo en el `docker-compose.yml`; sumá
   `DATABASE_URL` al servicio `app`, sacá las tres `SUPABASE_*` y agregá el
   servicio `migrate` de un solo uso (sección 3), para que la cadena quede
   `db` → `migrate` → `app`.
2. Las variables que **siguen igual**: las 4 de Cloudinary, `RESEND_API_KEY`,
   `MAIL_FROM`, `MAIL_REPLY_TO`, `REMINDERS_SECRET`.
3. Las que **desaparecen**: `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`,
   `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_PROJECT_ID` y sus cuatro gemelas
   `VITE_*`.
4. Las que **aparecen**: `DATABASE_URL`, `POSTGRES_PASSWORD`,
   `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL`.
5. **El cron de recordatorios cambia de lugar.** Hoy es `pg_cron` adentro de
   Supabase. Pasa al cron del sistema en el VPS; el comando exacto ya está en
   `supabase/emails/README.md`, al final:

   ```
   0 10 * * *  curl -fsS -X POST https://shiraf.com.ar/api/recordatorios -H "Authorization: Bearer $REMINDERS_SECRET"
   ```

   Ese es a las 10 de Buenos Aires, no en UTC — se acabó la conversión.

6. **Backups.** Hasta acá los hacía Supabase. Ahora son tuyos:

   ```
   0 3 * * *  docker exec shiraf-db pg_dump -U shiraf shiraf | gzip > /backups/shiraf-$(date +\%F).sql.gz
   ```

   Con rotación y **copia fuera del VPS**. Un backup que vive en el mismo disco
   que la base no es un backup.

---

### Fase 8 — Limpieza, y recién al final

**No hagas nada de esto antes de que el sitio nuevo lleve dos semanas
funcionando.**

1. Borrar `src/integrations/supabase/`
2. `npm uninstall @supabase/supabase-js`
3. Mover `supabase/migrations/` a `docs/historia-migraciones-supabase/`.
   **No las borres**: son la documentación de por qué cada regla existe, y
   varias explican decisiones del negocio que no están escritas en ningún otro
   lado.
4. Actualizar `README.md`, `AGENTS.md`, `ESTADO.md`, `TODO.md` y `DOCKER.md`
5. Recién ahí, pausar el proyecto de Supabase. **Bajate antes un `pg_dump`
   completo y guardalo fuera del VPS.**

---

## 6. Trampas conocidas

Cosas que parecen obvias y están mal. Cada una salió de leer el código.

1. **`auth.uid()` desaparece y no tiene reemplazo directo.** Aparece en las 61
   policies y en 6 funciones. En código, el equivalente es `context.userId`, y la
   diferencia crítica es que `auth.uid()` **no se puede falsear desde el
   navegador** y un parámetro sí. Cada vez que traduzcas un `auth.uid()`, el
   valor tiene que salir de la sesión del servidor. **Nunca de un argumento de la
   función.**

2. **`my_agenda()` no toma parámetro a propósito.** Está escrito en el comentario
   de `20260818020000`: si recibiera `_professional_id`, cualquiera pediría la
   agenda de cualquiera. Al reescribirla es tentador pasarle el id "para que sea
   reusable". No lo hagas.

3. **`profiles` no tiene el mail.** Vive en `auth.users` y era deliberado.
   Cuando migres a better-auth, **no lo copies a `profiles`** salvo que quieras
   revisar quién puede leer esa tabla — hoy la lee cualquiera con
   `clients_contact` **o** con `appointments`.

4. **El permiso `appointments` implica `clients_contact`.** Está declarado en
   `src/lib/permissions.ts` como `implies` y la policy de `profiles` lo refleja.
   Si al traducir se te escapa, la pantalla de turnos muestra una lista de "—"
   en vez de los nombres.

5. **`product_categories` pide `stock`, no `catalog`.** Es contraintuitivo:
   agrupan cremas e insumos internos que no salen en el sitio. Lo arregló
   `20260814000000`; no lo vuelvas atrás.

6. **`appointments.price` está congelado a propósito.** Es el precio del día que
   se reservó, no el actual del servicio. No lo reemplaces por un join a
   `services.price`.

7. **El precio lo completa un trigger en el alta** y la columna es `NOT NULL`.
   Si lo movés a código, acordate de llenarlo o los inserts van a fallar.

8. **`SLOT_BUFFER_MINUTES` y `ALLOW_OVERTIME`** son constantes en
   `src/lib/shiraf.ts` con decisiones del centro escritas al lado. No las toques
   ni las muevas a la base.

9. **La invalidación de caché de react-query cruza pantallas.** Hay claves que
   una pantalla invalida y otra consume. Ya causó un bug (`admin-professionals`
   vs `admin-team-professionals`, arreglado en `f36b9e5`). **No renombres ninguna
   `queryKey` durante la migración.** Si querés ordenarlas, después y en un
   commit aparte.

10. **`enforce_appointment_client_scope` ya se rompió una vez** por reescribirla
    desde una copia vieja: `20260818030000` la copió de `20260813040000` en vez
    de `20260816020000` y revirtió dos cambios sin querer, dejando a la empleada
    sin poder confirmar turnos. La versión buena es
    **`20260819000000_fix_appointment_client_scope.sql`**. Traducí esa y ninguna
    otra.

11. **`DATABASE_URL` no es la misma adentro que afuera del contenedor.** Desde
    el servicio `app` el host es `db` (el nombre del servicio de compose); desde
    tu máquina es `localhost`. Es el error más frecuente de la fase 1 y el
    mensaje —`getaddrinfo ENOTFOUND db`— no lo sugiere. Si corrés todo con
    `docker compose run` como dice la sección 3, siempre es `db` y el problema
    no existe.

12. **El servicio `migrate` usa la imagen de producción, que hoy no trae la CLI
    de Prisma.** `npx prisma migrate deploy` necesita el paquete `prisma`
    —el de desarrollo, no `@prisma/client`— y la carpeta `prisma/` con el
    esquema y las migraciones. La etapa de runtime actual no copia ninguno de
    los dos. O los copiás (ver sección 3), o el servicio `migrate` usa la etapa
    `deps` en vez de la final.

---

## 7. Checklist final

Antes de dar la migración por terminada, con cada rol:

**Dueña (admin)**
- [ ] Entra al panel y ve las 8 secciones
- [ ] Confirma, cancela y marca realizado un turno
- [ ] Carga un turno de invitada por teléfono y le corrige los datos
- [ ] Sube una foto y un video a un tratamiento y reordena la galería
- [ ] La portada del catálogo cambia sola al mover la primera foto
- [ ] Crea una empleada y le tilda accesos
- [ ] Le da acceso al panel a una profesional y ata la ficha

**Empleada (staff, con «Gestionar turnos»)**
- [ ] **Confirma un turno** ← el bug de `20260818030000`, no lo repitas
- [ ] **No** ve Equipo
- [ ] **No** ve las notas clínicas si no tiene `clients_notes`
- [ ] **No** puede atarse una ficha de profesional

**Profesional (ficha vinculada, sin permisos)**
- [ ] Entra y ve **sólo** «Mi agenda»
- [ ] Ve el teléfono y las notas clínicas **sólo de sus** turnos
- [ ] **No** ve la agenda del centro

**Clienta**
- [ ] Se registra, recibe el mail de confirmación **en castellano**
- [ ] Si tenía turnos de invitada con ese mail, aparecen en su historial
- [ ] Reserva un turno y el centro recibe el aviso
- [ ] **No** puede ver el turno de otra clienta
- [ ] Recupera la contraseña

**Docker** — el requisito de la sección 3
- [ ] `docker compose -f docker-compose.dev.yml up` levanta base y app, y el
      sitio abre en el navegador del host
- [ ] El código se edita en el host y **recarga solo** adentro del contenedor
- [ ] `docker compose up -d` en el VPS levanta `db` → `migrate` → `app` en ese
      orden, y `migrate` termina con código 0
- [ ] **Prisma consulta bien desde la imagen de producción** — es el error que
      no aparece hasta la primera consulta real
- [ ] En el host **no hay** Node, Postgres ni Prisma instalados, y todo se puede
      hacer igual
- [ ] Los comandos de Prisma quedaron escritos en el `README.md`

**Sistema**
- [ ] `POST /api/recordatorios` sin secreto → 401
- [ ] Con el secreto → procesa los turnos del día siguiente
- [ ] El cron del VPS está puesto y probado
- [ ] El backup diario corre y **se restauró una vez para comprobar que sirve**
- [ ] Dos reservas simultáneas del mismo horario: la segunda es rechazada
