# Migración de Supabase a Postgres propio + Prisma

> **Para el agente que ejecute esto: leé el archivo entero antes de tocar una
> línea.** Las fases están ordenadas por dependencia y cada una termina con la
> app funcionando. Hay una sección de trampas al final que explica por qué
> varias cosas que parecen obvias están mal.
>
> Escrito el 20/8/2026 contra la rama `panel-solo-para-el-equipo`, y **revisado
> dos veces el mismo día**:
>
> 1. Contra el repo: se corrigió el inventario de policies (eran conteos del
>    historial de migraciones, no de la base), el orden de las fases, y seis
>    cosas del armado de Docker que no funcionaban como estaban escritas.
> 2. Contra **`Ecommerce_mm`**, el otro proyecto de la dueña. La versión
>    original proponía una arquitectura distinta de la que ella ya mantiene.
>    **Ahora Shiraf se organiza como ese proyecto**: las mismas cuatro carpetas,
>    el mismo auth con JWT, el mismo contenedor de backups. Eso cambió la
>    sección 2, la Fase 2 y la Fase 7.
>
> **Ese otro proyecto es material de lectura obligatoria**, no una referencia
> suelta: varias partes de este plan dicen "andá a copiar de tal archivo" en vez
> de explicar cómo se hace.

---

## 0. Qué se decidió y por qué

La dueña del proyecto quiere el sitio corriendo en **su VPS**, con **Postgres en
Docker** y **Prisma** como capa de datos, sin depender de la nube de Supabase.

Se le señaló que Prisma **no elimina las migraciones** —`prisma migrate` genera
archivos `.sql` igual que ahora— y que el riesgo real está en reimplementar a
mano las reglas de seguridad que hoy hace cumplir Postgres: **39 policies, 19
funciones y 15 triggers**. Lo confirmó igual. **Esa decisión está tomada: no hay
que volver a discutirla, hay que ejecutarla bien.**

Lo que sí cambia el plan es entender dónde está el riesgo, que no es donde
parece:

| | Riesgo |
| --- | --- |
| Reescribir 30 `.from()` en llamadas Prisma | Bajo. Es tedio mecánico. |
| Mover los datos | **Casi nulo.** Son 87 filas en total. |
| Reemplazar el auth | Medio. Hay 4 usuarios; se recrean a mano. |
| **Reemplazar las 39 policies RLS** | **Alto. Acá es donde se filtran datos.** |

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

Contado sobre el repo, no estimado. Lo de la base sale de reconstruir el
historial completo de `supabase/migrations/` —creando y dropeando en orden—, que
es exacto salvo que alguien haya tocado algo a mano en el SQL Editor. Cómo
confirmarlo contra la base está más abajo.

### La base tiene 87 filas

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

✅ **Verificado el 20/8/2026 corriendo `scripts/export-supabase.mjs`**: los 15
conteos dan exactamente eso. (El documento decía "77 filas" en el título: era un
error de suma, los números de la tabla siempre estuvieron bien.)

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

- **39 policies RLS** — 35 en `public` y 4 sobre `storage.objects`. La lista
  completa, policy por policy, está en la Fase 5.
- **19 funciones** en `public`
- **15 triggers**
- **4 enums**: `app_role`, `app_permission`, `appointment_status`, `media_kind`

