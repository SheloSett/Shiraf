# WhatsApp automático: lo que hay que saber antes de meterse

> 27/8/2026. Escrito para decidir con la dueña, no para programar. La conclusión
> corta está al final del todo.

La idea es que los avisos de turnos que hoy salen por mail salgan **también por
WhatsApp, solos**, sin que nadie del centro apriete enviar.

Se puede. Pero lo que decide si vale la pena no es el código —eso es lo fácil—
sino tres condiciones que pone Meta y una cuenta que hay que pagar todos los
meses. Este archivo es para que eso se entienda antes de prometerlo.

---

## 1. El código ya está preparado

Esto no es una reescritura. El sistema de avisos se pensó de entrada para dos
canales.

El texto de los mensajes vive en `src/lib/notifications.ts` como una **lista de
líneas, sin formato**, justamente para que cada canal la arme a su manera. El
comentario de arriba de ese archivo ya lo dice:

> Los mismos mensajes salen por dos canales —WhatsApp y mail— y por dos caminos
> —el panel al confirmar o cancelar, y la tarea del recordatorio—. Si cada uno
> redactara el suyo, en un mes dirían cosas distintas.

Hoy hay **ocho avisos**:

| Evento              | Va a       | Cuándo                                        |
| ------------------- | ---------- | --------------------------------------------- |
| `requested`         | La clienta | Reservó por el sitio y falta confirmar        |
| `confirmed`         | La clienta | El centro le confirmó el turno                |
| `cancelled`         | La clienta | El centro le dio de baja el turno             |
| `rescheduled`       | La clienta | El centro se lo movió de día u hora           |
| `reminder`          | La clienta | El día anterior                               |
| `new-request`       | El centro  | Entró una reserva y espera confirmación       |
| `client-cancelled`  | El centro  | La clienta canceló sola desde «Mi cuenta»     |
| `client-rescheduled`| El centro  | La clienta se movió el turno sola             |

El mail sale por `deliverAppointmentEmail()` en `src/lib/notifications.server.ts`,
y se llama desde dos lugares: el panel y la tarea de recordatorios
(`src/server/services/reminders.service.ts`).

Sumar WhatsApp es un `whatsapp.service.ts` gemelo de `email.service.ts` y un
`deliverAppointmentWhatsapp()` al lado del de mail. **Medio día de trabajo.**

### Y WhatsApp ya está, pero a mano

`appointmentWhatsappUrl()` arma el link `wa.me` con el mensaje ya escrito, y
alguien del centro aprieta enviar. Funciona, no cuesta nada y sale del número
real del centro. El comentario de esa función ya anticipaba todo lo que sigue:

> No manda nada: abre la conversación con el texto cargado para que la persona
> del centro lo lea y apriete enviar. Mandar solo exige la API de Meta, con
> verificación del negocio y plantillas aprobadas una por una.

---

## 2. Lo que exige Meta

No existe un "SMTP de WhatsApp". Para mandar solo hay que usar la **WhatsApp
Business Platform (Cloud API)**, y viene con cuatro condiciones.

### 2.1 🔴 El número se lo come la API

**Ésta es la grande.** Un número conectado a la API **deja de funcionar en la app
de WhatsApp del celular**. No puede tener las dos cosas a la vez.

Hoy el centro atiende por WhatsApp en el número que está en `src/lib/contact.ts`.
Si se conecta ése, nadie del equipo puede volver a chatear desde el teléfono:
todo lo que escriban las clientas llega por la API, a un webhook, y hay que
leerlo desde algún otro lado.

### 2.2 Verificación del negocio

Cuenta de Meta Business y verificación de la empresa con documentación (CUIT,
comprobantes). **Lo tiene que hacer la dueña**, porque es su identidad comercial,
y tarda días.

### 2.3 Los ocho mensajes pasan a ser plantillas aprobadas

Fuera de una ventana de 24 horas desde que la clienta escribe, no se puede mandar
texto libre: sólo **plantillas que Meta aprueba una por una**, con las variables
marcadas.

Los ocho de la tabla caen en la categoría **utility** (avisos de turno), que es la
que Meta acepta sin discusión.

