# WhatsApp automático: lo que hay que saber antes de meterse

> 27/8/2026, **reescrito el 4/9/2026**. Escrito para decidir con la dueña, no
> para programar. La conclusión corta está en §8.

La idea es que los avisos de turnos que hoy salen por mail salgan **también por
WhatsApp, solos**, sin que nadie del centro apriete enviar.

Se puede. Lo que decide si vale la pena no es el código —eso está hecho— sino
unas condiciones que pone Meta y una cuenta que hay que pagar todos los meses.
Este archivo es para que eso se entienda antes de prometerlo.

---

## 0. Lo que cambió el 4/9/2026

Si ya leíste la versión anterior de este documento, **hay dos cosas que dejaron
de ser ciertas** y tres decisiones nuevas. La última es la que manda: se eligió
un camino y está implementado.

**1. El número del centro ya no se pierde.** La versión vieja decía que conectar
un número a la API lo saca de la app del celular para siempre, y toda la
recomendación —sacar un chip nuevo— estaba construida sobre eso. Meta sacó
después **Coexistence**: el mismo número vive a la vez en la app y en la API.
Las secretarias siguen chateando desde el teléfono. Ver §2.1.

**2. Pero la coexistencia se paga, y no es barata.** El alta de un número que ya
está en la app va por un flujo que corren los proveedores, y un proveedor cuesta
**del orden de 50 dólares por mes**. O sea: la coexistencia resolvió el problema
del número, pero lo convirtió en un problema de plata. Los tres caminos y lo que
sale cada uno están en §3; **la decisión ahora es económica, no técnica**.

**3. Se decidió que NO hay bot que responda.** Sólo avisos que salen del sistema
hacia la clienta. Ver §7, que explica por qué esa decisión hay que sostenerla
aunque técnicamente se pueda hacer otra cosa.

**5. Y al final no se paga nada: va la opción D.** La dueña no quiso pagar por
los avisos automáticos, ni los 57 dólares ni los 7. Como no existe la vía oficial
gratis, se tomó el único camino que quedaba: un **chip descartable** vinculado a
**Evolution API** en el VPS. Es la vía no oficial, con el riesgo asumido y
acotado a un número que no vale nada — nunca al del centro. Está **implementado y
apagado**; el porqué en §5, el paso a paso en §11.

**4. Confirmado con el centro (4/9/2026): usan WhatsApp Business**, la app verde
con la "B". Era el requisito que podía voltear todo el plan — con WhatsApp común
la coexistencia no existe. Está.

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

La mitad de WhatsApp que no depende de Meta **ya está escrita y apagada** —
`whatsapp.service.ts`, `whatsapp-plantillas.ts` y `deliverAppointmentWhatsapp()`.
Los detalles, en §9.

### Y WhatsApp ya está, pero a mano

`appointmentWhatsappUrl()` arma el link `wa.me` con el mensaje ya escrito, y
alguien del centro aprieta enviar. Funciona, no cuesta nada y sale del número
real del centro. Es lo que se usa hoy, desde la pantalla de Avisos (§6, opción
C), y **sigue siendo el respaldo** si lo automático se cae o si la charla con la
dueña se estira.

---

## 2. Lo que exige Meta

No existe un "SMTP de WhatsApp". Para mandar solo hay que usar la **WhatsApp
Business Platform (Cloud API)**, y viene con estas condiciones.

### 2.1 El número: ahora se puede tener las dos cosas

**Éste era el problema grande, y dejó de serlo.**

Antes, un número conectado a la API dejaba de funcionar en la app del celular:
no podía tener las dos cosas a la vez. Hoy existe **Coexistence** (coexistencia),
que permite exactamente eso:

- El número sigue abriéndose en la app del celular. **El equipo atiende como
  siempre**, desde el teléfono, sin aprender ninguna herramienta nueva.
- Lo que manda la API **le aparece a la clienta en la misma conversación de
  siempre**, la que ya tiene agendada con el centro.
- Los mensajes que entran se espejan a los dos lados: al celular y —si uno se
  suscribe— a un webhook. Nosotros **no** vamos a usar esa segunda mitad (§7).

Lo que hay que cumplir para que funcione:

- 🔴 **Tiene que ser la app WhatsApp Business** —la verde con la "B"—, no el
  WhatsApp común. Ya está confirmado que el centro la usa. Si algún día vuelven
  al WhatsApp normal, la coexistencia se cae.