> ### ⚠️ Cómo NO contar las policies
> Contar los `CREATE POLICY` de `supabase/migrations/` da **61**, y está mal: 26
> de esas fueron dropeadas y recreadas después, así que el número mezcla
> versiones vivas con versiones muertas. `appointments` es el caso más claro —
> tiene 9 `CREATE POLICY` en el historial, de los cuales
> [`20260813070000`](supabase/migrations/20260813070000_permissions.sql) dropeó 4
> para reemplazarlos. Vivas quedan **5**.
>
> Trabajar sobre el conteo del historial no es sólo impreciso: lleva a abrir
> migraciones viejas y traducir la versión superada de una regla. Eso ya pasó una
> vez en este proyecto y dejó a la empleada sin poder confirmar turnos (trampa
> #10). **La verdad está en la base, no en los archivos:**
>
> ```sql
> select schemaname, tablename, policyname, cmd, qual, with_check
>   from pg_policies
>  where schemaname in ('public','storage')
>  order by tablename, policyname;
> ```
>
> Corré eso **antes de empezar la Fase 5** y compará contra la tabla que está
> ahí. Si difiere, gana la base.

---

## 2. La arquitectura de destino

### La forma la marca `Ecommerce_mm`, no este documento

**Leé esto antes que nada, porque define todo lo demás y una versión anterior de
este archivo decía lo contrario.**

La dueña ya tiene otro proyecto andando —`Ecommerce_mm`, en la carpeta de al
lado— con Express + Prisma, y lo mantiene ella. **Shiraf se organiza igual.** No
es una preferencia estética: un proyecto que se entiende a los seis meses vale
más que uno técnicamente más prolijo pero ajeno.

Lo que se copia de ahí es **la separación en capas**, que es lo que hace que ese
backend se lea fácil:

| En `Ecommerce_mm` | Qué hace | En Shiraf |
| --- | --- | --- |
| `routes/x.routes.js` | Flaco. Dice **quién puede llamar qué** y nada más | `server/routes/x.routes.ts` |
| `controllers/x.controller.js` | La lógica y Prisma | `server/controllers/x.controller.ts` |
| `middleware/auth.middleware.js` | Verifica el JWT, pone `req.user` | `server/middleware/auth.middleware.ts` |
| `services/email.service.js` | Lo transversal: mails, cron | `server/services/` |

Mirá `backend/src/routes/category.routes.js`: son 20 líneas, ningún `if`, ningún
Prisma. Sólo el mapeo y los middlewares. **Ese es el patrón a repetir.**

### Lo que NO se copia: partirlo en dos procesos

`Ecommerce_mm` tiene `backend/` y `frontend/` separados porque su frontend es
Vite + React + react-router: un SPA que no tiene servidor propio, así que
necesita un Express al lado.

**Shiraf no está en esa situación.** Es TanStack Start con SSR, o sea que **ya
trae su propio servidor adentro** — hay tres archivos usándolo hoy y funcionan:

- `src/lib/team.functions.ts` — alta y baja de empleadas
- `src/lib/cloudinary.functions.ts` — firma de subidas
- `src/lib/notifications.functions.ts` — envío de mails

Sumarle un Express al lado serían dos servidores haciendo el trabajo de uno, más
CORS, más un segundo contenedor, más un segundo deploy. Y partirlo de verdad
—como el ecommerce— obligaría a sacarle el SSR y el ruteo a TanStack Start y
rehacerlo con react-router: es rehacer el frontend, no mover archivos.

**Entonces: las mismas cuatro carpetas, un solo proceso.** El layout de destino:

```
src/
  routes/                    ← las pantallas (ya existe, no se toca)
  components/                ← (ya existe, no se toca)
  server/                    ← TODO lo nuevo vive acá
    routes/                  ← createServerFn + middleware. Quién llama qué.
      turnos.routes.ts
      catalogo.routes.ts
      equipo.routes.ts
    controllers/             ← la lógica y Prisma
      turnos.controller.ts
      catalogo.controller.ts
    middleware/
      auth.middleware.ts     ← verifica el JWT → context.userId
      permission.middleware.ts  ← el equivalente de adminMiddleware
    services/
      email.service.ts
      reminders.service.ts
    db.ts                    ← el PrismaClient, uno solo
  prisma/
```

La única pieza del ecommerce que no tiene equivalente directo es el `index.js`
que monta los routers: acá eso lo hace TanStack. Lo que sí hay que ubicar a mano
es **el limitador de intentos de login**, que en el ecommerce vive en
`loginLimiter.js` — en Shiraf va en `src/server.ts`, donde ya se interceptan
paths (ver Fase 2).

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
> nunca.** El acceso a la base vive únicamente bajo `src/server/`, y toda función
> que las pantallas puedan llamar empieza verificando la sesión y el permiso.
>
> Es la misma regla que en `Ecommerce_mm`: el frontend le habla al backend, nunca
> a la base. Allá la separación te la garantiza que son dos procesos distintos.
> Acá, que es uno solo, **te la tiene que garantizar la disciplina y el lint.**

En la Fase 1 se instala un lint que lo hace cumplir. No es opcional.

### Las piezas

| Pieza | Elección | Por qué |
| --- | --- | --- |
| Base | **Postgres 17** en Docker | Lo que ya corre en Supabase; evita sorpresas de versión |
| ORM | **Prisma** | Lo pedido, y lo que usa `Ecommerce_mm` |
| API | **`createServerFn`** de TanStack Start | Ya está en el proyecto |
| Auth | **JWT propio**: `jsonwebtoken` + `bcryptjs` | Es el de `Ecommerce_mm`. Copiar un mecanismo probado y propio, en vez de sumar una librería que no se usa en ningún otro lado |
| Mails | **Resend** (sin cambios) | Ya está escrito en `notifications.functions.ts` |
| Imágenes | **Cloudinary** (sin cambios) | Ya migrado, no depende de Supabase |
| Backups | **`prodrigestivill/postgres-backup-local`** | Ya corre en `Ecommerce_mm` con rotación configurada. No escribir un cron a mano |

### Sobre el auth: se copia el de `Ecommerce_mm`

**No hay que diseñar nada acá. Está resuelto en el otro proyecto y hay que ir a
copiarlo.** Los archivos a leer, en este orden:

| Archivo de `Ecommerce_mm` | Qué sacar de ahí |
| --- | --- |
| `backend/src/middleware/auth.middleware.js` | `authMiddleware` (verifica el JWT), `adminMiddleware`, `customerMiddleware` |
| `backend/src/routes/customer.routes.js` | El mapa completo: `register`, `login`, `forgot-password`, `reset-password`, `/me`, `/me/password` |
| `backend/src/controllers/customer.controller.js` | `register`, `customerLogin`, `forgotPassword` (línea 621), `resetPassword` (652) |
| `backend/src/middleware/loginLimiter.js` | El limitador de intentos |

El mecanismo de recuperación de contraseña, que es lo único delicado, ya está
bien hecho ahí y se copia tal cual:

```js
const token = crypto.randomBytes(32).toString("hex");
// se guarda en resetToken + resetTokenExpiry (1 hora)
// al usarlo: where { resetToken, resetTokenExpiry: { gt: new Date() } }
// y se limpian los dos campos
```

Token aleatorio, con vencimiento, de un solo uso, que se borra al usarse. **No
lo mejores, copialo.**

#### 🔴 Las dos cosas que Shiraf necesita y el ecommerce no tiene

1. **Confirmación de mail al registrarse.** En el ecommerce el registro crea la
   cuenta y listo. En Shiraf **no alcanza**, y no por prolijidad: al confirmar el
   mail se dispara `claim_guest_appointments`, que le pasa a la clienta nueva los
   turnos que había sacado como invitada, buscándolos **por mail**. Sin
   verificar, cualquiera se registra con el mail de otra y ve sus turnos: nombre,
   teléfono y tratamientos.

   El mecanismo es **el mismo que el de `forgotPassword`** —token aleatorio con
   vencimiento— con otro nombre de columna. No es territorio nuevo.

   Si en algún momento se decide sacar la confirmación, **entonces hay que sacar
   también el vínculo automático de los turnos de invitada** y pasarlo a algo que
   haga el centro a mano. Van juntos.

2. **Permisos que cambian sin esperar.** El ecommerce mete `permissions` adentro
   del JWT, que dura 7 días. Ahí no molesta. En Shiraf sí: la dueña tilda un
   acceso en el panel y espera que la empleada lo tenga **ya**, no la semana que
   viene.

   Entonces: **el token lleva sólo el `id`** (y el rol, que casi no cambia). Los
   permisos se leen de la base en cada pedido, que es lo que hace hoy
   `has_permission()`. Es una consulta trivial sobre una tabla de 6 filas.

#### Dónde se monta

Las rutas de auth van como **paths HTTP interceptados en `src/server.ts`**, no
como server functions: es el mismo patrón que ya usa `/api/recordatorios` —andá a
mirar ese archivo, está resuelto ahí— y es lo que deja poner el rate limiter
adelante, como en el ecommerce.

```
POST /api/auth/register          POST /api/auth/forgot-password
POST /api/auth/login             POST /api/auth/reset-password
POST /api/auth/logout            GET  /api/auth/verify
```

⚠️ **El token va en una cookie `httpOnly`, no en `localStorage`.** El ecommerce
lo manda en el body y el frontend lo guarda, que es lo normal en un SPA. Shiraf
tiene SSR: el servidor necesita leer la sesión para renderizar, y a
`localStorage` no llega. Con cookie funciona en los dos lados y además el
navegador la manda sola.

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
| `pg-backup` | `prodrigestivill/postgres-backup-local` | El backup diario. **Copiado de `Ecommerce_mm`.** |

### El backup ya está resuelto en el otro proyecto

No escribas un cron con `pg_dump` a mano: `Ecommerce_mm/docker-compose.yml` tiene
un servicio que lo hace, con rotación configurada y probada. Se copia con los
nombres cambiados:

```yaml
  pg-backup:
    image: prodrigestivill/postgres-backup-local:17
    container_name: shiraf-backup
    restart: unless-stopped
    depends_on:
      db: { condition: service_healthy }
    environment:
      POSTGRES_HOST: db
      POSTGRES_DB: shiraf
      POSTGRES_USER: shiraf
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD:?falta POSTGRES_PASSWORD en .env}
      SCHEDULE: "59 23 * * *"
      BACKUP_KEEP_DAYS: 7
      BACKUP_KEEP_WEEKS: 4
      BACKUP_KEEP_MONTHS: 6
    volumes:
      - ./backups:/backups
```

⚠️ La etiqueta de la imagen tiene que coincidir con la versión de Postgres: el
ecommerce usa `:15` porque su base es 15. Acá es **17**.

⚠️ Y vale lo mismo que allá: **`./backups` vive en el mismo disco que la base.**
Eso protege de un borrado accidental, no de que se muera el disco. Hace falta una
copia afuera del VPS.

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
    command: ["node", "node_modules/prisma/build/index.js", "migrate", "deploy"]
    restart: "no"

  app:
    depends_on:
      migrate: { condition: service_completed_successfully }
```

⚠️ Ese `command` **sólo funciona si la imagen lleva adentro el paquete `prisma`
y la carpeta `prisma/`**. Ver más abajo: hoy no lleva ninguno de los dos, y `npx`
tampoco es una salida (sin la dependencia instalada, `npx` se la baja de
internet en cada arranque del contenedor).

### ✅ Prisma en la imagen — resuelto, y con menos vueltas de las previstas

**Esta sección decía otra cosa hasta el 20/8/2026, y lo que decía era correcto
para Prisma 5 y 6.** El proyecto instaló **Prisma 7.9.1**, que cambió la
arquitectura de raíz. Se reescribe entera en vez de corregirla por partes,
porque el razonamiento viejo llevaba a un Dockerfile más complicado del
necesario.

#### Lo que se creía (Prisma ≤ 6)

El cliente llevaba un **motor de consultas nativo**: un binario de Rust,
distinto por sistema operativo y enlazado contra `libssl`. De ahí salían tres
complicaciones que **ya no aplican**:

- había que declarar `binaryTargets` con cada plataforma de destino;
- alpine (musl) era un dolor de cabeza clásico, con el `openssl` que nunca era
  la versión correcta;
- generar en una etapa y correr en otra podía dejar el binario equivocado, y eso
  fallaba recién en la primera consulta real, en producción.

#### Lo que es (Prisma 7)

El motor pasó a ser un **compilador en WASM**: el mismo archivo en todas las
plataformas.

> **Comprobado** sobre lo que genera la 7.9.1 en este proyecto:
> `node_modules/.prisma/client/` tiene `query_compiler_fast_bg.wasm` y **cero**
> binarios nativos — ni `.node`, ni `.so`, ni `.dll`.

Consecuencias, todas a favor:

- **`binaryTargets` no va.** Quedó comentado en `schema.prisma` con la
  explicación. No baja nada.
- **`openssl` no hace falta.** El `apt-get install openssl` de la etapa de
  runtime está comentado, no borrado, para que no lo vuelva a agregar el
  próximo que lea un tutorial de 2024.
- **alpine vuelve a ser viable.** Se deja `node:22-slim` igual, por no reabrir
  una discusión cerrada, pero el motivo original desapareció.
- **Copiar el cliente entre etapas es seguro**, sin importar el sistema
  operativo de cada una.

#### Lo que sí cambió a cambio: hace falta un driver adapter

El WASM arma el SQL pero **no se conecta a la base**. Eso lo hace ahora un
*driver adapter*, en el constructor:

```ts
import { PrismaPg } from "@prisma/adapter-pg";
const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const prisma  = new PrismaClient({ adapter });
```

Sin él, `new PrismaClient()` **ni siquiera se instancia**: tira *"A driver
adapter is required to connect to your database"*. Por eso el proyecto suma
`@prisma/adapter-pg` y `pg` como dependencias normales.

#### Y otra cosa que Prisma 7 rompió: la URL salió de `schema.prisma`

```prisma
datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")   // ← P1012 en Prisma 7
}
```

La URL vive ahora en **`prisma.config.ts`**, en la raíz. Es lo primero que carga
la CLI; sin él, `migrate` y `db pull` no saben a qué base apuntar. **La imagen
de producción tiene que copiarlo**, o el servicio `migrate` falla.

⚠️ Adentro de ese archivo, usá `process.env.DATABASE_URL` y **no** el helper
`env("DATABASE_URL")` de `prisma/config`. Parecen lo mismo y no lo son: el helper
**tira** si la variable no está, y el config se carga en TODOS los comandos,
incluido `generate` — que no necesita base para nada. Con el helper, el
`docker build` moría con `PrismaConfigEnvError`, que es correcto que no exista
ahí: la URL de la base no se hornea en una imagen.

#### Cómo quedó el Dockerfile

```dockerfile
FROM oven/bun:1-alpine AS deps        # todas, para compilar
FROM oven/bun:1-alpine AS prod-deps   # bun install --production
FROM oven/bun:1-alpine AS build       # bunx prisma generate && bun run build
FROM node:22-slim      AS runtime
```

Y el runtime copia, **en este orden**:

```dockerfile
COPY --from=prod-deps /app/node_modules ./node_modules
COPY --from=build /app/node_modules/.prisma        ./node_modules/.prisma
COPY --from=build /app/node_modules/@prisma/client ./node_modules/@prisma/client
COPY --from=build /app/prisma           ./prisma
COPY --from=build /app/prisma.config.ts ./prisma.config.ts
```

⚠️ **El orden importa.** `bun install` deja `@prisma/client` vacío — se llena
recién con `prisma generate`, y `.prisma/` directamente no existe hasta
entonces. Por eso el cliente generado se copia **después**, pisando lo que dejó
el instalador.

⚠️ **`prisma` (el CLI) está en `dependencies`, no en `devDependencies`.** No es
un descuido: el servicio `migrate` corre `migrate deploy` **adentro de esta
imagen**, así que para ella es una dependencia de runtime.

⚠️ **No copies paquetes sueltos por nombre.** Se intentó y está mal: `pg`
arrastra ocho dependencias transitivas, y esa lista habría que mantenerla a
mano. El día que sume una novena, el build pasa y la app se cae al conectarse.
Para eso está la etapa `prod-deps`.

⚠️ `prisma generate` corre **en la etapa de build**, antes de `bun run build`:
el código del servidor importa `@prisma/client`, y ese paquete está vacío hasta
que `generate` lo escribe.

#### Verificado de punta a punta el 20/8/2026

No es teoría: se construyó la imagen y se corrió todo contra un Postgres real.

| Qué | Resultado |
| --- | --- |
| `docker build` | ✅ |
| `migrate deploy` **desde la imagen de producción** | ✅ las 3 migraciones |
| `PrismaClient` + adapter consultando desde la imagen | ✅ |
| La app arranca y responde 200 | ✅ |
| `POST /api/recordatorios` sin secreto | ✅ 401 |
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
    command:
      - sh
      - -c
      - bunx prisma generate && bun run dev --host 0.0.0.0 --port 8080 --strictPort
    volumes:
      - .:/app                       # el código, en vivo
      - /app/node_modules            # ← volumen anónimo, ver abajo
    ports: ["8081:8080"]             # HOST:CONTENEDOR — ver abajo
    env_file: .env
    depends_on:
      db: { condition: service_healthy }
```

