# Mails de Shiraf

Las plantillas de los dos mails de cuenta. **Las manda la app**, leyéndolas de
esta carpeta en cada envío:
[`email.service.ts`](../src/server/services/email.service.ts) las abre con
`readFile` y reemplaza `{{ .ConfirmationURL }}` por el enlace.

| Archivo | Cuándo se manda |
| --- | --- |
| `confirmar-cuenta.html` | Al registrarse, y cada vez que se pide reenviarlo |
| `recuperar-contrasena.html` | Al pedir "olvidé mi contraseña" |

Los asuntos están en el código, en `ASUNTOS` del mismo archivo.

Que se lean del disco y no del bundle es a propósito: son dos mails por semana
en el peor de los casos, así que releer un archivo no le cuesta nada a nadie, y
a cambio se pueden corregir sin reconstruir la imagen.

⚠️ Pero tienen que estar **adentro de la imagen**. La etapa `runtime` del
Dockerfile se arma copiando archivo por archivo, y ya pasó una vez que `emails/`
no estuviera en esa lista: el síntoma fue
`[cuenta] No salió el mail: No se encontró la plantilla del mail.`, y en
desarrollo era invisible.

El `{{ .ConfirmationURL }}` es sintaxis de Go y quedó de la época de Supabase.
Se reemplaza igual, para no tener que tocar los 509 renglones de HTML de cada
plantilla.

### Se pueden mirar sin mandar nada

Con el dev server levantado:
`http://localhost:8081/preview-mails/recuperar-contrasena.html`

### Antes las mandaba Supabase

Había que pegarlas a mano en su panel, y hasta que no hubiera SMTP propio ni
siquiera dejaba editarlas: a la clienta le llegaba un mail en inglés desde
`noreply@mail.app.supabase.io`. Con backend propio, esa carpeta del panel dejó
de existir y estos archivos pasaron a ser los que se mandan de verdad.

---

## Probar de verdad

Los clientes de correo renderizan muy distinto entre sí. Conviene mandarse el
mail a una cuenta de Gmail y a una de Outlook antes de darlo por bueno: Outlook
usa el motor de Word y es el que más rompe.

**Por qué el HTML está escrito "mal" a propósito** —tablas en vez de flex,
estilos inline en vez de clases, Georgia en vez de Bodoni, colores en hex en vez
de oklch— está explicado en el comentario de arriba de
`recuperar-contrasena.html`. En resumen: es lo único que se ve igual en todos
los clientes de correo.

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

Se manda con **nodemailer por el SMTP de Brevo**, con el remitente
`avisos@shiraf.com.ar` firmado por el dominio del centro. Son seis variables:

```
SMTP_HOST=smtp-relay.brevo.com
SMTP_PORT=587
SMTP_USER=<el login de Brevo, con forma de xxxxxxxx@smtp-brevo.com>
SMTP_PASS=<la clave SMTP>
MAIL_FROM="Shiraf <avisos@shiraf.com.ar>"
MAIL_REPLY_TO=shirafbeautyandspa@gmail.com
```

`MAIL_FROM` ahora **sí** se define. Con Gmail iba sin definir a propósito —su
SMTP no dejaba mandar como otra dirección—; con Brevo es al revés, y el
remitente propio es justamente el punto. `MAIL_REPLY_TO` sigue apuntando al
Gmail para que la respuesta de la clienta caiga en la casilla que alguien lee.

En el panel de Brevo esto vive en dos lugares: **Remitentes, dominio, IP** —el
dominio autenticado y el remitente— y **SMTP y API** —el login y la clave—.

⚠️ **La clave SMTP vence el 4/9/2027**, y también a los 90 días sin usarla. El
día que venza, los mails dejan de salir de golpe y el log dice `Invalid login`.

### Por qué se dejó de mandar por Gmail — 4/9/2026

Una clienta con casilla de **Hotmail** no recibió ni el mail de confirmación de
su cuenta ni el aviso de su turno. El envío andaba perfecto: Gmail aceptaba cada
mensaje con un `250 OK`, y las mismas pruebas llegaban sin problema a Gmail.

