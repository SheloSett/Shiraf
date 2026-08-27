# Qué cambió y qué falta probar

Rama: **`trabajo/panel-turnos-y-reprogramar`** · actualizado el **26/8/2026**

Nada se mergeó a `main`.

Este archivo se reescribe cada vez que se cierra una tanda de trabajo. Lo de la
tanda anterior (25/8: colores del calendario, estado a la vista, reprogramar)
sigue abajo, en **«Lo que venía de antes»**, porque hay cosas de ahí que todavía
no se probaron.

---

## ✅ Segunda tanda del 26/8 — en la máquina de casa, que SÍ tiene Docker

Casi todo lo que la tanda anterior dejó sin probar **ya se probó**, y aparecieron
cinco cosas que no estaban en el plan. Las listas de más abajo quedaron viejas:
lo que sigue pendiente está al final de esta sección.

### Lo que apareció probando, y no estaba en el plan

| Qué | Por qué no se había visto |
|---|---|
| **`bun.lock` desincronizado** — `docker compose build` fallaba entero | La otra máquina no tenía Docker. 37771f4 sacó `@lovable.dev/vite-tanstack-config` de `package.json` pero el lockfile quedó con él y su árbol. **Bloqueaba la fase 7** |
| **Los dos composes compartían `shiraf-app:latest`** | El de dev no declaraba `image:` y Docker se lo armaba por convención con el mismo nombre que el de producción |
| **Reprogramar se chocaba contra sí mismo** | El horario propio volvía como ocupado, así que no se podía cambiar sólo de profesional |
| **Los horarios de reprogramar salían en ISO** | `{h}` a secas: decía `2026-08-31T13:50:00.000Z` — y en UTC, tres horas corrida |
| **La tolerancia no se leía** | `text-xs` sobre una card de L 0.99: misma letra chica que el renglón del pago |

Y de yapa, dos trampas del entorno que hacen perder un rato largo:

- **`npm install` en el host deja el typecheck roto** con errores que no existen
  (`service_name` no existe, `slug` no existe). Es el cliente de Prisma viejo: el
  contenedor lo regenera al arrancar y el host no. Se arregla con
  `npx prisma generate` y `DATABASE_URL` exportada.
- **Matar el dev server con `Stop-Process -Force` se lleva puesto el Postgres**
  cuando la base es local sin Docker. Acá no aplica — la base corre en su
  contenedor — pero sigue valiendo en la otra máquina.

### Verificado contra la base y por HTTP real

Para probar los endpoints sin la contraseña de nadie se firmó un token con el
`JWT_SECRET` local (payload `{ id, email, role }`, cookie `shiraf_sesion`).
Queda anotado porque sirve para la próxima.