- Versión de la app **2.24.17 o superior**. Cualquier teléfono con la app al día
  la tiene.
- **Alguien tiene que abrir la app al menos cada 13 días** o la sincronización se
  corta. En un centro que atiende todos los días esto no es un riesgo real, pero
  sí lo es en enero si cierran tres semanas: conviene dejarlo dicho.
- **Desinstalar la app o borrar la cuenta de WhatsApp rompe la coexistencia** y
  hay que rehacer el alta. Vale la pena que lo sepa quien maneja ese teléfono,
  porque "lo reseteé porque andaba lento" es una causa perfectamente normal de
  que los avisos dejen de salir.
- Al dar de alta, Meta ofrece **importar hasta seis meses de historial, o
  ninguno**. Da igual para lo nuestro —no leemos las conversaciones—, así que la
  opción prudente es no importar nada: menos datos de clientas dando vueltas por
  un tercero, sin ninguna contra.

### 2.2 Verificación del negocio

Hace falta una cuenta de **Meta Business**. La verificación de la empresa con
documentación (CUIT, comprobantes) **la tiene que hacer la dueña**, porque es su
identidad comercial, y tarda días.

Para el volumen del centro se puede arrancar **sin verificar**: el límite de la
cuenta nueva es holgado frente a la cantidad de turnos que se manejan. La
verificación se vuelve necesaria si algún día se quiere el tilde de negocio
verificado o mucho más volumen.

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

Meta cobra por **plantilla entregada**. *Utility* es la categoría más barata.

Para **Argentina**, el orden de magnitud de una plantilla utility es de **poco
más de un centavo de dólar** por mensaje. Si el centro hace 200 turnos por mes y
cada turno dispara 3 avisos, son 600 mensajes: **menos de diez dólares al mes**.

> ⚠️ Meta actualiza la tabla de precios **cada trimestre**. El número de arriba
> es para dimensionar, no para presupuestar: hay que mirar la tabla de Argentina
> el día que se arme.

Dos detalles que juegan a favor y en contra:

- **A favor**: una plantilla utility que cae dentro de una ventana de servicio
  abierta —o sea, cuando la clienta escribió hace menos de 24 horas— no se
  cobra. Parte de los avisos van a caer ahí gratis.
- **En contra**: el recordatorio del día anterior casi nunca cae adentro de esa
  ventana, así que **ése se cobra siempre**. Es, justamente, el más importante.

---

## 3. El proveedor: antes era evitable, ahora hace falta

Meta te da la Cloud API cruda: endpoints, un token, un webhook, y arreglate. Un
**proveedor** (360dialog, Twilio, Wati, Infobip) es un intermediario que pone una
capa arriba: alta más simple, panel para cargar plantillas, y —lo que acá
importa— **el flujo de alta que habilita la coexistencia**.

La versión vieja de este documento decía que el proveedor era un gasto evitable y
que el camino barato era Meta directo. **Para la coexistencia eso ya no parece
cierto.**

El alta de un número que ya está en la app WhatsApp Business se hace con un flujo
de Meta llamado **Embedded Signup**, y ese flujo lo corre una app registrada ante
Meta como proveedor técnico — no un negocio suelto entrando al panel.

> 🔍 **Esto hay que confirmarlo el día que se arme, no antes.** En teoría uno
> puede registrarse como proveedor técnico de sí mismo, pero es un trámite de
> revisión de Meta entero para dar de alta **un** número. Si el trámite sale
> caro en tiempo, un proveedor con abono chico lo compra hecho. La cuenta se
> hace ese día, con precios de ese día.

**Entonces se paga lo de Meta *más* lo del proveedor**, y el proveedor es la
parte cara.

> ⚠️ **Corrección del 4/9/2026, mismo día.** Una versión anterior de este párrafo
> decía "unos pocos dólares al mes". **Está mal y por mucho.** Los proveedores
> conocidos cobran un abono fijo **por número** del orden de **50 dólares
> mensuales** —360dialog arranca en €49, Wati y Twilio andan por ahí—, encima del
> costo por mensaje de Meta. Hay que cotizar, pero ése es el orden de magnitud
> con el que hay que ir a la charla, no el otro.

Puesto en plata, para el volumen del centro:

