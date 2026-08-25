# Las 39 policies, y dónde quedó cada una

Mientras la base fue Supabase, **quien decidía qué veía cada persona era
Postgres**. Había 39 policies y se aplicaban siempre: si el código se olvidaba un
chequeo, la base lo frenaba igual.

Eso ya no existe. `src/server/db.ts` se conecta con un usuario que es dueño de
todo y no le pregunta a nadie. **Cada una de estas 39 reglas tiene que estar
escrita en algún lado del código, o no está.**

Este archivo es el que permite auditarlo. Sin él no hay forma de saber si quedó
algo sin cubrir, y con 39 reglas algo va a quedar sin cubrir.

## ✅ Completada el 21/8/2026

Las 39 están cubiertas. Se verificó de dos formas, y las dos importan:

1. **Ruta por ruta**: los 61 endpoints de `src/server/routes/` se listaron con sus
   middlewares. Ninguno quedó sin protección salvo los que tienen que estar
   abiertos —`/api/publico/*` y el login— y `/api/turnos/mi-agenda`, que pide
   sesión pero **no** el permiso `appointments`, a propósito: ver los turnos
   propios no es gestionar los del centro, y el alcance lo pone la sesión.
2. **Contra la base**, con los datos reales: sin sesión, `/api/turnos`,
   `/api/catalogo/servicios`, `/api/stock/productos`, `/api/equipo/empleadas` y
   `/api/clientas` contestan **401**; con la sesión de la dueña, **200**.

## Cómo se completa

Una fila por policy. Cuando escribas el controller que la reemplaza, cambiá el
⬜ por ✅ y anotá el archivo y la función exactos. **No lo hagas de memoria ni al
final**: se hace mientras escribís cada controller.

El inventario salió de reconstruir el historial de `supabase/migrations/`
—creando y dropeando en orden— y da 39 vivas. Contar los `CREATE POLICY` da 61 y
está mal: 26 fueron reemplazadas. La columna «Vigente en» dice de qué migración
hay que copiar la regla, que es siempre **la última que la tocó**.

---

## Turnos — `appointments` (5)

Lo más sensible del sistema: una clienta tiene que ver **sólo** los suyos.

| ✔   | Policy                            | Op     | Regla                                          | Vigente en     | Dónde queda                                                                                                                   |
| --- | --------------------------------- | ------ | ---------------------------------------------- | -------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| ✅  | `read appointments`               | SELECT | `client_id = uid` **o** permiso `appointments` | 20260813070000 | turnos.controller → listar/pendientes/calendario (ruta: `appointments`) · clientas.controller → misTurnos (filtra por sesión) |
| ✅  | `update appointments`             | UPDATE | Ídem, y vale para leer **y** para escribir     | 20260813070000 | turnos.controller → cambiarEstado (ruta: `appointments`) · clientas.controller → cancelarMiTurno + exigirAlcanceDeClienta     |
| ✅  | `staff create appointments`       | INSERT | Permiso `appointments`                         | 20260813070000 | turnos.controller → crear (ruta: `appointments`)                                                                              |
| ✅  | `clients create own appointments` | INSERT | `client_id = uid`. La más vieja y sigue viva   | 20260805164122 | reservar.controller → reservar (el client_id sale de la sesión, no del body)                                                  |
| ✅  | `delete appointments`             | DELETE | Permiso `appointments`                         | 20260813070000 | turnos.controller → borrar (ruta: `appointments`). Sólo si el turno ya no se va a atender: lo que se puede atender se cancela |

## Fichas de clientas — `profiles` (3)

| ✔   | Policy               | Op     | Regla                                                              | Vigente en     | Dónde queda                                                                                                |
| --- | -------------------- | ------ | ------------------------------------------------------------------ | -------------- | ---------------------------------------------------------------------------------------------------------- |
| ✅  | `read profiles`      | SELECT | `uid = id` **o** `clients_contact` **o** `appointments` ← ver nota | 20260813070000 | clientas.controller → listar (`clients_contact` o `appointments`) · turnos.controller → clientasParaElegir |
| ✅  | `update profiles`    | UPDATE | `uid = id` **o** `clients_contact`                                 | 20260813070000 | clientas.controller → guardarMiFicha (sólo la propia)                                                      |
| ✅  | `own profile insert` | INSERT | `uid = id`                                                         | 20260805164122 | auth.controller → register (crea profile y rol en la misma transacción)                                    |

