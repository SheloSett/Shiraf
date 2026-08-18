# Pendientes de Shiraf

## 📍 Dónde quedé — 18/8/2026

### 🔴 LO PRIMERO EN LA OTRA PC: completar el `.env`

**Las 14 migraciones están corridas.** No hay nada que aplicar en la base.

Pero el `.env` **no viaja por el repo**, y esta tanda sumó cuatro variables
nuevas que antes no existían. Sin ellas el sitio levanta igual, así que el error
no aparece hasta que alguien confirma un turno y el mail no sale. Copiarlas de
[`.env.example`](.env.example) y completarlas:

| Variable | Para qué | Si falta |
| --- | --- | --- |
| `RESEND_API_KEY` | mandar los mails de turno | el panel avisa "por mail no salió" |
| `MAIL_FROM` | el remitente, de un dominio verificado en Resend | ídem |
| `MAIL_REPLY_TO` | a dónde contesta la clienta | contesta a `MAIL_FROM` |
| `REMINDERS_SECRET` | la llave de `POST /api/recordatorios` | el endpoint responde 401 a todo |

⚠️ **El Gmail del centro no sirve como `MAIL_FROM`**: Google no deja que otro
proveedor firme por sus dominios y Resend rechaza el envío. Va en
`MAIL_REPLY_TO`. Todo el detalle en
[`supabase/emails/README.md`](supabase/emails/README.md).

### 🟡 Lo que falta probar en pantalla (nada de esto se probó todavía)

Las tres funcionalidades del 18/8 están escritas, compilan y tienen la migración
corrida, pero **ninguna se usó contra la base**. Es lo primero que conviene
hacer:

- [ ] **Mi agenda** (ver más abajo). Vincular una ficha, entrar con esa cuenta y
      que aparezcan los turnos.
- [ ] **Galería de tratamientos.** Subir varias fotos y un video a un
      tratamiento, reordenarlas, y ver que la portada del catálogo sea la
      primera imagen.
- [ ] **Avisos por mail.** Confirmar un turno y ver si llega. Necesita el `.env`
      de arriba. El recordatorio además necesita la tarea programada.

### ✅ Agenda de la profesional — migración corrida (18/8/2026)

`20260818020000_professional_agenda.sql` ya está aplicada.

**Falta el paso a mano, una sola vez por profesional.** Hay dos caminos, según
de dónde vengas:

- **No tiene cuenta todavía** → **Profesionales**, en su tarjeta, botón
  **"Darle acceso"**: pide sólo mail y contraseña —el nombre sale de la ficha—,
  crea la cuenta y la ata en un solo paso.
- **Ya tiene cuenta** (o querés vincularte la tuya) → **Equipo**, en su tarjeta,
  elegir la **ficha de profesional** en el desplegable.

Sin ese paso no se rompe nada: simplemente no le aparece la sección.

Sin probar todavía en pantalla.

---

**Fuera de eso, la segunda PC está lista.** Rama bajada, `.env` completo —las 11
variables, Supabase y Cloudinary—, dev server en `http://localhost:8080/`.

### ✅ 1. Migración de `team_member_ids` — corrida (18/8/2026)

`20260818000000_team_member_ids.sql` está aplicada y probada en pantalla: en
Clientes el equipo ya no aparece, y en el buscador de "Nuevo turno" sí, marcado.

Verificado además contra la base: la función devuelve `42501` a `anon`, o sea que
existe y el `REVOKE` la deja sólo para gente logueada.

### ✅ 2. El `.env` está completo (18/8/2026)

Las 11 variables cargadas y verificadas contra los dos servicios: Supabase
responde, y la API de Cloudinary acepta las credenciales y ya lista fotos en
`shiraf/servicios/`.

Acordarse de que **el `.env` no viaja por el repo**: en una máquina nueva hay que
volver a armarlo desde `.env.example`.

Nota menor: Node acá es v20.20.2 y una dependencia pide ≥22.12, así que
`npm install` tira un warning `EBADENGINE`. **No es bloqueante** — el build
compila igual. Actualizar Node cuando haya un rato.

### ✅ 3. La migración de doble reserva — corrida (18/8/2026)

