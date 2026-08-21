-- ============================================================================
-- Turnos de clientas sin cuenta.
--
-- EL PROBLEMA: appointments.client_id apunta a auth.users y era NOT NULL, así
-- que un turno sólo podía existir a nombre de alguien ya registrado en el
-- sitio. Buena parte de la agenda de un centro entra por teléfono, y quien
-- llama por primera vez no tiene cuenta: ese turno no había forma de anotarlo.
-- Quedaba en un cuaderno, y el calendario del panel mostraba una agenda que no
-- era la real.
--
-- LA DECISIÓN: no se le crea una cuenta. Por teléfono se consigue un nombre y
-- un celular; el mail casi nunca, y exigirlo habría dejado afuera justo el caso
-- que se vino a resolver. El turno guarda esos dos datos y listo.
--
-- El mail queda opcional igual: si lo dan, sirve para reconocerla el día que se
-- registre sola y poder vincularle el historial.
-- ============================================================================

ALTER TABLE public.appointments
  ALTER COLUMN client_id DROP NOT NULL,
  ADD COLUMN IF NOT EXISTS guest_name  TEXT,
  ADD COLUMN IF NOT EXISTS guest_phone TEXT,
  ADD COLUMN IF NOT EXISTS guest_email TEXT;

-- Un turno tiene que identificar a alguien: o una cuenta, o un nombre suelto.
-- Sin esto se podría crear uno anónimo, que en la agenda no sirve para nada.
ALTER TABLE public.appointments
  ADD CONSTRAINT appointments_identifies_someone
  CHECK (client_id IS NOT NULL OR btrim(coalesce(guest_name, '')) <> '');

COMMENT ON COLUMN public.appointments.guest_name IS
  'Nombre de la clienta cuando no tiene cuenta. Sólo lo carga el centro, desde '
  'el panel. Si client_id está seteado, esto va en NULL.';

-- ── Por qué las policies no se tocan ────────────────────────────────────────
-- Quedan como están y eso es lo correcto, pero conviene dejarlo escrito porque
-- no es evidente:
--
--   · "read appointments" pide `client_id = auth.uid() OR has_permission(...)`.
--     Con client_id en NULL, la comparación da NULL —no TRUE—, así que ninguna
--     clienta ve los turnos de invitadas. Sólo los ve quien tiene el permiso
--     de turnos, que es lo que se busca.
--
--   · "clients create own appointments" pide `client_id = auth.uid()`. Por el
--     mismo motivo, una clienta NO puede crearse un turno de invitada para
--     saltearse las validaciones: la policy no la deja pasar con NULL.
--
--   · "staff create appointments" pide el permiso `appointments`. Es la única
--     puerta por la que entra un turno de invitada, y es la correcta: lo carga
--     el centro.

-- ── El trigger de validación sí necesita un ajuste ──────────────────────────
-- validate_appointment() exigía fecha futura a todo el que no fuera admin. Con
-- turnos de invitada eso se vuelve más común de lo que era: los carga la
-- secretaria, que puede tener el permiso de turnos sin ser admin, y a veces
-- anota lo que ya pasó por el mostrador.
--
-- Se cambia el criterio: la excepción deja de ser "sos admin" y pasa a ser
-- "gestionás turnos". Es la misma idea —quien atiende el mostrador puede
-- registrar la realidad— expresada con el permiso en vez del rol.
CREATE OR REPLACE FUNCTION public.validate_appointment()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  salon_tz CONSTANT TEXT := 'America/Argentina/Buenos_Aires';

  manages_agenda BOOLEAN;
  svc RECORD;
  local_start TIMESTAMP;
  local_end TIMESTAMP;
  fits BOOLEAN;
BEGIN
  SELECT id, price, duration_minutes, is_published
    INTO svc
    FROM public.services
   WHERE id = NEW.service_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'El tratamiento no existe.';
  END IF;

  NEW.duration_minutes := svc.duration_minutes;

  IF TG_OP = 'INSERT' THEN
    NEW.price := svc.price;
  ELSIF NEW.service_id IS DISTINCT FROM OLD.service_id THEN
    NEW.price := svc.price;
  END IF;

  -- Nombre de invitada sin espacios de más, y vacío tratado como ausente.
  NEW.guest_name  := nullif(btrim(coalesce(NEW.guest_name, '')), '');
  NEW.guest_phone := nullif(btrim(coalesce(NEW.guest_phone, '')), '');
  NEW.guest_email := nullif(btrim(coalesce(NEW.guest_email, '')), '');

  -- Los datos de invitada sólo tienen sentido sin cuenta. Si hay client_id, se
  -- descartan en vez de rechazar: son el resto de un formulario mal completado,
  -- no un intento de nada.
  IF NEW.client_id IS NOT NULL THEN
    NEW.guest_name  := NULL;
    NEW.guest_phone := NULL;
    NEW.guest_email := NULL;
  END IF;

  IF auth.uid() IS NULL THEN
    RETURN NEW;
  END IF;

  manages_agenda := public.has_permission(auth.uid(), 'appointments');

  IF NOT svc.is_published AND NOT manages_agenda THEN
    RAISE EXCEPTION 'Ese tratamiento no está disponible para reservar.';
  END IF;

  IF NOT manages_agenda AND NEW.starts_at <= now() THEN
    RAISE EXCEPTION 'No se puede reservar un turno en el pasado.';
  END IF;

  IF NEW.professional_id IS NULL THEN
    IF manages_agenda THEN
      RETURN NEW;
    END IF;
    RAISE EXCEPTION 'Hay que elegir una profesional.';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.professionals
     WHERE id = NEW.professional_id AND is_active
  ) THEN
    RAISE EXCEPTION 'Esa profesional no está disponible.';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.professional_services
     WHERE professional_id = NEW.professional_id
       AND service_id = NEW.service_id
  ) THEN
    RAISE EXCEPTION 'Esa profesional no realiza ese tratamiento.';
  END IF;

  IF NOT manages_agenda THEN
    local_start := NEW.starts_at AT TIME ZONE salon_tz;
    local_end := local_start + make_interval(mins => NEW.duration_minutes);

    SELECT EXISTS (
      SELECT 1
        FROM public.professional_schedules ps
       WHERE ps.professional_id = NEW.professional_id
         AND ps.weekday = EXTRACT(DOW FROM local_start)::SMALLINT
         AND local_start::TIME >= ps.start_time
         AND local_end::TIME <= ps.end_time
         AND local_end::DATE = local_start::DATE
    ) INTO fits;

    IF NOT fits THEN
      RAISE EXCEPTION 'Ese horario está fuera de la agenda de la profesional.';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.validate_appointment() FROM PUBLIC, anon, authenticated;

-- Para buscar por teléfono el día que se quiera vincular una invitada con la
-- cuenta que se creó después.
CREATE INDEX IF NOT EXISTS appointments_guest_phone_idx
  ON public.appointments (guest_phone)
  WHERE guest_phone IS NOT NULL;
