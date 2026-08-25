# Qué cambió y qué falta probar

Rama: **`trabajo/panel-turnos-y-reprogramar`** · commit `b502b9a`

Escrito el 25/8/2026. Todo lo de acá está commiteado y subido; **nada se mergeó
a `main`**.

---

## Antes de empezar en casa

Esta máquina no tiene Docker, así que la base local es un PostgreSQL propio que
vive en `C:\Users\2\.shiraf-pg` y escucha en el **5433**. Si tu otra máquina sí
tiene Docker, usá el compose de siempre y salteate esto.

```bash
npm install
npm run db:local        # arranca el Postgres (NO es un servicio: no arranca solo)
npm run dev             # http://localhost:8080
```

Para parar la base: `npm run db:local:stop`. Para ver si está: `db:local:status`.

**El `.env` no viaja por git.** El de esta máquina tiene `DATABASE_URL` apuntando
al 5433, `JWT_SECRET`, `APP_URL=http://localhost:8080` y las claves de Cloudinary.
En la otra máquina hay que armarlo desde `.env.example`.

> **Ojo con la zona horaria si armás otro Postgres a mano.** El cluster de acá
> heredó la de Windows (Argentina) y eso hacía que los horarios se guardaran 3
> horas corridos. Se arregla con `ALTER SYSTEM SET timezone TO 'UTC';` +
> `SELECT pg_reload_conf();`. El de Docker ya viene en UTC.

Entrar al panel: **`shelosetton@gmail.com` / `shiraf-local`**. Esa contraseña la
puse yo sólo en la base local; el seed deja las cuentas sin contraseña usable.

---

## ✅ Probado y andando

| Qué | Cómo se probó |
|---|---|
| Colores del calendario (realizado ≠ confirmado, aro dorado en hoy) | Captura del navegador con el código real + contraste WCAG medido |
| Turnos abre en «Todos» | Navegador: pestaña activa = «Todos», 4 filas |
| Columna «Estado» | Navegador: Vencido / Cancelado / Realizado en sus filas |
| «Vencido» se calcula bien | Contra los datos reales y los 5 casos, incluido `now = null` |
| Ficha de la clienta abre por la derecha | Medido: `x=988` en viewport de 1500 |
| Nombre de la profesional congelado | Asigné por la API → borré la profesional → el nombre sobrevivió |
| El cartel rojo ignora lo que ya pasó | `sinProfesional` pasó de 2 a 0 |
| Botones de la tabla según el estado de la fila | Navegador, los 4 estados |
| Botones de estado siempre en la ficha | Navegador, los 4 estados |
| Reprogramar desde el panel | Moví un turno a septiembre, verifiqué, lo devolví a su horario |
| Rechazos de reprogramar (panel) | Cerrado → 422, fecha inválida → 400, sin horario → 400, inexistente → 404 |
| Regla de 6 horas (la función) | 9 casos, con el corte exacto en las 6 h |
| Candados de reprogramar (clienta) | Turno ajeno → 404, sin sesión → 401 |

---

## ⚠️ SIN PROBAR — esto es lo que hay que mirar

### 1. Reprogramar desde «Mi cuenta» (lo más importante)

Es la funcionalidad más grande y **no se probó ni una vez de punta a punta**. No
había con qué: tu cuenta tiene rol `client` pero cero turnos, y EL RAYO tiene un
turno pero sin contraseña usable. Crear cualquiera de las dos cosas es tocar
datos, así que lo dejé.

**Cómo probarlo:**

1. Entrá a `/reservar` con tu cuenta y sacate un turno **para dentro de varios
   días**, con Sofia Reyes o Valentina Ríos (las dos tienen tratamientos y
   horarios cargados).
2. Andá a **Mi cuenta** → el turno tiene **Cambiar** y **Cancelar**.
3. Apretá **Cambiar**. Comprobá:
   - [ ] Arranca con la profesional que ya tenía seleccionada.
   - [ ] El desplegable muestra sólo profesionales que hacen ESE tratamiento.
   - [ ] Al elegir un día, aparecen horarios reales y no cualquiera.
   - [ ] Un día que la profesional no atiende dice «Ese día no le quedan
         horarios» y nombra los días que sí atiende.
   - [ ] Cambiar de profesional recalcula los horarios.
   - [ ] Al confirmar, el turno se mueve y el panel lo muestra en la fecha nueva.
4. **El caso que más me preocupa:** elegí un horario que ya esté ocupado con esa
   profesional (sacá dos turnos pisados a propósito desde el panel). Tiene que
   salir *«Ese horario ya fue tomado con esa profesional»* y **no** un error 500.