> ### 🔴 El OR de `read profiles` no es un descuido
>
> Lee **`clients_contact` o `appointments`**, y hay que traducir los dos. El
> motivo está escrito en la migración: la pantalla de turnos muestra el nombre y
> el teléfono de quien reservó, así que una empleada que sólo gestiona turnos
> tiene que poder leer la ficha. **Si al traducir se escapa el segundo, la agenda
> queda mostrando una lista de «—» en vez de nombres.**
>
> Ojo con resolverlo llamando a `impliedPermissions()` de
> `src/lib/permissions.ts`: ese helper existe para que la pantalla de accesos no
> ofrezca una casilla que promete un candado inexistente, y **`puede()` no lo
> aplica**. Acá hay que chequear los dos permisos explícitamente, como hacía la
> policy. Para eso está `puedeAlguno()` en `authz.service.ts`.

> ### Borrar una clienta no estaba entre las 39, y por eso es de la dueña
>
> Ninguna policy permitía borrar un `profile`: en Supabase las cuentas se
> borraban con la Admin API, fuera del alcance de la RLS. `DELETE
> /api/clientas/:id` es nuevo, así que no hay regla vieja de la cual copiar el
> candado — y con el mismo criterio fail-closed del resto del archivo se le
> puso `exigirAdmin()`, el que ya usa la baja de una empleada.
>
> El candado está **adentro del controller y no en la ruta**
> (`clientas.controller → borrarClienta`): el middleware de las otras rutas de
> `/clientas` deja pasar a quien tiene `clients_contact` **o** `appointments`,
> que es leer, no borrar cuentas con su historial.

## Notas clínicas — `client_notes` (3)

Alergias, embarazos, antecedentes. Tabla aparte de `profiles` justamente para
poder pedirle un permiso distinto.

| ✔   | Policy                | Op     | Regla                                   | Vigente en     | Dónde queda                                                                                          |
| --- | --------------------- | ------ | --------------------------------------- | -------------- | ---------------------------------------------------------------------------------------------------- |
| ✅  | `read client notes`   | SELECT | `client_id = uid` **o** `clients_notes` | 20260814010000 | clientas.controller → listar (sólo si `clients_notes`) · agenda.service → miAgenda (sólo sus turnos) |
| ✅  | `write client notes`  | INSERT | Ídem                                    | 20260814010000 | clientas.controller → guardarMiFicha                                                                 |
| ✅  | `update client notes` | UPDATE | Ídem                                    | 20260814010000 | clientas.controller → guardarMiFicha                                                                 |

## Reparto de accesos — `user_roles` (3) y `user_permissions` (3)

| ✔   | Policy                          | Op     | Regla                             | Vigente en     | Dónde queda                                                          |
| --- | ------------------------------- | ------ | --------------------------------- | -------------- | -------------------------------------------------------------------- |
| ✅  | `read own roles`                | SELECT | `user_id = uid` **o** rol admin   | 20260805164122 | authz.service → accesoDe (siempre por userId de la sesión)           |
| ✅  | `admin assigns non-admin roles` | INSERT | Rol admin **y** `role <> 'admin'` | 20260813070000 | team.functions → createEmployee (verifica admin con la service role) |
| ✅  | `admin removes non-admin roles` | DELETE | Ídem                              | 20260813070000 | team.functions → deleteEmployee (exige que la víctima sea staff)     |
| ✅  | `read permissions`              | SELECT | `user_id = uid` **o** rol admin   | 20260813070000 | authz.service → accesoDe                                             |
| ✅  | `admin grants permissions`      | INSERT | **Rol** admin, no permiso         | 20260813070000 | equipo.controller → cambiarPermiso + exigirAdmin                     |
| ✅  | `admin revokes permissions`     | DELETE | Ídem                              | 20260813070000 | equipo.controller → cambiarPermiso + exigirAdmin                     |

