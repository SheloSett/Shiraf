# Shiraf — estado del proyecto

Documento de traspaso. Resume qué se hizo, por qué, qué falta y las trampas que
ya se pisaron, para retomar el trabajo sin volver a investigar lo mismo.

Última actualización: **21 de agosto de 2026**.

> ⚠️ **Cambió el stack.** Del 5 al 21 de agosto el proyecto corrió sobre
> Supabase. Ahora corre sobre **Postgres propio en Docker**. Todo lo que este
> documento decía sobre RLS, PostgREST y `auth.uid()` quedó obsoleto y está
> reescrito. La historia completa —y el porqué de cada regla— vive en
> [`docs/historia-supabase/`](docs/historia-supabase/LEEME.md) y en
> [`MIGRACION-A-PRISMA.md`](MIGRACION-A-PRISMA.md).

---

## 1. Qué es

Sitio para el centro de estética Shiraf. Lo generó Lovable a partir de un brief
(está en el `README.md`): vista de clienta con catálogo y reserva de turnos, y
panel de administración con calendario, turnos, servicios, profesionales,
clientes y stock.

**Stack:** TanStack Start (SSR) + React 19 + Vite 8 + Tailwind v4 + shadcn/ui +
**Postgres 17 + Prisma 7**. TypeScript en modo estricto con
`exactOptionalPropertyTypes`.

**Detalle clave — y es el que cambió.** Antes la app **no tenía backend**: el
navegador hablaba directo con PostgREST y la seguridad eran 39 policies de RLS
atadas a `auth.uid()`.

Ahora hay backend, y vive adentro del mismo proceso: son las server functions y
los routers de `src/server/`. El navegador **ya no toca la base**; sólo puede
llamar a los ~61 endpoints que existen.

```
navegador ──fetch──> src/server/routes/*  ──> controllers ──Prisma──> Postgres
                     (quién puede llamar qué)   (la lógica)
```

La consecuencia que hay que tener presente todo el tiempo: **Postgres ya no te
protege.** La conexión de `src/server/db.ts` es dueña de todo. Lo que decide
quién ve qué es el código, y por eso:

> 🔴 **Ninguna pantalla importa Prisma.** El acceso a datos vive sólo en
> `src/server/**`, y hay un `no-restricted-imports` en `eslint.config.js` que lo
> hace cumplir.

La compensación es real: el navegador dejó de tener una conexión directa a la
base. Antes la clave publishable viajaba en el bundle y cualquiera podía
intentar leer `appointments`; lo único que lo frenaba era la RLS.

---

## 2. Base de datos

Postgres 17 en Docker, en el mismo `docker-compose.yml` que la app.

|                          |                                                                   |
| ------------------------ | ----------------------------------------------------------------- |
| Esquema                  | `prisma/schema.prisma` — 16 modelos, 4 enums                      |
| Se sincroniza con        | `prisma db push`, **no** con migraciones                          |
| Lo que `db push` no sabe | `prisma/sql/reglas.sql`, aplicado por `scripts/post-push.mjs`     |
| Datos iniciales          | `prisma/seed.ts`                                                  |
| Permisos                 | `src/server/services/authz.service.ts` + `src/server/PERMISOS.md` |

### Por qué `db push` y no migraciones

Es la forma que usa `Ecommerce_mm`, el otro proyecto de la dueña, y la decisión
fue explícitamente parecerse a ése. El `schema.prisma` es la fuente de verdad y
el contenedor `migrate` lo sincroniza en cada arranque.

**El riesgo que eso trae, y cómo se cubre.** `db push` sólo conoce lo que está
en el schema. Los 3 triggers, el `CHECK` de turnos, `normalize_phone` y los 4
índices parciales **no**. Por eso `scripts/post-push.mjs` corre siempre después,
los vuelve a poner, y —lo importante— **verifica que estén y corta el arranque
si falta alguno**. Sin el CHECK, la base acepta turnos sin dueño y eso no se ve
hasta que alguien mira la agenda.

### Lo que se quedó en SQL, y por qué

Tres reglas no pueden vivir en el código porque dependen de que la comprobación
y la escritura pasen **en la misma transacción**:

| Trigger                     | Si estuviera en código                                                         |
| --------------------------- | ------------------------------------------------------------------------------ |
| `check_appointment_overlap` | Dos reservas simultáneas leen las dos que está libre, y las dos escriben       |
| `apply_stock_movement`      | Dos movimientos a la vez pierden uno                                           |
| `sync_service_cover`        | Es un invariante de datos: vale aunque escriba un seed o una corrección a mano |

### El primer admin

