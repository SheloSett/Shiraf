-- ============================================================================
-- Lo que `prisma db push` no sabe manejar.
--
-- Se aplica DESPUÉS de cada push, desde scripts/post-push.mjs. Es el mismo
-- patrón que `post-migrate.js` en Ecommerce_mm.
--
-- ── POR QUÉ EXISTE ESTE ARCHIVO ────────────────────────────────────────────
--
-- `db push` sincroniza la base con schema.prisma y nada más. Lo que no está en
-- el schema, para él no existe:
--
--   · triggers y funciones  → los ignora. Sobreviven solos, pero si la base es
--                             nueva nadie los crea.
--   · CHECK constraints     → Prisma no los sabe declarar. Los BORRA por drift.
--   · índices parciales     → tampoco los sabe declarar. Los BORRA por drift.
--
-- O sea que sin este archivo, al primer `db push` sobre una base ya armada
-- desaparecen el candado que impide un turno sin dueño y los cuatro índices que
-- usan los triggers y la tarea de recordatorios. Sin un error, sin un aviso.
--
-- ── TODO ACÁ ADENTRO ES IDEMPOTENTE ────────────────────────────────────────
--
-- Corre en cada arranque del contenedor, así que tiene que poder correr mil
-- veces: CREATE OR REPLACE para las funciones, DROP IF EXISTS + CREATE para los
-- triggers y el CHECK, IF NOT EXISTS para los índices.
-- ============================================================================


-- ═══ 1. REGLAS QUE NO PUEDEN VIVIR EN EL CÓDIGO ═════════════════════════════
--
-- Las tres se quedan en la base porque dependen de que la comprobación y la
-- escritura pasen DENTRO DE LA MISMA TRANSACCIÓN. En código serían "consultar,
-- después escribir", y entre una cosa y la otra entra otro pedido.


-- ── 1.1 Un turno identifica a alguien ───────────────────────────────────────
-- client_id es NULL a propósito en los turnos de invitada, que carga el centro
-- por teléfono. Pero NULL en los dos lados sería un turno de nadie.
ALTER TABLE "appointments" DROP CONSTRAINT IF EXISTS appointments_identifies_someone;
ALTER TABLE "appointments"
  ADD CONSTRAINT appointments_identifies_someone
  CHECK (client_id IS NOT NULL OR btrim(coalesce(guest_name, '')) <> '');


-- ── 1.1 bis  Un turno dice qué tratamiento fue ──────────────────────────────
--
-- `service_id` pasó a ser NULL-able para que un tratamiento se pueda borrar del
-- catálogo sin llevarse el historial por delante. El precio ya estaba congelado
-- en el turno; ahora el nombre también, en `service_name`.
--
-- Sin este CHECK los dos podrían quedar en NULL, y el turno viejo no diría de
-- qué fue. El nombre se escribe SIEMPRE al crear —lo pone `validarTurno`— así
-- que en la práctica nunca se llega acá: el CHECK está para lo que entre por
-- fuera de la app, una corrección a mano, un import, un seed.

-- El relleno va primero: los turnos que ya existían no tienen el nombre escrito
-- y sin esto el CHECK no se podría crear. Es idempotente por el `IS NULL`.
UPDATE appointments a
   SET service_name = s.name
  FROM services s
 WHERE s.id = a.service_id
   AND a.service_name IS NULL;

-- ── 1.1 ter  Y quién lo atendió ─────────────────────────────────────────────
--
-- Mismo relleno que el de arriba, para `professional_name`. Corre en cada push
-- y es idempotente por el `IS NULL`.
--
-- ⚠️ Esto sólo puede recuperar el nombre de las profesionales que TODAVÍA
-- existen. Las que ya se borraron dejaron `professional_id` en NULL y su nombre
-- no está en ningún lado: ese historial ya se perdió y no hay de dónde sacarlo.
-- Por eso importa que esto corra ANTES de la próxima baja del equipo.
--
-- No lleva CHECK: un turno sin profesional y sin nombre es válido —es el que el
-- centro carga sin decidir aún quién atiende—, al revés que con el tratamiento.
UPDATE appointments a
   SET professional_name = pr.full_name
  FROM professionals pr
 WHERE pr.id = a.professional_id
   AND a.professional_name IS NULL;