Cuatro cosas que hay que entender de eso:

1. **El volumen anónimo sobre `node_modules` no es un detalle.** Sin esa línea,
   el bind mount de `.` tapa el `node_modules` del contenedor con el del host —
   que en Windows tiene binarios de rollup y esbuild compilados para Windows. La
   app no arranca y el error no dice eso.

2. **Nada de `read_only: true` acá.** El servicio de producción lo tiene y hay
   que dejarlo; en desarrollo, Vite escribe su caché y lo necesita.

3. **El puerto es 8080, y las tres banderas del comando hacen falta.**

   `--host 0.0.0.0`, sin el cual Vite escucha sólo en el loopback **del
   contenedor** y desde el navegador del host no se llega.

   `--port 8080`, que es el que configura el preset de Lovable. Acá estuvo
   publicado el **8081** un rato, y eso era un bug silencioso: 8081 es a donde
   Vite se corre **sólo si el 8080 está ocupado**, cosa que pasa en la máquina
   de casa y no adentro de un contenedor limpio. O sea que el mapeo apuntaba a
   un puerto donde no había nadie escuchando: pestaña en blanco, logs diciendo
   que todo está bien.

   `--strictPort`, que convierte eso en un error visible. Sin él, Vite se corre
   al siguiente puerto libre en silencio y volvemos al mismo síntoma.

4. **`bunx prisma generate` antes de arrancar, en cada `up`.** La etapa `deps`
   sólo corre `bun install` con el `package.json`, sin el `schema.prisma` a la
   vista, así que el postinstall de Prisma no genera nada. Sin esto, el primer
   `import` de `@prisma/client` falla pidiendo exactamente eso.

### 🔴 En ese contenedor no existe `npx`

La etapa `deps` es `oven/bun:1-alpine` (mirá el `Dockerfile`, primera etapa).
**Las imágenes de bun no traen Node ni npm ni npx** — son bun y nada más. Todo
comando que empiece con `npx` adentro de ese contenedor falla con
`command not found`, y el mensaje no sugiere por qué.

Son `bunx`:

```bash
docker compose -f docker-compose.dev.yml run --rm app bunx prisma migrate dev --name lo_que_hace
docker compose -f docker-compose.dev.yml run --rm app bunx prisma generate
docker compose -f docker-compose.dev.yml run --rm app bunx prisma db pull
docker compose -f docker-compose.dev.yml run --rm --service-ports app bunx prisma studio
```

(`--service-ports` en el de Studio: sin eso `run` no publica puertos y la
pantalla de Studio no abre desde el host.)

Dos cosas más que hay que resolver acá y no dejar para producción:

