# Retomar el lunes — WhatsApp automático

> Escrito el **viernes 4/9/2026** para seguir el **lunes 7/9/2026**.
>
> Este archivo es temporal: cuando el WhatsApp esté andando y los pendientes de
> abajo estén cerrados o mudados a `TODO.md`, **se borra**. Un archivo de
> "retomar" que sobrevive tres meses es basura que nadie vuelve a leer.

---

## En una línea

Se implementó el envío automático de WhatsApp por un camino que **no le cuesta
nada a la dueña**: un chip descartable vinculado a Evolution API en el VPS. El
código está entero y **apagado**; falta comprar el chip y encenderlo.

---

## Cómo se llegó acá (el resumen de la charla)

La dueña **no quiere pagar nada** por los avisos automáticos. Se descartaron, en
este orden:

| Camino | Por qué no |
| --- | --- |
| Número del centro + coexistencia + proveedor | ~USD 57/mes. La dueña dijo que no |
| Número nuevo + Meta directo | ~USD 7/mes. También dijo que no |
| Ser Tech Provider de nosotros mismos | Gratis, pero es una revisión de Meta entera para dar de alta un número |
| Cupo gratis de Meta | No existe: las plantillas se cobran desde el primer mensaje |

Lo que quedó: **Evolution API sobre un chip descartable**. Es la vía no oficial
—va contra los términos de servicio de WhatsApp— y el riesgo es que **baneen el
número**. Se acepta **sólo** porque el número expuesto es un prepago que no vale
nada.

🔴 **La regla que no se negocia: acá nunca se vincula el número por el que
atienden las secretarias.** Está escrita en el `.env.example`, en
`evolution.service.ts` y en `docs/whatsapp-automatico.md` §5.

El análisis completo, con precios y las cuatro salidas, está en
[`docs/whatsapp-automatico.md`](docs/whatsapp-automatico.md). Se reescribió
entero el 4/9: la versión vieja decía cosas que ya no son ciertas.

---

## Lo que se hizo — código, todo verificado

Pasa `tsc --noEmit` y `eslint` limpio.

| Archivo | Qué cambió |
| --- | --- |
| `src/server/services/evolution.service.ts` | **Nuevo.** El transporte. Gemelo de `whatsapp.service.ts` |
| `src/lib/notifications.server.ts` | `transporteWhatsapp()` elige canal; `deliverAppointmentWhatsapp()` se bifurca |
| `src/server/services/reminders.service.ts` | Pregunta por cualquiera de los dos canales, no sólo por el de Meta |
| `docker-compose.yml` | Perfil `whatsapp`: Evolution + su Postgres + su Redis |
| `.env.example` | Bloque `EVOLUTION_*` documentado |
| `docs/whatsapp-automatico.md` | Reescrito entero |
| `TODO.md` | Actualizadas las dos referencias que quedaron viejas |

**Nada de esto tocó la base de datos.** `deliverAppointmentWhatsapp()` ya era el
único punto de entrada del canal, así que la bifurcación entró adentro y ni el
panel ni el cron se enteraron.

**Lo de Meta no se borró.** `whatsapp-plantillas.ts` y `whatsapp.service.ts`
siguen ahí, apagados, para el día que se decida pagar. Si algún día se configuran
los dos, **gana Evolution** (lo decide `transporteWhatsapp()`).

### Una ventaja que salió de rebote

Evolution manda **texto libre**, no plantillas. Así que usa el mismo
`buildAppointmentMessage()` que el mail. Consecuencias buenas: no hay que cargar
ni mantener 8 plantillas en Meta, no hay trámite de aprobación por cada coma, y
el mail y el WhatsApp del mismo turno **no pueden decir cosas distintas**.

---

## 🔴 Lo que NO está verificado

Que quede claro antes de confiar en esto:

1. **Nunca se levantó.** No hay Docker en la máquina de desarrollo, así que el
   compose no se validó ni una vez. La primera corrida va a ser en el VPS.
2. **La imagen de Evolution no se probó.** Está fijada en
   `evoapicloud/evolution-api:v2.2.3`. El proyecto cambió de organización más de
   una vez; si no baja, el nombre viejo es `atendai/evolution-api`. Se puede
   pisar con `EVOLUTION_IMAGE` sin tocar el compose.
3. **No se mandó ningún mensaje de prueba.** No hay chip ni instancia todavía.
4. **El endpoint es el de la API v2** (`POST /message/sendText/{instancia}`, con
   header `apikey`). Sale de la documentación, no de una llamada real.

---

## Lo que falta, en orden

### 1. Encender el WhatsApp