ALTER TABLE "appointments" DROP CONSTRAINT IF EXISTS appointments_names_its_service;
ALTER TABLE "appointments"
  ADD CONSTRAINT appointments_names_its_service
  CHECK (service_id IS NOT NULL OR btrim(coalesce(service_name, '')) <> '');


-- ── 1.2 Dos clientas no pueden reservar el mismo horario ────────────────────
-- ESTE ES EL IMPORTANTE. Si esto se hiciera en código —"fijate si está libre" y
-- después "insertá"— dos reservas que llegan juntas leen las dos que está libre
-- y las dos escriben. El sábado a la mañana, que es cuando más se reserva, es
-- cuando más probable es.
CREATE OR REPLACE FUNCTION check_appointment_overlap()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  conflicts INTEGER;
BEGIN
  -- Un turno cancelado o ya realizado no bloquea la agenda, y sin profesional
  -- asignada no hay con quién superponerse.
  IF NEW.professional_id IS NULL OR NEW.status NOT IN ('pending', 'confirmed') THEN
    RETURN NEW;
  END IF;

  SELECT count(*)
    INTO conflicts
  FROM appointments a
  WHERE a.professional_id = NEW.professional_id
    AND a.id <> NEW.id
    AND a.status IN ('pending', 'confirmed')
    -- Dos rangos se pisan si cada uno empieza antes de que termine el otro.
    AND a.starts_at < NEW.starts_at + make_interval(mins => NEW.duration_minutes)
    AND NEW.starts_at < a.starts_at + make_interval(mins => a.duration_minutes);

  IF conflicts > 0 THEN
    RAISE EXCEPTION 'Ese horario ya fue tomado con esa profesional.'
      USING ERRCODE = 'exclusion_violation';
  END IF;

  -- ── Y la clienta tampoco puede estar en dos camillas a la vez ─────────────
  --
  -- Esto faltaba, y se descubrió probando: la misma clienta sacaba dos turnos a
  -- la MISMA hora con dos profesionales distintas y el sistema los aceptaba los
  -- dos. La comprobación de arriba sólo mira que no se pise la profesional;
  -- nadie miraba a la persona que se atiende.
  --
  -- Va en la base y no en el código por el mismo motivo que la de arriba: dos
  -- reservas que llegan juntas leerían las dos que el horario está libre. Acá
  -- las dos pasan por la misma transacción.
  --
  -- Sólo para las clientas CON cuenta. Una invitada no tiene id con el que
  -- reconocerla, y cruzar por teléfono sería adivinar: dos personas de la misma
  -- casa pueden compartir el número, y de hecho en esta base ya hay un teléfono
  -- repetido entre dos personas distintas.
  IF NEW.client_id IS NOT NULL THEN
    SELECT count(*)
      INTO conflicts
    FROM appointments a
    WHERE a.client_id = NEW.client_id
      AND a.id <> NEW.id
      AND a.status IN ('pending', 'confirmed')
      AND a.starts_at < NEW.starts_at + make_interval(mins => NEW.duration_minutes)
      AND NEW.starts_at < a.starts_at + make_interval(mins => a.duration_minutes);

    IF conflicts > 0 THEN
      RAISE EXCEPTION 'Esa clienta ya tiene otro turno a esa hora.'
        USING ERRCODE = 'exclusion_violation';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_check_appointment_overlap ON "appointments";
-- `client_id` se suma a la lista de columnas que disparan el chequeo: sin eso,
-- vincular una invitada a una cuenta que ya tiene un turno a esa hora pasaría
-- sin que nadie mire.
CREATE TRIGGER trg_check_appointment_overlap
  BEFORE INSERT OR UPDATE OF starts_at, duration_minutes, professional_id, status, client_id
  ON "appointments"
  FOR EACH ROW EXECUTE FUNCTION check_appointment_overlap();


-- ── 1.3 El saldo de stock se mueve junto con el movimiento ──────────────────
-- Mismo motivo: "leer el stock, sumarle, guardarlo" desde dos lugares a la vez
-- pierde uno de los dos movimientos.
CREATE OR REPLACE FUNCTION apply_stock_movement()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  UPDATE products
    SET stock = stock + NEW.quantity,
        updated_at = now()
  WHERE id = NEW.product_id;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_apply_stock_movement ON "stock_movements";
CREATE TRIGGER trg_apply_stock_movement
AFTER INSERT ON "stock_movements"
FOR EACH ROW EXECUTE FUNCTION apply_stock_movement();