- **La CLI de Prisma bajo bun es un borde conocido.** Probala apenas armes la
  Fase 1, con `bunx prisma migrate dev`, **antes** de tener nada escrito
  encima. Si no anda, la salida es una etapa `tools` sobre `node:22-slim` en el
  `Dockerfile` —con el paquete `prisma` y la carpeta `prisma/`— y un servicio de
  compose que use esa etapa para los comandos. No arregles esto instalando
  Prisma en el host: ahí se cae el requisito entero de la sección.
- ~~**Alpine también es musl acá.**~~ **Ya no es un problema** (20/8/2026). Esto
  decía que el contenedor de desarrollo, al ser alpine, necesitaba su propio
  `binaryTargets`. Con el compilador WASM de Prisma 7 no hay binario por
  plataforma, así que da igual: el mismo cliente generado sirve en alpine y en
  Debian. Verificado generando en `oven/bun:1-alpine` y consultando desde
  `node:22-slim`.

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
  ser la fuente de verdad**, ver Fase 5
- Todo `src/components/ui/**` — shadcn, no sabe qué hay atrás
- Todo el CSS, el diseño y las páginas públicas en su parte visual

**Casi tocados:**

- `src/lib/storage.ts` — sólo hay que sacar la rama de Supabase Storage
  (`servicePathFromUrl` y el `.remove()`). La de Cloudinary queda.
- `src/lib/reminders.server.ts` — cambia únicamente la consulta del medio; la
  lógica de husos horarios y la marca `reminded_at` quedan igual. **Al final se
  muda a `src/server/services/reminders.service.ts`**, que es donde vive en el
  ecommerce (`services/cron.service.js`), pero eso es mover un archivo: hacelo en
  un commit aparte, no mezclado con un cambio de lógica.

> ### ⚠️ Mudar archivos y cambiarles el contenido, nunca en el mismo commit
> Los tres `*.functions.ts` de hoy terminan bajo `src/server/`, y varios `lib/`
> también. Es tentador aprovechar el viaje y reescribirlos de paso. **No lo
> hagas**: si algo se rompe, un diff que mueve y edita a la vez no deja ver qué
> lo rompió. Primero mover, commit, después cambiar.

---

## 5. Las fases

Cada fase termina con **la app corriendo y verificada**. No pases a la siguiente
sin que la verificación dé bien.

**El orden no es negociable y no es el intuitivo.** Lo intuitivo es reescribir
las pantallas apenas está el esquema. Pero una pantalla sólo se puede verificar
de verdad cuando ya existen las tres cosas de las que depende:

1. **los triggers** (Fase 3) — sin `check_appointment_overlap`, `sync_service_cover`
   y `apply_stock_movement` puestos, la pantalla de turnos, la galería y el stock
   se comportan distinto que en producción y la prueba no vale;
2. **los datos** (Fase 4) — contra una base vacía toda pantalla se ve igual de
   bien, así que la verificación no verifica nada;
3. **los permisos** (Fase 5) — `requirePermission()` es lo primero que llama
   cada server function de la Fase 6.

Por eso las pantallas van últimas, en la Fase 6. Nada de lo anterior es trabajo
tirado: cada fase deja algo comprobable.

Trabajá en una rama nueva desde `panel-solo-para-el-equipo`:

```bash
git checkout -b migracion-prisma
```

---

### Fase 0 — Red de seguridad ✅ HECHA

**Antes de cualquier otra cosa.**

1. ✅ **Los datos están bajados**, con `node scripts/export-supabase.mjs`: las 15
   tablas en `scripts/datos/*.json` y las 4 cuentas en `scripts/usuarios.json`.
   87 filas, los 15 conteos verificados contra la sección 1.

   Se hizo con un script y no con `npx supabase db dump` porque el dump pide la
   contraseña de la base (Project Settings → Database), que no está en el `.env`.
   El script usa la service role key, que sí está.

   ⚠️ **Falta todavía el dump SQL completo**, y hace falta: es el único que
   sirve para restaurar de verdad si algo sale mal, porque incluye el esquema y
   no sólo las filas. Cuando tengas la contraseña a mano:

   ```bash
   npx supabase db dump --data-only -f scripts/datos.sql
   ```

   El `supabase link` está explicado paso a paso en
   [`supabase/MIGRACIONES.md`](supabase/MIGRACIONES.md).

2. 🔴 **Los datos NO se commitean. Este repositorio es público.**

   Una versión anterior de este documento decía lo contrario —"acá no hay nada
   sensible más allá de 4 nombres y teléfonos"— y estaba mal por dos motivos:

   - Que sean pocos no los hace menos personales. `profiles` trae nombre
     completo, **teléfono** y fecha de nacimiento de 4 personas reales, y
     `appointments` los datos de contacto de 3 invitadas. En un repositorio
     público eso queda indexado por buscadores y no se borra del todo con un
     `git rm`: queda en el historial y en los forks.
   - Además está `product_costs`, que son los **costos de compra**. No es dato
     personal pero sí información comercial.

   `scripts/datos/` y `scripts/usuarios.json` están en el `.gitignore`. **La red
   de seguridad no se debilita**: los archivos están en el disco, y se
   regeneran con un comando. Lo único que no hay es una copia publicada en
   internet.

   ⚠️ **Eso significa que la red de seguridad vive en una sola máquina.** Antes
   de tocar la base, copiá `scripts/datos/` a algún lado —un pendrive, un drive
   privado, el mail—. Un backup que existe en un solo disco es medio backup.

3. **No borres ni pauses el proyecto de Supabase.** Queda intacto hasta que el
   nuevo lleve dos semanas andando. Es el único rollback verdadero.

**Verificación:** ✅ los 15 JSON existen y suman 87 filas;
`scripts/usuarios.json` trae las 4 cuentas con su `id`; y ninguno de los dos
aparece en `git status`.

---

### Fase 1 — Postgres en Docker y el esquema en Prisma ✅ HECHA Y APLICADA

> **Estado al 20/8/2026, actualizado en la máquina con Docker.** Ya no es
> teoría: la base se levanta, se migra y responde. Todo lo de abajo se corrió
> contra un Postgres real.
>
> | | |
> | --- | --- |
> | ✅ `prisma/schema.prisma` | 16 modelos, 4 enums. `prisma validate` pasa |
> | ✅ `prisma/migrations/20260820000000_esquema_inicial/` | 286 líneas: 16 tablas, 9 índices únicos, 15 FK |
> | ✅ `docker-compose.yml` | `db` → `migrate` → `app`, más `pg-backup`. YAML verificado |
> | ✅ `docker-compose.dev.yml` | Con el volumen anónimo y el `--host 0.0.0.0` |
> | ✅ `Dockerfile` | Runtime a `node:22-slim`, las 4 copias de Prisma, sin Supabase |
> | ✅ `.env.example` | Las 4 variables nuevas, y las de Supabase marcadas como de salida |
> | ✅ Aplicarlo a una base | **Hecho.** 3 migraciones, 17 tablas, 4 enums, 3 triggers, 7 índices, 1 CHECK |
| ✅ `prisma.config.ts` | Prisma 7 ya no acepta `url` en el schema |
| ✅ `docker build` + `migrate deploy` desde la imagen | Verificado |
| ✅ `docker compose -f docker-compose.dev.yml up` | Sirve en `localhost:8081` |
>
> #### 🔴 Lo primero en la máquina con Docker, antes que nada
>
> ```bash
> bun add -d prisma && bun add @prisma/client
> ```
>
> **No lo corras con npm.** El repo tiene dos lockfiles y el `Dockerfile` usa
> `bun install --frozen-lockfile`: si `package.json` y `bun.lock` no coinciden,
> el build falla. Por eso desde la máquina sin bun **no se tocó `package.json`**
> —el Prisma que generó todo esto se corrió con `npx prisma@6`, que no instala
> nada en el proyecto— y el repo quedó consistente.
>
> Después:
>
> ```bash
> docker compose up -d db
> bunx prisma migrate deploy      # aplica la migración ya generada
> bunx prisma generate
> ```
>
> #### Y cuando tengas la contraseña de la base de Supabase
>
> ```bash
> bunx prisma db pull --schema /tmp/comparar.prisma   # contra una COPIA
> ```
>
> y compará contra `prisma/schema.prisma`. El esquema se armó del OpenAPI de
> PostgREST más las migraciones, que juntas son fieles, pero **no detectan nada
> que se haya tocado a mano en el SQL Editor.** Es la única forma de descartarlo.
>
> #### Queda anotado para la Fase 3
>
> El `CHECK (client_id IS NOT NULL OR guest_name <> '')` de `appointments`
> —constraint `appointments_identifies_someone`, de `20260816010000`— **Prisma no
> lo puede expresar** en el esquema. Va en la migración a mano de la Fase 3,
> junto con los tres triggers. Sin él, se puede grabar un turno que no identifica
> a nadie.

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