> ⚠️ Repartir accesos es del **rol** `admin`, no de un permiso, y es a propósito:
> ningún permiso se amplía a sí mismo. Va con `exigirAdmin()`, nunca con
> `exigirPermiso()`. Y el `role <> 'admin'` tampoco es decorativo: impide que se
> fabrique una segunda dueña.

## Catálogo — `services` (3), `service_media` (3), `service_categories` (1)

| ✔   | Policy                                  | Op     | Regla                                         | Vigente en     | Dónde queda                                                                |
| --- | --------------------------------------- | ------ | --------------------------------------------- | -------------- | -------------------------------------------------------------------------- |
| ✅  | `published services anon`               | SELECT | `is_published`. **Sin sesión**                | 20260805165527 | publico.controller → listarServicios/verServicio (filtra is_published)     |
| ✅  | `published services authenticated`      | SELECT | `is_published` **o** `catalog`                | 20260813070000 | ídem: la ruta pública no mira la sesión                                    |
| ✅  | `manage services`                       | ALL    | `catalog`                                     | 20260813070000 | catalogo.controller (ruta: `catalog`)                                      |
| ✅  | `published service media anon`          | SELECT | El tratamiento del que cuelga está publicado  | 20260818010000 | publico.controller → verServicio (la galería sale del servicio publicado)  |
| ✅  | `published service media authenticated` | SELECT | `catalog` **o** el tratamiento está publicado | 20260818010000 | ídem                                                                       |
| ✅  | `manage service media`                  | ALL    | `catalog`                                     | 20260818010000 | catalogo.controller → crear/editar (la galería va en la misma transacción) |
| ✅  | `manage service categories`             | ALL    | `catalog`                                     | 20260813070000 | categorias.controller → *DeServicios (ruta: `catalog`)                     |

## Equipo — `professionals` (3), `professional_services` (2), `professional_schedules` (2)

| ✔   | Policy                               | Op     | Regla                                                    | Vigente en     | Dónde queda                                                                     |
| --- | ------------------------------------ | ------ | -------------------------------------------------------- | -------------- | ------------------------------------------------------------------------------- |
| ✅  | `active professionals anon`          | SELECT | `is_active`. **Sin sesión**                              | 20260805165527 | publico.controller → listarProfesionales (filtra is_active)                     |
| ✅  | `active professionals authenticated` | SELECT | `is_active` **o** `team`                                 | 20260813070000 | ídem                                                                            |
| ✅  | `manage professionals`               | ALL    | `team` — **y `exigirAdmin()` para `user_id`**, ver abajo | 20260813070000 | equipo.controller → crear/editar/activar/borrar (ruta: `team`)                  |
| ✅  | `professional services public`       | SELECT | `true` — anon y con sesión                               | 20260805164122 | publico.controller → profesionalesDelServicio                                   |
| ✅  | `manage professional services`       | ALL    | `team`                                                   | 20260813070000 | equipo.controller → crear/editar                                                |
| ✅  | `schedules public`                   | SELECT | `true` — anon y con sesión                               | 20260805164122 | publico.controller → listarProfesionales · reservar.controller → disponibilidad |
| ✅  | `manage schedules`                   | ALL    | `team`                                                   | 20260813070000 | equipo.controller → crear/editar                                                |

## Stock — `products`, `stock_movements`, `product_categories`, `product_costs` (1 cada una)