Ya no hace falta el `crear-admin.sql`: las 4 cuentas se cargaron con el seed,
conservando sus UUID originales. Para una cuenta nueva con rol admin, hoy es un
`UPDATE` en `user_roles` desde `npm run studio`.

## 3. El bug de la doble reserva (resuelto)

Vale entenderlo porque no era obvio.

La policy de `appointments` deja ver **únicamente los turnos propios**. El
formulario de reserva calculaba la disponibilidad consultando esa tabla, así que
cada clienta recibía sólo sus propios turnos: **los horarios ocupados por otras
aparecían libres**. Dos personas podían tomar el mismo horario con la misma
profesional y nada lo impedía, ni la interfaz ni la base.

Se resolvió por dos lados:

1. **`professional_busy_slots(_professional_id, _from, _to)`** — función
   `SECURITY DEFINER` que devuelve los rangos ocupados sin decir de quién son.
   Sólo inicio y duración; ni id de cliente ni notas. `reservar.tsx` la llama vía
   `supabase.rpc()` en lugar de consultar la tabla.
2. **Trigger `check_appointment_overlap`** — `BEFORE INSERT OR UPDATE`, rechaza
   el turno si se pisa con otro. Funciona aunque alguien escriba directo contra
   la API salteando la interfaz.

Las columnas de salida de la función se llaman `slot_start` / `slot_minutes`, no
`starts_at` / `duration_minutes`: en `RETURNS TABLE` los nombres de salida
comparten ámbito con las columnas de la tabla y repetirlos puede dar un _column
reference is ambiguous_. `reservar.tsx` los mapea al recibirlos.

**Deuda conocida:** lo canónico sería un constraint `EXCLUDE` con `btree_gist`,
pero `timestamptz + interval` es `STABLE` en Postgres, no `IMMUTABLE`, así que no
se puede indexar directo — haría falta una columna `ends_at` con su propio
trigger. Se eligió el trigger por ser una sola migración y menos riesgo. Queda
una ventana de carrera de milisegundos entre dos inserts concurrentes;
despreciable para una agenda por profesional, pero está.

---

## 4. Rediseño visual

El diseño original era el shadcn por defecto: todo en tarjetas con borde y
sombra, secciones centradas de ritmo idéntico, y la franja de tres íconos
(Leaf / Clock / Star) que es la firma más reconocible de las landings generadas.

Lo que se cambió y **conviene no revertir**:

- **Tipografía:** el display pasó de Cormorant Garamond a **Bodoni Moda**, que se
  acerca al wordmark del logo (una Didone de alto contraste). Es variable en
  tamaño óptico. El texto corrido sigue en Karla — Bodoni en cuerpos chicos se
  rompe.
- **Nada de palabras en color de acento dentro de un titular.** Es el tic más
  reconocible del diseño generado por IA. El énfasis lo da el tamaño.
- **Rejilla de 12 columnas a sangre**, no contenedores centrados. El texto suele
  ir de la columna 2 a la 6 y las imágenes de la 8 al borde.
- **Sin tarjetas en el catálogo.** Home usa un índice con panel de detalle al
  pasar el mouse; `/servicios` usa listas con filete agrupadas por categoría.
- Paleta: se subió el croma del oliva de `0.032` a `0.048` — a `0.032` se leía
  gris verdoso en campos grandes.

Utilidades propias en `src/styles.css`: `display-hero`, `display-section`,
`text-eyebrow`, `numeral`, `grain`, `gold-rule`, `surface-olive`.

Componentes propios: `reveal.tsx` (aparición al scrollear, respeta
`prefers-reduced-motion`), `organic-rule.tsx` (filete dibujado a mano),
`logo.tsx`, `admin/category-manager.tsx`.

### El truco de `.js` en `__root.tsx`

Hay un script inline en el `<head>` que agrega la clase `js` al `<html>` antes
del primer pintado. Las animaciones de aparición cuelgan de `.js`. **No lo
saques:** sin esa guarda, el HTML del servidor sale con `opacity: 0` y el hero
queda invisible si el JS falla o tarda.

### El logo

`public/logo_shiraf.jpeg` es un lockup completo (monograma + "SHIRAF" + bajada)
sobre fondo oliva, **sin transparencia**. Por eso `logo.tsx` expone dos cosas:

- `<Logo>` recorta sólo el monograma por CSS y lo presenta como sello circular —
  a 44px el lockup entero es ilegible.
- `<LogoLockup>` muestra el archivo entero, para superficies oliva grandes.

Los valores del recorte están calculados a ojo sobre el original de 1254×1254.
Si el sello se ve descentrado, son dos números en `logo.tsx`.

---

## 5. Fotos

Van en **Cloudinary**, carpeta `shiraf/servicios`, con subida firmada desde el
servidor (`src/lib/cloudinary.functions.ts`).