### 2. La regla de 6 horas contra el servidor

Verifiqué la función que decide, no el endpoint.

1. Con el turno del paso anterior, andá al panel → **Ver turno** → **Reprogramar**
   y movelo a **dentro de 2 horas** (desde el panel no hay límite, por eso sirve
   para armar la prueba).
2. Volvé a **Mi cuenta**: no tiene que haber ni «Cambiar» ni «Cancelar», sino
   *«Para cambiarlo o cancelarlo, escribinos»*.
3. Que el candado real sea el servidor y no la pantalla, desde la consola del
   navegador estando logueada:

```js
fetch("/api/mi-cuenta/turnos/PONE_EL_ID/cancelar", { method: "PUT" })
  .then(r => r.json()).then(console.log)
```

Tiene que dar **422** con *«Este turno ya está a menos de 6 horas…»*.

### 3. El botón «Confirmar» de la ficha

No hay ningún turno pendiente en la base, así que ese camino no se ejercitó.
Sale solo cuando sacás un turno desde `/reservar`, que entra como pendiente.

### 4. Los avisos por mail

**No sale ningún mail**: no hay cuenta de Resend y `RESEND_API_KEY` no está en el
`.env`. El código lo detecta y lo dice por consola, así que se puede trabajar,
pero el aviso nuevo de turno reprogramado (`rescheduled`) **nunca se envió de
verdad**. Cuando haya cuenta, revisar cómo se ve ese mail.

### 5. Todo lo de la otra sesión

Está en el mismo commit porque estaba en el árbol de trabajo, pero **yo no lo
escribí ni lo probé**:

- Recordatorios con `node-cron`: `src/lib/reminders.server.ts` se mudó a
  `src/server/services/reminders.service.ts`, más cambios en `src/server.ts`,
  `docker-compose.yml`, `.env.example` y documentación.
- **Eliminar un turno**: `src/hooks/useBorrarTurno.ts` y su bloque en la ficha.
  Ojo que esto SÍ borra de la base.

---

## Para cuando esto vaya al VPS

**Correr `npm run db:sync` antes de la próxima baja del equipo.** Ese comando
aplica `reglas.sql`, que le congela el nombre de la profesional a todos los
turnos que hoy la tienen asignada. Después de eso, borrar a alguien del equipo ya
no se lleva puesto el historial.

Sólo escribe una columna nueva y vacía (`professional_name`) donde está en NULL:
no borra ni cambia ningún dato existente. Aun así, avisá antes.

**Lo que ya no se puede recuperar:** las profesionales que se borraron ANTES de
este cambio dejaron el campo en NULL y su nombre no está en ningún lado. Esos
turnos van a decir «Sin registrar».

**`prisma db push` no anda solo en local.** `prisma.config.ts` lee
`process.env.DATABASE_URL` y el CLI de Prisma 7 no carga el `.env`. En el VPS
funciona porque la variable la pone compose; en tu máquina hay que exportarla
antes.

---

## Decisiones que tomé y podés querer cambiar

- **«Cancelar» no sale en los turnos vencidos** (sólo pendiente y confirmado).
  Lo interpreté de tu mensaje, donde nombraste «Vencido» como estado aparte. Si
  querés que un vencido también se cancele de un clic desde la tabla, es una
  palabra.
- **El aviso rojo «Ya no atiende» sobre un turno realizado queda en 3.57:1**, por
  debajo del mínimo AA. Es a propósito: bajar el fondo hasta que pase pediría
  volver al color de antes, y en un turno ya realizado ese aviso no pide hacer
  nada.
- **Reprogramar no cambia el estado.** Un pendiente sigue pendiente y un
  confirmado sigue confirmado, también cuando lo mueve la clienta. Se puede
  discutir que si ella lo mueve, el centro debería volver a confirmarlo.
- **Reprogramar desde «Mi cuenta» no le avisa al centro.** Seguí lo que ya hacía
  cancelar, que tampoco avisa.
- **El horario NUEVO no lleva el corte de 6 horas**, sólo el viejo. Si el sitio
  deja reservar para dentro de una hora, mover un turno a dentro de una hora no
  puede estar peor visto.

---

## Estado de la base local

La dejé con 2 profesionales (Sofia Reyes, Valentina Ríos) y 4 usuarios. **Las dos
cuentas de staff —`camila@gmail.com` y `micashiraf@gmail.com`— las restauré yo al
correr el seed sin preguntar; vos las habías borrado.** Me dijiste que las
dejara. Los 4 turnos están en sus horarios originales.
