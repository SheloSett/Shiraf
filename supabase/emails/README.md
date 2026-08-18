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

## Mail: configurar Resend

1. Crear la cuenta en [resend.com](https://resend.com) y agregar el dominio
   `shiraf.com.ar`.
2. Cargar los registros DNS que Resend indica (SPF y DKIM) donde esté comprado
   el dominio. Es lo que hace que Gmail confíe.
3. Crear una API key y ponerla en `RESEND_API_KEY`.
4. Completar `MAIL_FROM` con una dirección de ese dominio, por ejemplo
   `Shiraf <turnos@shiraf.com.ar>`.

**El Gmail del centro no sirve como remitente.** Google no deja que otro
proveedor firme por sus dominios, así que Resend rechaza el envío. Va de
`MAIL_REPLY_TO`, para que la respuesta de la clienta caiga en la casilla que
alguien mira de verdad.

Sin `RESEND_API_KEY` o sin `MAIL_FROM` no se rompe nada: el turno cambia de
estado igual y el panel avisa "Por mail no salió: …". Es para poder trabajar sin
el correo resuelto, no para dejarlo así.

Las clientas sin cuenta pueden no tener mail (`guest_email` es opcional). Para
esas, WhatsApp es el único canal, y el panel lo dice cuando pasa.

## Recordatorios: programar la tarea

El recordatorio es el único aviso que no lo dispara una persona, así que
necesita algo que lo llame. El endpoint es:

    POST /api/recordatorios
    Authorization: Bearer $REMINDERS_SECRET

Le manda el aviso a quien tenga un turno **confirmado mañana** y todavía no lo
haya recibido. Correrlo dos veces el mismo día no le escribe a nadie de nuevo:
la marca queda en `appointments.reminded_at`.

Responde un resumen en JSON: `{ day, found, sent, skipped }`. `skipped` trae el
motivo de cada uno que no salió — casi siempre, una invitada sin mail cargado.

Conviene correrlo **una vez por día a la mañana**. Con pg_cron, desde el SQL
editor de Supabase (ojo: pg_cron programa en UTC, así que las 10 de Buenos Aires
son las 13):

```sql
select cron.schedule(
  'recordatorios-shiraf',
  '0 13 * * *',
  $$
  select net.http_post(
    url     := 'https://shiraf.com.ar/api/recordatorios',
    headers := jsonb_build_object(
      'Authorization', 'Bearer EL-VALOR-DE-REMINDERS-SECRET',
      'Content-Type',  'application/json'
    )
  );
  $$
);
```

Requiere las extensiones `pg_cron` y `pg_net` activadas en Database →
Extensions. Si preferís no meter el secreto en la base, el equivalente en el
cron del servidor donde corre el docker-compose:

    0 10 * * *  curl -fsS -X POST https://shiraf.com.ar/api/recordatorios -H "Authorization: Bearer $REMINDERS_SECRET"

Para probarlo sin esperar al día siguiente: confirmá un turno para mañana y
llamá al endpoint a mano con curl.