⚠️ La contra: **cambiar una coma de un texto obliga a pedir aprobación de nuevo.**
Hoy el texto se edita en `notifications.ts` y sale al toque; con plantillas, cada
retoque tiene un trámite en el medio.

### 2.4 Se paga por mensaje

Meta cobra por mensaje enviado. *Utility* es la categoría más barata de las tres,
y algunos casos no se cobran cuando la clienta escribió hace poco — pero **un
recordatorio del día anterior se cobra siempre**.

Orden de magnitud: **centavos de dólar por mensaje**. Si el centro hace 200 turnos
por mes y cada turno dispara 3 avisos, son 600 mensajes: unos pocos dólares al
mes. No es un abono de software, es una cuenta chica que crece con los turnos.

> Los precios los cambia Meta seguido. Hay que mirar la tabla de **Argentina** el
> día que se arme, no confiar en este párrafo.

---

## 3. Qué es un "proveedor" y por qué no abarata

Meta te da la Cloud API cruda: endpoints, un token, un webhook, y arreglate.

Un **proveedor** (Twilio, 360dialog, Wati, Infobip) es un intermediario que pone
una capa arriba: alta más simple, panel para cargar las plantillas, un sandbox
para probar sin esperar la verificación, y —lo importante— **una bandeja de
entrada** para leer y contestar lo que llega.

**El proveedor no reemplaza a Meta: se suma.** Se paga lo de Meta **más** lo del
proveedor.

> Si el objetivo es gastar lo mínimo, el proveedor es justo lo que hay que
> evitar. El camino barato es Meta directo.

---

## 4. El choque: número del centro vs. gastar poco

Estas dos cosas se pelean:

- «Que use el número que ya tiene el centro»
- «Que no gaste de más»

Y se pelean por esto: si se conecta el número del centro a la API, ese número
**deja de abrirse en el celular** (§2.1). Entonces el equipo necesita **una
bandeja donde leer y responder** los mensajes que le llegan.

Esa bandeja es exactamente lo que venden los proveedores. Con Meta directo no
viene: habría que construirla adentro del panel, y eso es bastante más trabajo
que los avisos automáticos — es una funcionalidad entera (chat en vivo, no
leídos, quién contesta qué).

```
Número del centro  ──►  hace falta bandeja  ──►  proveedor  ──►  💸 caro
Meta directo       ──►  no hay bandeja      ──►  número nuevo ──►  💰 barato
```

---

## 5. Lo que NO hay que hacer

Existen librerías (`whatsapp-web.js`, Baileys) que automatizan un WhatsApp común
simulando el WhatsApp Web. Es gratis y se arma en una tarde.

**No usarlas acá.** Van contra los términos de servicio de WhatsApp y el castigo
es que Meta **banea el número**. Jugarse el número por el que el centro recibe
clientas para ahorrar unos dólares por mes es un mal negocio.

---

## 6. Las tres salidas

### A. Número nuevo + Meta directo ← *la recomendada*

Un chip aparte, que sale un par de mil pesos por única vez.

- ✅ El centro sigue chateando con su WhatsApp de siempre, sin cambiar nada de
  cómo trabajan hoy.
- ✅ El número nuevo **sólo manda**, así que no hace falta bandeja.
- ✅ Se le paga sólo a Meta: centavos por mensaje.
- ❌ A la clienta le llega el aviso de un número que no tiene agendado. Se
  atenúa con la foto de perfil y el nombre verificado del negocio, que Meta
  deja poner, y aclarando en el propio mensaje a qué número escribir.

### B. Número del centro + proveedor

- ✅ Todo sale del mismo número que las clientas ya conocen.
- ❌ El equipo pierde el WhatsApp del celular y pasa a atender desde una bandeja
  web.
- ❌ Se paga Meta **más** el proveedor, todos los meses.

### C. Seguir a mano — costo cero ← *hecha el 28/8/2026*

El mail sale automático y el WhatsApp lo dispara alguien del centro con un botón
que ya abre el mensaje escrito. No cuesta nada y no depende de Meta.