| Qué | Cómo quedó |
|---|---|
| **El choque de turnos llega como 409, no como 500** | Confirmado en las dos capas: el trigger levanta `23P01`, Prisma lo envuelve en un `P2039`, y `mensajeDeTrigger()` lo desentierra de `meta.driverAdapterError.cause`. Por HTTP: `409 "Ese horario ya fue tomado con esa profesional."` |
| **La regla de 6 horas, contra el endpoint** | `422` en cancelar *y* en reprogramar, con mensajes distintos. El turno quedó `pending` |
| **Reprogramar, camino feliz** | `200`. Cambia hora y profesional, refresca `professional_name`, **limpia `reminded_at`**, no toca el estado ni el precio |
| **`excluir=<id>`** | Antes `10:50 · 14:00 · 14:55`; ahora `09:00 · 10:50 · 14:00 · 14:55`. Las 09:55 siguen ocultas, que es correcto |
| **La grilla de horarios** | Sofia y Julieta dan exactamente lo calculado a mano. Ni 11:45 ni 19:30: `ALLOW_OVERTIME=false` se respeta |
| **El SMTP de Gmail** | `transporter.verify()` conecta y hace login |
| **Los 7 avisos de turno** | Los 7 mandados de verdad: `requested`, `new-request`, `confirmed`, `cancelled`, `client-cancelled`, `reminder`, `rescheduled` |
| 🔴 **El motivo llega a la clienta** | El mail de cancelación trae `Motivo: …`. Confirmado leyendo el texto |
| **La tolerancia en los mails** | Está en el del pedido y en el de la confirmación |
| **El resumen de vencidos** | Mandado. Hay 4 vencidos y el mail se llevó 3: el del 18/8 cayó fuera de la ventana de 7 días, que es el caso de control |
| **Borrar un turno** | La pantalla ESCONDE el botón mientras el turno se pueda atender (`seBorra`), y el servidor rechaza igual: `409` en pendiente y en confirmado. Ya cancelado o vencido, se borra — probados los dos por la dueña |
| **Borrar una clienta** | `403` a una empleada, `409` a la dueña si tiene turnos por venir (y dice cuántos), `200` si no. El CASCADE se lleva cuenta, ficha, rol, **nota clínica** y turnos: cinco ceros, y nada más se tocó |
| **Los turnos se guardan bien** | `professional_name` y `service_name` congelados, `cancel_reason` vacío, `reminded_at` en null |

> Todas las pruebas que escribieron en la base se revirtieron. Se sacó un
> respaldo antes de empezar (`npm run db:backup`) y la base quedó igual que al
> principio: 8 turnos, los mismos estados, `cancel_reason` vacío en todos.

### Lo que TODAVÍA falta

1. **La papelera de una clienta, vista por una empleada.** Único pendiente
   real, y es de 30 segundos: entrar con `camila@gmail.com` a Clientes y mirar
   que no aparezca. El servidor ya la rechaza con 403 y la pantalla tiene el
   `{isAdmin && …}`, así que es confirmar, no descubrir.
2. **El recordatorio no dice la tolerancia.** Está en el mail del pedido y en el
   de la confirmación, pero no en el del día previo — que es justo el que se lee
   la noche antes. Es una decisión, no un bug; vale repreguntarla.
4. **`shiraf-app:latest` quedó con una imagen de dev vieja** en esta máquina.
   Antes de cualquier `docker compose up -d` de producción hay que forzar
   `docker compose build app`.

### Una decisión de agenda que conviene llevar al centro con un número

`SLOT_BUFFER_MINUTES` está en 10 y TODO.md deja abierto repreguntar si conviene
15. Con la agenda real de Julieta —lunes 14 a 20, sesiones de 45— la cuenta da:

| Con 10 (hoy) | Con 15 |
|---|---|
| `14:00 · 14:55 · 15:50 · 16:45 · 17:40 · 18:35` | `14:00 · 15:00 · 16:00 · 17:00 · 18:00 · 19:00` |
| Termina 19:20 → **40 minutos muertos** | Termina 19:45 → **15 minutos muertos** |
| 6 turnos | **6 turnos** |

Mismos seis turnos, horarios redondos y menos de la mitad del hueco al final.
Con Sofia da igual con 10 o con 15. O sea que subir la limpieza a 15 **no cuesta
ninguna clienta en ninguna de las dos agendas**, y de paso hace bastante menos
urgente la otra decisión pendiente, `ALLOW_OVERTIME`.

---

## Antes de empezar en otra máquina

Esta máquina no tiene Docker: la base local es un PostgreSQL propio en
`C:\Users\2\.shiraf-pg`, escuchando en el **5433**. Si la otra sí tiene Docker,
usá el compose de siempre y salteate esto.

```bash
npm install
npm run db:local        # arranca el Postgres (NO es un servicio: no arranca solo)
npm run dev             # http://localhost:8080
```