Microsoft descarta en silencio lo que llega de un `@gmail.com` diciendo ser un
negocio: no lo rechaza —no hay rebote que mirar— y tampoco lo deja en correo no
deseado. Se probó con un mail de texto plano, sin HTML ni enlaces, y tampoco
llegó: no era el contenido, era el remitente.

Y no había forma de arreglarlo desde Gmail. Google no deja que otro proveedor
firme por `gmail.com`, así que el mail nunca iba a estar autenticado a nombre de
Shiraf. Firmado por `shiraf.com.ar` con DKIM y DMARC, y saliendo de una IP con
reputación, la misma prueba a la misma casilla llegó.

> Vale la pena quedarse con la forma del problema, porque se repite: **el
> sistema puede estar funcionando perfecto y el mail no llegar igual.** Que el
> envío salga sin error no dice nada sobre si alguien lo recibió. Eso lo sabe el
> panel de entregas del proveedor —en Brevo, `Estadísticas` → `Registros`— o la
> persona a la que le tenía que llegar, y nadie más.

### El DNS está en Cloudflare, no en Hostinger

`shiraf.com.ar` resuelve por Cloudflare. Los registros de Brevo —SPF, DKIM, el
`brevo-code` y el CNAME del subdominio `mail`— los cargó Brevo solo, conectando
con esa cuenta. Si alguna vez hay que tocarlos a mano, en Cloudflare van con la
**nube gris (DNS only)**, nunca proxied.

Esto además cierra el cabo suelto más viejo del proyecto, el que había bloqueado
a Resend en agosto: no se sabía dónde se administraba el dominio. Se administra
desde Cloudflare.

El subdominio `mail.shiraf.com.ar` existe para que los enlaces que Brevo
reescribe para medir clics queden en el dominio del centro. Sin él apuntarían a
un dominio de Brevo, que es exactamente la clase de cosa que a Outlook le
desagrada.

### Mudarse de VPS no toca nada de esto

Los registros son del dominio, no del servidor. En una mudanza cambia el `A` y
nada más; al VPS nuevo se le copia el `.env` con las mismas seis variables.

Es una de las razones para no haber montado un servidor de correo propio adentro
del VPS: además de arrancar sin reputación de IP —lo peor posible contra
Outlook—, cada mudanza sería empezar de cero.

### Límites y qué esperar

El plan gratuito de Brevo son **300 mails por día**. Para los avisos de una
agenda sobra de lejos; el día que no alcance, el panel lo va a decir antes.

Sin `SMTP_USER` o sin `SMTP_PASS` no se rompe nada: el turno cambia de estado
igual y el panel avisa "Por mail no salió: …". Es para poder trabajar sin el
correo resuelto, no para dejarlo así.

Y desde el 4/9/2026, un mail que no sale **siempre deja una línea en el log**,
aunque no haya nadie mirando la pantalla:

    docker logs shiraf-app 2>&1 | grep -iE "\[cuenta\]|\[aviso\]"

Las clientas sin cuenta pueden no tener mail (`guest_email` es opcional). Para
esas, WhatsApp es el único canal, y el panel lo dice cuando pasa.

### Antes esto fue Resend, y después Gmail

**Resend** se descartó en agosto porque pedía un dominio verificado y no se
sabía dónde estaba registrado `shiraf.com.ar`. Ese trámite tuvo los mails
frenados semanas.

**Gmail con contraseña de aplicación** los destrabó el 26/8: alcanzaba con la
casilla que el centro ya tenía, sin cuenta nueva ni dominio que verificar. Fue
la decisión correcta en ese momento y funcionó bien —para Gmail—. Lo que no
cubría era el resto del mundo, y eso no se vio hasta que se registró una clienta
de Hotmail.

El transporte, mientras tanto, no se movió de lugar:
[`src/server/services/email.service.ts`](../src/server/services/email.service.ts).
Los tres cambios de proveedor fueron variables de entorno; el código de envío no
se tocó ni una vez.

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