`20260813020000_prevent_double_booking.sql` ya está aplicada en la base. Con eso
quedan andando `professional_busy_slots()` (los horarios vuelven a aparecer en
el panel y en `/reservar`) y `trg_check_appointment_overlap` (la base ya rechaza
dos turnos encimados con la misma profesional).

Pendiente de probarlo a mano en cuanto esté el `.env`.

**No falta ninguna: las 14 están corridas** (las tres del 18/8, confirmadas por
la dueña esa misma tarde). Lo que falta ahora es probarlas en pantalla, no
aplicarlas.

| Migración                                     | Estado                               |
| --------------------------------------------- | ------------------------------------ |
| `20260813000000` product_categories           | ✅                                   |
| `20260813010000` service_categories           | ✅                                   |
| `20260813020000` prevent_double_booking       | ✅ (corrida el 18/8)                 |
| `20260813030000` service_images_bucket        | ✅ (bucket `servicios`)              |
| `20260813040000` appointment_rules            | ✅ (`appointments.price`)            |
| `20260813060000` add_staff_role               | ✅ (enum `staff`)                    |
| `20260813070000` permissions                  | ✅ (`user_permissions`)              |
| `20260814010000` split_sensitive_columns      | ✅ (`client_notes`, `product_costs`) |
| `20260816000000` rename_category_atomic       | ✅                                   |
| `20260816010000` / `20260816020000` invitadas | ✅ (`guest_*`, `normalize_phone`)    |
| `20260818000000` team_member_ids              | ✅ (corrida el 18/8)                 |
| `20260818010000` service_media                | ✅ (corrida el 18/8)                 |
| `20260818020000` professional_agenda          | ✅ (corrida el 18/8)                 |
| `20260818030000` appointment_reminders        | ✅ (corrida el 18/8)                 |

### ✅ 4. Todo pusheado

`panel-solo-para-el-equipo` está en `origin` con upstream y árbol limpio. Al
18/8 a la noche incluye todo lo de esa fecha: el equipo separado de las clientas,
los datos de contacto reales, el cierre del home, la galería de tratamientos, los
avisos por mail y la agenda de la profesional. `origin/main` está al día también.

**El merge a `main` sería fast-forward** (la rama tiene los 8 commits de `main`
más los suyos, y `main` no tiene ninguno que la rama no tenga):

```
git checkout main
git merge panel-solo-para-el-equipo
git push origin main
```

Sin `--rebase` ni `--squash`: Lovable sincroniza `main` y perdería el historial.
Conviene esperar a probar todo lo de la semana con el `.env` puesto, porque son
cambios grandes y ninguno se probó a fondo todavía.

### ✅ Las tandas: ninguna quedó a medias

Las cuatro se entregaron completas en código, y con la migración del 18/8 no
queda nada pendiente de aplicar en la base.

- **Tanda 0** — higiene: `.gitattributes`, `.env` fuera del repo
- **Tanda 1** — reglas de turnos: validación, alcance por clienta, precio
  congelado _(el `prevent_double_booking` es de acá)_
- **Tanda 2** — el panel carga turnos + recuperar y cambiar contraseña
- **Tanda 3** — los 5 bugs medianos (detalle más abajo)

### 🟢 Panel de la profesional — hecho y con la migración corrida (18/8)

Cada profesional entra al panel y ve **"Mi agenda"**: sus próximos turnos con el
tratamiento, el día, la hora, la clienta, su teléfono y sus notas clínicas. Sólo
lectura — no confirma, no cancela, no mueve nada.

**La pieza que faltaba** era el vínculo: `professionals.user_id` existía desde la
primera migración y nunca se había escrito, así que la ficha de la profesional y
la cuenta con la que entra eran dos cosas sueltas. Ahora se atan desde Equipo.

Tres decisiones que conviene no perder de vista:

- **No es un permiso.** No hay casilla que tildar: se gana atando la ficha y se
  pierde desactivándola. Por eso es el único nivel de acceso que la dueña no
  pasa automáticamente — si ella también atiende, hay que vincularle su ficha.
- **El teléfono y las notas clínicas los ve** (decisión del centro, 18/8). Las
  notas son las que evitan aplicar algo contraindicado. Sólo de **sus** clientas
  y sólo de los turnos que tiene por delante: `my_agenda()` no sabe devolver otra
  cosa.
