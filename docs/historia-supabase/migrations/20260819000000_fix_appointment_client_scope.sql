-- ============================================================================
-- Arreglo: la empleada volvió a no poder confirmar un turno.
--
-- QUÉ PASÓ. `enforce_appointment_client_scope()` se reescribió entera en
-- 20260818030000 (recordatorios) para sumarle `reminded_at` a la lista de
-- columnas que una clienta no puede tocar. El comentario de esa migración dice
-- que la copió de 20260813040000 "salvo el renglón de reminded_at", y ahí está
-- el error: la versión vigente NO era la de 20260813040000, era la de
-- 20260816020000, que ya la había cambiado en dos lugares. Al reescribirla
-- sobre la copia vieja, esos dos cambios se perdieron.
--
-- Lo que se perdió, y qué rompió cada uno:
--
--   1. La puerta de arriba volvió a `has_role(auth.uid(), 'admin')` cuando
--      20260816020000 la había abierto a `has_permission(auth.uid(),
--      'appointments')`.
--
--      Consecuencia: una empleada con "Gestionar turnos" que no sea la dueña
--      cae en la rama de abajo, que es la de una CLIENTA editando su propio
--      turno, y ahí lo único permitido es cancelar. O sea que podía cargar
--      turnos y cancelarlos, pero al apretar "Confirmar" le saltaba
--      "Sólo el centro puede confirmar o cerrar un turno" — el centro es ella.
--      Comprobado contra la base con una cuenta staff de prueba.
--
--      La dueña no lo notaba: `has_role(admin)` la deja pasar igual.
--
--   2. Los tres renglones de `guest_*` desaparecieron de la lista de columnas
--      protegidas.
--
--      Consecuencia: menos grave, pero es un candado que estaba puesto a
--      propósito. Una clienta logueada sólo puede tocar sus propios turnos (la
--      RLS lo garantiza) y en esos `client_id` está seteado, así que los
--      `guest_*` van en NULL; sin estos renglones podía escribirlos igual. Son
--      datos que carga el centro sobre alguien SIN cuenta, no sobre ella.
--
-- POR QUÉ ESTE ARCHIVO Y NO EDITAR EL OTRO. 20260818030000 ya está aplicada en
-- la base. Editarla no cambiaría nada de lo que ya corrió y dejaría el archivo
-- mintiendo sobre lo que se ejecutó ese día.
--
-- LA LECCIÓN, QUE VALE MÁS QUE EL ARREGLO: Postgres no sabe agregarle una
-- condición a una función existente, así que sumarle un renglón obliga a
-- reescribirla entera — y reescribirla entera es copiar de algún lado. Hay que
-- copiar de la ÚLTIMA migración que la tocó, no de la que la creó. Para saber
-- cuál es:
--
--   grep -l "enforce_appointment_client_scope" supabase/migrations/*.sql | tail -1
--
-- Esta función ya va por su cuarta versión (13040000 → 16020000 → 18030000 →
-- ésta), así que va a volver a pasar.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.enforce_appointment_client_scope()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  -- Sin sesión: la service role y el SQL Editor. Por acá entra la tarea de
  -- recordatorios cuando escribe `reminded_at`.
  IF auth.uid() IS NULL THEN
    RETURN NEW;
  END IF;

  -- El centro. `has_permission` y no `has_role('admin')`: la dueña la cumple
  -- siempre —el admin está por encima del sistema de permisos, no adentro— y
  -- además la cumple la empleada que tiene tildado "Gestionar turnos", que es
  -- justo la que se había quedado afuera.
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
  -- Los datos de una invitada los carga el centro, no ella. Recuperados de
  -- 20260816020000.
  OR NEW.guest_name       IS DISTINCT FROM OLD.guest_name
  OR NEW.guest_phone      IS DISTINCT FROM OLD.guest_phone
  OR NEW.guest_email      IS DISTINCT FROM OLD.guest_email
  -- La marca del recordatorio. Lo único que aportaba 20260818030000, y es lo
  -- único de esa versión que se conserva: sin este renglón, cualquiera podría
  -- escribirse una fecha ahí desde el navegador y el aviso no le saldría nunca.
  OR NEW.reminded_at      IS DISTINCT FROM OLD.reminded_at
  OR NEW.created_at       IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'Para reprogramar el turno escribinos: desde acá sólo podés cancelarlo.';
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.enforce_appointment_client_scope()
  FROM PUBLIC, anon, authenticated;
