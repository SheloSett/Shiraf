# Pendientes de Shiraf

## 📍 Dónde quedé — 17/8/2026, 17:00

Para seguir en la otra PC, leer esto primero. Las dos cosas de arriba son
bloqueantes: una para la base, otra para poder bajar el código.

### 🔴 1. Falta correr UNA migración en la base

**[`supabase/migrations/20260813020000_prevent_double_booking.sql`](supabase/migrations/20260813020000_prevent_double_booking.sql)**
— pegarla en el SQL Editor de Supabase.

Es la que quedó afuera cuando se corrieron las de la Tanda 1. Trae dos cosas:

1. `professional_busy_slots()` — la función que dice qué horarios están tomados.
   Sin ella, **la pantalla de turnos no muestra ningún horario**: la consulta
   falla y el panel informa "esta profesional no atiende ese día", aunque los
   horarios estén cargados y bien. Pasa igual en el sitio público, donde la
   clienta lee "no hay horarios disponibles" y se va creyendo que está lleno.
2. `trg_check_appointment_overlap` — el trigger que rechaza dos turnos encimados
   con la misma profesional. **Sin esto la base acepta doble reserva.** Dos
   clientas pueden tener a Camila a las 15:00 del mismo día y nada lo frena.

Verificado contra la base el 17/8: `professional_busy_slots` devuelve `PGRST202`
(no existe), llamándola con los parámetros correctos. Como el archivo entra en
una sola transacción, si falta la función falta también el trigger.

**Todo el resto de las migraciones SÍ está aplicado.** Se probaron una por una:

| Migración                                     | Estado                               |
| --------------------------------------------- | ------------------------------------ |
| `20260813000000` product_categories           | ✅                                   |
| `20260813010000` service_categories           | ✅                                   |
| `20260813020000` prevent_double_booking       | ❌ **falta**                         |
| `20260813030000` service_images_bucket        | ✅ (bucket `servicios`)              |
| `20260813040000` appointment_rules            | ✅ (`appointments.price`)            |
| `20260813060000` add_staff_role               | ✅ (enum `staff`)                    |
| `20260813070000` permissions                  | ✅ (`user_permissions`)              |
| `20260814010000` split_sensitive_columns      | ✅ (`client_notes`, `product_costs`) |
| `20260816000000` rename_category_atomic       | ✅                                   |
| `20260816010000` / `20260816020000` invitadas | ✅ (`guest_*`, `normalize_phone`)    |

### 🔴 2. Nada está pusheado — sin esto no hay qué bajar

- La rama de trabajo es **`panel-solo-para-el-equipo`** y **no tiene upstream**.
- Tiene **6 commits sin pushear**.
- `main` está **2 commits adelante** de `origin/main`.
- Y hay **trabajo sin commitear** en el árbol (ver abajo).

```
git add -A
git commit -m "wip: contador de turnos pendientes y menú plegable"
git push -u origin panel-solo-para-el-equipo
```

⚠️ Antes de pushear `main`, acordarse de que Lovable sincroniza esa rama.

### 🟠 3. Trabajo a medio hacer en el árbol (sin commitear)

Contador de turnos pendientes + menú lateral plegable:

- `src/hooks/usePendingAppointments.ts` — **archivo nuevo, sin trackear**
- `src/routes/_authenticated/admin.turnos.tsx` — badge en la pestaña "Pendiente"
- `src/routes/_authenticated/admin.tsx` — barra sticky y secciones plegables

`npm run lint` da **1 error de formato** en `admin.tsx` (prettier, línea ~234).
Se arregla con `npx prettier --write src/routes/_authenticated/admin.tsx`.

### ✅ Las tandas: ninguna quedó a medias

Las cuatro se entregaron completas en código. El único agujero fue de
aplicación, no de desarrollo: la migración del punto 1 nunca se corrió.

- **Tanda 0** — higiene: `.gitattributes`, `.env` fuera del repo
- **Tanda 1** — reglas de turnos: validación, alcance por clienta, precio
  congelado _(el `prevent_double_booking` es de acá — es lo que falta correr)_
- **Tanda 2** — el panel carga turnos + recuperar y cambiar contraseña
- **Tanda 3** — los 5 bugs medianos (detalle más abajo)

### ✅ Hecho hoy, ya commiteado en la rama