**Ya está la pantalla**: `Avisos` en el menú del panel (`/admin/avisos`). Muestra
los turnos **confirmados de mañana**, en orden, cada uno con su botón de
WhatsApp. La persona del centro entra una vez por día, aprieta los botones y
listo — cinco minutos de trabajo diario.

Detalles que conviene saber:

- **«Mañana» es el mismo que usa el mail.** Sale de `tomorrowInBuenosAires()` en
  `reminders.service.ts`, la misma función. Si cada uno calculara el suyo, entre
  las 21 y la medianoche —cuando en UTC ya es otro día— la pantalla mostraría una
  fecha y el mail saldría por otra.
- **Sólo confirmados**, igual que el mail: recordarle a alguien que venga a algo
  que el centro todavía no aceptó es prometerle un horario que puede no existir.
- **El texto es el mismo** que el del mail. Lo arma `buildAppointmentMessage` con
  el evento `reminder`, así que no hay una segunda redacción que con el tiempo
  diga otra cosa.
- Muestra la **nota de la clienta** (alergias, embarazos) a la vista de quien
  está por escribirle, y avisa cuáles **no tienen teléfono cargado**.

#### Lo que le falta, y es el paso siguiente

**No marca cuáles ya se avisaron por WhatsApp.** Abrir `wa.me` deja el mensaje
escrito en la app; si la persona apretó enviar o cerró la ventana, desde el panel
no hay forma de saberlo. Y una tilde que dice "avisado" sin serlo es peor que
ninguna.

Tampoco se puede reusar `reminded_at`: ésa es la marca del **mail**, y escribirla
haría que la tarea de la mañana saltee a esa clienta y se quede sin el mail.

La marca de verdad necesita **una columna propia** en `appointments`, del tipo
`notified_wa_at`, que se escriba cuando alguien aprieta el botón. Es un cambio
chico —una columna nullable, un endpoint que la sella— pero toca la base, así que
queda anotado acá y no hecho de prepo. Mientras tanto, la pantalla sí dice si el
**mail** salió, que es la información que hay.

---

## 7. Para llevarle a la dueña

Tres preguntas, en este orden:

1. **¿Está dispuesta a pagar unos pocos dólares por mes?** Si la respuesta es
   no, la charla termina acá y queda la opción C. No hay WhatsApp automático
   gratis por la vía legal.
2. **¿Saca un número nuevo?** Si sí, es la opción A y es la más barata y la que
   menos le cambia el día a día del equipo.
3. **¿Está dispuesta a que el equipo deje de usar WhatsApp desde el celular?**
   Sólo si contesta que sí tiene sentido mirar la opción B.

**Mientras tanto no hay nada bloqueado**: los avisos por mail salen solos y el
WhatsApp se manda desde la pantalla de Avisos, que ya está.

---

## 8. Sobre el número, si al final va la opción A

La duda que aparece siempre: «si Meta me come el número que ya tengo, ¿cómo
hago?». Se saca un chip nuevo, y es menos trabajo de lo que parece.

- **Un prepago común alcanza.** Cualquier compañía. El número tiene que poder
  recibir **un** código de verificación —por SMS o por llamada— el día que se da
  de alta, y después vive dentro de la API.
- **Ese número no puede tener WhatsApp instalado.** Si alguna vez se usó en la
  app, hay que borrar esa cuenta de WhatsApp antes de registrarlo.
- **Conviene mantener el chip vivo** con una carga mínima cada tanto: si algún
  día hay que volver a registrarlo, hace falta recibir el código otra vez, y una
  línea prepaga vencida se da de baja sola.
- **Ojo con los números virtuales / VoIP**: muchos los rechaza Meta. El chip
  físico es el camino sin sorpresas.
- El número **de siempre no se toca**: el centro sigue chateando desde el
  celular como hasta ahora, y el botón flotante del sitio sigue apuntando ahí.

Que a la clienta le llegue el aviso de un número que no tiene agendado se atenúa
poniéndole foto de perfil y nombre del negocio, y aclarando en el propio mensaje
a qué número escribir si quiere contestar.