> ### ⚠️ La base se cae si la consola recibe una señal
>
> Pasó de nuevo el 26/8: matar el dev server con `Stop-Process -Force` se llevó
> puesto el Postgres, porque en Windows queda en el mismo grupo de procesos. El
> síntoma engaña: **el sitio sigue respondiendo 200 y lo único que falla es el
> login, con un 500.** Si ves eso, lo primero es `npm run db:local:status`.
>
> Está explicado arriba de `scripts/pg-local.mjs`, con la salida definitiva
> (registrarlo como servicio de Windows, que pide permisos de administrador).

**El `.env` no viaja por git.** Además de `DATABASE_URL`, `JWT_SECRET`, `APP_URL`
y Cloudinary, ahora hacen falta **las dos del correo** (ver abajo). Se arma desde
`.env.example`.

Entrar al panel: **`shelosetton@gmail.com` / `shiraf-local`**. Esa contraseña
está sólo en la base local; el seed deja las cuentas sin contraseña usable.

---

## Lo que se hizo el 26/8

### 1. Los mails salen de verdad — se fue Resend

Era el bloqueo más viejo del proyecto y no era técnico: Resend exige un dominio
propio verificado (SPF y DKIM), y sigue sin saberse dónde está registrado
`shiraf.com.ar`.

**Ahora se manda con `nodemailer` por el SMTP de Gmail**, igual que
`Ecommerce_mm` (`backend/src/services/email.service.js`). Sin cuenta de ningún
servicio ni dominio que verificar: alcanza con la casilla que el centro ya usa.

```
SMTP_USER="shirafbeautyandspa@gmail.com"
SMTP_PASS="contraseña de aplicación de Google, 16 letras, sin espacios"
MAIL_REPLY_TO="shirafbeautyandspa@gmail.com"
```