| Camino | Abono mensual | Mensajes (Meta) | **Total por mes** |
| --- | --- | --- | --- |
| Número de siempre, con proveedor | ~USD 50 | ~USD 7 | **~USD 57** |
| Número nuevo, Meta directo | USD 0 | ~USD 7 | **~USD 7** |

La diferencia es de unos **600 dólares al año**, y lo único que compra es que el
aviso salga del número que la clienta ya tiene agendado en vez de uno nuevo.
**Esa es la decisión, y es de la dueña.**

### La tercera vía: ser proveedor de nosotros mismos

Meta deja que uno se registre como **Tech Provider** y corra su propio Embedded
Signup. Es **gratis**: no hay abono, se paga sólo el mensaje. Con eso se tendría
la coexistencia —el número de siempre— sin los 50 dólares.

Lo que cuesta no es plata, es trámite y trabajo:

- Hay que crear una app en Meta, pedir los permisos, **implementar el flujo de
  Embedded Signup** y pasar la **revisión de Meta** ("approved solution"). Sin
  esa aprobación no se puede dar de alta el número por esta vía.
- Todo eso es maquinaria pensada para quien da de alta **muchos** negocios, y acá
  se usaría para **uno solo**, una única vez.
- El riesgo es de calendario, no de plata: si Meta rechaza o se toma semanas,
  el proyecto queda esperando y no hay a quién reclamarle.

**Cuándo tiene sentido**: si la dueña quiere sí o sí el número de siempre y no
quiere pagar el abono. Es la única combinación que da las dos cosas.
**Cuándo no**: si lo que se quiere es encenderlo pronto y sin sorpresas.

---

## 4. Al elegir proveedor, un criterio técnico que decide si hay que tocar código

No todos los proveedores son iguales para nosotros, y la diferencia no es el
precio:

- ✅ **Los que te dan el token y el phone id de Meta** (hosting de la Cloud API
  "by Meta"): el código actual **funciona tal cual está**. Se pegan las dos
  variables en el `.env` y listo. `whatsapp.service.ts` le habla a
  `graph.facebook.com` y no se entera de que hay un proveedor en el medio.
- ❌ **Los que ponen su propio endpoint** —otra URL, otra forma de autenticar,
  a veces otro formato de mensaje— obligan a **modificar `whatsapp.service.ts`**
  y atan el proyecto a ese proveedor: cambiarlo después es volver a tocar
  código.

**Preguntar esto antes de contratar**, y preferir el primero aunque salga un poco
más. Es la diferencia entre encender el canal en una tarde o abrir un frente de
trabajo.

---

## 5. La vía no oficial: qué es, y sobre qué número sí y sobre cuál no

> Esta sección decía "no hacer esto" hasta el 4/9/2026. Cambió, y el cambio está
> explicado abajo. Vale la pena leerlo entero antes de sacar conclusiones en
> cualquiera de las dos direcciones.

Existen librerías (`whatsapp-web.js`, **Baileys**) que automatizan WhatsApp
simulando un **dispositivo vinculado**, como el WhatsApp Web. Es gratis y se arma
en una tarde. **Evolution API** y **WAHA** son eso mismo empaquetado en Docker
con una API REST adelante: no son tres alternativas, son la misma técnica con
distinto envoltorio, y corren exactamente el mismo riesgo.

**Van contra los términos de servicio de WhatsApp.** El castigo, cuando llega, es
que **banean el número**, sin apelación práctica.

### Lo que cambió, y lo que no

Lo que **no** cambió: el riesgo es real y hay que asumir que el ban va a pasar,
no que puede pasar.

Lo que **sí** cambió es sobre qué número se corre ese riesgo. Antes la pregunta
era "¿usamos esto en el número del centro?", y ahí la respuesta es y sigue siendo
**no**: ese número está en el sitio, en el Instagram, en los flyers y en la
agenda de cada clienta que volvió tres veces, con todo el historial adentro.
Jugárselo para ahorrar siete dólares por mes es un mal negocio, y el día que
salga mal el centro se entera un martes a la mañana cuando deja de entrarle
trabajo.

La pregunta que quedó, cuando la dueña dijo que no iba a pagar nada (§8), es
otra: **¿lo corremos sobre un chip que no vale nada?** Ahí el peor caso es que se
pierda un prepago de dos mil pesos y haya que escanear un QR de nuevo. Eso ya es
una apuesta razonable, y es la que se tomó.

