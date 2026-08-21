-- ============================================================================
-- Reglas del turno en la base.
--
-- El problema de fondo: la app no tiene capa de servidor. No hay un solo
-- createServerFn en src/, así que el navegador le habla directo a PostgREST con
-- la clave publishable — que es pública y viaja en el bundle. Todo lo que
-- valida src/routes/_authenticated/reservar.tsx (que el horario esté libre, que
-- la profesional haga ese tratamiento, que la duración sea la correcta) es
-- decoración: se saltea con un POST hecho a mano.
--
-- Hoy, con sólo estar registrada, una clienta puede:
--   · sacarse un turno a las 3 de la mañana de un domingo,
--   · con una profesional que no realiza ese tratamiento,
--   · declarando duration_minutes = 5 para ocupar menos agenda,
--   · en una fecha ya pasada,
--   · auto-confirmárselo (status = 'confirmed'),
--   · cambiarle el service_id después de confirmado — reservar el de $22.000 y
--     dejarlo en el de $38.000, o al revés,
--   · y escribir en admin_notes, que es el campo interno del centro.
--
-- Esto lo cierra en la base, que es el único lugar que vale sin importar quién
-- llame: el navegador, un script o el SQL editor.
--
-- Además congela el precio del turno. Hoy appointments no lo guarda y el panel
-- lo lee de services(price) en vivo, así que cada actualización de precios
-- reescribe el valor de todos los turnos ya realizados. La duración sí se
-- copiaba al turno, lo que delata que el precio fue un olvido y no una
-- decisión.
-- ============================================================================

-- ── 1. El precio deja de ser un dato prestado del catálogo ──────────────────
ALTER TABLE public.appointments ADD COLUMN IF NOT EXISTS price NUMERIC(12,2);

-- Los turnos que ya existen toman el precio actual de su tratamiento. Es lo
-- más cerca de la verdad que se puede reconstruir: el precio con el que se
-- reservaron no quedó registrado en ningún lado.
UPDATE public.appointments a
   SET price = s.price
  FROM public.services s
 WHERE s.id = a.service_id
   AND a.price IS NULL;

