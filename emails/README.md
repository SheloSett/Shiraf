# Mails de Shiraf

Plantillas de los mails que manda Supabase. Van pegadas a mano en el panel:
Supabase no las lee de este repo, así que si se editan acá hay que volver a
copiarlas allá.

| Archivo | Dónde va (Supabase → Authentication → Emails) |
| --- | --- |
| `confirmar-cuenta.html` | **Confirm signup** |
| `recuperar-contrasena.html` | **Reset Password** |

Asuntos sugeridos, en el campo *Subject* de cada una:

- Confirm signup → `Confirmá tu cuenta en Shiraf`
- Reset Password → `Recuperá tu contraseña de Shiraf`

---

## Lo que estas plantillas NO arreglan

Cambian **cómo se ve** el mail. No cambian **de quién llega**.

Con el SMTP que Supabase trae de fábrica, el remitente es una dirección suya
(`noreply@mail.app.supabase.io`) y no se puede tocar. La clienta ve un mail
lindo de Shiraf mandado desde un dominio que nunca escuchó nombrar, que es
justo lo que enseñan a mirar para detectar una estafa. Y como el dominio no es
nuestro, tampoco hay SPF ni DKIM propios: hay chances concretas de que caiga en
correo no deseado.

Para que el mail salga de una dirección de Shiraf hace falta **SMTP propio**:
Authentication → Emails → SMTP Settings. Cualquier proveedor sirve — Resend,
Brevo, SendGrid, Amazon SES.

Hay además una razón que no es de imagen: **el SMTP de fábrica está limitado a
unos pocos mails por hora** y la propia documentación de Supabase dice que no
es para producción. Con eso, un sábado a la mañana con varias clientas
registrándose, los mails simplemente dejan de salir. Antes de abrir el centro
esto hay que resolverlo igual, así que conviene hacerlo de una vez.

Al configurarlo hay que verificar el dominio en el proveedor (agregar unos
registros DNS de SPF y DKIM donde esté comprado `shiraf.com.ar`). Es lo que hace
que Gmail confíe.

Ojo con el remitente: la casilla del centro es `shirafbeautyandspa@gmail.com`,
que **no** sirve como remitente verificado en Resend o Brevo — Gmail no deja que
otro proveedor firme por sus dominios. Hay que crear una dirección sobre
`shiraf.com.ar` (por ejemplo `hola@shiraf.com.ar`) y usar el Gmail como
`reply-to`, o mandar directamente por el SMTP de Google con una contraseña de
aplicación (`smtp.gmail.com:465`), que evita comprar mail pero tiene un tope de
unos 500 envíos por día y muestra un "vía gmail.com".

---

## Además

**Redirect URLs.** En Authentication → URL Configuration tienen que estar las
direcciones a las que vuelven los enlaces, o rebotan:

- `http://localhost:8081/recuperar` (desarrollo)
- `https://shiraf.com.ar/recuperar` (producción, cuando el dominio esté apuntando)

**Probar de verdad.** Los clientes de correo renderizan muy distinto entre sí.
Conviene mandarse el mail a una cuenta de Gmail y a una de Outlook antes de
darlo por bueno: Outlook usa el motor de Word y es el que más rompe.

**Por qué el HTML está escrito "mal" a propósito** (tablas, estilos inline,
Georgia en vez de Bodoni, colores en hex): está explicado en el comentario de
arriba de `recuperar-contrasena.html`. En resumen, es lo único que se ve igual
en todos los clientes de correo.

---

# Avisos de turnos

Aparte de los mails de auth de acá arriba, la app manda cuatro avisos propios.
El texto de los cuatro está en `src/lib/notifications.ts`, en un solo lugar y
compartido entre los dos canales: si hay que cambiar cómo se le habla a la
clienta, se cambia ahí y cambia en WhatsApp y en el mail a la vez.

| Aviso | Va a | Lo dispara | Canales |
| --- | --- | --- | --- |
| Turno confirmado | La clienta | El centro, al confirmar en el panel | Mail + WhatsApp |
| Turno cancelado | La clienta | El centro, al cancelar en el panel | Mail + WhatsApp |
| Turno nuevo pendiente | El centro | La clienta, al reservar en el sitio | Mail |
| Recordatorio | La clienta | La tarea programada, el día antes | Mail |

"Marcar realizado" no avisa nada a propósito: es una anotación interna que pasa
después de que la clienta ya estuvo en el centro.

## WhatsApp: por qué no sale solo

El aviso no se manda: se **abre WhatsApp con el mensaje ya escrito** y alguien
del centro aprieta enviar. Aparece como un botón "Avisar" en el toast que
confirma el cambio, y como un botón en cada fila de la lista de turnos para
reenviarlo después.

Mandarlo solo exige la WhatsApp Business Cloud API de Meta: verificación del
negocio, un número dedicado a la API —que deja de poder usarse normalmente desde
el celular—, plantillas aprobadas de a una por Meta y costo por conversación.
Son semanas de trámite antes de escribir una línea de código. Mientras tanto,
esto sale del número real del centro y no cuesta nada.