Antes iban a Supabase Storage. Se movieron el 15/8, y el motivo no fue la
migración: las fotos se muestran en tres tamaños muy distintos —48px en la tabla
del panel, ~400px en la tarjeta, pantalla completa en la ficha— y desde Storage
bajaban siempre el mismo archivo de 1600px. Supabase sabe redimensionar por URL,
pero es función de plan Pro.

⚠️ Puede quedar alguna foto vieja apuntando a Supabase Storage. `imageUrl()`
devuelve intacta toda URL que no sea de Cloudinary, así que se siguen viendo, y
migran solas a medida que se reemplacen. **Ese es el último hilo que ata el
proyecto de Supabase**: antes de pausarlo, conviene resubir esas fotos.

`src/lib/storage.ts` **redimensiona y comprime en el navegador antes de subir**:
máximo 1600px de ancho y conversión a WebP con calidad 0.82. Una foto de celular
de 6 MB queda en ~200 KB. Esto importa por dos motivos: el bucket gratis es de
1 GB, y sobre todo una foto sin optimizar tarda muchísimo en cargar con datos
móviles.

El nombre del archivo lo genera `crypto.randomUUID()`, no el nombre original:
evita choques, saca acentos y espacios de la URL, y hace que al reemplazar una
foto no se sirva la anterior desde la caché.

`services.image_url` ya existía en el esquema original y nunca se había usado.
`professionals.avatar_url` **sigue sin usarse** — es el próximo lugar natural
para sumar fotos.

Los paneles oliva con grano del home y de la ficha de tratamiento estaban
dimensionados desde el principio como marcador de posición para estas fotos.

---

## 6. Docker

Ya no es opcional: **la base corre en Docker**, así que el proyecto no levanta
sin él. La imagen se construyó y se probó el 20 y el 21 de agosto.

```
db  ──sano──>  migrate  ──termina bien──>  app
└── pg-backup
```

`migrate` corre una vez, hace `db push` + `post-push.mjs`, y se apaga. Si alguna
regla no quedó puesta, sale con error y la cadena se corta ahí: la app no
arranca contra una base a la que le falta un candado.

Para desarrollo hay un `docker-compose.dev.yml` aparte, con el código montado en
vivo. El sitio queda en `http://localhost:8081`.

Tres cosas que hay que saber antes de tocarlo:

1. El build por defecto apunta a **Cloudflare Workers** (es donde publica
   Lovable). El Dockerfile fuerza `NITRO_PRESET=node-server` por variable de
   entorno. **No lo muevas a `vite.config.ts`** o rompés el deploy de Lovable.
2. Las variables `VITE_*` se hornean en el bundle **en tiempo de build**, no de
   runtime. Por eso van como `args` y no como `environment`. Si las movés, la
   imagen compila pero la app rompe en el navegador.

3. **Prisma 7 no lleva binarios nativos**, lleva un compilador en WASM. Todo lo
   que se lee por ahí sobre dockerizar Prisma —`binaryTargets`, la pelea con
   musl, instalar `openssl`— es de la versión 6 para atrás y acá no aplica.
   Está explicado en el `Dockerfile`.

`read_only: true` en el servicio `app` **sí funciona** — se probó. La app no
escribe en disco; lo que persiste vive en el contenedor de la base.

---

## 7. Qué falta

### Importante

- **Fotos reales.** Sigue siendo el techo del diseño. Hacen falta 8–12: sala,
  detalle de manos trabajando, texturas de producto y **retratos de las
  profesionales**. Sin eso, ninguna decisión de CSS llega al "wow".
- **Una clienta puede auto-confirmarse el turno** o cambiarle la fecha por API.
  La policy `clients update own appointments` deja modificar cualquier columna
  del turno propio. Se arregla restringiendo qué campos puede tocar.
- ~~**Datos de contacto:** `email` e `instagram` de ejemplo.~~ Hechos el
  18/8/2026: en `src/lib/contact.ts` están el mail, las dos redes
  (`@shiraf_beauty` en Instagram y TikTok) y el dominio `shiraf.com.ar`.
- **El favicon sigue siendo el de Lovable.** El logo pesa 254 KB para mostrarse
  a 44px; conviene exportar una versión chica en WebP.

### Funcionalidad

- **`mi-cuenta` no filtra por `client_id`.** Se apoya en la RLS, así que a un
  admin le muestra los turnos de todas las clientas en su propia cuenta.
- **Clientes** en el panel es sólo lectura.
- **Pago online**: nunca se definió. El brief decía que no se había hablado con
  la clienta.
- **Gift cards**: idea de negocio que apareció mirando la competencia. Para un
  spa suele ser una línea de ingreso importante.
