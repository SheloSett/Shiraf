# Pendientes de Shiraf

> ### 👉 Si venís a seguir el trabajo, empezá por [`PARA-PROBAR.md`](PARA-PROBAR.md)
>
> Ahí está lo último que se hizo (31/8/2026), qué quedó verificado y **qué falta
> probar** — que es bastante, porque nada que escriba en la base o mande un mail
> se ejercitó. Este archivo son los pendientes de fondo del proyecto; aquél es
> el estado de la tanda en curso, en la rama `trabajo/margen-y-ausencias`.

## 🔜 Lo que sigue — act. 27/8/2026

Cerrado hoy: la rama `trabajo/panel-turnos-y-reprogramar` se mergeó a `main`, se
subió al VPS y **los mails salen en producción**. Eso era el bloqueo más viejo
del proyecto. Lo que queda, por orden:

### 🟡 0. Correr `db:sync` por el permiso «Ver métricas» — act. 28/8/2026

El Dashboard y Métricas ya andan **para la dueña**: `puede()` cortocircuita en
`esAdmin`, así que no necesita que nadie le tilde nada.

Lo que falta es poder **delegarlo**. El valor `metrics` se agregó al enum
`app_permission` en `schema.prisma`, pero la base todavía no lo tiene. Hasta que
se corra:

    bun run db:sync

la casilla «Ver métricas» aparece en Accesos y **guardarla tira un error de
Postgres** (`invalid input value for enum app_permission`). No rompe nada más:
leer permisos no necesita el valor, sólo escribirlo.

Agregar un valor a un enum no borra datos y no pide reset. Hay que correrlo en
las dos: la local y la del VPS.

### 🔴 1. HTTPS — hoy las contraseñas viajan en claro

Se entra por **`http://177.7.59.16:3000`**, con `APP_BIND=0.0.0.0` y sin
certificado. Cada login, cada registro y cada recuperación de contraseña va sin
cifrar. Está bien para probar; **no** para que entre una clienta.

Tres pasos, en orden, y el tercero se olvida:

1. **El dominio.** Sigue sin saberse dónde está registrado `shiraf.com.ar`. Es
   el cabo suelto más viejo: bloqueó Resend, ahora bloquea esto.
2. **nginx + certbot**, un `server` block como los de los otros dos sitios del
   VPS (el ecommerce y la inmobiliaria), apuntando a `127.0.0.1:3000`. El
   ejemplo está en [`DOCKER.md`](DOCKER.md).
3. **`APP_URL` a `https://…` y `APP_BIND` de vuelta a `127.0.0.1`** en el `.env`
   del servidor. Los dos importan: de `APP_URL` sale el flag `Secure` de la
   cookie, así que si se olvida el sitio queda con certificado y la cookie sin
   proteger. Y `APP_URL` también arma los links de los mails, que hoy apuntan a
   la IP.

### 🟡 2. Restaurar un backup, una vez

`shiraf-backup` corre y guarda desde el 27/8, pero **un backup que nunca se
restauró es una suposición**. Hay que probarlo una vez contra una base
descartable, no contra la de producción.

Y sacar una copia **fuera del VPS**. En el mismo disco no protege de nada: si se
pierde el disco, se pierden la base y sus respaldos juntos.

### 🟡 3. No pausar Supabase todavía

Es el único rollback verdadero. Recién cuando el nuevo lleve **dos semanas
andando** y con un `pg_dump` completo guardado afuera. Antes de pausarlo hay que
resubir las fotos que sigan en Supabase Storage.

### 🟢 4. Las dos preguntas para el centro, juntas y en este orden

Están desarrolladas más abajo, en «Reglas de la agenda». El orden importa porque
la primera hace menos urgente a la segunda:

1. **¿Limpieza de 15 minutos en vez de 10?** Con la agenda real de Julieta
   —lunes 14 a 20, sesiones de 45— da los **mismos seis turnos** pero en
   horarios redondos (`14:00 · 15:00 · 16:00 · 17:00 · 18:00 · 19:00` contra
   `14:00 · 14:55 · 15:50 · 16:45 · 17:40 · 18:35`) y con 15 minutos muertos al
   final en vez de 40. Con Sofia no cambia nada. **No cuesta ninguna clienta en
   ninguna de las dos agendas.**
2. **¿El último turno puede pasarse de la hora de salida?** (`ALLOW_OVERTIME`)

### 🟢 5. Sueltos