2. `bun add -d prisma && bun add @prisma/client && bunx prisma init` — adentro del
   contenedor, con `docker compose -f docker-compose.dev.yml run --rm app …`

3. **Generá el esquema por introspección, no a mano.** Apuntá
   `DATABASE_URL` a la base **de Supabase** (Project Settings → Database →
   Connection string, modo *session*) y corré:

   ```bash
   bunx prisma db pull
   ```

   Trae las 15 tablas, los 4 enums y todas las FK ya escritas. Escribir eso a
   mano son horas y un typo silencioso.

4. **Limpiá el esquema introspectado.** Cosas que hay que arreglar sí o sí:

   - **Las FK al esquema `auth` no van a aparecer como modelos.** La
     introspección sólo mira los esquemas del `search_path` —o sea `public`—,
     así que `auth.users` no viene: las columnas que apuntan ahí
     (`profiles.id`, `appointments.client_id`, `professionals.user_id`,
     `user_roles.user_id`, `user_permissions.user_id`) vuelven como `String`
     sueltos, con un warning de "referencia a una tabla fuera del esquema". **No
     busques un modelo `users` para borrar: no está.** Lo que hay que hacer es
     apuntarlas a la tabla de usuarios propia, que se crea en la Fase 2.
   - Poné `@updatedAt` en las 7 columnas `updated_at`. **Eso reemplaza los 7
     triggers `update_updated_at_column` de una.**
   - Revisá que los enums quedaron como enums de Postgres y no como texto.

5. `bunx prisma migrate dev --name esquema_inicial` contra la base local nueva.

6. **El lint que hace cumplir LA REGLA.** En `eslint.config.js`:

   ```js
   {
     files: ["src/routes/**", "src/components/**", "src/hooks/**"],
     rules: {
       "no-restricted-imports": ["error", {
         paths: [
           { name: "@prisma/client", message: "Prisma sólo bajo src/server/. Ver MIGRACION-A-PRISMA.md, LA REGLA." },
           { name: "@/server/db", message: "Idem: la base no se toca desde una pantalla." },
           // ⚠️ Repetida a propósito, ver abajo.
           { name: "server-only", message: "TanStack Start does not use the Next.js `server-only` package. Rename the module to `*.server.ts` or mark it with `@tanstack/react-start/server-only`." },
         ],
       }],
     },
   }
   ```

   ⚠️ **Esa tercera entrada no es decorativa.** Ya hay un `no-restricted-imports`
   en el bloque general de [`eslint.config.js`](eslint.config.js) que bloquea
   `server-only`. En flat config, un bloque posterior con la misma regla
   **reemplaza** la configuración anterior para los archivos que matchea, no la
   suma. Sin repetir esa línea, las pantallas ganan la protección de Prisma y
   pierden la de `server-only` en silencio.

   ⚠️ Y tené presente lo que el lint **no** puede ver: los imports indirectos.
   Una pantalla que importa un `.functions.ts` que importa Prisma pasa el lint
   igual. La comprobación de verdad es buscar `@prisma/client` en el bundle del
   navegador después de un `build`. **Hacela una vez al terminar la Fase 6.**

**Verificación:** `docker compose up db` levanta, `bunx prisma migrate status` da
limpio, y `bunx prisma studio` muestra las 15 tablas vacías.

---

### Fase 2 — Auth

La fase más delicada. **Hacela entera antes de tocar una sola pantalla de
datos.**

**Antes de escribir una línea, abrí los cuatro archivos de `Ecommerce_mm` que
lista la sección 2.** Esta fase es en un 80% copiar de ahí.

1. **La tabla de usuarios en `schema.prisma`.** Mirá `model Customer` en
   `Ecommerce_mm/backend/prisma/schema.prisma` (línea 281) y copiá la forma:

   ```prisma
   email             String    @unique
   password          String            // bcrypt
   resetToken        String?           // 32 bytes hex, un solo uso
   resetTokenExpiry  DateTime?         // 1 hora
   verifyToken       String?           // ← Shiraf suma esto, ver sección 2
   verifyTokenExpiry DateTime?
   emailVerified     DateTime?
   ```

   ⚠️ Shiraf ya tiene `profiles`, `user_roles` y `user_permissions`. **La tabla
   nueva guarda sólo lo de autenticación** —mail, contraseña, tokens— y las otras
   tres quedan como están, colgando de su `id`. No las fusiones: el reparto de
   permisos es un sistema aparte y funciona.

2. **Las rutas, en `src/server.ts`.** Ya hay un path interceptado ahí
   (`/api/recordatorios`); copiá ese patrón para los seis de `/api/auth/*` que
   lista la sección 2. Con el rate limiter adelante del `register` y del `login`,
   como en `customer.routes.js`.

3. **Reescribí `src/integrations/supabase/auth-middleware.ts`.**

   Esto es lo más importante de la fase: el middleware `requireSupabaseAuth`
   devuelve hoy `context.userId`, y **todas** las server functions existentes lo
   consumen así. Si el reemplazo devuelve la misma forma, **esos archivos no se
   tocan**:

   ```ts
   // Antes: valida el JWT de Supabase → context.userId
   // Después: lee la cookie, jwt.verify con JWT_SECRET → context.userId
   return next({ context: { userId: payload.id } });
   ```

   Es `auth.middleware.js` del ecommerce, con dos diferencias: el token sale de
   la cookie en vez del header, y **el payload lleva sólo el `id` y el rol, no
   los permisos** (el motivo está en la sección 2).

   Movelo a `src/server/middleware/auth.middleware.ts` y actualizá los imports.
   **No cambies el nombre de `userId` ni la forma del contexto.**

4. 🔴 **Borrá `src/integrations/supabase/auth-attacher.ts` y sacá su línea de
   `src/start.ts`.** Este paso es el que hace cierto el paso anterior y es fácil
   no verlo, porque el archivo no aparece buscando `.from(` ni `.rpc(`.

   Hoy el token viaja como header `Authorization: Bearer`, y quien se lo pega a
   cada llamada al servidor es `attachSupabaseAuth`, registrado como
   `functionMiddleware` global en [`src/start.ts`](src/start.ts). **Con la cookie
   `httpOnly` eso deja de hacer falta**: la manda el navegador sola. Si el
   archivo queda, cada llamada a una server function sigue pidiéndole la sesión a
   Supabase — o falla, cuando Supabase ya no esté.

   Los dos archivos de auth dicen arriba *"This file is automatically generated.
   Do not edit it directly"*: son de Lovable. **Borralos, no los edites**, así
   nadie los regenera encima.

