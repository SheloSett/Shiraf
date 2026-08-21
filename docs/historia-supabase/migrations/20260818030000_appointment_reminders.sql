-- ============================================================================
-- Recordatorio del día antes: la marca de que ya se mandó.
--
-- El recordatorio lo dispara una tarea programada, no una persona apretando un
-- botón, y una tarea programada se ejecuta de más: se reintenta si falló a la
-- mitad, se corre a mano para probarla, y el día que alguien la ponga cada hora
-- en vez de una vez por día va a pasar veinticuatro veces.
--
-- Sin una marca en la base, cada una de esas corridas le vuelve a escribir a la
-- misma clienta. Un recordatorio repetido no es un detalle estético: es la
-- diferencia entre un centro prolijo y uno que hace spam, y es la clase de cosa
-- por la que la gente bloquea el remitente.
--
-- Por eso la condición de "a quién le toca" no se calcula por tiempo sino por
-- este campo: se le manda a quien tiene turno mañana Y todavía no recibió el
-- aviso. Correr la tarea dos veces el mismo día no le escribe a nadie de nuevo.
-- ============================================================================

ALTER TABLE public.appointments
  ADD COLUMN IF NOT EXISTS reminded_at TIMESTAMPTZ;

COMMENT ON COLUMN public.appointments.reminded_at IS
  'Cuándo salió el recordatorio del día antes. NULL = todavía no se mandó. Lo escribe la tarea de recordatorios con la service role; no se toca a mano.';

-- El índice cubre exactamente la consulta de la tarea: los confirmados de un día
-- que aún no recibieron el aviso. El WHERE parcial lo mantiene chico — los
-- turnos ya avisados salen del índice en cuanto se les escribe la fecha.
CREATE INDEX IF NOT EXISTS appointments_pending_reminder_idx
  ON public.appointments (starts_at)
  WHERE reminded_at IS NULL AND status = 'confirmed';

-- ── Que la clienta no pueda apagarse su propio recordatorio ─────────────────
-- enforce_appointment_client_scope enumera las columnas que una clienta no
-- puede tocar de su turno. `reminded_at` es nueva, así que no estaba en esa
-- lista: tal como quedó, cualquiera podría escribirse una fecha ahí desde el
-- navegador y el recordatorio no le saldría nunca.
--
-- No es grave —el daño se lo haría a sí misma— pero es un campo del centro, no
-- suyo, y el resto del trigger ya trata así a admin_notes. Misma regla.
--
-- La función se reescribe entera porque Postgres no tiene forma de agregarle una
-- condición a una existente. Es idéntica a la de 20260813040000 salvo el
-- renglón de reminded_at.
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
  OR NEW.reminded_at      IS DISTINCT FROM OLD.reminded_at
  OR NEW.created_at       IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'Para reprogramar el turno escribinos: desde acá sólo podés cancelarlo.';
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.enforce_appointment_client_scope()
  FROM PUBLIC, anon, authenticated;