```
Baileys sobre el número del centro  ──►  ban  ──►  se pierde el negocio   ❌
Baileys sobre un chip descartable   ──►  ban  ──►  se pierde el chip      ✅
```

**La regla, entonces, no es "no usarlo": es que acá adentro nunca entre el número
por el que atienden las secretarias.** Está escrita en tres lugares —este doc,
`evolution.service.ts` y el `.env.example`— porque el código no la puede hacer
cumplir: Evolution vincula lo que le escaneen el QR.

Lo que está implementado y cómo se enciende, en §11.

---

## 6. Las salidas

> Son cuatro, y **la elegida es la D** — la de más abajo. Las tres primeras
> quedan escritas porque son las que hay que volver a mirar el día que la dueña
> cambie de idea sobre pagar, o el día que a un chip lo baneen.

### A. El número del centro, con coexistencia ← *la mejor, si se paga*

- ✅ Los avisos salen **del número que las clientas ya tienen agendado**, en la
  conversación de siempre. No hay que explicarle a nadie quién les escribe.
- ✅ **Las secretarias no cambian nada** de cómo trabajan: siguen atendiendo
  desde el celular.
- ✅ No hay que comprar ni mantener un chip.
- ❌ Hace falta un proveedor: **unos 50 dólares por mes** además de lo de Meta
  (§3). Es, de lejos, el costo más grande de todo esto.
- 🔧 La variante **sin abono** es ser Tech Provider de nosotros mismos: sale
  gratis pero hay que implementar el alta y pasar revisión de Meta (§3).
- ❌ Ataduras nuevas y frágiles: abrir la app cada 13 días, no desinstalarla, no
  volver al WhatsApp común (§2.1).

### B. Número nuevo + Meta directo ← *el plan B*

Era la recomendada de la versión vieja, y **sabiendo lo que sale el proveedor,
vuelve a estar muy peleada**. Es la más barata por lejos —unos 7 dólares al mes
contra 57— y la más simple de encender. El detalle del chip está en §10.

Lo único que resigna es que el aviso llegue del número conocido. Se atenúa con la
foto de perfil y el nombre del negocio, y aclarando en el mensaje a qué número
escribir — que es, igual, lo que hay que aclarar siempre, porque a ese número
nadie lo atiende.

- ✅ Se le paga sólo a Meta.
- ✅ El número nuevo **sólo manda**, así que nadie tiene que atender ahí.
- ❌ A la clienta le llega el aviso de un número que no tiene agendado.

### D. Chip descartable + Evolution API ← *la elegida, 4/9/2026*

Es la B —número nuevo, el centro no cambia nada— pero en vez de pagarle a Meta
por cada mensaje, el chip se vincula a un contenedor propio que habla WhatsApp
como un dispositivo vinculado (§5).

- ✅ **No se le paga a nadie**, ni por mensaje ni por mes. Era la condición.
- ✅ Automático de verdad: los ocho avisos salen solos, sin que nadie apriete
  nada.
- ✅ Manda **texto libre**, así que el WhatsApp dice exactamente lo mismo que el
  mail —el mismo `buildAppointmentMessage()`— y no hay ocho plantillas que
  mantener en Meta ni trámite de aprobación por cada coma.
- ✅ Las secretarias no se enteran de nada: su WhatsApp sigue intacto.
- ❌ **Va contra los términos de servicio y el chip se puede perder.** Es el
  costo real de esta opción y no hay que disimularlo: se paga en riesgo en vez
  de en plata.
- ❌ A la clienta le llega de un número que no tiene agendado, igual que en la B.
- ❌ Tres contenedores más en el VPS (la API, su Postgres y su Redis) y una cosa
  más que se puede caer.

**Lo que la hace aceptable es que el riesgo está acotado a algo reemplazable.**
Si el chip cae, se compra otro, se escanea el QR y sigue andando; mientras tanto
los avisos siguen saliendo por mail, que nunca dejó de ser el canal confiable.

### C. Seguir a mano — costo cero ← *el respaldo, y sigue vivo*

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

**Esta pantalla no se tira aunque se encienda la A.** Queda como respaldo para el
día que Meta rechace un envío, venza un token o se rompa la coexistencia.

#### Lo que le falta