5. Reemplazá los 26 `supabase.auth.*`. El mapeo, contra las rutas nuevas:

   | Supabase | Shiraf, después |
   | --- | --- |
   | `signInWithPassword` | `POST /api/auth/login` |
   | `signUp` | `POST /api/auth/register` |
   | `signOut` | `POST /api/auth/logout` (borra la cookie) |
   | `getUser` / `getSession` (14 usos) | Una sola server function `getMe()`, cacheada con react-query |
   | `onAuthStateChange` | Ya no existe. Al entrar y al salir, invalidá la query de `getMe` |
   | `updateUser` (contraseña) | `PUT /api/auth/password` — el `changePassword` del ecommerce |
   | `resetPasswordForEmail` | `POST /api/auth/forgot-password` |
   | `getClaims` | Ya no existe: la sesión se lee en el servidor |

   ⚠️ **`onAuthStateChange` es el que no tiene traducción directa** y aparece 3
   veces. Era un suscriptor: Supabase avisaba solo cuando cambiaba la sesión. Con
   JWT no hay a quién suscribirse. En el ecommerce esto se resuelve con el
   contexto de React (`frontend/src/context/`) — andá a ver cómo está hecho ahí
   antes de inventarlo.

6. **Los mails de auth por Resend, con las plantillas que ya existen.**
   Reusá `supabase/emails/confirmar-cuenta.html` y `recuperar-contrasena.html`.
   Los placeholders `{{ .ConfirmationURL }}` de Supabase pasan a interpolación
   normal. **Acá es donde se destraba el bloqueo viejo del TODO** — las
   plantillas en castellano están escritas hace semanas y Supabase no las deja
   usar sin SMTP propio.

   El ecommerce manda por **nodemailer/SMTP** (`services/email.service.js`);
   Shiraf ya tiene **Resend** escrito y andando en `notifications.functions.ts`.
   **Quedate con Resend**: es lo único de este renglón que ya funciona en Shiraf.

7. **Los 2 triggers sobre `auth.users` se vuelven código:**
   - `handle_new_user` (crea el `profile` y le pone el rol `client`) → adentro
     del `register`, en la misma transacción. Si falla el profile, no queda la
     cuenta a medias.
   - `claim_guest_appointments` (le pasa los turnos de invitada) → **al confirmar
     el mail, no al registrarse**. El motivo está en la sección 2 y es una
     filtración de datos, no un detalle de prolijidad. **No lo saltees ni lo
     adelantes.**

8. **Creá las 4 cuentas a mano** con los mismos mails que hoy, y asignales los
   roles y permisos exportados en la Fase 0. Los `id` nuevos no van a coincidir
   con los viejos: **anotá el mapeo `id_viejo → id_nuevo` y dejalo en un archivo**
   —no en el historial de una terminal—, lo necesita la Fase 4.

   Las contraseñas se hashean con **bcrypt**, igual que en el ecommerce. En
   `Ecommerce_mm` hay un `prisma/seed.js` y un `adminUsers.controller.js` que ya
   hacen exactamente esto: copiá de ahí.

**Verificación:** las 4 cuentas entran y salen; recuperar contraseña manda un
mail que funciona y el token **no se puede usar dos veces**; una cuenta nueva
recibe el mail de confirmación **en castellano**; y hasta que no lo confirma, sus
turnos de invitada **no** aparecen en el historial.

---

### Fase 3 — Triggers y funciones: qué sobrevive en SQL 🟡 LOS TRIGGERS SÍ, LAS RPC NO

> **Estado al 20/8/2026.** La migración a mano está escrita **y aplicada y
> probada**: `prisma/migrations/20260820000001_reglas_que_se_quedan_en_sql/`.
> Se verificó que los tres hacen lo suyo contra un Postgres real — la portada
> sigue a la primera foto y cae a la siguiente al borrarla, un turno encimado se
> rechaza, y el stock suma y resta.
>
> Lleva los tres triggers y el `CHECK` de `appointments`. Ninguna de las tres
> funciones usaba `auth.uid()` ni `has_permission()`, así que se copiaron casi
> textuales; lo único que se sacó fue `SECURITY DEFINER`, que estaba para saltear
> la RLS y acá no hay RLS que saltear.
>
> **Falta todavía**: las 8 RPC de más abajo, que son la otra mitad de la fase.

**No traduzcas los 15 triggers a código.** Tres tienen que quedarse en la base, y
el motivo importa.

#### Se quedan como SQL (van en una migración de Prisma con `--create-only`)

| Trigger / función | Por qué NO puede ir a código |
| --- | --- |
| `check_appointment_overlap` | **Condición de carrera.** "Consultar si el horario está libre" y después "insertar" son dos operaciones: entre una y otra entra otra reserva. La base lo resuelve dentro de la misma transacción. En código es un bug que aparece justo el sábado a la mañana. |
| `apply_stock_movement` | Ídem: el saldo de stock se actualiza atómicamente con el movimiento. |
| `sync_service_cover` | Mantiene `services.image_url` igual a la primera imagen de la galería. Es un invariante de datos, no una regla de negocio: vale aunque alguien escriba por fuera de la app. |

Prisma soporta SQL a mano: `bunx prisma migrate dev --create-only` y pegás el
cuerpo. Copialos de `20260813020000`, `20260805165256` y `20260818010000`.

⚠️ Los tres usan `auth.uid()` o `has_permission()` en algún renglón. Al copiarlos
hay que sacar esas referencias: `auth` no existe en la base nueva. Lo que se
conserva de cada uno es **la parte atómica** —el chequeo de solape, el saldo, la
portada—, no la de permisos, que va a `permission.middleware.ts` en la Fase 5.

#### Se vuelven código

| Origen | Destino |
| --- | --- |
| 7 × `update_updated_at_column` | `@updatedAt` de Prisma (Fase 1) |
| `handle_new_user`, `claim_guest_appointments` | El register y la confirmación de mail (Fase 2) |
| `enforce_appointment_client_scope`, `validate_appointment`, `guard_professional_account_link` | `permission.middleware.ts` (Fase 5) |

#### Las 8 RPC

| RPC | Reemplazo |
| --- | --- |
| `professional_busy_slots` | **Dejala en SQL.** Es una consulta con generación de series; en Prisma queda peor. `$queryRaw`. |
| `my_agenda` | Server function con Prisma. ⚠️ Hoy la seguridad la da que **no toma parámetro** de profesional: el alcance sale de `auth.uid()`. **Mantené eso**: sacá el id de la sesión, nunca de un argumento. |
| `my_professional_id` | Consulta trivial. Ojo con `is_active`. |
| `team_member_ids` | Consulta trivial. |
| `rename_service_category`, `rename_product_category` | `prisma.$transaction`. El renombrado tiene que ser atómico — ver `20260816000000`. |
| `link_guest_appointments` | `updateMany`. Reusá `normalize_phone`: se queda como función SQL o se reescribe en TS, pero **una sola vez**. |
| `has_role`, `has_permission` | `permission.middleware.ts`. |

**Verificación:** `bunx prisma migrate deploy` corre limpio contra la base nueva
y los tres triggers figuran en `pg_trigger`. Todavía no hay datos ni pantallas
que probar: esta fase se verifica en la base y nada más.

---

### Fase 4 — Cargar los datos

87 filas. Escribí `prisma/seed.ts` que lea lo exportado en la Fase 0.

**Va después de la Fase 3 a propósito**: los tres triggers que se quedan en SQL
tienen que estar puestos antes de cargar, porque dos de ellos participan de la
carga. Y va antes de las pantallas porque una pantalla contra una base vacía no
se puede verificar.

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

⚠️ **`check_appointment_overlap` está vivo mientras seedeás** —lo creaste en la
Fase 3— y no distingue una reserva nueva de una carga histórica. Si dos de los 4
turnos se pisan en la base vieja (pasa: se cargaron antes de que existiera el
trigger, en `20260813020000`), el seed falla ahí. La salida es
`ALTER TABLE public.appointments DISABLE TRIGGER trg_check_appointment_overlap;`
alrededor de esa carga, **y volver a habilitarlo al terminar**. Dejalo en el
mismo script, no en dos comandos sueltos: un trigger deshabilitado y olvidado es
la puerta abierta al sobreturno.

