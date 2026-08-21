# Las 39 policies, y dónde quedó cada una

Mientras la base fue Supabase, **quien decidía qué veía cada persona era
Postgres**. Había 39 policies y se aplicaban siempre: si el código se olvidaba un
chequeo, la base lo frenaba igual.

Eso ya no existe. `src/server/db.ts` se conecta con un usuario que es dueño de
todo y no le pregunta a nadie. **Cada una de estas 39 reglas tiene que estar
escrita en algún lado del código, o no está.**

Este archivo es el que permite auditarlo. Sin él no hay forma de saber si quedó
algo sin cubrir, y con 39 reglas algo va a quedar sin cubrir.

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

| ⬜  | Policy                            | Op     | Regla                                         | Vigente en     | Dónde queda |
| --- | --------------------------------- | ------ | --------------------------------------------- | -------------- | ----------- |
| ⬜  | `read appointments`               | SELECT | `client_id = uid` **o** permiso `appointments` | 20260813070000 | _pendiente_ |
| ⬜  | `update appointments`             | UPDATE | Ídem, y vale para leer **y** para escribir     | 20260813070000 | _pendiente_ |
| ⬜  | `staff create appointments`       | INSERT | Permiso `appointments`                        | 20260813070000 | _pendiente_ |
| ⬜  | `clients create own appointments` | INSERT | `client_id = uid`. La más vieja y sigue viva  | 20260805164122 | _pendiente_ |
| ⬜  | `delete appointments`             | DELETE | Permiso `appointments`                        | 20260813070000 | _pendiente_ |

## Fichas de clientas — `profiles` (3)

| ⬜  | Policy               | Op     | Regla                                                              | Vigente en     | Dónde queda |
| --- | -------------------- | ------ | ------------------------------------------------------------------ | -------------- | ----------- |
| ⬜  | `read profiles`      | SELECT | `uid = id` **o** `clients_contact` **o** `appointments` ← ver nota | 20260813070000 | _pendiente_ |
| ⬜  | `update profiles`    | UPDATE | `uid = id` **o** `clients_contact`                                 | 20260813070000 | _pendiente_ |
| ⬜  | `own profile insert` | INSERT | `uid = id`                                                         | 20260805164122 | _pendiente_ |

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

## Notas clínicas — `client_notes` (3)

Alergias, embarazos, antecedentes. Tabla aparte de `profiles` justamente para
poder pedirle un permiso distinto.

| ⬜  | Policy                | Op     | Regla                                   | Vigente en     | Dónde queda |
| --- | --------------------- | ------ | --------------------------------------- | -------------- | ----------- |
| ⬜  | `read client notes`   | SELECT | `client_id = uid` **o** `clients_notes` | 20260814010000 | _pendiente_ |
| ⬜  | `write client notes`  | INSERT | Ídem                                    | 20260814010000 | _pendiente_ |
| ⬜  | `update client notes` | UPDATE | Ídem                                    | 20260814010000 | _pendiente_ |

## Reparto de accesos — `user_roles` (3) y `user_permissions` (3)

| ⬜  | Policy                          | Op     | Regla                             | Vigente en     | Dónde queda |
| --- | ------------------------------- | ------ | --------------------------------- | -------------- | ----------- |
| ⬜  | `read own roles`                | SELECT | `user_id = uid` **o** rol admin   | 20260805164122 | _pendiente_ |
| ⬜  | `admin assigns non-admin roles` | INSERT | Rol admin **y** `role <> 'admin'` | 20260813070000 | _pendiente_ |
| ⬜  | `admin removes non-admin roles` | DELETE | Ídem                              | 20260813070000 | _pendiente_ |
| ⬜  | `read permissions`              | SELECT | `user_id = uid` **o** rol admin   | 20260813070000 | _pendiente_ |
| ⬜  | `admin grants permissions`      | INSERT | **Rol** admin, no permiso         | 20260813070000 | _pendiente_ |
| ⬜  | `admin revokes permissions`     | DELETE | Ídem                              | 20260813070000 | _pendiente_ |