- **Vincular la ficha lo puede hacer sólo la dueña**, por trigger en la base.
  Sin ese candado, cualquiera con "Gestionar profesionales" podía apuntarse una
  ficha ajena y quedarse leyendo los teléfonos y las notas de esas clientas.

Lo que queda para cuando el centro lo pida:

- [ ] ¿Puede **confirmar** sus propios turnos? Hoy no. Eso necesita una policy de
      UPDATE sobre `appointments`, y conviene pensarla entonces: confirmar es
      responderle a una clienta, y hoy esa respuesta la da el centro.
- [ ] ¿Ve lo que **ya hizo**? Hoy la lista es sólo para adelante. Un historial
      propio es otra pantalla, no un filtro más.

### 🟠 Hecho el 18/8, TODAVÍA SIN COMMITEAR

- **El equipo ya no se confunde con las clientas.** El buscador de "Nuevo turno"
  y la pantalla de Clientes listaban `profiles` sin filtro, así que las empleadas
  y la dueña aparecían como clientas. Se resuelve distinto en cada pantalla, a
  propósito:
  - **Clientes** no las muestra. Es la base comercial y una empleada con 0 turnos
    ensucia la lectura.
  - **Nuevo turno** sí, con etiqueta «Equipo» y ordenadas al final: una empleada
    también se atiende y hay que poder cargarle el turno.
- **`SLOT_BUFFER_MINUTES` pasó a 10**, por decisión del centro.
- Se arregló el warning de hidratación que salía en cada carga (`__root.tsx`).
- `.env.example`: la `SUPABASE_SERVICE_ROLE_KEY` estaba comentada con un "todavía
  no hace falta" que ya era falso — la usan `team.functions.ts` y
  `client.server.ts` para el alta y la baja de empleadas.

### ✅ Hecho el 17/8, ya commiteado en la rama

- La cuenta del centro entra al panel y no a la tienda; `/mi-cuenta` y
  `/reservar` la desvían. Se agregó `/admin/cuenta` (contraseña + accesos) y
  "Cerrar sesión" adentro del panel.
- Los turnos se **encadenan** en vez de caer en una grilla de 30 minutos.
- En "Nuevo turno" la hora **se elige de una lista**; el campo libre quedó detrás
  de "Cargar fuera de horario".
- Un error al pedir los horarios ya no se lee como "no hay turnos".

---

## 🟡 Reglas de la agenda — falta una sola (act. 18/8/2026)

Los horarios se **encadenan**: cada turno arranca cuando termina el anterior y el
paso lo da la duración del tratamiento más el margen de limpieza. Una profesional
de 12 a 16 con sesiones de 45 ofrece `12:00 · 12:55 · 13:50 · 14:45`.

De las tres decisiones, **queda pendiente sólo `ALLOW_OVERTIME`**. Todas son
**una constante** arriba de [`src/lib/shiraf.ts`](src/lib/shiraf.ts), con el
comentario que explica cada lado.

### 1. `ALLOW_OVERTIME` — ¿el último turno puede pasarse de la hora de salida?

Hoy en **`false`**. Con la profesional de 12 a 16, sesiones de 45 y los 10 de
limpieza, las 15:40 **no** se ofrecen porque terminarían 16:25.

- [ ] Preguntarle al centro: _"si la salida es a las 16, ¿la podemos hacer quedar
      hasta las 16:30?"_

Está en `false` y no en `true` —que es la lista que se pidió— por dónde duele
equivocarse. En `false` se ofrece un turno de menos y el panel lo puede cargar
igual a mano. En `true` una clienta reserva sola, por el sitio, un horario que
deja a la profesional trabajando después de su hora, y eso ya no se deshace.

Ojo con un efecto que no es obvio: el desborde lo acota la **duración del
tratamiento**, no un ratito fijo. Esa misma profesional, con una depilación de
90, encadena 12:00 y 13:40; en `true` se le suma 15:20, que termina **16:50** —
cincuenta minutos tarde. La regla no distingue "un ratito" de "casi una hora".

### 2. ✅ `SLOT_BUFFER_MINUTES` — decidido: 10 minutos (18/8/2026)