**No marca cuáles ya se avisaron por WhatsApp.** Abrir `wa.me` deja el mensaje
escrito en la app; si la persona apretó enviar o cerró la ventana, desde el panel
no hay forma de saberlo. Y una tilde que dice "avisado" sin serlo es peor que
ninguna.

Tampoco se puede reusar `reminded_at`: ésa es la marca del **mail**, y escribirla
haría que la tarea de la mañana saltee a esa clienta y se quede sin el mail.

La marca de verdad necesita **una columna propia** en `appointments`, del tipo
`notified_wa_at`. Es un cambio chico —una columna nullable, un endpoint que la
sella— pero toca la base, así que queda anotado acá y no hecho de prepo.

> Si se enciende la opción A, esta falta **desaparece sola** para los avisos
> automáticos: ahí el sistema sabe si Meta aceptó el mensaje. La columna
> seguiría haciendo falta sólo para los que se manden a mano.

---

## 7. Nada de bot que responda — decisión del 4/9/2026

Se decidió que esto es **un canal de salida y nada más**: el sistema le avisa a
la clienta, y si ella contesta, **le contesta una persona desde el celular, como
hoy**.

Con la coexistencia encendida, los mensajes que entran se pueden espejar a un
webhook, y de ahí a un bot que conteste "tu turno es el jueves a las 15" hay un
paso corto. **No lo demos.** Las razones, para que no haya que discutirlas de
nuevo dentro de seis meses:

- **El mensaje le llega a los dos a la vez.** Con coexistencia, lo que escribe
  una clienta le aparece a la secretaria en el celular **y** al webhook. Un bot
  que responde por su cuenta va a pisar a una persona que ya estaba escribiendo.
  Del lado de la clienta se ve como dos respuestas distintas al mismo mensaje.
- **Contestar cuesta plata, y cada vez más.** Las respuestas de servicio —lo que
  manda el bot dentro de la ventana de 24 horas— pasaron a cobrarse. Lo que sale
  desde la app del celular sigue siendo gratis. O sea: el bot le cobraría al
  centro por hacer algo que la secretaria hace sin cargo.
- **Es un producto, no una función.** "Entender lo que pide la clienta" es
  ambiguo por definición, y equivocarse ahí no es un bug silencioso: es una
  clienta a la que le dijeron mal el horario de su turno.

**Lo concreto para quien programe esto**: al dar de alta el número, **no
suscribirse a los webhooks de mensajes entrantes**, o dejarlos sin procesar. No
hay endpoint que los reciba y no hay que escribirlo.

---

## 8. Para llevarle a la dueña — *ya contestado, queda por si cambia de idea*

> **La respuesta fue "no pago nada" (4/9/2026)**, y de ahí salió la opción D
> (§6-D, §11). Esta sección queda escrita porque es la charla que hay que volver
> a tener el día que un chip caiga por segunda o tercera vez, y convenga comparar
> la molestia contra los siete dólares por mes de la opción B.

Ahora son dos preguntas, no tres, y la que voltaba todo ya está contestada.

1. **¿Cuánto vale que el aviso salga del número de siempre?** Ésta es LA
   pregunta, y es de plata:
   - **~USD 57 por mes** (unos 700 al año) → número de siempre, con proveedor.
   - **~USD 7 por mes** → número nuevo, sin proveedor. Todo lo demás igual.
   - **~USD 7 por mes, pero con trámite y espera** → número de siempre, siendo
     Tech Provider de nosotros mismos (§3).

   Si la respuesta es "nada de eso", la charla termina acá y queda la opción C,
   que ya está andando y no cuesta un peso. **No hay WhatsApp automático gratis
   por la vía legal.**
2. **¿Puede hacer la cuenta de Meta Business a su nombre?** Es su identidad
   comercial; no lo puede hacer otro por ella.

Y una cosa que hay que avisarle al equipo, no preguntarle: **el teléfono con el
WhatsApp Business no se puede resetear, desinstalar ni dejar quieto más de dos
semanas** sin que los avisos dejen de salir (§2.1).

~~¿Está dispuesta a que el equipo deje de usar WhatsApp desde el celular?~~ —
esta pregunta ya no existe. Era la más difícil de las tres y la respondió Meta.

**Mientras tanto no hay nada bloqueado**: los avisos por mail salen solos y el
WhatsApp se manda desde la pantalla de Avisos, que ya está.

---

## 9. El código ya está escrito, y apagado

