# Pendientes de Shiraf

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

> *Set up custom SMTP to edit templates. Emails will be sent using the default
> templates.*

O sea que el formato del mail y el remitente vienen juntos, no se pueden separar.
Hoy a la clienta le llega un mail **en inglés**, de `noreply@mail.app.supabase.io`,
con un pie que dice *"powered by Supabase"*.

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
- [ ] **Cargar turnos de clientas sin cuenta.** Hoy el panel solo deja elegir
      entre quienes ya se registraron, porque `appointments.client_id` apunta a
      `auth.users`. El turno telefónico de alguien nuevo no entra. Necesita un
      `createServerFn` con la Admin API, igual que el alta de empleadas.
- [ ] **Bloqueos de agenda:** vacaciones, feriados, francos. Hoy solo hay horario
      semanal fijo, sin excepciones por fecha: un 25 de diciembre es reservable.

## Tanda 3 — los 5 bugs medianos, ninguno hecho

Verificados en el código el 15/8/2026. Independientes entre sí, ninguno depende
de datos que falten.

- [ ] **Borrar un servicio no borra su foto.** `removeServiceImage` sólo se
      llama al reemplazarla, no en la mutación `remove` de
      [`admin.servicios.tsx`](src/routes/_authenticated/admin.servicios.tsx).
      Con Cloudinary esto pesa más que antes: el plan gratuito tiene cuota, y
      cada foto huérfana la consume para siempre. Son dos líneas.
- [ ] **Colisión de `["admin-services"]`.** Servicios y Profesionales usan la
      misma clave de react-query con `select` distintos; al navegar de una a
      otra, la tabla de servicios muestra precio y duración vacíos hasta que
      refetchea.
- [ ] **Renombrar categoría no es atómico:** dos UPDATE sueltos. Si el segundo
      falla, la categoría queda renombrada y los servicios apuntando al nombre
      viejo.
- [ ] **Desactivar una profesional no avisa de sus turnos futuros.** Quedan
      agendados con alguien que ya no atiende.
- [ ] **`mi-cuenta` no filtra por `client_id`.** Se apoya sólo en la RLS, así
      que a un admin le lista los turnos de todas las clientas en su propia
      cuenta.

## Chicas

- [ ] El comentario de `requiredAccessFor` en [`src/lib/permissions.ts`](src/lib/permissions.ts)
      quedó viejo: dice que `clients_notes` y `stock_costs` no tienen respaldo en
      la base, pero la migración `20260814010000` los convirtió en candados reales.
- [ ] `profiles.birth_date` existe en la tabla y no se muestra ni se edita en
      ningún lado. Los cumpleaños son acción comercial clásica en estética.
- [ ] El favicon sigue siendo el de Lovable.
- [ ] Fotos reales del centro. Sigue siendo el techo del diseño.