- **Slider antes/después**: lo mejor que tiene carmennavarro.com y encaja
  perfecto para depilación definitiva y radiofrecuencia. Necesita pares de fotos.

### Técnico

- **El contenido no se renderiza en el servidor.** Todas las consultas son
  client-side con react-query, así que el HTML inicial sale sin servicios ni
  profesionales. Google ejecuta JS y los ve, pero contradice el trabajo de SEO
  que sí está hecho en los meta tags. Se arregla con loaders de TanStack.
- Quedan 7 warnings de ESLint, todos de shadcn/ui (`react-refresh`). Son
  inofensivos.

---

## 8. Cómo levantarlo

Todo corre en Docker. En la máquina no hace falta ni Node ni Postgres.

```sh
docker compose -f docker-compose.dev.yml up     # http://localhost:8081
```

La primera vez, además, hay que llenar la base:

```sh
docker compose -f docker-compose.dev.yml run --rm app sh -c   "bunx prisma generate && bunx prisma db push && node scripts/post-push.mjs && bun prisma/seed.ts"
```

Las 4 cuentas quedan **sin contraseña usable**: se les pone una desde
"recuperar contraseña", o con un `UPDATE` desde `npm run studio`.

Si preferís correr las verificaciones en el host (no hace falta Docker para
eso, pero sí `npx prisma generate` una vez):

Verificaciones antes de dar algo por terminado:

```sh
npx tsc --noEmit   # tiene que dar 0 errores
npm run lint       # 0 errores, 7 warnings de shadcn
npm run build      # 0 errores
npm run format     # prettier — el repo tenía CRLF y daba 8123 errores de lint
```

**Windows:** el repo venía con saltos de línea CRLF y ESLint marcaba 8123
errores por eso. `npm run format` los normaliza. Si vuelven a aparecer, conviene
un `.gitattributes` con `* text=auto eol=lf`.

**Puerto ocupado:** si el dev server arranca en 8081, quedó un proceso node
viejo tomando el 8080. Hay que matarlo — si conviven dos, pelean por escribir
`routeTree.gen.ts` y tiran `EPERM`.

---

## 9. Trampas ya pisadas

Cosas que costaron encontrar y no conviene volver a descubrir:

- **Rutas anidadas y el 404 fantasma.** Al partir `/servicios` en
  `servicios.index.tsx` + `servicios.$serviceId.tsx`, TanStack arma un padre
  virtual y el SSR responde **404 aunque la página renderice bien**. Se arregla
  agregando un `servicios.tsx` explícito que sólo devuelve `<Outlet />`. El
  mismo patrón usa `admin.tsx`.
- **`search` obligatorio en los `<Link>`.** Con `exactOptionalPropertyTypes`,
  declarar `{ service: string | undefined }` (clave obligatoria con valor
  `undefined`) obliga a pasar `search` en cada link. Hay que declarar
  `{ service?: string }` y omitir la clave al construir el objeto.
- **`invalidateQueries` no se espera.** Es asíncrono: si el toast de éxito sale
  antes, el usuario ve "guardado" con el dato viejo en pantalla y piensa que no
  funcionó. Pasó con el stock. Usar `await`.
- **Tailwind sólo emite lo que encuentra en el markup.** Dos utilidades
  (`dot-leader`, `index-row`) quedaron definidas pero sin usar y compilaban en
  cero. Si se borra un componente, revisar si dejó CSS huérfano.
- **Los tipos ya no se editan a mano.** Los genera `prisma generate` desde
  `schema.prisma`. Si tocás el esquema y no corrés `generate`, TypeScript sigue
  viendo el modelo viejo y los errores no mencionan a Prisma.
- **`npx prisma generate` no necesita base.** Sólo lee el schema. Es el paso que
  más se olvida al clonar en una máquina nueva, y sin él **todos** los
  `import { prisma }` tiran error de tipos y parece que el proyecto está roto.
- **`db push` es silencioso con lo que no conoce.** No toca triggers ni
  funciones, pero puede llevarse por delante el `CHECK` y los índices parciales.
  Por eso `post-push.mjs` corre siempre después y **verifica**. Nunca corras
  `db push` solo: usá `npm run db:sync`.
- **El puerto del host y el del contenedor son dos cosas distintas.** Vite se
  ata al 8080 adentro; el compose lo publica en el 8081 porque el 8080 del host
  lo tiene Docker Desktop. Confundirlos deja la pestaña en blanco con los logs
  diciendo que todo está bien.
- **No commitear `package-lock.json`.** El lockfile del repo es `bun.lock`. Uno
  generado en Windows rompe los builds en Linux por las dependencias opcionales
  de rollup/esbuild. Ya está en `.gitignore`.