Escrito el 28/8/2026 y sigue igual: **no manda nada todavía**. Sin
`WHATSAPP_TOKEN` ni `WHATSAPP_PHONE_ID` el canal contesta "todavía no está
configurado" y los avisos salen sólo por mail, exactamente como venía. Encenderlo
es pegar dos variables en el `.env`.

| Archivo | Qué es |
| --- | --- |
| `src/lib/whatsapp-plantillas.ts` | Los 8 textos como plantillas de Meta, con sus huecos |
| `src/server/services/whatsapp.service.ts` | El envío. Gemelo de `email.service.ts` |
| `deliverAppointmentWhatsapp()` en `notifications.server.ts` | Busca el turno, resuelve a quién y manda |

Sale por los mismos dos caminos que el mail: `notifyAppointment` (el panel y la
clienta) y la tarea diaria de `reminders.service.ts`.

**La coexistencia no obliga a cambiar nada de esto**, siempre que el proveedor dé
acceso directo a la Cloud API (§4): mandar una plantilla es el mismo POST a
`/{phone_id}/messages`, con o sin coexistencia.

### Las 8 plantillas que hay que cargar en Meta

Todas de categoría **utility** e idioma **es_AR** (si en el panel quedan como
`es` a secas, hay que poner `WHATSAPP_LANG=es`, o Meta contesta que la plantilla
no existe).

| Nombre en Meta | Aviso | Variables, en orden |
| --- | --- | --- |
| `turno_pedido` | Reservó por el sitio, falta confirmar | nombre · cuándo · qué |
| `turno_confirmado` | El centro se lo confirmó | nombre · cuándo · qué |
| `turno_cancelado` | El centro lo dio de baja | nombre · cuándo · qué · motivo |
| `turno_movido` | El centro lo movió de horario | nombre · **qué** · **cuándo** |
| `turno_recordatorio` | El día antes | nombre · cuándo · qué |
| `centro_turno_nuevo` | Al centro: entró una reserva | quién · cuándo · qué |
| `centro_clienta_cancelo` | Al centro: canceló sola | quién · cuándo · qué · motivo |
| `centro_clienta_movio` | Al centro: se movió el turno sola | quién · cuándo · qué |

⚠️ Ojo con `turno_movido`: es la única donde **el tratamiento va antes que la
fecha**. No es un descuido, es cómo quedó redactada la frase — los huecos siguen
al texto y no a una convención. Cargarla con el orden de las otras hace que el
mensaje diga el tratamiento donde va la fecha.

> ⚠️ Con coexistencia hay algo que revisar el día del alta: los tres avisos que
> van **al centro** (`centro_*`) le llegarían al mismo número que los manda. Un
> número mandándose plantillas a sí mismo es, como mínimo, raro, y puede que Meta
> ni lo entregue. Lo más probable es que esos tres tengan que ir al celular de
> otra persona, o quedarse sólo en el mail, que es donde ya funcionan bien.

**El texto exacto para pegar en el formulario está en el campo `cuerpo` de cada
plantilla, en `src/lib/whatsapp-plantillas.ts`.** No se copia acá a propósito: dos
copias del mismo texto es cómo empiezan a decir cosas distintas. Ese archivo es
la fuente.

### Las tres reglas de Meta que ya están contempladas

- **Ningún parámetro puede ir vacío** — Meta rechaza el mensaje entero. Los datos
  opcionales (el tratamiento, el motivo de una cancelación) tienen texto de
  reemplazo, y el servicio además lo verifica antes de mandar.
- **Ningún parámetro puede tener saltos de línea.** Lo que en el mail es un
  renglón aparte, en la plantilla va adentro de la misma frase.
- **El cuerpo no puede empezar ni terminar con un hueco**, ni tener dos pegados.
  Por eso en los avisos al centro el nombre y el teléfono de la clienta van en el
  mismo parámetro.

### Cuando cambies un texto

Si tocás el `cuerpo` de una plantilla y **no** volvés a pedir aprobación en Meta,
no pasa nada visible y es peor: Meta sigue mandando **su** versión, la vieja, y el
archivo miente. Si además agregás o sacás un `{{n}}`, la cantidad de parámetros
deja de coincidir y Meta rechaza el envío con un error de parámetros.

### Qué falta para encenderlo