⚠️ **`price` y `duration_minutes` vienen del export y se insertan tal cual.** En
la base vieja los completaba `validate_appointment`, que en la Fase 5 pasa a
código y por lo tanto **no existe como trigger acá**. Es justo lo que querés —
son los precios del día que se reservó, congelados (trampa #6)— pero significa
que si el export los trajo vacíos, se insertan vacíos y la columna es `NOT NULL`.
Comprobalo antes de correr el seed, no después.

**Verificación:** comparar los 15 conteos contra la tabla de la sección 1. Y
abrir el sitio: las 6 fotos del catálogo tienen que verse. Y los 4 turnos tienen
que conservar el precio que tenían, no el del catálogo de hoy.

---

### Fase 5 — Las 39 policies se vuelven código

**La fase de la que depende que esto no termine en una filtración de datos.**

Antes de empezar, corré la consulta a `pg_policies` de la sección 1 y compará
contra las tablas de acá. Si difieren, gana la base — estas listas salen de
reconstruir el historial de migraciones, que es exacto salvo que alguien haya
tocado algo a mano en el SQL Editor.

1. Escribí `src/server/middleware/permission.middleware.ts` con las tres
   primitivas, que reemplazan a `has_role()` y `has_permission()`. Es el
   equivalente de `adminMiddleware` / `customerMiddleware` del ecommerce, con la
   diferencia de que Shiraf tiene permisos finos además de roles:

   ```ts
   export async function getAccess(userId: string): Promise<Access>
   export async function requirePermission(userId: string, p: Permission): Promise<void>
   export async function requireAdmin(userId: string): Promise<void>
   ```

   **Respetá la regla que ya existe en la base**: el admin pasa siempre, sin
   mirar la tabla de permisos. Está explicada en `src/hooks/useAccess.ts` y en
   `src/lib/permissions.ts`; no la reinventes.

2. Recorré las **35 policies de `public`** una por una. Acá está la lista
   completa: nombre, operación, la regla que hace cumplir, y **la migración donde
   está la versión vigente** — que es de la única de la que hay que copiar.

   **Tildá cada renglón a medida que lo traducís.** Esta lista es el entregable
   de la fase: si al final quedó alguna sin tildar, hay una puerta abierta.

   #### `appointments` (5) — lo más sensible
   | Op | Policy | Regla | Vigente en |
   | --- | --- | --- | --- |
   | SELECT | `read appointments` | `client_id = uid` **o** permiso `appointments` | `20260813070000` |
   | UPDATE | `update appointments` | ídem, en `using` y en `with check` | `20260813070000` |
   | INSERT | `staff create appointments` | permiso `appointments` | `20260813070000` |
   | INSERT | `clients create own appointments` | `client_id = uid`. **La más vieja y sigue viva** | `20260805164122` |
   | DELETE | `delete appointments` | permiso `appointments` | `20260813070000` |

   #### `profiles` (3) — teléfonos
   | Op | Policy | Regla | Vigente en |
   | --- | --- | --- | --- |
   | SELECT | `read profiles` | `uid = id` **o** `clients_contact` **o** `appointments` ← ver trampa #4 | `20260813070000` |
   | UPDATE | `update profiles` | `uid = id` **o** `clients_contact` | `20260813070000` |
   | INSERT | `own profile insert` | `uid = id` | `20260805164122` |

   #### `client_notes` (3) — notas clínicas
   | Op | Policy | Regla | Vigente en |
   | --- | --- | --- | --- |
   | SELECT | `read client notes` | `client_id = uid` **o** `clients_notes` | `20260814010000` |
   | INSERT | `write client notes` | ídem | `20260814010000` |
   | UPDATE | `update client notes` | ídem | `20260814010000` |

   #### `user_roles` (3) y `user_permissions` (3) — el reparto de accesos
   | Op | Policy | Regla | Vigente en |
   | --- | --- | --- | --- |
   | SELECT | `read own roles` | `user_id = uid` **o** rol admin | `20260805164122` |
   | INSERT | `admin assigns non-admin roles` | rol admin **y** `role <> 'admin'` | `20260813070000` |
   | DELETE | `admin removes non-admin roles` | ídem | `20260813070000` |
   | SELECT | `read permissions` | `user_id = uid` **o** rol admin | `20260813070000` |
   | INSERT | `admin grants permissions` | **rol** admin, no permiso | `20260813070000` |
   | DELETE | `admin revokes permissions` | ídem | `20260813070000` |

   ⚠️ Repartir accesos es del **rol** `admin` y no de un permiso, a propósito:
   ningún permiso se amplía a sí mismo. No lo conviertas en `requirePermission`.

   #### Catálogo — `services` (3), `service_media` (3), `service_categories` (1)
   | Op | Policy | Regla | Vigente en |
   | --- | --- | --- | --- |
   | SELECT | `published services anon` | `is_published` | `20260805165527` |
   | SELECT | `published services authenticated` | `is_published` **o** `catalog` | `20260813070000` |
   | ALL | `manage services` | `catalog` | `20260813070000` |
   | SELECT | `published service media anon` | el service del que cuelga está publicado | `20260818010000` |
   | SELECT | `published service media authenticated` | `catalog` **o** el service está publicado | `20260818010000` |
   | ALL | `manage service media` | `catalog` | `20260818010000` |
   | ALL | `manage service categories` | `catalog` | `20260813070000` |

   #### Equipo — `professionals` (3), `professional_services` (2), `professional_schedules` (2)
   | Op | Policy | Regla | Vigente en |
   | --- | --- | --- | --- |
   | SELECT | `active professionals anon` | `is_active` | `20260805165527` |
   | SELECT | `active professionals authenticated` | `is_active` **o** `team` | `20260813070000` |
   | ALL | `manage professionals` | `team` | `20260813070000` |
   | SELECT | `professional services public` | `true` — anon y authenticated | `20260805164122` |
   | ALL | `manage professional services` | `team` | `20260813070000` |
   | SELECT | `schedules public` | `true` — anon y authenticated | `20260805164122` |
   | ALL | `manage schedules` | `team` | `20260813070000` |

   #### Stock — `products` (1), `stock_movements` (1), `product_categories` (1), `product_costs` (1)
   | Op | Policy | Regla | Vigente en |
   | --- | --- | --- | --- |
   | ALL | `manage products` | `stock` | `20260813070000` |
   | ALL | `manage stock movements` | `stock` | `20260813070000` |
   | ALL | `manage product categories` | `stock` ← **no `catalog`**, ver trampa #5 | `20260814000000` |
   | ALL | `manage product costs` | `stock_costs` — costos de compra | `20260814010000` |

   ⚠️ Ninguna de estas cuatro tiene policy de lectura pública: el stock no sale
   en el sitio. Al pasarlas a código, la server function tiene que exigir el
   permiso **también para leer**.

   **Copiá esta tabla a un archivo aparte del repo** con una columna más: en qué
   server function quedó cada chequeo. Es lo que va a permitir auditar después.

3. Las **4** policies de `storage.objects` (`servicios lectura publica`,
   `servicios alta`, `servicios cambio`, `servicios baja`) **se descartan**: el
   bucket de Supabase Storage muere con la migración y las fotos nuevas ya van a
   Cloudinary.

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

### Fase 6 — Los datos, pantalla por pantalla

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

**Dos archivos por pantalla, como en el ecommerce**: la ruta flaca y el
controlador con la lógica.

```ts
// src/server/routes/catalogo.routes.ts
// Flaco a propósito: dice quién puede llamar qué y nada más.
// Es el equivalente de category.routes.js del ecommerce.
export const listarServicios = createServerFn({ method: "GET" })
  .middleware([requireAuth, requirePermission("catalog")])
  .handler(({ context }) => catalogo.listarServicios(context.userId));
```

```ts
// src/server/controllers/catalogo.controller.ts
// Acá vive Prisma y la lógica. Ningún chequeo de permiso: para llegar
// hasta acá ya pasó por el middleware.
export function listarServicios(userId: string) {
  return prisma.service.findMany({ include: { serviceMedia: true } });
}
```

⚠️ **El chequeo de permiso va en la ruta, no adentro del controlador.** Es lo que
hace `category.routes.js` con `authMiddleware, adminMiddleware`, y la ventaja es
la misma: abriendo un solo archivo de 20 líneas ves quién puede hacer qué en toda
un área. Si el chequeo queda enterrado en el controlador, para auditarlo hay que
leer todo.

⚠️ **Si una pantalla necesita algo que ninguna ruta expone, se agrega una ruta.**
No se llama al controlador desde la pantalla. Ese es el atajo que rompe la
separación entera, y el lint no lo ve.

El `useQuery` de la pantalla cambia sólo el `queryFn`. **Las `queryKey` se
mantienen exactamente iguales** — hay invalidaciones cruzadas entre pantallas
que se rompen en silencio si les cambiás el nombre. (Ver `admin-professionals`
vs `admin-team-professionals`, que ya causó un bug.)

`requirePermission` ya existe: lo escribiste en la Fase 5. Si te encontrás
inventándolo acá, estás haciendo las fases en el orden viejo.

**Verificación por pantalla:** entrar con la cuenta admin **y** con la staff, y
comprobar que cada una ve lo que le toca. Esto recién tiene sentido porque la
base ya tiene los datos de la Fase 4: contra una base vacía las dos cuentas ven
lo mismo —nada— y la verificación pasa sin comprobar nada.

**Verificación final de la fase, una sola vez:** construí y buscá
`@prisma/client` en el bundle del navegador. No tiene que aparecer. El lint de la
Fase 1 no ve los imports indirectos; esto sí.

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
   `JWT_SECRET`, `APP_URL` (para armar los links de los mails).
5. **El cron de recordatorios cambia de lugar.** Hoy es `pg_cron` adentro de
   Supabase. Pasa al cron del sistema en el VPS; el comando exacto ya está en
   `supabase/emails/README.md`, al final:

   ```
   0 10 * * *  curl -fsS -X POST https://shiraf.com.ar/api/recordatorios -H "Authorization: Bearer $REMINDERS_SECRET"
   ```

   Ese es a las 10 de Buenos Aires, no en UTC — se acabó la conversión.

6. **Backups.** Hasta acá los hacía Supabase. Ahora son tuyos, y **no hay nada
   que escribir**: es el servicio `pg-backup` de la sección 3, copiado de
   `Ecommerce_mm`. Levanta con el resto del compose.

   Lo único que hay que agregar es **la copia fuera del VPS**. Un backup que vive
   en el mismo disco que la base te salva de un borrado accidental, no de que se
   muera el disco. Fijate cómo está resuelto en el ecommerce y hacé lo mismo.

   **Y probá una restauración.** Un backup que nunca se restauró es una carpeta
   con archivos, no un backup.

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

1. **`auth.uid()` desaparece y no tiene reemplazo directo.** Aparece en casi
   todas las policies y en 6 funciones. En código, el equivalente es
   `context.userId`, y la
   diferencia crítica es que `auth.uid()` **no se puede falsear desde el
   navegador** y un parámetro sí. Cada vez que traduzcas un `auth.uid()`, el
   valor tiene que salir de la sesión del servidor. **Nunca de un argumento de la
   función.**

2. **`my_agenda()` no toma parámetro a propósito.** Está escrito en el comentario
   de `20260818020000`: si recibiera `_professional_id`, cualquiera pediría la
   agenda de cualquiera. Al reescribirla es tentador pasarle el id "para que sea
   reusable". No lo hagas.

3. **`profiles` no tiene el mail.** Vive en `auth.users` y era deliberado.
   Cuando armes la tabla de usuarios, **no lo copies a `profiles`** salvo que quieras
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
    de Prisma.** `prisma migrate deploy` necesita el paquete `prisma` —el de
    desarrollo, no `@prisma/client`— y la carpeta `prisma/` con el esquema y las
    migraciones. La etapa de runtime actual no copia ninguno de los dos, y
    **`npx` tampoco es la salida**: sin la dependencia instalada se la baja de
    internet en cada arranque. Hay que copiar las dos cosas (sección 3).

    ⚠️ Y la etapa `deps` **no es un plan B**: sólo copia `package.json`,
    `bun.lock` y `bunfig.toml`. No tiene la carpeta `prisma/`, así que
    `migrate deploy` no encuentra qué aplicar. Si querés una etapa aparte, hay
    que armarla, no reusar ésa.

13. **En el contenedor de desarrollo no hay `npx`.** La etapa `deps` es
    `oven/bun:1-alpine` y las imágenes de bun no traen Node ni npm. Es `bunx`.
    Está explicado en la sección 3. (La otra advertencia que había acá, sobre
    musl, quedó sin efecto con Prisma 7 — ver la sección 3.)

    ✅ La CLI de Prisma bajo bun **se probó y anda**: `bunx prisma validate`,
    `generate`, `migrate diff` y `migrate deploy`, todos desde
    `oven/bun:1-alpine`. No hace falta la etapa `tools` que se proponía como
    salida.

14. **El bloque nuevo de `no-restricted-imports` pisa al que ya está.** En flat
    config la regla no se suma, se reemplaza. Sin repetir la entrada de
    `server-only`, las pantallas ganan una protección y pierden otra sin que
    nadie se entere. Ver Fase 1, punto 6.

15. **`auth-attacher.ts` no aparece buscando `.from(` ni `.rpc(`**, y es el que
    hace que las server functions reciban la sesión. Hoy la manda por header;
    ahora va por cookie httpOnly. Si queda, cada llamada al servidor sigue
    hablando con Supabase. Ver Fase 2, punto 4.

16. **Contar los `CREATE POLICY` de las migraciones da 61 y es un número
    inventado.** 26 fueron dropeadas y recreadas. Vivas hay 39. Peor que el
    número: buscar 61 obliga a abrir migraciones viejas, que es exactamente cómo
    se produjo el accidente de la trampa #10. La lista real está en la Fase 5 y
    la verdad está en `pg_policies`.

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
- [ ] `bunx prisma migrate dev` corre adentro del contenedor de desarrollo
- [ ] Los comandos de Prisma quedaron escritos en el `README.md`, con `bunx`

**Las policies** — la fase de la que depende que no se filtren datos
- [ ] La tabla de traducción de la Fase 5 está en el repo, con las **35** de
      `public` tildadas y la ruta donde quedó cada chequeo
- [ ] `@prisma/client` **no** aparece en el bundle del navegador
- [ ] `auth-attacher.ts` está borrado y su línea sacada de `src/start.ts`

**La forma** — que se lea como `Ecommerce_mm`, que es para lo que se eligió
- [ ] Todo lo de servidor vive bajo `src/server/`, en `routes` / `controllers` /
      `middleware` / `services`
- [ ] Los archivos de `routes/` son flacos: mapeo y middlewares, sin Prisma
      adentro
- [ ] Ninguna pantalla llama a un controlador directo, siempre a una ruta
- [ ] El token va en cookie `httpOnly`, no en `localStorage`
- [ ] El JWT **no** lleva los permisos adentro — se leen de la base en cada
      pedido, así un acceso tildado en el panel vale al instante

**Sistema**
- [ ] `POST /api/recordatorios` sin secreto → 401
- [ ] Con el secreto → procesa los turnos del día siguiente
- [ ] El cron del VPS está puesto y probado
- [ ] El backup diario corre y **se restauró una vez para comprobar que sirve**
- [ ] Dos reservas simultáneas del mismo horario: la segunda es rechazada