- La cuenta del centro entra al panel y no a la tienda; `/mi-cuenta` y
  `/reservar` la desvían. Se agregó `/admin/cuenta` (contraseña + accesos) y
  "Cerrar sesión" adentro del panel.
- Los turnos se **encadenan** en vez de caer en una grilla de 30 minutos.
- En "Nuevo turno" la hora **se elige de una lista**; el campo libre quedó detrás
  de "Cargar fuera de horario".
- Un error al pedir los horarios ya no se lee como "no hay turnos".

---

## 🟡 Dos reglas de la agenda que tiene que decidir el centro (17/8/2026)

Los horarios ya se **encadenan**: cada turno arranca cuando termina el anterior y
el paso lo da la duración del tratamiento. Una profesional de 12 a 16 con
sesiones de 45 ofrece `12:00 · 12:45 · 13:30 · 14:15 · 15:00`.

Faltan definir dos cosas. Las dos son **una constante** arriba de
[`src/lib/shiraf.ts`](src/lib/shiraf.ts), con el comentario que explica cada lado.

### 1. `ALLOW_OVERTIME` — ¿el último turno puede pasarse de la hora de salida?

Hoy en **`false`**. Con la profesional de 12 a 16 y sesiones de 45, las 15:45
**no** se ofrecen porque terminarían 16:30.

- [ ] Preguntarle al centro: _"si la salida es a las 16, ¿la podemos hacer quedar
      hasta las 16:30?"_

Está en `false` y no en `true` —que es la lista que se pidió— por dónde duele
equivocarse. En `false` se ofrece un turno de menos y el panel lo puede cargar
igual a mano. En `true` una clienta reserva sola, por el sitio, un horario que
deja a la profesional trabajando después de su hora, y eso ya no se deshace.

Ojo con un efecto que no es obvio: como los horarios se recalculan, el desborde
puede ser grande. Si le tomaron un masaje de 45 y queda libre desde las 12:45,
una depilación de 90 encadena 12:45 y 14:15, y la siguiente arrancaría 15:45
para terminar **17:15** — una hora y cuarto tarde. La regla no distingue "un
ratito" de "una hora y cuarto".

### 2. `SLOT_BUFFER_MINUTES` — ¿cuántos minutos entre una clienta y la siguiente?

Hoy en **`0`**: los turnos van pegados y la que entra 12:45 se cruza en la puerta
con la que sale.

- [ ] Preguntarle al centro cuánto tarda limpiar y preparar la cabina.

Con `15`, esa misma agenda pasa a `12:00 · 13:00 · 14:00 · 15:00`: entra una
clienta menos por tarde, pero los horarios quedan redondos y fáciles de dictar
por teléfono. Queda en `0` porque es lo que la app venía haciendo; subirlo sin
que nadie lo pida le borra turnos a la agenda.

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

**Frenado porque falta un dato: qué dominio tiene el centro.**

### El paso cero

En [`src/lib/contact.ts`](src/lib/contact.ts) el mail figura como `hola@shiraf.com`,
pero el propio comentario avisa que es el de ejemplo del generador. Hay que confirmar:

- [ ] ¿Está comprado `shiraf.com`? ¿Otro dominio? ¿Ninguno?
- [ ] ¿Dónde está registrado, para poder cargar los DNS?
- [ ] El Instagram real, que también sigue siendo el de ejemplo

**Sin dominio propio esto no avanza.** Los proveedores solo dejan enviar desde un
dominio verificable, y el de prueba que da Resend únicamente le llega a tu propia
casilla — no a las clientas.

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
       usuario, contraseña, remitente `hola@shiraf.com`, nombre `Shiraf`
6. [ ] Ya destrabadas, pegar las plantillas en la pestaña **Templates**:
   - `Confirm sign up` ← [`supabase/emails/confirmar-cuenta.html`](supabase/emails/confirmar-cuenta.html)
     · asunto: `Confirmá tu cuenta en Shiraf`
   - `Reset password` ← [`supabase/emails/recuperar-contrasena.html`](supabase/emails/recuperar-contrasena.html)
     · asunto: `Recuperá tu contraseña de Shiraf`
7. [ ] Agregar la URL de producción en Authentication → URL Configuration →
       Redirect URLs. Hoy solo está `http://localhost:8081/recuperar`
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