El centro definió **10 minutos de limpieza** entre clienta y clienta. Ya está
aplicado. Antes estaba en `0` y los turnos iban pegados.

La profesional de 12 a 16 con sesiones de 45 pasa de `12:00 · 12:45 · 13:30 ·
14:15 · 15:00` a `12:00 · 12:55 · 13:50 · 14:45`: entra una clienta menos.

- [ ] **Repreguntar si conviene `15` en vez de `10`.** Con 15 esa agenda queda
      `12:00 · 13:00 · 14:00 · 15:00` — entran las mismas cuatro clientas, así
      que no cuesta ningún turno, pero los horarios quedan redondos en vez de
      caer en :55, :50 y :45, que son horribles de dictar por teléfono. Es
      cambiar un número.

### 3. Recalcular vs. grilla fija — decidido, pero revisable

Quedó en **recalcular**. Si un masaje de 45 ocupa 12:00–12:45, una depilación de
90 se ofrece desde las **12:45**, no desde las 13:30.

La alternativa era la grilla fija: horarios siempre iguales contados desde que
abre la profesional, borrando el que esté pisado. Más predecible, pero deja 45
minutos muertos que nadie puede usar.

- [ ] Confirmarlo con el centro cuando se vean las otras dos.

---

## ✅ Cloudinary — hecho y andando (15/8/2026)

Subida firmada desde el servidor, entrega con transformaciones por URL.
Pendiente de esto, nada. Queda anotado para producción:

- [ ] Cargar las 4 variables `CLOUDINARY_*` en el entorno del deploy (Vercel o
      el VPS). En el `docker-compose.yml` ya están declaradas.
- [ ] Las fotos viejas siguen en Supabase Storage y se ven bien: `imageUrl()`
      devuelve intacta toda URL que no sea de Cloudinary. Migran solas a medida
      que se reemplacen. Si algún día se quiere apurar, es resubirlas a mano.

---

## 🔴 Set SMTP en Supabase para cambiar los templates de email

### El paso cero — ya contestado (18/8/2026)

Los datos reales están en [`src/lib/contact.ts`](src/lib/contact.ts):

- Dominio: **`shiraf.com.ar`**
- Mail: **`shirafbeautyandspa@gmail.com`**
- Instagram y TikTok: **`@shiraf_beauty`** (mismo usuario en las dos)

Queda una sola pregunta abierta, y es la que destraba todo lo de abajo:

- [ ] ¿Dónde está registrado `shiraf.com.ar` (NIC.ar, Donweb, otro) y quién
      entra al panel de DNS? Sin cargar SPF y DKIM no hay remitente propio.

⚠️ **El Gmail no sirve como remitente.** Resend y Brevo piden un dominio que
puedan firmar, y Google no deja firmar por `gmail.com`. Las dos salidas:

- **Recomendada:** crear `hola@shiraf.com.ar` y verificar el dominio en Resend.
  El Gmail queda como `reply-to`, así las respuestas siguen llegando a la casilla
  de siempre.
- **Rápida:** mandar por el SMTP de Google (`smtp.gmail.com`, puerto `465`, con
  una contraseña de aplicación). No hay que comprar nada, pero el tope es ~500
  mails por día y Gmail le muestra a la clienta un "vía gmail.com".

### Por qué hay que hacerlo sí o sí

Supabase **bloquea la edición de las plantillas** hasta que haya SMTP propio. El
cartel está en Authentication → Emails → Templates:

> _Set up custom SMTP to edit templates. Emails will be sent using the default
> templates._

O sea que el formato del mail y el remitente vienen juntos, no se pueden separar.
Hoy a la clienta le llega un mail **en inglés**, de `noreply@mail.app.supabase.io`,
con un pie que dice _"powered by Supabase"_.

Y hay un motivo que no es de imagen: el envío de fábrica está limitado a unos
pocos mails por hora y la documentación de Supabase dice que no es para
producción. Un sábado con varias clientas registrándose, los mails dejan de salir.

### Pasos, una vez que esté el dominio