El botón no aparece cuando el turno no tiene teléfono cargado. Los números se
normalizan a `549 + área + número` en `toWhatsappNumber()`; el 9 es el que más se
olvida y sin él el enlace abre un chat con un número que no existe.

## Mail: configurar el SMTP

Se manda con **nodemailer por el SMTP de Gmail**, igual que `Ecommerce_mm`. No
hay cuenta de ningún servicio que crear ni dominio que verificar: alcanza con la
casilla que el centro ya usa. Son dos variables:

1. Activar la **verificación en dos pasos** en la cuenta de Google del centro
   (`shirafbeautyandspa@gmail.com`). Sin eso, el paso siguiente no existe.
2. Generar una **contraseña de aplicación** en
   [myaccount.google.com/apppasswords](https://myaccount.google.com/apppasswords).
   Son 16 letras. Se pegan en `SMTP_PASS` **sin espacios**.
3. `SMTP_USER` es la dirección de esa misma casilla.

```
SMTP_USER="shirafbeautyandspa@gmail.com"
SMTP_PASS="las16letras"
```

`SMTP_HOST` y `SMTP_PORT` tienen default (`smtp.gmail.com` y `587`) y no hace
falta ponerlas.

### El remitente, con Gmail, no es libre

Su SMTP sólo deja mandar como la casilla autenticada o como un alias que esa
casilla tenga confirmado en «Enviar como»; cualquier otra dirección la reescribe
o la rechaza. Por eso **`MAIL_FROM` se deja sin definir** mientras se mande por
Gmail: el remitente sale de `SMTP_USER`, que es lo único que Google va a
respetar. Ponerle `turnos@shiraf.com.ar` sin tener ese dominio andando es la
forma de que los mails dejen de salir sin que el código se entere.

El día que `shiraf.com.ar` tenga su propio servidor de correo, esto se resuelve
cambiando las tres variables de `SMTP_*` y definiendo `MAIL_FROM`. El código no
se toca.

### Límites y qué esperar

Gmail permite unos 500 destinatarios por día en una cuenta común. Para un centro
de estética —los avisos de turno de una agenda— sobra de lejos.

Sin `SMTP_USER` o sin `SMTP_PASS` no se rompe nada: el turno cambia de estado
igual y el panel avisa "Por mail no salió: …". Es para poder trabajar sin el
correo resuelto, no para dejarlo así.

### Antes esto era Resend

Pedía un dominio propio verificado, con SPF y DKIM cargados en el registrador, y
ese trámite tuvo los mails frenados semanas: falta saber dónde está registrado
`shiraf.com.ar`. Con backend propio no hacía falta pagar ese peaje — el
ecommerce nunca lo pagó. El transporte quedó en un solo lugar,
[`src/server/services/email.service.ts`](../src/server/services/email.service.ts),
y los avisos de turno y los de cuenta salen los dos por ahí.

Las clientas sin cuenta pueden no tener mail (`guest_email` es opcional). Para
esas, WhatsApp es el único canal, y el panel lo dice cuando pasa.

## Recordatorios: no hay nada que programar

El recordatorio es el único aviso que no lo dispara una persona, así que necesita
algo que lo llame. **Eso vive adentro de la app** y se pone en marcha solo cuando
arranca el contenedor:
[`src/server/services/reminders.service.ts`](../src/server/services/reminders.service.ts).

    0 10,13 * * *   America/Argentina/Buenos_Aires

Le manda el aviso a quien tenga un turno **confirmado mañana** y todavía no lo
haya recibido. Que corra dos veces el mismo día no le escribe a nadie de nuevo:
la marca queda en `appointments.reminded_at`, y la segunda pasada está
justamente para el día en que el contenedor esté reiniciándose a las 10.

La zona horaria va declarada ahí y no depende del reloj del servidor, que corre
en UTC. Se acabó escribir la hora convertida.

### Cómo saber si corrió

Deja una línea por corrida en el log del contenedor:

    docker compose logs -f app | grep recordatorios

    [recordatorios] Programados: "0 10,13 * * *" (America/Argentina/Buenos_Aires).
    [recordatorios] 2026-08-26: 3 turno(s), 3 aviso(s) enviado(s).
    [recordatorios] Sin enviar · turno 8f2a…: La clienta no tiene mail cargado.

Es la única señal: antes había un endpoint que contestaba el resumen en JSON y
ya no existe. Los que no salen se listan de a uno con el motivo — casi siempre,
una invitada sin mail cargado, que se arregla en su ficha.

### En desarrollo no se programa

Sólo corre con `NODE_ENV=production`, que lo pone el Dockerfile. Con
`bun run dev` el reloj no arranca, y es a propósito: la base local tiene los
mails reales de las clientas, y un `dev` olvidado abierto les mandaría
recordatorios de verdad. Los avisos que se disparan a mano desde el panel
—confirmar, cancelar— salen igual.

### Antes esto era un endpoint con un secreto

`POST /api/recordatorios` con `Authorization: Bearer $REMINDERS_SECRET`. No era
una decisión de diseño: con Supabase no teníamos proceso propio y el disparo
venía de afuera —`pg_cron` primero, el crontab del VPS después—, así que hubo
que inventarle una llave. Con la base y el contenedor propios, el endpoint, el
secreto y el crontab se borraron los tres.