- [ ] **Destildarle «Ver datos de clientas» a `camila@gmail.com`** en la base
      LOCAL. Se lo puse el 27/8 para probar que a una empleada no le aparece la
      papelera de borrar clientas — la prueba pasó. Ojo que desde ese mismo día
      ese permiso incluye **las notas clínicas**.
- [ ] **Las 4 cuentas del VPS siguen con la contraseña del seed**, imposible de
      acertar a propósito. Se arreglan desde «¿Olvidaste tu contraseña?», que
      recién funciona desde el 27/8.
- [ ] **Decidir si la ficha de un turno muestra las notas clínicas.** Hoy no las
      trae, y el motivo por el que no las traía —que tenían candado propio— dejó
      de existir al unir los permisos. Está anotado con ⚠️ en
      `turnos.controller.ts`. Si la recepcionista abre un turno, el momento en
      que una alergia importa es ése.

---

## 📍 Dónde quedé — 21/8/2026

### La migración a base propia está hecha

El proyecto salió de Supabase. Corre sobre **Postgres 17 propio en Docker**, con
Prisma y un backend en `src/server/`. Las fases 0 a 6 del plan están hechas y
probadas contra la base con los datos reales.

Todo el detalle —incluido qué se decidió y por qué— está en
[`MIGRACION-A-PRISMA.md`](MIGRACION-A-PRISMA.md). Lo que sigue acá es sólo lo
que queda por hacer.

### 🟡 Fase 7 — el VPS. Está andando; falta el candado y el respaldo.

**El sitio corre en `http://177.7.59.16:3000` desde el 25/8/2026.** Esta sección
decía "nada de esto se corrió todavía" hasta el 27/8 y era mentira desde el
primer día: ver 734b322, que existe porque el sitio ya estaba arriba y la dueña
no podía entrar.

- [x] `docker compose up -d` en el VPS. Levanta `db → migrate → app` más el
      contenedor de backups.
- [x] Completar el `.env` de allá. Sumadas el 27/8 las tres del correo:
      `SMTP_USER`, `SMTP_PASS` y `MAIL_REPLY_TO`. `REMINDERS_SECRET` dejó de
      usarse — el endpoint que la pedía ya no existe.
- [x] Los datos están cargados y el esquema al día. Verificado el 27/8 contra el
      servidor: `db push` en sync, post-push 3/3 triggers · 2/2 CHECK · 4/4
      índices · 1/1, las columnas `cancel_reason` y `professional_name` puestas,
      la migración de permisos aplicada y los dos relojes programados en hora de
      Buenos Aires.
- [ ] **Ponerle contraseña a las 4 cuentas** desde "recuperar contraseña".
      Quedaron con una imposible de acertar a propósito. Recién se puede desde
      el 27/8: hasta ese día no salía ningún mail, y era el bloqueo más viejo
      del proyecto.
- [ ] 🔴 **HTTPS.** Hoy se entra por IP y sin certificado, así que **las
      contraseñas viajan en claro**. Anda por `APP_BIND=0.0.0.0`, que está
      pensado para probar, no para que entren clientas. Hace falta el dominio,
      un `server` block de nginx como el de los otros dos sitios del VPS, y
      después actualizar `APP_URL` a `https://…` — de ahí sale el flag `Secure`
      de la cookie, y si se olvida queda sin él.
- [ ] **Restaurar un backup, una vez.** Un backup que nunca se restauró es una
      suposición. Y sacar una copia fuera del VPS: en el mismo disco no sirve.

### 🟡 Lo que falta probar en pantalla, con una persona usándolo

La app se ejercitó por HTTP contra la base real —los 61 endpoints, el login, las
páginas— pero **nadie hizo clic en nada**. Es lo primero que conviene hacer:

- [ ] Entrar con cada rol y recorrer su panel: dueña, empleada, profesional.
- [ ] Cargar un turno, confirmarlo, cancelarlo.
- [ ] Subir una foto y un video a un tratamiento, reordenar la galería.
- [ ] Reservar como clienta desde `/reservar`.
- [ ] Registrarse con el mail de una invitada y ver que se le pasen sus turnos.

### 🟢 Tres cosas que se destrabaron al migrar

- **Las plantillas de mail en castellano.** Supabase no las dejaba editar sin
  SMTP propio y a la clienta le llegaba un mail en inglés. Ahora las manda la
  app desde [`emails/`](emails/), por SMTP de Gmail con nodemailer, igual que el
  ecommerce. Ya no hace falta la cuenta de Resend ni verificar `shiraf.com.ar`:
  sólo una **contraseña de aplicación** de Google en `SMTP_PASS`. Ver
  [`emails/README.md`](emails/README.md).