-- ── 2. Validación y congelado, al insertar o al reprogramar ─────────────────
-- SECURITY DEFINER porque tiene que ver el catálogo y las agendas completas sin
-- que la RLS de quien llama le recorte lo que puede leer.
CREATE OR REPLACE FUNCTION public.validate_appointment()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  -- El centro está en Buenos Aires. professional_schedules guarda TIME sin
  -- zona (hora de pared) y appointments.starts_at es TIMESTAMPTZ, así que para
  -- compararlos hay que traer el turno a la hora local del centro. Sin esto,
  -- una clienta con el reloj en otra zona reservaría horarios corridos.
  salon_tz CONSTANT TEXT := 'America/Argentina/Buenos_Aires';

  is_admin BOOLEAN;
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

  -- Duración y precio los fija la base, nunca el cliente. Van antes de
  -- cualquier chequeo de permisos a propósito: son integridad del dato, no
  -- autorización, y tienen que valer también cuando el turno lo cree el
  -- servidor con la service role.
  NEW.duration_minutes := svc.duration_minutes;

  IF TG_OP = 'INSERT' THEN
    NEW.price := svc.price;
  ELSIF NEW.service_id IS DISTINCT FROM OLD.service_id THEN
    -- Si el centro le cambia el tratamiento a un turno, el precio acompaña.
    NEW.price := svc.price;
  END IF;

  -- auth.uid() en NULL significa que no hay JWT: la llamada viene del servidor
  -- (service_role) o del SQL editor. No es un agujero — anon no tiene GRANT
  -- sobre appointments, así que desde el navegador no se llega hasta acá sin
  -- sesión.
  IF auth.uid() IS NULL THEN
    RETURN NEW;
  END IF;

  is_admin := public.has_role(auth.uid(), 'admin');

  IF NOT svc.is_published AND NOT is_admin THEN
    RAISE EXCEPTION 'Ese tratamiento no está disponible para reservar.';
  END IF;

  -- El centro sí puede cargar un turno viejo: al implementarse la carga manual
  -- va a hacer falta para registrar lo que ya pasó por el mostrador.
  IF NOT is_admin AND NEW.starts_at <= now() THEN
    RAISE EXCEPTION 'No se puede reservar un turno en el pasado.';
  END IF;

  IF NEW.professional_id IS NULL THEN
    IF is_admin THEN
      RETURN NEW;  -- el centro puede dejarlo sin asignar y resolverlo después
    END IF;
    RAISE EXCEPTION 'Hay que elegir una profesional.';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.professionals
     WHERE id = NEW.professional_id AND is_active
  ) THEN
    RAISE EXCEPTION 'Esa profesional no está disponible.';
  END IF;

  -- Vale también para el admin: asignarle el tratamiento a la profesional es
  -- una casilla en el panel, y si no está tildada lo más probable es que sea
  -- un error de carga y no una excepción buscada.
  IF NOT EXISTS (
    SELECT 1 FROM public.professional_services
     WHERE professional_id = NEW.professional_id
       AND service_id = NEW.service_id
  ) THEN
    RAISE EXCEPTION 'Esa profesional no realiza ese tratamiento.';
  END IF;

  -- El horario, en cambio, no se le exige al centro: que una profesional se
  -- quede más tarde por una clienta es normal y el panel tiene que poder
  -- registrarlo.
  IF NOT is_admin THEN
    local_start := NEW.starts_at AT TIME ZONE salon_tz;
    local_end := local_start + make_interval(mins => NEW.duration_minutes);

    SELECT EXISTS (
      SELECT 1
        FROM public.professional_schedules ps
       WHERE ps.professional_id = NEW.professional_id
         AND ps.weekday = EXTRACT(DOW FROM local_start)::SMALLINT
         AND local_start::TIME >= ps.start_time
         AND local_end::TIME <= ps.end_time
         -- Un turno que cruza la medianoche caería en otro weekday y rompería
         -- la comparación de TIME de arriba.
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

-- ── 3. Qué puede tocar la clienta de su propio turno ────────────────────────
-- A propósito NO es SECURITY DEFINER: sólo compara OLD contra NEW y no lee
-- ninguna tabla protegida, así que conviene que corra con el rol real de quien
-- llama.
--
-- Por qué un trigger y no un GRANT por columna: el admin no es un rol de
-- Postgres distinto, es el mismo `authenticated` con una fila en user_roles.
-- Un GRANT UPDATE (columna) le sacaría al centro la posibilidad de reprogramar
-- turnos junto con la de la clienta. El trigger puede preguntar has_role() y
-- aplicarle una regla distinta a cada uno.
CREATE OR REPLACE FUNCTION public.enforce_appointment_client_scope()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN NEW;
  END IF;

  IF public.has_role(auth.uid(), 'admin') THEN
    RETURN NEW;
  END IF;

  -- De acá para abajo es una clienta editando un turno propio: la RLS ya
  -- garantizó que le pertenece. Lo único suyo es cancelarlo y su nota.
  IF NEW.status IS DISTINCT FROM OLD.status THEN
    IF NEW.status <> 'cancelled' THEN
      RAISE EXCEPTION 'Sólo el centro puede confirmar o cerrar un turno.';
    END IF;
    IF OLD.status NOT IN ('pending', 'confirmed') THEN
      RAISE EXCEPTION 'Este turno ya no se puede cancelar.';
    END IF;
  END IF;

  IF NEW.client_id        IS DISTINCT FROM OLD.client_id
  OR NEW.service_id       IS DISTINCT FROM OLD.service_id
  OR NEW.professional_id  IS DISTINCT FROM OLD.professional_id
  OR NEW.starts_at        IS DISTINCT FROM OLD.starts_at
  OR NEW.duration_minutes IS DISTINCT FROM OLD.duration_minutes
  OR NEW.price            IS DISTINCT FROM OLD.price
  OR NEW.admin_notes      IS DISTINCT FROM OLD.admin_notes
  OR NEW.created_at       IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'Para reprogramar el turno escribinos: desde acá sólo podés cancelarlo.';
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.enforce_appointment_client_scope()
  FROM PUBLIC, anon, authenticated;

-- ── 4. Enganche ────────────────────────────────────────────────────────────
-- Postgres dispara los triggers BEFORE por orden alfabético de nombre, y estos
-- quedan client_scope → validate → check_overlap (el que ya existía). Es el
-- orden que se quiere: primero si podés tocarlo, después si el dato cierra, y
-- al final si el horario está libre.
DROP TRIGGER IF EXISTS trg_appointment_client_scope ON public.appointments;
CREATE TRIGGER trg_appointment_client_scope
  BEFORE UPDATE ON public.appointments
  FOR EACH ROW EXECUTE FUNCTION public.enforce_appointment_client_scope();

-- En UPDATE se limita a las columnas que pueden invalidar el turno: cancelar
-- uno viejo no tiene por qué re-validar contra la agenda de hoy.
DROP TRIGGER IF EXISTS trg_appointment_validate ON public.appointments;
CREATE TRIGGER trg_appointment_validate
  BEFORE INSERT OR UPDATE OF service_id, professional_id, starts_at
  ON public.appointments
  FOR EACH ROW EXECUTE FUNCTION public.validate_appointment();

-- Recién ahora, con el backfill hecho y el trigger completando la columna en
-- cada alta, el precio puede exigirse siempre presente.
ALTER TABLE public.appointments ALTER COLUMN price SET NOT NULL;