1. **Comprar el chip** (prepago cualquiera) y registrarle WhatsApp desde un
   teléfono. Ponerle foto de perfil y el nombre del centro: es lo que va a ver la
   clienta.
2. **Variables** del bloque `EVOLUTION_*` en el `.env` **del VPS**.
   `EVOLUTION_API_KEY` inventada larga y al azar.
3. **Levantar**: `docker compose --profile whatsapp up -d`.
   ⚠️ Sin el `--profile` no levantan y las variables solas no alcanzan.
4. **Vincular**: túnel `ssh -L 8080:127.0.0.1:8080 usuario@vps`, abrir
   `localhost:8080`, crear la instancia con el nombre de `EVOLUTION_INSTANCIA` y
   escanear el QR desde el teléfono del chip.
5. **Probar con un turno de prueba** antes de que lo vea una clienta.

El detalle, los errores frecuentes y qué hacer el día que baneen el chip están en
`docs/whatsapp-automatico.md` §11.

### 2. ~~A las profesionales no les llega nada~~ — **hecho el 4/9/2026**

Era un hallazgo de esa tarde: el aviso salía **a una sola casilla**
(`CONTACT.email`, la del centro) y la profesional que atendía el turno no se
enteraba de nada, aunque el sistema supiera quién era.

Se decidió, con la dueña: **además del centro** (no en vez de), y de **todo lo
que le cambie la agenda**. Implementado:

| Archivo | Qué |
| --- | --- |
| `buildProfessionalMessage()` en `notifications.ts` | Los textos, en tono de trabajo y tercera persona |
| `deliverAppointmentToProfessional()` en `notifications.server.ts` | El envío, con el mail sacado de la base |
| `notifications.functions.ts` | Se llama junto al mail y al WhatsApp; el resultado viaja en `professional` |

Le llegan **seis de los ocho** avisos. Los dos que no, a propósito:

- **`requested`** · Es el mismo hecho que `new-request` y se disparan juntos al
  reservar. Mandar los dos serían dos mails por la misma reserva.
- **`reminder`** · Sale uno por turno del día siguiente: a una profesional con
  seis turnos le llegarían seis mails cada mañana. Lo que serviría ahí es un
  resumen del día, que es otra cosa y no existe (ver pendiente 4).

Y no se le avisa **de lo que hizo ella misma** desde el panel — ahora que todas
manejan turnos, es el caso más común, y un mail contándote lo que acabás de hacer
es la forma más rápida de que estos avisos terminen filtrados a la papelera.

**Probado**: los ocho casos se corrieron y se leyeron uno por uno. Pasa `tsc` y
`eslint`. Lo que **no** se probó es el envío real —hace falta base y SMTP—, así
que el lunes conviene confirmar un turno de prueba y mirar que el mail llegue.

Dos cosas que quedaron sin resolver y son decisiones, no olvidos:

- **Una profesional sin cuenta vinculada no recibe nada.** No hay dónde
  mandarle: `professionals.user_id` es nullable y el mail sale de `users`. El
  aviso lo dice en el motivo, pero nadie lo mira todavía.
- **Nadie mira el campo `professional` del resultado.** Viaja hasta el panel y no
  se muestra, igual que `whatsapp`. Es a propósito: la mayoría de las veces "no
  salió" es lo normal —turno sin profesional, o lo hizo ella misma— y ponerlo en
  un toast sería un cartel de error permanente.

### 3. La marca de "ya avisé por WhatsApp" (viejo pendiente)

La pantalla de Avisos no marca a quién ya se le mandó el WhatsApp a mano. Necesita
una columna nueva en `appointments` (`notified_wa_at`).

**Toca la base, así que no se hizo.** Nota: si el envío automático queda andando,
esta falta pierde casi toda su urgencia — el sistema ya sabe si el envío salió.
Ver `docs/whatsapp-automatico.md` §6-C.

### 4. Un resumen del día para cada profesional (nuevo, chico)

Salió del punto 2: el recordatorio diario no se le manda a la profesional porque
serían seis mails sueltos. Un solo mail a la mañana con los turnos del día sí
serviría. No lo pidió nadie todavía — queda anotado y se ve si hace falta.

---

## Estado del repo al cerrar el viernes

**No se commiteó nada.**

En el working tree hay dos cosas mezcladas:

- **Lo de WhatsApp**: los 7 archivos de la tabla de arriba.
- **Trabajo tuyo de antes**, que no se tocó: `auth.tsx`,
  `auth.controller.ts`, `mi-cuenta.tsx`, `reservar.tsx`, `schema.prisma`,
  `password-input.tsx`, `confirmar-mail.tsx`, `confirmar.tsx`,
  `emails/cambiar-mail.html` y algunos más.

Conviene **commitear por separado**, no todo junto.
