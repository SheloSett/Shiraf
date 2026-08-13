-- ============================================================================
-- Evitar la doble reserva.
--
-- El problema: la policy de appointments deja ver únicamente los turnos
-- propios. Cuando el formulario de reserva consultaba la tabla para calcular
-- la disponibilidad, sólo recibía los turnos de la clienta conectada, así que
-- los horarios ocupados por OTRAS clientas aparecían libres. Dos personas
-- podían tomar el mismo horario con la misma profesional y nada lo impedía:
-- ni la interfaz ni la base.
--
-- Se ataca por los dos lados:
--   1. professional_busy_slots(): expone los rangos ocupados sin revelar de
--      quién son, para que el cálculo de horarios libres sea correcto.
--   2. Un trigger que rechaza el turno si se superpone, como última línea de
--      defensa aunque alguien escriba directo contra la API.
-- ============================================================================

-- ── 1. Rangos ocupados, sin datos personales ────────────────────────────────
-- SECURITY DEFINER para saltear la RLS de appointments: es la única forma de
-- que una clienta sepa que un horario está tomado sin poder ver de quién es el
-- turno. Devuelve sólo inicio y duración; ni id de cliente, ni notas, ni nada.
-- Las columnas de salida se llaman slot_start / slot_minutes y no starts_at /
-- duration_minutes a propósito: en RETURNS TABLE los nombres de salida quedan
-- en el mismo ámbito que las columnas de la tabla, y repetirlos invita a un
-- "column reference is ambiguous". El cliente mapea los nombres al recibirlos.
CREATE OR REPLACE FUNCTION public.professional_busy_slots(
  _professional_id UUID,
  _from TIMESTAMPTZ,
  _to TIMESTAMPTZ
)
RETURNS TABLE (slot_start TIMESTAMPTZ, slot_minutes INTEGER)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT a.starts_at, a.duration_minutes
  FROM public.appointments a
  WHERE a.professional_id = _professional_id
    AND a.status IN ('pending', 'confirmed')
    AND a.starts_at >= _from
    AND a.starts_at < _to
$$;

REVOKE ALL ON FUNCTION public.professional_busy_slots(UUID, TIMESTAMPTZ, TIMESTAMPTZ)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.professional_busy_slots(UUID, TIMESTAMPTZ, TIMESTAMPTZ)
  TO authenticated;

-- ── 2. Rechazo de turnos superpuestos ───────────────────────────────────────
-- También SECURITY DEFINER: el trigger tiene que poder ver TODOS los turnos de
-- la profesional para detectar el choque, no sólo los de quien está reservando.
CREATE OR REPLACE FUNCTION public.check_appointment_overlap()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
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
  FROM public.appointments a
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

REVOKE ALL ON FUNCTION public.check_appointment_overlap() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_check_appointment_overlap ON public.appointments;
CREATE TRIGGER trg_check_appointment_overlap
  BEFORE INSERT OR UPDATE OF starts_at, duration_minutes, professional_id, status
  ON public.appointments
  FOR EACH ROW EXECUTE FUNCTION public.check_appointment_overlap();

-- Acelera tanto la búsqueda de disponibilidad como el chequeo del trigger.
CREATE INDEX IF NOT EXISTS appointments_professional_starts_idx
  ON public.appointments (professional_id, starts_at)
  WHERE status IN ('pending', 'confirmed');