- **Las migraciones a mano.** Se acabó copiar SQL en el editor web: el esquema
  se sincroniza con `npm run db:sync`.
- **El cron de los recordatorios.** Ya no hay nada que programar en el VPS ni
  ningún secreto que generar: la app es un proceso propio y el reloj corre
  adentro, como en el ecommerce. Se programa solo al arrancar el contenedor, a
  las 10 y a las 13 de Buenos Aires. Ver
  [`reminders.service.ts`](src/server/services/reminders.service.ts).

### ⬜ Fase 8 — limpieza. Hecha, salvo el último paso.

Ya se borró `src/integrations/supabase/`, se desinstaló el paquete, las
variables quedaron comentadas en el `.env` y estos documentos están al día. Las
migraciones viejas se mudaron a
[`docs/historia-supabase/`](docs/historia-supabase/LEEME.md) — **no se borran**:
son la única documentación de por qué existe cada regla.

- [ ] **No pausar el proyecto de Supabase todavía.** Es el único rollback
      verdadero. Recién cuando el nuevo lleve **dos semanas andando** en el VPS,
      y con un `pg_dump` completo guardado fuera.
- [ ] Antes de pausarlo: resubir las fotos que sigan en Supabase Storage. Se ven
      bien igual, pero son el último hilo que ata el proyecto viejo.

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

### 2. ✅ El margen de limpieza — ahora lo decide cada tratamiento (31/8/2026)

El centro definió **10 minutos** el 18/8/2026, para todo el catálogo, en
`SLOT_BUFFER_MINUTES`. El 31/8 dejó de ser un número único: es
`services.buffer_minutes`, una columna por tratamiento, porque una depilación
deja la cabina para limpiar y un masaje no.

La constante sigue existiendo, pero **sólo como el default** de esa columna —el
valor que se usa cuando el dato falta. No se calcula ninguna agenda con ella.

Entre dos turnos manda el margen del que TERMINA: el rato es para limpiar lo que
ése acaba de usar. Está explicado en `buildSlots`.

- [x] ~~**Repreguntar si conviene `15` en vez de `10`.**~~ Sin objeto: ya no hay
      un número para todo el catálogo. Lo que era una decisión global pasó a ser
      un campo del formulario de tratamientos, y el centro lo ajusta por
      tratamiento sin tocar código. La cuenta de horarios redondos que estaba en
      PARA-PROBAR.md sigue sirviendo para elegir el de cada uno.

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

## ✅ Mails: andando desde el 26/8/2026 — se descartó Resend

**Los mails salen.** Probado de punta a punta: el de recuperar contraseña llegó.

Se descartó Resend, que era el bloqueo más viejo del proyecto y no era técnico:
exige un dominio propio verificado con SPF y DKIM, y **todavía no se sabe dónde
está registrado `shiraf.com.ar`**. Ese trámite tenía los mails frenados semanas.

Ahora se manda con **nodemailer por el SMTP de Gmail**, igual que
`Ecommerce_mm`. Sin cuenta de ningún servicio ni dominio que verificar: alcanza
con la casilla que el centro ya usa, con una **contraseña de aplicación** de
Google (`SMTP_USER` + `SMTP_PASS` en el `.env`; ver
[`emails/README.md`](emails/README.md)).

Las plantillas siguen igual, en [`emails/`](emails/), y el transporte quedó en un
solo lugar: `src/server/services/email.service.ts`. Antes había dos clientes de
Resend escritos por separado.

> ⚠️ **`MAIL_FROM` va sin definir mientras se mande por Gmail.** Su SMTP sólo
> deja mandar como la casilla autenticada; poner `turnos@shiraf.com.ar` sin tener
> ese dominio andando hace que los mails dejen de salir sin que el código se
> entere.

### Lo que queda pendiente del correo

- [ ] Probar en **Outlook** además de Gmail: usa el motor de Word y es el que más
      rompe las plantillas.
- [ ] Los mails nuevos del 26/8 —pedido de turno, cancelación con motivo,
      resumen de vencidos— **no se enviaron ni una vez**. Ver
      [`PARA-PROBAR.md`](PARA-PROBAR.md).
- [ ] **Dónde está registrado `shiraf.com.ar`.** Ya no bloquea nada, pero el día
      que se quiera mandar desde `turnos@shiraf.com.ar` en vez del Gmail, hace
      falta el panel de DNS.

