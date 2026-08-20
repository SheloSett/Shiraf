-- ============================================================================
-- Lo que NO puede vivir en el código, y por qué.
--
-- Migración a mano (`prisma migrate dev --create-only`). Fase 3 del plan.
--
-- La regla general de esta migración es que Postgres deja de ser quien decide
-- QUIÉN puede hacer qué —eso pasa a ser trabajo del código, en la Fase 5— pero
-- sigue siendo quien garantiza que los datos no queden inconsistentes. Son dos
-- cosas distintas y sólo la primera se muda.
--
-- Estas tres reglas se quedan porque las tres dependen de que la comprobación y
-- la escritura pasen DENTRO DE LA MISMA TRANSACCIÓN. En código serían
-- "consultar, después escribir", y entre una cosa y la otra entra otro pedido.
--
-- Ninguna de las tres usa auth.uid() ni has_permission(), así que se copian casi
-- textuales. Lo único que se sacó es SECURITY DEFINER: estaba para saltear la
-- RLS, y acá no hay RLS que saltear.
-- ============================================================================


-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Un turno identifica a alguien
--
-- Prisma no sabe expresar un CHECK en el esquema, así que va acá y hay que
-- acordarse de que existe: no aparece en schema.prisma.
--
-- client_id es NULL a propósito en los turnos de invitada, que carga el centro
-- por teléfono. Pero NULL en los dos lados sería un turno de nadie.
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE "appointments"
  ADD CONSTRAINT appointments_identifies_someone
  CHECK (client_id IS NOT NULL OR btrim(coalesce(guest_name, '')) <> '');


-- ─────────────────────────────────────────────────────────────────────────────
-- 2. Dos clientas no pueden reservar el mismo horario
--
-- ESTE ES EL IMPORTANTE. Si esto se hiciera en código —"fijate si está libre" y
-- después "insertá"— dos reservas que llegan juntas leen las dos que está libre
-- y las dos escriben. El sábado a la mañana, que es cuando más se reserva, es
-- cuando más probable es.
-- ─────────────────────────────────────────────────────────────────────────────

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

  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_check_appointment_overlap
  BEFORE INSERT OR UPDATE OF starts_at, duration_minutes, professional_id, status
  ON "appointments"
  FOR EACH ROW EXECUTE FUNCTION check_appointment_overlap();


-- ─────────────────────────────────────────────────────────────────────────────
-- 3. El saldo de stock se mueve junto con el movimiento
--
-- Mismo motivo: "leer el stock, sumarle, guardarlo" desde dos lugares a la vez
-- pierde uno de los dos movimientos. Acá el UPDATE va en la misma transacción
-- que el INSERT que lo disparó.
-- ─────────────────────────────────────────────────────────────────────────────

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

CREATE TRIGGER trg_apply_stock_movement
AFTER INSERT ON "stock_movements"
FOR EACH ROW EXECUTE FUNCTION apply_stock_movement();


-- ─────────────────────────────────────────────────────────────────────────────
-- 4. La portada del tratamiento sigue a la primera foto de la galería
--
-- Este se queda por otro motivo, no por la condición de carrera: es un
-- invariante de datos, no una regla de negocio. Vale aunque alguien escriba por
-- fuera de la app —un seed, una corrección a mano, un import— y en esos casos no
-- hay código de la app que lo mantenga.
--
-- ⚠️ Esto es lo que hace que NO haya que seedear services.image_url en la Fase 4.
--    Se escribe solo al insertar las fotos.
-- ─────────────────────────────────────────────────────────────────────────────

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

CREATE TRIGGER trg_sync_service_cover
  AFTER INSERT OR DELETE OR UPDATE OF service_id, url, kind, position
  ON "service_media"
  FOR EACH ROW EXECUTE FUNCTION sync_service_cover();