1. Cuenta de **Meta Business** a nombre de la dueña (sin verificar alcanza — §2.2).
2. **Elegir proveedor** preguntando lo de §4, y confirmar ahí mismo que hace
   coexistencia sobre un número que ya está en la app.
3. Dar de alta el número **con coexistencia**, desde el teléfono del centro, sin
   importar historial (§2.1).
4. Cargar las 8 plantillas y esperar la aprobación (minutos a un día), decidiendo
   antes qué se hace con las tres `centro_*`.
5. Sacar el **token permanente** — no el temporal de 24 horas, que vence y corta
   los avisos sin que cambie nada en el código.
6. `WHATSAPP_TOKEN` y `WHATSAPP_PHONE_ID` en el `.env` de la local y del VPS.
7. **No** suscribirse a los webhooks de mensajes entrantes (§7).

Al encenderlo, el recordatorio del día antes pasa a salir por los dos canales, y
la pantalla de Avisos queda como respaldo y como registro.

---

## 10. Si al final va el plan B: sobre el chip nuevo

Sólo aplica a la opción B (§6). Se saca un chip nuevo, y es menos trabajo de lo
que parece.

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

---

## 11. La opción D, paso a paso — 4/9/2026

El código está escrito y **nace apagado**, igual que el de Meta: sin las
variables no intenta nada, no falla, y los avisos salen sólo por mail.

### Lo que se agregó

| Archivo | Qué es |
| --- | --- |
| `src/server/services/evolution.service.ts` | El transporte. Gemelo de `whatsapp.service.ts`, pero manda texto |
| `transporteWhatsapp()` en `notifications.server.ts` | Decide por cuál de los dos sale. Evolution gana si está configurado |
| Perfil `whatsapp` en `docker-compose.yml` | Los tres contenedores: la API, su Postgres y su Redis |
| El bloque `EVOLUTION_*` de `.env.example` | Las variables, con lo que significa cada una |

No hubo que tocar la base de datos ni las pantallas: `deliverAppointmentWhatsapp()`
ya era el único punto de entrada, y adentro se bifurca.

**Lo de Meta no se borró.** Los ocho textos de `whatsapp-plantillas.ts` y el
servicio de la Cloud API siguen ahí, apagados, para el día que se decida pagar.

### Para encenderlo

1. **Comprar el chip.** Un prepago cualquiera. Registrarle WhatsApp desde un
   teléfono —hace falta recibir un SMS una vez— y ponerle foto de perfil y el
   nombre del centro, que es lo que va a ver la clienta.
2. **Poner las variables** del bloque `EVOLUTION_*` en el `.env` del VPS. La
   `EVOLUTION_API_KEY` inventala larga y al azar.
3. **Levantar los contenedores**: `docker compose --profile whatsapp up -d`.
   Sin el `--profile` no levantan, y las variables solas no alcanzan.
4. **Vincular el chip.** El panel de Evolution no sale a internet a propósito, así
   que se abre por un túnel: `ssh -L 8080:127.0.0.1:8080 usuario@vps`, y después
   `localhost:8080` en el navegador. Se crea la instancia con el nombre de
   `EVOLUTION_INSTANCIA` y se escanea el QR desde el teléfono del chip.
5. **Probar con un turno de prueba** antes de que lo vea una clienta.

### Cuando algo no salga

El motivo llega hasta el panel y hasta el log, igual que el del mail. Los tres
que van a aparecer:

- **404** — casi siempre el nombre de la instancia no coincide con el del `.env`.
  No es la URL.
- **"No se pudo llamar a Evolution"** — el contenedor está apagado. Suele ser un
  `docker compose up` sin `--profile whatsapp`.
- **Se manda pero no llega** — la sesión se desvinculó. Hay que volver al panel y
  escanear el QR de nuevo.

### El día que lo baneen

Va a pasar. Cuando pase:

1. Los avisos siguen saliendo **por mail**, solos, sin tocar nada. Nadie se queda
   sin enterarse de su turno.
2. Para el WhatsApp, la pantalla de **Avisos** (§6-C) sigue estando: se vuelve a
   mandar a mano, como antes, mientras se resuelve.
3. Se compra otro chip y se repite desde el paso 1 de arriba.

**Lo que NO hay que hacer ese día es vincular el número del centro "hasta que
consigamos otro chip".** Es exactamente así como se pierde el número bueno: no
por una decisión, sino por un apuro.