1. [ ] Crear cuenta en **Resend** (gratis: 3.000 mails/mes) o Brevo
2. [ ] Agregar el dominio y cargar los registros **SPF y DKIM** en el DNS
3. [ ] Esperar la verificación — suele tardar minutos
4. [ ] Generar las credenciales SMTP
5. [ ] Supabase → Authentication → Emails → **SMTP Settings**: host, puerto `465`,
       usuario, contraseña, remitente `hola@shiraf.com.ar`, nombre `Shiraf`,
       `reply-to` `shirafbeautyandspa@gmail.com`
6. [ ] Ya destrabadas, pegar las plantillas en la pestaña **Templates**:
   - `Confirm sign up` ← [`supabase/emails/confirmar-cuenta.html`](supabase/emails/confirmar-cuenta.html)
     · asunto: `Confirmá tu cuenta en Shiraf`
   - `Reset password` ← [`supabase/emails/recuperar-contrasena.html`](supabase/emails/recuperar-contrasena.html)
     · asunto: `Recuperá tu contraseña de Shiraf`
7. [ ] Agregar `https://shiraf.com.ar/recuperar` en Authentication → URL
       Configuration → Redirect URLs. Hoy solo está `http://localhost:8081/recuperar`
8. [ ] Probar en Gmail **y** en Outlook: Outlook usa el motor de Word y es el que
       más rompe

Las plantillas ya están escritas y se pueden mirar sin Supabase, con el dev
server levantado:
`http://localhost:8081/preview-mails/recuperar-contrasena.html`

⚠️ **Cuidado con el toggle "Enable custom SMTP":** si queda encendido con los
campos vacíos, dejan de salir todos los mails.

---

## Lo próximo, por orden de dolor real

- [ ] **Recordatorio de turno 24h antes.** Es lo que baja el ausentismo, que es
      la métrica del negocio en este rubro. Hay que decidir: ¿mail o WhatsApp?
      ¿y quién dispara el cron, `pg_cron` en Supabase o el VPS? Si va por mail,
      depende del SMTP de arriba.
- [ ] **Las invitadas no aparecen en Clientes.** Los turnos de gente sin cuenta
      ya se pueden cargar, pero la pantalla de Clientes lista `profiles`, así
      que alguien que vino tres veces sin registrarse no figura en ningún lado.
      Falta decidir si esa pantalla debe mostrarlas y cómo.
- [x] ~~**Vincular una invitada con su cuenta.**~~ Hecho (migración
      `20260816020000`): por mail se vincula sola al confirmarse la cuenta, y por
      teléfono a mano desde la lista de turnos.
- [ ] **Bloqueos de agenda:** vacaciones, feriados, francos. Hoy solo hay horario
      semanal fijo, sin excepciones por fecha: un 25 de diciembre es reservable.

## ✅ Tanda 3 — los 5 bugs medianos, hechos (16/8/2026)

- [x] Borrar un servicio ahora borra su foto. Y cerrar el formulario sin
      guardar también borra la que se haya subido para la vista previa, que era
      la otra fuente de huérfanas.
- [x] Colisión de `["admin-services"]` resuelta: Profesionales usa
      `["admin-services", "picker"]`, que mantiene el prefijo para que la
      invalidación la siga alcanzando.
- [x] Renombrado de categoría atómico, en `rename_service_category` y
      `rename_product_category` (migración `20260816000000`). El permiso se
      chequea explícitamente: en un UPDATE la RLS filtra filas en vez de dar
      error, así que sin eso la operación "salía bien" sin hacer nada.
- [x] Desactivar o borrar una profesional avisa cuántos turnos futuros deja
      colgados. Activar no pregunta nada.
- [x] `mi-cuenta` filtra por `client_id` y ya no se apoya sólo en la RLS.

## Chicas

- [ ] El comentario de `requiredAccessFor` en [`src/lib/permissions.ts`](src/lib/permissions.ts)
      quedó viejo: dice que `clients_notes` y `stock_costs` no tienen respaldo en
      la base, pero la migración `20260814010000` los convirtió en candados reales.
- [ ] `profiles.birth_date` existe en la tabla y no se muestra ni se edita en
      ningún lado. Los cumpleaños son acción comercial clásica en estética.
- [ ] El favicon sigue siendo el de Lovable.
- [ ] Fotos reales del centro. Sigue siendo el techo del diseño.