La contraseña de aplicación se saca en
[myaccount.google.com/apppasswords](https://myaccount.google.com/apppasswords) y
pide verificación en dos pasos activada.

> **`MAIL_FROM` quedó SIN definir a propósito.** Gmail sólo deja mandar como la
> casilla autenticada o como un alias confirmado en «Enviar como»; poner
> `turnos@shiraf.com.ar` sin tener ese dominio andando hace que los mails dejen
> de salir sin que el código se entere. Sin la variable, el remitente sale de
> `SMTP_USER`. El día que el dominio tenga correo propio, se cambian las tres
> `SMTP_*` y se define `MAIL_FROM`: **el código no se toca**.

También se unificó el transporte. Antes había DOS clientes de Resend escritos por
separado —uno en `email.service.ts` para los mails de cuenta y otro adentro de
`notifications.server.ts` para los avisos de turno—. Ahora hay una sola función
`enviarMail()` y los dos la usan.

### 2. El cron de recordatorios vive adentro de la app

`POST /api/recordatorios` y `REMINDERS_SECRET` **ya no existen**. Ese endpoint
con secreto existía porque con Supabase el disparo venía de afuera (`pg_cron`
primero, el crontab del VPS después) y quien llama de afuera no tiene sesión.

Con contenedor propio eso sobra: el reloj corre adentro del proceso con
`node-cron`, como en el ecommerce. Vive en
`src/server/services/reminders.service.ts`.

| Reloj | Cuándo | Qué hace |
|---|---|---|
| `recordatorios` | `0 10,13 * * *` AR | El aviso del día previo a la clienta |
| `vencidos` | `0 10 * * *` AR | Resumen al centro de los turnos sin cerrar |

Dos pasadas para el recordatorio y una sola para el resumen, y no es un descuido:
el recordatorio es idempotente (`reminded_at` deja afuera a quien ya lo recibió),
así que la de las 13 cubre el día en que el contenedor estaba reiniciándose a las
10 sin mandarle nada a nadie dos veces. El resumen no es idempotente: dos pasadas
serían dos mails iguales.

**No arranca en dos casos, y los dos son a propósito:** fuera de
`NODE_ENV=production` (para que un `npm run dev` olvidado no le mande
recordatorios de verdad a las clientas reales de la base local) y en Cloudflare
Workers (no hay proceso vivo entre pedidos).

> ⚠️ **El reloj se programa con el PRIMER PEDIDO, no al arrancar el proceso.**
> Nitro carga el módulo del SSR de forma perezosa. En el contenedor da igual —el
> `HEALTHCHECK` le pega a `/` cada 30 segundos— pero si algún día los
> recordatorios no salen, esto es lo primero que hay que mirar. La línea que lo
> confirma en el log es `[recordatorios] Programados: …`.

### 3. Avisos por mail en cada estado del turno

| Cuándo | A quién | Evento |
|---|---|---|
| La clienta reserva | A ella | `requested` (nuevo) |
| La clienta reserva | Al centro | `new-request` |
| El centro confirma | A la clienta | `confirmed` |
| El centro cancela | A la clienta, **con el motivo** | `cancelled` |
| La clienta cancela | Al centro | `client-cancelled` (nuevo) |
| Día previo | A la clienta | `reminder` |
| Turnos sin cerrar | Al centro, 1 por día | resumen de vencidos (nuevo) |

**«Realizado» no manda mail**, decidido con la dueña el 26/8: es una anotación
interna posterior a la visita; avisarle es contarle algo que ya vivió.

**«Vencido» no es un estado de la base** —es pendiente o confirmado con la hora
pasada— así que no puede disparar un mail por sí solo. Se resolvió con el resumen
diario al centro, que empuja a **reprogramar** (que es lo único que recupera ese
turno) o a cerrarlo. Mira los últimos **7 días**: más atrás sería una lista que
nadie termina de vaciar y el mail se archivaría sin leer.

⚠️ Los permisos de `notifyAppointment` van **por evento**, y hay que mirarlos dos
veces antes de tocarlos: los tres que dispara la clienta sobre su propio turno
(`new-request`, `requested`, `client-cancelled`) sólo exigen que el turno sea
suyo; todo el resto exige el permiso `appointments`. Mover un evento de una lista
a la otra deja que cualquiera con cuenta le mande a otra un «tu turno fue
cancelado» firmado por Shiraf.

### 4. El motivo de la cancelación

Columna nueva: `appointments.cancel_reason` (aplicada en la base local el 26/8
con `npm run db:sync`; `post-push` verificó 3/3 triggers, 2/2 CHECK, 4/4 índices
parciales).

La casilla aparece al cancelar desde las tres pantallas: la lista de turnos, la
ficha y «Mi cuenta». Es **opcional** en las dos puntas — obligar a escribir algo
para poder cancelar es la forma segura de que todo el mundo escriba "x".

> 🔴 **No es una nota interna.** Cuando cancela el centro, ese texto **se le
> manda a la clienta en el mail**, y por eso el cartel lo dice con todas las
> letras («se lo contamos a la clienta»). Sin ese aviso, alguien escribe «clienta
> pesada, no atender más» creyendo que queda puertas adentro. Para eso está
> `admin_notes`.

El componente es uno solo: `src/components/cancelar-turno-dialog.tsx`, con los
textos dados vuelta según quién cancela.

### 5. Tolerancia de espera: 10 minutos

`TOLERANCIA_MINUTOS` en `src/lib/shiraf.ts`, con las otras perillas del negocio.
Se dice en la pantalla de reserva **antes** de confirmar y en los mails del
pedido y de la confirmación.

⚠️ **Comparte el número con `SLOT_BUFFER_MINUTES` y no tiene nada que ver con
él**: aquél es el rato de limpieza entre clientas. Son dos constantes a propósito
— el día que el centro decida esperar 15 minutos, cambiar un solo número no puede
ensanchar también los huecos de la agenda.

### 6. Eliminar turnos y clientas

- **`DELETE /api/turnos/:id`** (permiso `appointments`). Un turno que todavía se
  va a atender **no se borra: se cancela primero**, porque cancelar es lo único
  que le avisa a la clienta. Ya cancelado, vencido o realizado, se borra.
- **`DELETE /api/clientas/:id`** (**sólo la dueña**, `exigirAdmin`). Se lleva la
  cuenta, la ficha, las notas clínicas y **los turnos** (todo por CASCADE). Se
  frena si tiene turnos por venir sin cancelar. La pantalla cuenta cuántos turnos
  se van antes de confirmar.

El candado de borrar una clienta va **adentro del controller y no en la ruta**: el
middleware de las otras rutas de `/clientas` deja pasar a quien tiene
`clients_contact`, que es leer, no borrar historiales.

---

## ✅ Verificado el 26/8

| Qué | Cómo |
|---|---|
| Typecheck, ESLint y los DOS builds (`node-server` y Cloudflare) | Limpios |
| Las rutas nuevas existen | `DELETE` sin sesión → 401 (antes daba 405) |
| El SMTP de Gmail autentica | `transporter.verify()` — conecta y hace login sin mandar nada |
| **El mail de recuperar contraseña LLEGA** | Probado por la dueña de punta a punta |
| Los dos relojes se programan | Log del server construido, con `NODE_ENV=production` |
| La zona horaria del cron | Las próximas corridas caen 10:00 y 13:00 AR = 13:00 y 16:00 UTC |
| El `db push` no borra nada | `prisma migrate diff` antes de correrlo: una sola línea, `ADD COLUMN` |

## ⚠️ SIN PROBAR — esto es lo que hay que mirar

> ⚠️ **Esta lista es de la primera tanda del 26/8 y quedó vieja.** Casi todo
> se probó después — ver «Segunda tanda del 26/8» más arriba. Lo único que
> sigue pendiente de acá es **borrar un turno y borrar una clienta**.

**Nada de lo de abajo se ejercitó contra la base ni mandó un mail de verdad.** La
base no se toca sin permiso, así que todo lo que pedía escribir o mandar quedó
para probar con la app abierta.

### 1. Los mails nuevos, uno por uno

Ninguno se envió. Con el SMTP ya andando, alcanza con hacer cada acción y mirar
la casilla:

- [ ] Reservar desde `/reservar` → le llega **a la clienta** («recibimos tu
      pedido») y **al centro** («nuevo turno pendiente»). Son dos mails.
- [ ] Confirmar desde el panel → le llega a la clienta.
- [ ] Cancelar desde el panel **con motivo escrito** → el mail tiene que traer el
      renglón `Motivo: …`.
- [ ] Cancelar desde «Mi cuenta» → le llega **al centro**, no a la clienta.
- [ ] Que la tolerancia de 10 minutos aparezca en los dos mails y en la pantalla
      de reserva.

### 2. El resumen de vencidos

La consulta nunca corrió. Hay turnos vencidos en la base local, así que sirve
para probarlo. Como el reloj es a las 10, para verlo antes conviene llamar a
`avisarDeLosVencidos()` a mano o mover el cron un minuto.

- [ ] Que liste sólo los de los últimos 7 días.
- [ ] Que los enlaces a `/admin/turnos/<id>` abran la ficha correcta.
- [ ] Con cero vencidos **no manda nada** (a propósito: un mail diario que dice
      "no hay nada" se archiva sin leer, y con él el día que sí había algo).

### 3. Borrar un turno y borrar una clienta

**Ojo: esto borra de la base de verdad.** Ninguno se ejecutó.

- [ ] Borrar un turno cancelado o vencido → desaparece de la lista, del
      calendario y del historial de la clienta.
- [ ] Intentar borrar un turno pendiente futuro → **409** con el texto que dice
      que se cancele primero.
- [ ] Borrar una clienta con turnos por venir → **409** diciendo cuántos son.
- [ ] Borrar una clienta sin turnos por venir → se va con todo su historial.
- [ ] Que el botón de la papelera NO le aparezca a una empleada (sólo la dueña).

### 4. La casilla del motivo, en pantalla

- [ ] Que el cartel avise «se lo contamos a la clienta» del lado del panel.
- [ ] Que cancelar dos turnos seguidos no le pegue al segundo el motivo del
      primero (el campo se vacía al abrir; está escrito, no probado).
- [ ] Que el motivo se vea después en la ficha del turno.

---

## Lo que venía de antes (25/8) y sigue sin probarse

> ✅ **Ya no.** Reprogramar desde «Mi cuenta», la regla de 6 horas y el aviso
> `rescheduled` se probaron en la segunda tanda del 26/8. Se deja el detalle
> porque explica qué se esperaba de cada caso.

### Reprogramar desde «Mi cuenta» — lo más importante

**Nunca se probó de punta a punta.** Sacate un turno desde `/reservar` para
dentro de varios días, con Sofia Reyes o Valentina Ríos, y desde «Mi cuenta»:

- [ ] Arranca con la profesional que ya tenía.
- [ ] El desplegable muestra sólo profesionales que hacen ESE tratamiento.
- [ ] Un día que no atiende dice «Ese día no le quedan horarios» y nombra los que sí.
- [ ] Cambiar de profesional recalcula los horarios.
- [ ] **El caso que más preocupa:** elegir un horario ya ocupado con esa
      profesional tiene que dar *«Ese horario ya fue tomado con esa
      profesional»* y **no** un 500.

### La regla de 6 horas contra el servidor

Se verificó la función, no el endpoint. Desde la consola del navegador, logueada:

```js
fetch("/api/mi-cuenta/turnos/PONE_EL_ID/cancelar", { method: "PUT" })
  .then(r => r.json()).then(console.log)
```

Con un turno a menos de 6 horas tiene que dar **422**.

### El aviso de turno reprogramado

El evento `rescheduled` existe y **nunca se mandó**. Ojo: no está en el `z.enum`
de `notifications.functions.ts`, así que hoy no se puede disparar desde el
navegador. Si reprogramar tiene que avisar, hay que agregarlo ahí y decidir de
qué lado del permiso cae.

---

## Decisiones tomadas que se pueden discutir

- **Borrar una clienta se lleva sus turnos.** Es lo que ya decía el esquema
  (`appointments.client` es `onDelete: Cascade`) y no se cambió. La alternativa
  sería convertirlos en turnos de invitada para conservar el historial de
  facturación. Se eligió lo predecible sobre lo astuto, y la pantalla cuenta
  cuántos se van antes de confirmar.
- **El resumen de vencidos mira 7 días.** Más atrás nagea con una lista que no se
  vacía; menos, se pierden turnos.
- **«Realizado» no manda mail.** Confirmado por la dueña.
- **Reprogramar no cambia el estado**, tampoco cuando lo mueve la clienta.
- **Reprogramar desde «Mi cuenta» no le avisa al centro** — pero cancelar **sí**,
  desde el 26/8. Quedaron distintos: vale la pena emparejarlos.
- **«Cancelar» no sale en los turnos vencidos** desde la tabla (sólo pendiente y
  confirmado). Desde la ficha se puede.

---

## Estado de la base local

2 profesionales (Sofia Reyes, Valentina Ríos) y 4 usuarios. Los turnos están en
sus horarios originales. La columna `cancel_reason` está aplicada y vacía.

**El único cambio de esquema pendiente de llevar al VPS es esa columna.** Se
aplica con `npm run db:sync`, que además vuelve a poner triggers, CHECK e
índices parciales.

⚠️ **`prisma db push` no anda solo en local**: `prisma.config.ts` lee
`process.env.DATABASE_URL` y el CLI de Prisma 7 no carga el `.env`. Hay que
exportarla antes:

```bash
export DATABASE_URL="$(grep '^DATABASE_URL=' .env | sed -E 's/^DATABASE_URL=//; s/^"//; s/"$//')"
npm run db:sync
```

En el VPS no hace falta: la variable la pone compose.