-- ── 1.4 La portada del tratamiento sigue a la primera foto ──────────────────
-- Éste se queda por otro motivo, no por la condición de carrera: es un
-- invariante de datos. Vale aunque alguien escriba por fuera de la app —un
-- seed, una corrección a mano, un import— y en esos casos no hay código de la
-- app que lo mantenga.
--
-- Es lo que hace que el seed NO tenga que escribir services.image_url.
CREATE OR REPLACE FUNCTION sync_service_cover()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  target UUID := COALESCE(NEW.service_id, OLD.service_id);
BEGIN
  -- Si el tratamiento se está borrando, el CASCADE ya se llevó su fila de
  -- services y este UPDATE no matchea nada. Es el caso normal, no un error.
  UPDATE services s
     SET image_url = (
           SELECT m.url
             FROM service_media m
            WHERE m.service_id = target
              AND m.kind = 'image'
            ORDER BY m.position, m.created_at
            LIMIT 1
         )
   WHERE s.id = target;

  RETURN NULL; -- AFTER trigger: el valor de retorno se ignora.
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_service_cover ON "service_media";
CREATE TRIGGER trg_sync_service_cover
  AFTER INSERT OR DELETE OR UPDATE OF service_id, url, kind, position
  ON "service_media"
  FOR EACH ROW EXECUTE FUNCTION sync_service_cover();


-- ═══ 2. FUNCIONES QUE USA EL CÓDIGO ═════════════════════════════════════════

-- ── 2.1 normalize_phone ─────────────────────────────────────────────────────
-- Se queda con los últimos 10 dígitos, que en Argentina son área + número. Así
-- da igual si alguien anotó el 54, el 9 de celular o ninguno de los dos.
--
-- IMMUTABLE no es decorativo: sin eso no se puede indexar por su resultado, y
-- el índice 3.4 de más abajo la necesita.
CREATE OR REPLACE FUNCTION normalize_phone(_phone TEXT)
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT NULLIF(RIGHT(regexp_replace(coalesce(_phone, ''), '\D', '', 'g'), 10), '')
$$;


-- ═══ 3. ÍNDICES QUE PRISMA NO SABE ESCRIBIR ═════════════════════════════════
--
-- Los tres simples están declarados con @@index en schema.prisma y los mantiene
-- `db push`. Estos cuatro son PARCIALES (llevan WHERE) y uno además es DE
-- EXPRESIÓN. El lenguaje de Prisma no tiene forma de decir ninguna de las dos.
--
-- Ninguno da error si falta: sólo se pone lento, y para cuando se note, nadie
-- lo va a atribuir a esto.


-- ── 3.1 La agenda de una profesional, y el chequeo de superposición ─────────
-- Lo usan dos cosas: los horarios libres de /reservar y de "Nuevo turno", y el
-- SELECT de adentro de check_appointment_overlap().
CREATE INDEX IF NOT EXISTS appointments_professional_starts_idx
  ON "appointments" (professional_id, starts_at)
  WHERE status IN ('pending', 'confirmed');


-- ── 3.2 Buscar una invitada por su teléfono tal como se anotó ───────────────
CREATE INDEX IF NOT EXISTS appointments_guest_phone_idx
  ON "appointments" (guest_phone)
  WHERE guest_phone IS NOT NULL;


-- ── 3.3 Buscarla por el teléfono normalizado ────────────────────────────────
-- El de expresión. Es el que permite juntar todos los turnos de un mismo número
-- escrito de tres formas distintas. Sin él esa comparación no puede usar ningún
-- índice: normalize_phone(guest_phone) no es una columna.
CREATE INDEX IF NOT EXISTS appointments_guest_phone_norm_idx
  ON "appointments" (normalize_phone(guest_phone))
  WHERE client_id IS NULL AND guest_phone IS NOT NULL;


-- ── 3.4 A quién le toca el recordatorio ─────────────────────────────────────
-- Cubre exactamente la consulta de la tarea de recordatorios: los confirmados
-- de un día que todavía no recibieron el aviso. El WHERE parcial lo mantiene
-- chico — los ya avisados SALEN del índice en cuanto se les escribe la fecha,
-- así que no crece con el uso.
CREATE INDEX IF NOT EXISTS appointments_pending_reminder_idx
  ON "appointments" (starts_at)
  WHERE reminded_at IS NULL AND status = 'confirmed';
