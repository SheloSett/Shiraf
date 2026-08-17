-- ============================================================================
-- Que los turnos de invitada pasen al historial cuando la clienta se registra.
--
-- Hasta acá, si alguien reservaba tres veces por teléfono y después se creaba
-- una cuenta, entraba a "Mi cuenta" y no veía nada: sus turnos habían quedado
-- sueltos, sin dueña.
--
-- DOS CAMINOS, Y LA DIFERENCIA IMPORTA:
--
--   1. Por MAIL, automático. Supabase le manda un enlace de confirmación, así
--      que un mail confirmado es prueba de que la casilla es suya.
--
--   2. Por TELÉFONO, a mano desde el panel. El teléfono no lo verifica nadie:
--      si esto fuera automático, cualquiera podría registrarse poniendo el
--      celular de otra persona y quedarse con su historial — qué tratamientos
--      se hizo, cuándo y con quién. En un centro de estética eso incluye
--      embarazos y problemas de piel. Quien atiende el mostrador sabe si esa
--      Mica es la misma Mica; el sistema no.
--
-- POR QUÉ EL ENGANCHE VA EN LA CONFIRMACIÓN Y NO EN EL ALTA:
-- handle_new_user() corre al insertarse la fila en auth.users, que es ANTES de
-- que la persona confirme. Si el traspaso pasara ahí, bastaría con registrarse
-- usando el mail de otra para llevarse sus turnos sin haber probado nada. Al
-- colgarlo de email_confirmed_at, sólo ocurre cuando alguien abrió el enlace
-- que llegó a esa casilla.
-- ============================================================================

-- ── Primero, un bug que salió a la luz escribiendo esto ─────────────────────
-- enforce_appointment_client_scope() eximía sólo al ROL admin. Cuando la
-- migración anterior pasó validate_appointment() a mirar el PERMISO
-- 'appointments', este trigger quedó atrás mirando el rol, y las dos reglas
-- dejaron de decir lo mismo.
--
-- El efecto en el mostrador: una secretaria con el permiso de turnos NO podía
-- confirmar ninguno. Le saltaba "Sólo el centro puede confirmar o cerrar un
-- turno" — siendo que ella ES el centro. Tampoco podía reprogramar ni anotar
-- nada en admin_notes.
--
-- Se descubrió porque el traspaso de turnos de invitada también es un UPDATE de
-- client_id y este trigger lo rechazaba. La matriz de permisos no lo había
-- agarrado porque probaba que la secretaria pudiera CREAR turnos, nunca que
-- pudiera modificarlos.
--
-- Pasa a mirar el permiso, igual que el otro. La dueña no pierde nada:
-- has_permission() le devuelve true siempre.
CREATE OR REPLACE FUNCTION public.enforce_appointment_client_scope()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN NEW;
  END IF;

  IF public.has_permission(auth.uid(), 'appointments') THEN
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
  OR NEW.guest_name       IS DISTINCT FROM OLD.guest_name
  OR NEW.guest_phone      IS DISTINCT FROM OLD.guest_phone
  OR NEW.guest_email      IS DISTINCT FROM OLD.guest_email
  OR NEW.created_at       IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'Para reprogramar el turno escribinos: desde acá sólo podés cancelarlo.';
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.enforce_appointment_client_scope()
  FROM PUBLIC, anon, authenticated;

-- ── Normalización de teléfono ───────────────────────────────────────────────
-- Los teléfonos se escriben de mil formas: "11 5418-9624", "+54 9 11 5418-9624",
-- "1154189624". Compararlos como texto no encuentra nada.
--
-- Se queda con los últimos 10 dígitos, que en Argentina son área + número. Así
-- da igual si alguien anotó el 54, el 9 de celular o ninguno de los dos.
CREATE OR REPLACE FUNCTION public.normalize_phone(_phone TEXT)
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT NULLIF(RIGHT(regexp_replace(coalesce(_phone, ''), '\D', '', 'g'), 10), '')
$$;

-- ── 1. Automático: al confirmarse el mail ───────────────────────────────────
CREATE OR REPLACE FUNCTION public.claim_guest_appointments()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Sólo en la transición a confirmado. Sin esto correría en cada UPDATE de la
  -- fila del usuario.
  IF NEW.email_confirmed_at IS NULL OR OLD.email_confirmed_at IS NOT NULL THEN
    RETURN NEW;
  END IF;

  UPDATE public.appointments
     SET client_id   = NEW.id,
         guest_name  = NULL,
         guest_phone = NULL,
         guest_email = NULL
   WHERE client_id IS NULL
     AND lower(btrim(coalesce(guest_email, ''))) = lower(btrim(coalesce(NEW.email, '')))
     AND btrim(coalesce(guest_email, '')) <> '';

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.claim_guest_appointments() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS on_auth_user_confirmed ON auth.users;
CREATE TRIGGER on_auth_user_confirmed
  AFTER UPDATE OF email_confirmed_at ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.claim_guest_appointments();

-- ── 2. A mano: el centro vincula por teléfono ───────────────────────────────
-- Devuelve cuántos turnos quedaron vinculados, para poder avisarlo en pantalla.
--
-- Toma TODOS los turnos que compartan ese teléfono y no sólo el que se estaba
-- mirando: si vino cuatro veces, nadie quiere repetir la operación cuatro veces.
CREATE OR REPLACE FUNCTION public.link_guest_appointments(_phone TEXT, _client_id UUID)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  target TEXT := public.normalize_phone(_phone);
  linked INTEGER;
BEGIN
  IF NOT public.has_permission(auth.uid(), 'appointments') THEN
    RAISE EXCEPTION 'No tenés permiso para gestionar turnos.';
  END IF;

  IF target IS NULL THEN
    RAISE EXCEPTION 'Ese turno no tiene un teléfono con el que buscar.';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = _client_id) THEN
    RAISE EXCEPTION 'Esa clienta no existe.';
  END IF;

  UPDATE public.appointments
     SET client_id   = _client_id,
         guest_name  = NULL,
         guest_phone = NULL,
         guest_email = NULL
   WHERE client_id IS NULL
     AND public.normalize_phone(guest_phone) = target;

  GET DIAGNOSTICS linked = ROW_COUNT;
  RETURN linked;
END;
$$;

REVOKE ALL ON FUNCTION public.link_guest_appointments(TEXT, UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.link_guest_appointments(TEXT, UUID) TO authenticated;

-- Acelera la búsqueda por teléfono normalizado, que es como se compara.
CREATE INDEX IF NOT EXISTS appointments_guest_phone_norm_idx
  ON public.appointments (public.normalize_phone(guest_phone))
  WHERE client_id IS NULL AND guest_phone IS NOT NULL;