Las plantillas se pueden mirar sin mandar nada, con el dev server levantado:
`http://localhost:8081/preview-mails/recuperar-contrasena.html`

## Lo próximo, por orden de dolor real

- [x] ~~**Recordatorio de turno 24h antes.**~~ Hecho (26/8/2026). Va **por
      mail**, y el cron **vive adentro de la app** con `node-cron`: ni `pg_cron`
      ni el crontab del VPS. Corre a las 10 y a las 13 de Buenos Aires; la
      segunda pasada no manda nada dos veces porque `reminded_at` la hace
      idempotente. Ver `src/server/services/reminders.service.ts`.
      **Falta la versión por WhatsApp**, que en este rubro es el canal que la
      gente mira de verdad — hoy el botón «Avisar» abre el chat con el mensaje
      escrito, pero lo aprieta una persona.
- [ ] **Las invitadas no aparecen en Clientes.** Los turnos de gente sin cuenta
      ya se pueden cargar, pero la pantalla de Clientes lista `profiles`, así
      que alguien que vino tres veces sin registrarse no figura en ningún lado.
      Falta decidir si esa pantalla debe mostrarlas y cómo.
- [x] ~~**Vincular una invitada con su cuenta.**~~ Hecho (migración
      `20260816020000`): por mail se vincula sola al confirmarse la cuenta, y por
      teléfono a mano desde la lista de turnos.
- [x] ~~**Bloqueos de agenda por profesional:** vacaciones, francos.~~ Hecho el
      31/8/2026: `professional_absences`, un rango de días por profesional que se
      carga desde su ficha en Accesos. Lo hacen cumplir `buildSlots` en la
      pantalla y `exigirQueEntreEnLaAgenda` en el servidor.
- [ ] **Feriados del centro** — los que valen para TODAS, no para una. Hoy hay
      que cargar el 25 de diciembre profesional por profesional, y una que se
      agregue después nace sin él. Es la misma tabla con `professional_id`
      nullable, o una propia; conviene decidirlo antes de que haya muchas filas
      cargadas a mano.

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




## http://localhost:8081/admin/turnos
1- falta poder tener una vista en detalle del turno con la posibilidad de ver los datos de la clienta y modificar el estado del turno



## http://localhost:8081/admin/profesionales
- [x]  cuando creo a una profesional automaticamente deberia formar parte del "equipo", entonces en su creacio del profesional debo tener el campo de email y contraseño para que automaticamente ya pueda acceder

- [x] cuando ponemos su horario solo tenemos un rango de horario por dia, es decir que si en el dia tiene su break y trabaja:
LUNES 9:00 a 13:00
14hrs no trabaja
LUNES 15:00 a 17:00

La idea es que sea algo onda:
LUNES 9:00 a 13:00 - 15:00 a 17:00


shiraf

HOME
- [x] fondo mas beige de lo que ya esta...
- [x] El nombre de shiraf calma belleza y bienestar en dorado y primera letra en mayuscula, logo agrandado

- [x] "Cada piel es distinta. El tratamiento también." en el HOME - no va

- [x] seccion de servicio en el Home SACARLO


SERVICIOS
- [x] ¿Qué necesita tu piel hoy? no va VA "Como te vas Consentir hoy"
      → en el sitio va **"Cómo te vas a consentir hoy"**: mismas palabras, con la
      tilde y la "a" que faltaban en el pedido. Corregido el 27/8 a pedido de la
      dueña; antes estaba copiado literal y se leía como error de tipeo.



x- recordatorios en el dia del turno/ y un wasap apenas saquen turno, Astrid-Profesional-cliente
      → el mail de todos esos avisos ya sale solo. El WhatsApp hoy es a mano, con
      el botón que abre el mensaje escrito. Automatizarlo depende de una decisión
      de la dueña —número, plantillas y unos dólares por mes—: está todo escrito
      en `docs/whatsapp-automatico.md`, con las tres salidas y qué preguntarle.

- [x] todas las profesionales manejan turnos
      → la cuenta de una profesional nace con «Gestionar turnos» tildado, por las
      dos puertas que la crean (el alta y «Darle acceso» de la tarjeta). Se puede
      destildar en Accesos. Ojo: eso arrastra «Ver datos de clientas», notas
      clínicas incluidas.

x- 10 min de tolerancia ACLARAR AL SACAR UNO Y MANDAR POR WASAP


