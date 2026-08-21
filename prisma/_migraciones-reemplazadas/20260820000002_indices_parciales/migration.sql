-- ============================================================================
-- Los índices que Prisma no sabe escribir.
--
-- Migración a mano (`prisma migrate dev --create-only`).
--
-- De los 7 índices que appointments y service_media tenían en Supabase, 3 son
-- simples y están declarados con @@index en schema.prisma. Estos 4 no se pueden:
-- tres son PARCIALES (llevan WHERE) y uno además es DE EXPRESIÓN (indexa el
-- resultado de una función, no una columna). El lenguaje de Prisma no tiene
-- forma de expresar ninguna de las dos cosas.
--
-- POR QUÉ IMPORTAN, SI HOY LA BASE TIENE 77 FILAS. Dos de ellos existen para
-- acelerar triggers que sí se migraron, y ninguno de los dos se va a quejar por
-- estar faltando: simplemente van a recorrer la tabla entera. Con la agenda de
-- un año cargada, eso pasa a notarse justo en el momento de reservar. Un índice
-- que falta nunca da error, sólo se pone lento, y para entonces nadie lo va a
-- atribuir a este traslado.
--
-- ⚠️ LIMITACIÓN CONOCIDA DE PRISMA, Y HAY QUE TENERLA PRESENTE.
--    `prisma migrate dev` compara la base contra schema.prisma, y como estos 4
--    no están ahí, los va a ver como "drift" y va a ofrecer borrarlos. En
--    producción no pasa —`migrate deploy` sólo aplica lo pendiente, no compara—
--    pero en desarrollo hay que leer lo que propone antes de aceptar. Si alguna
--    vez los borra, se recuperan volviendo a correr este archivo.
-- ============================================================================


-- ─────────────────────────────────────────────────────────────────────────────
-- 1. normalize_phone
--
-- Va acá y no en la migración de las RPC porque el índice 4 la necesita: un
-- índice de expresión exige que la función exista y sea IMMUTABLE. Cuando se
-- porten las 8 RPC, link_guest_appointments va a usar ésta misma — es
-- CREATE OR REPLACE, así que volver a declararla no molesta.
--
-- Se queda con los últimos 10 dígitos, que en Argentina son área + número. Así
-- da igual si alguien anotó el 54, el 9 de celular o ninguno de los dos.
-- Copiada de 20260816020000.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION normalize_phone(_phone TEXT)
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT NULLIF(RIGHT(regexp_replace(coalesce(_phone, ''), '\D', '', 'g'), 10), '')
$$;


-- ─────────────────────────────────────────────────────────────────────────────
-- 2. La agenda de una profesional, y el chequeo de superposición
--
-- Lo usan dos cosas: professional_busy_slots() —que es lo que dibuja los
-- horarios libres en /reservar y en "Nuevo turno"— y el SELECT de adentro de
-- check_appointment_overlap(), el trigger que rechaza dos turnos encimados.
--
-- El WHERE lo mantiene chico: los cancelados y los ya realizados se acumulan
-- para siempre y no participan de ninguna de las dos consultas.
-- De 20260813020000.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE INDEX IF NOT EXISTS appointments_professional_starts_idx
  ON "appointments" (professional_id, starts_at)
  WHERE status IN ('pending', 'confirmed');


-- ─────────────────────────────────────────────────────────────────────────────
-- 3. Buscar una invitada por su teléfono tal como se anotó
-- De 20260816010000.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE INDEX IF NOT EXISTS appointments_guest_phone_idx
  ON "appointments" (guest_phone)
  WHERE guest_phone IS NOT NULL;


-- ─────────────────────────────────────────────────────────────────────────────
-- 4. Buscarla por el teléfono normalizado
--
-- El de expresión. Es el que usa link_guest_appointments() para juntar todos los
-- turnos de un mismo número escrito de tres formas distintas. Sin el índice, esa
-- comparación no puede usar ninguno: normalize_phone(guest_phone) no es una
-- columna. De 20260816020000.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE INDEX IF NOT EXISTS appointments_guest_phone_norm_idx
  ON "appointments" (normalize_phone(guest_phone))
  WHERE client_id IS NULL AND guest_phone IS NOT NULL;


-- ─────────────────────────────────────────────────────────────────────────────
-- 5. A quién le toca el recordatorio
--
-- Cubre exactamente la consulta de runDailyReminders(): los confirmados de un
-- día que todavía no recibieron el aviso. El WHERE parcial lo mantiene chico —
-- los turnos ya avisados SALEN del índice en cuanto se les escribe la fecha, así
-- que no crece con el uso. De 20260818030000.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE INDEX IF NOT EXISTS appointments_pending_reminder_idx
  ON "appointments" (starts_at)
  WHERE reminded_at IS NULL AND status = 'confirmed';