> ⚠️ Repartir accesos es del **rol** `admin`, no de un permiso, y es a propósito:
> ningún permiso se amplía a sí mismo. Va con `exigirAdmin()`, nunca con
> `exigirPermiso()`. Y el `role <> 'admin'` tampoco es decorativo: impide que se
> fabrique una segunda dueña.

## Catálogo — `services` (3), `service_media` (3), `service_categories` (1)

| ⬜  | Policy                                  | Op     | Regla                                         | Vigente en     | Dónde queda |
| --- | --------------------------------------- | ------ | --------------------------------------------- | -------------- | ----------- |
| ⬜  | `published services anon`               | SELECT | `is_published`. **Sin sesión**                | 20260805165527 | _pendiente_ |
| ⬜  | `published services authenticated`      | SELECT | `is_published` **o** `catalog`                | 20260813070000 | _pendiente_ |
| ⬜  | `manage services`                       | ALL    | `catalog`                                     | 20260813070000 | _pendiente_ |
| ⬜  | `published service media anon`          | SELECT | El tratamiento del que cuelga está publicado  | 20260818010000 | _pendiente_ |
| ⬜  | `published service media authenticated` | SELECT | `catalog` **o** el tratamiento está publicado | 20260818010000 | _pendiente_ |
| ⬜  | `manage service media`                  | ALL    | `catalog`                                     | 20260818010000 | _pendiente_ |
| ⬜  | `manage service categories`             | ALL    | `catalog`                                     | 20260813070000 | _pendiente_ |

## Equipo — `professionals` (3), `professional_services` (2), `professional_schedules` (2)

| ⬜  | Policy                               | Op     | Regla                                                    | Vigente en     | Dónde queda |
| --- | ------------------------------------ | ------ | -------------------------------------------------------- | -------------- | ----------- |
| ⬜  | `active professionals anon`          | SELECT | `is_active`. **Sin sesión**                              | 20260805165527 | _pendiente_ |
| ⬜  | `active professionals authenticated` | SELECT | `is_active` **o** `team`                                 | 20260813070000 | _pendiente_ |
| ⬜  | `manage professionals`               | ALL    | `team` — **y `exigirAdmin()` para `user_id`**, ver abajo | 20260813070000 | _pendiente_ |
| ⬜  | `professional services public`       | SELECT | `true` — anon y con sesión                               | 20260805164122 | _pendiente_ |
| ⬜  | `manage professional services`       | ALL    | `team`                                                   | 20260813070000 | _pendiente_ |
| ⬜  | `schedules public`                   | SELECT | `true` — anon y con sesión                               | 20260805164122 | _pendiente_ |
| ⬜  | `manage schedules`                   | ALL    | `team`                                                   | 20260813070000 | _pendiente_ |

## Stock — `products`, `stock_movements`, `product_categories`, `product_costs` (1 cada una)

| ⬜  | Policy                      | Op  | Regla                                 | Vigente en     | Dónde queda |
| --- | --------------------------- | --- | ------------------------------------- | -------------- | ----------- |
| ⬜  | `manage products`           | ALL | `stock`                               | 20260813070000 | _pendiente_ |
| ⬜  | `manage stock movements`    | ALL | `stock`                               | 20260813070000 | _pendiente_ |
| ⬜  | `manage product categories` | ALL | `stock` ← **no `catalog`**, ver abajo | 20260814000000 | _pendiente_ |
| ⬜  | `manage product costs`      | ALL | `stock_costs` — los costos de compra  | 20260814010000 | _pendiente_ |

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

| ⬜  | Trigger                            | Qué garantiza                                                  | Dónde queda |
| --- | ---------------------------------- | -------------------------------------------------------------- | ----------- |
| 🟡  | `enforce_appointment_client_scope` | Qué puede tocar una clienta de su propio turno                 | `turnos.service.ts` → `exigirAlcanceDeClienta()` |
| 🟡  | `validate_appointment`             | Turno futuro, dentro del horario, precio y duración congelados | `turnos.service.ts` → `validarTurno()` |
| 🟡  | `guard_professional_account_link`  | Sólo la dueña ata una ficha a una cuenta                       | `authz.service.ts` → `exigirPoderAtarFicha()` |

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
