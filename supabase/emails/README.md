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

Para que el mail salga de `hola@shiraf.com` hace falta **SMTP propio**:
Authentication → Emails → SMTP Settings. Cualquier proveedor sirve — Resend,
Brevo, SendGrid, Amazon SES.

Hay además una razón que no es de imagen: **el SMTP de fábrica está limitado a
unos pocos mails por hora** y la propia documentación de Supabase dice que no
es para producción. Con eso, un sábado a la mañana con varias clientas
registrándose, los mails simplemente dejan de salir. Antes de abrir el centro
esto hay que resolverlo igual, así que conviene hacerlo de una vez.

Al configurarlo hay que verificar el dominio en el proveedor (agregar unos
registros DNS de SPF y DKIM donde esté comprado `shiraf.com`). Es lo que hace
que Gmail confíe.

---

## Además

**Redirect URLs.** En Authentication → URL Configuration tienen que estar las
direcciones a las que vuelven los enlaces, o rebotan:

- `http://localhost:8081/recuperar` (desarrollo)
- la de producción cuando exista

**Probar de verdad.** Los clientes de correo renderizan muy distinto entre sí.
Conviene mandarse el mail a una cuenta de Gmail y a una de Outlook antes de
darlo por bueno: Outlook usa el motor de Word y es el que más rompe.

**Por qué el HTML está escrito "mal" a propósito** (tablas, estilos inline,
Georgia en vez de Bodoni, colores en hex): está explicado en el comentario de
arriba de `recuperar-contrasena.html`. En resumen, es lo único que se ve igual
en todos los clientes de correo.
