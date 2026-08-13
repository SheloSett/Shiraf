# Shiraf — estado del proyecto

Documento de traspaso. Resume qué se hizo, por qué, qué falta y las trampas que
ya se pisaron, para retomar el trabajo sin volver a investigar lo mismo.

Última actualización: **13 de agosto de 2026**.

---

## 1. Qué es

Sitio para el centro de estética Shiraf. Lo generó Lovable a partir de un brief
(está en el `README.md`): vista de clienta con catálogo y reserva de turnos, y
panel de administración con calendario, turnos, servicios, profesionales,
clientes y stock.

**Stack:** TanStack Start (SSR) + React 19 + Vite 8 + Tailwind v4 + shadcn/ui +
Supabase. TypeScript en modo estricto con `exactOptionalPropertyTypes`.

**Detalle clave:** la app **no tiene backend propio**. El navegador habla directo
con PostgREST y la seguridad son las policies de RLS atadas a `auth.uid()`. No
hay endpoints, no hay servidor de API. Sólo se usa **auth + PostgREST**: cero
realtime, cero edge functions, cero RPC más allá de las que se agregaron acá.

---

## 2. Base de datos

⚠️ **El proyecto Supabase original de Lovable ya no se usa.** Se migró a uno
nuevo porque no había acceso administrativo al primero.

- Proyecto actual: `btqqzbhrlwakglaooddg`
- Las claves están en `.env` (versionado en git; son las *publishable*, públicas
  por diseño). **Nunca sumar ahí la service_role key.**
- Al crear el proyecto se **destildó** "Automatically expose new tables", así que
  los permisos los otorgan sólo las migraciones. Como efecto, `appointments` y
  `products` le responden `permission denied` a un anónimo en vez de devolver
  `[]` — falla cerrado y ruidoso, que es lo deseable.

### Migraciones

Las cinco primeras (`20260805*`) son las que generó Lovable. Están unidas en
`supabase/setup-nuevo-proyecto.sql` para levantar un proyecto desde cero.

| Archivo | Qué hace |
| --- | --- |
| `20260813000000_product_categories.sql` | Tabla `product_categories`, sembrada con las categorías en uso |
| `20260813010000_service_categories.sql` | Tabla `service_categories`, ídem |
| `20260813020000_prevent_double_booking.sql` | RPC `professional_busy_slots()` + trigger anti-solapamiento + índice parcial |
| `20260813030000_service_images_bucket.sql` | Bucket `servicios` en Storage + policies |

`supabase/crear-admin.sql` asigna el rol admin a un usuario. Hay que correrlo
**después** de registrarse en `/auth`, porque necesita que el usuario exista en
`auth.users`.

### Por qué el primer admin se crea a mano

El trigger `handle_new_user` le pone rol `client` a todo el que se registra, y
`user_roles` sólo tiene policy de SELECT. Nadie puede insertar roles desde la
app, ni siquiera un admin. Es a propósito — si no, cualquiera se haría admin
solo. **No es un bug.**

### Categorías: decisión de diseño

`products.category` y `services.category` siguen siendo **TEXT**, no claves
foráneas. Las tablas de categorías existen para poder crearlas y renombrarlas,
pero el vínculo se mantiene por nombre.

Motivo: pasarlas a FK obligaba a migrar datos y regenerar los tipos, y
`services.category` se lee desde el sitio público, así que habría que tocar
todas las consultas. Para un catálogo de este tamaño no compensa.

**Consecuencia importante:** renombrar una categoría desde el panel actualiza
también todos los productos/servicios que la usan. Esa lógica está en
`admin.categorias-productos.tsx` y `admin.categorias-servicios.tsx`. Si alguna
vez se toca por fuera del panel, hay que arrastrar el cambio a mano.

---

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
comparten ámbito con las columnas de la tabla y repetirlos puede dar un *column
reference is ambiguous*. `reservar.tsx` los mapea al recibirlos.

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

Van en **Supabase Storage**, bucket `servicios`, público en lectura y escritura
sólo para admin. No hace falta Cloudinary.

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

`Dockerfile`, `docker-compose.yml` y `DOCKER.md` están listos pero **nunca se
construyó la imagen**: no hay Docker instalado en la máquina donde se trabajó.

Dos cosas que hay que saber antes de tocarlo:

1. El build por defecto apunta a **Cloudflare Workers** (es donde publica
   Lovable). El Dockerfile fuerza `NITRO_PRESET=node-server` por variable de
   entorno. **No lo muevas a `vite.config.ts`** o rompés el deploy de Lovable.
2. Las variables `VITE_*` se hornean en el bundle **en tiempo de build**, no de
   runtime. Por eso van como `args` y no como `environment`. Si las movés, la
   imagen compila pero la app rompe en el navegador.

Si el contenedor no arranca en el primer intento, el sospechoso es
`read_only: true` en el compose — es la única línea que no se pudo probar.

---

## 7. Qué falta

### Importante

- **Fotos reales.** Sigue siendo el techo del diseño. Hacen falta 8–12: sala,
  detalle de manos trabajando, texturas de producto y **retratos de las
  profesionales**. Sin eso, ninguna decisión de CSS llega al "wow".
- **Una clienta puede auto-confirmarse el turno** o cambiarle la fecha por API.
  La policy `clients update own appointments` deja modificar cualquier columna
  del turno propio. Se arregla restringiendo qué campos puede tocar.
- **Datos de contacto:** ya están los reales en `src/lib/contact.ts`, pero
  `email` e `instagram` siguen siendo los de ejemplo.
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

```sh
npm install
npm run dev        # http://localhost:8080
```

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
- **`signUp` devuelve `session: null`** cuando el proyecto exige confirmar el
  mail. El código original anunciaba "Cuenta creada" y navegaba a `/mi-cuenta`,
  que sin sesión rebota a `/auth`. Hay que chequear `data.session`.
- **Los tipos de Supabase se editan a mano.** No está instalado el CLI, así que
  `src/integrations/supabase/types.ts` se actualizó a mano para
  `product_categories`, `service_categories` y `professional_busy_slots`. Si se
  agrega algo a la base, hay que sumarlo ahí o TypeScript no lo reconoce.
- **No commitear `package-lock.json`.** El lockfile del repo es `bun.lock`. Uno
  generado en Windows rompe los builds en Linux por las dependencias opcionales
  de rollup/esbuild. Ya está en `.gitignore`.