| ✔   | Policy                      | Op  | Regla                                 | Vigente en     | Dónde queda                                                        |
| --- | --------------------------- | --- | ------------------------------------- | -------------- | ------------------------------------------------------------------ |
| ✅  | `manage products`           | ALL | `stock`                               | 20260813070000 | stock.controller (ruta: `stock`)                                   |
| ✅  | `manage stock movements`    | ALL | `stock`                               | 20260813070000 | stock.controller → mover (el trigger de saldo sigue en la base)    |
| ✅  | `manage product categories` | ALL | `stock` ← **no `catalog`**, ver abajo | 20260814000000 | categorias.controller → *DeProductos (ruta: `stock`, NO `catalog`) |
| ✅  | `manage product costs`      | ALL | `stock_costs` — los costos de compra  | 20260814010000 | stock.controller → listar/editar (sólo con `stock_costs`)          |

> ⚠️ **Dos cosas de esta tabla.**
>
> `product_categories` pide **`stock`**, no `catalog`, y es contraintuitivo:
> agrupan cremas e insumos internos que no salen en el sitio. Lo arregló
> `20260814000000` y no hay que volverlo atrás.
>
> Y ninguna de las cuatro tiene policy de lectura pública: el stock no se muestra
> en el sitio. **Al pasarlas a código hay que exigir el permiso también para
> leer**, no sólo para escribir — es el error fácil, porque en el resto de las
> tablas leer es lo abierto.

---

## Las 4 de `storage.objects` se descartan

`servicios lectura publica`, `servicios alta`, `servicios cambio` y
`servicios baja`. El bucket de Supabase Storage muere con la migración y las
fotos nuevas van a Cloudinary, que tiene su propia firma del lado servidor en
`src/lib/cloudinary.functions.ts`. **No hay que traducirlas.**

## Los 3 triggers de autorización

🟡 = la regla está escrita en `src/server/services/turnos.service.ts`, pero
**todavía no la llama nadie**: los controllers se escriben en la Fase 6. Una
regla escrita y no llamada no protege nada. Pasan a ✅ cuando el controller que
escribe en esa tabla las invoque.

No eran policies pero hacían lo mismo, y también hay que portarlos.

| ✔   | Trigger                            | Qué garantiza                                                  | Dónde queda                                      |
| --- | ---------------------------------- | -------------------------------------------------------------- | ------------------------------------------------ |
| 🟡  | `enforce_appointment_client_scope` | Qué puede tocar una clienta de su propio turno                 | `turnos.service.ts` → `exigirAlcanceDeClienta()` |
| 🟡  | `validate_appointment`             | Turno futuro, dentro del horario, precio y duración congelados | `turnos.service.ts` → `validarTurno()`           |
| 🟡  | `guard_professional_account_link`  | Sólo la dueña ata una ficha a una cuenta                       | `authz.service.ts` → `exigirPoderAtarFicha()`    |

> ### 🔴 `enforce_appointment_client_scope`: copiá de `20260819000000` y de ninguna otra
>
> Esta función va por su cuarta versión y **ya se rompió una vez exactamente
> así**: `20260818030000` la reescribió desde una copia vieja, revirtió sin
> querer dos cambios, y dejó a la empleada sin poder confirmar turnos.
>
> La versión buena es `20260819000000_fix_appointment_client_scope.sql`.
>
> Lo que tiene que decir, en orden: quien tiene el permiso `appointments` pasa
> —incluida la dueña, que lo cumple siempre—; de ahí para abajo es una clienta
> sobre su propio turno, y **lo único suyo es cancelarlo y su nota**. No puede
> tocar `status` para nada que no sea `cancelled`, ni `client_id`, `service_id`,
> `professional_id`, `starts_at`, `duration_minutes`, `price`, `admin_notes`,
> los tres `guest_*`, `reminded_at` ni `created_at`.

> ### 🔴 `guard_professional_account_link` es una filtración esperando
>
> Sin él, **cualquiera con el permiso `team` se ata a sí mismo una ficha de
> profesional ajena** y pasa a ver los teléfonos y las notas clínicas de las
> clientas de esa profesional.
>
> El chequeo es: al escribir `professionals.user_id`, `exigirAdmin()`. No alcanza
> con `exigirPermiso(acceso, "team")` — `team` es justamente lo que tiene quien
> haría el abuso.
