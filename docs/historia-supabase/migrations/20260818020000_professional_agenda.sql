-- ============================================================================
-- La agenda propia de cada profesional.
--
-- EL PROBLEMA: hoy la única forma de que una profesional vea sus turnos es
-- tildarle "Gestionar turnos", y ese permiso le da la agenda COMPLETA del
-- centro más la ficha y el teléfono de TODAS las clientas. Para que vea sus
-- cuatro turnos del miércoles hay que mostrarle el negocio entero.
--
-- LA PIEZA QUE FALTABA: `professionals.user_id` existe desde la primera
-- migración y nunca se escribió. La ficha de la profesional (nombre,
-- especialidad, qué tratamientos hace) y la cuenta con la que entra eran dos
-- cosas sueltas. Acá se vuelve un vínculo real, con dueño y con candado.
--
-- ── POR QUÉ UNA FUNCIÓN Y NO UNA POLICY NUEVA ──────────────────────────────
--
-- La tentación era agregarle a `appointments` una policy "la profesional ve los
-- suyos" y listo. No alcanza: la pantalla necesita además el nombre y el
-- teléfono de la clienta (`profiles`) y sus notas clínicas (`client_notes`), o
-- sea tres policies nuevas sobre tres tablas, cada una abriendo una puerta que
-- después hay que acordarse de que existe.
--
-- En vez de eso, `my_agenda()` es UNA puerta, angosta y con cartel: devuelve
-- exactamente las filas de esta pantalla y nada más. Ninguna tabla queda más
-- abierta que antes — quien no sea profesional sigue sin poder leer un turno
-- ajeno ni por la API.
--
-- Y no toma ningún parámetro que nombre a una profesional, a propósito: si
-- recibiera `_professional_id`, cualquiera podría pedir la agenda de cualquiera.
-- El único que decide de quién es la agenda es auth.uid(), que sale del JWT y no
-- se puede falsear desde el navegador.
--
-- ── LO QUE NO HACE ─────────────────────────────────────────────────────────
--
-- Sólo lectura, y a propósito: la profesional NO puede confirmar, cancelar ni
-- mover un turno. Si el centro lo quiere más adelante, eso sí necesita una
-- policy de UPDATE sobre appointments, y conviene pensarla entonces —confirmar
-- un turno es responderle a una clienta, y hoy esa respuesta la da el centro.
-- ============================================================================

-- ── 1. Una cuenta, una ficha ───────────────────────────────────────────────
-- Sin esto, dos fichas apuntando a la misma cuenta harían que "mi agenda" fuera
-- ambigua. Hoy todas las filas tienen user_id en NULL —nunca se escribió—, así
-- que el índice entra sin conflictos. El WHERE es lo que permite que sigan
-- conviviendo muchas fichas sin cuenta: en un índice único, NULL no choca con
-- NULL, pero dejarlo explícito ahorra la duda.
CREATE UNIQUE INDEX IF NOT EXISTS professionals_user_id_key
  ON public.professionals (user_id)
  WHERE user_id IS NOT NULL;

-- ── 2. El vínculo lo ata la dueña y nadie más ──────────────────────────────
-- Escribir `professionals` pide el permiso 'team' ("Gestionar profesionales").
-- Sin este candado, quien lo tenga podría apuntar CUALQUIER ficha a su propia
-- cuenta y quedarse leyendo los teléfonos y las notas clínicas de las clientas
-- de esa profesional. Es la misma regla que ya sostiene el sistema de permisos:
-- ningún permiso puede ampliarse a sí mismo (ver 20260813070000).
--
-- Va como trigger y no como policy porque la RLS no sabe comparar el valor
-- viejo con el nuevo: WITH CHECK sólo ve el NEW, así que no puede distinguir
-- "editó la bio" de "se autoasignó la ficha".
CREATE OR REPLACE FUNCTION public.guard_professional_account_link()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  -- Sin sesión sólo llegan la service role (la baja de una empleada borra la
  -- cuenta, y el ON DELETE SET NULL de la FK dispara un UPDATE de user_id) y el
  -- SQL Editor. anon no entra por acá: no tiene GRANT de escritura sobre esta
  -- tabla. Sin esta salida, dar de baja a una profesional vinculada fallaría.
  IF auth.uid() IS NULL THEN
    RETURN NEW;
  END IF;

  -- Si el vínculo no cambia, acá no hay nada que custodiar: editar la bio o la
  -- especialidad sigue siendo cosa del permiso 'team'.
  --
  -- Los dos casos van en ramas separadas y no en una sola condición con OLD
  -- adentro: en un trigger de INSERT el registro OLD no existe, y mencionarlo
  -- —aunque sea del lado que no se evalúa— es jugar a que el planificador no
  -- vaya a buscarlo igual.
  IF TG_OP = 'UPDATE' THEN
    IF NEW.user_id IS NOT DISTINCT FROM OLD.user_id THEN
      RETURN NEW;
    END IF;
  ELSIF NEW.user_id IS NULL THEN
    -- Ficha nueva sin cuenta: es el alta normal de una profesional.
    RETURN NEW;
  END IF;

  IF NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'Sólo la dueña puede vincular la ficha de una profesional con una cuenta.'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_guard_professional_account_link
  BEFORE INSERT OR UPDATE OF user_id ON public.professionals
  FOR EACH ROW EXECUTE FUNCTION public.guard_professional_account_link();

-- ── 3. ¿Qué ficha es la de quien está conectada? ───────────────────────────
-- Devuelve NULL para todo el mundo que no sea una profesional vinculada, y eso
-- es lo que hace que el resto se caiga solo: comparar contra NULL no da true
-- nunca, así que la agenda sale vacía sin necesidad de un IF.
--
-- Exige `is_active`: una profesional dada de baja deja de ver la agenda en el
-- acto, sin tener que acordarse de borrarle también la cuenta.
CREATE OR REPLACE FUNCTION public.my_professional_id()
RETURNS UUID
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT p.id
    FROM public.professionals p
   WHERE p.user_id = auth.uid()
     AND p.is_active
   LIMIT 1
$$;

REVOKE ALL ON FUNCTION public.my_professional_id() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.my_professional_id() TO authenticated;

-- ── 4. La agenda ───────────────────────────────────────────────────────────
-- Los nombres de salida llevan prefijo (appointment_start y no starts_at) por
-- lo mismo que slot_start en 20260813020000 y member_id en 20260818000000: en
-- RETURNS TABLE los nombres de salida quedan en el mismo ámbito que las
-- columnas de las tablas del cuerpo, y repetir uno invita a un "column
-- reference is ambiguous" en cuanto alguien agregue una condición sin calificar.
--
-- Qué turnos entran:
--   · 'pending' y 'confirmed'. Un cancelado no es un turno que va a pasar, y un
--     'completed' ya pasó — los dos ensucian una lista que se lee de un vistazo
--     antes de empezar el día.
--   · El que está EN CURSO sigue apareciendo: el corte es cuándo termina, no
--     cuándo empieza. Si fuera `starts_at >= now()`, el turno de las 14:00 se
--     borraría de la pantalla a las 14:01, con la clienta todavía en la camilla.
--   · Hasta `_days` adelante, para que la lista no se convierta en un año.
--
-- La clienta puede ser una invitada (turno cargado por teléfono, sin cuenta):
-- ahí el nombre y el teléfono salen de las columnas guest_* de la migración
-- 20260816010000, y `client_is_guest` deja que la pantalla lo aclare en vez de
-- mostrar una ficha que no existe.
CREATE OR REPLACE FUNCTION public.my_agenda(_days INTEGER DEFAULT 30)
RETURNS TABLE (
  appointment_id UUID,
  appointment_start TIMESTAMPTZ,
  appointment_minutes INTEGER,
  appointment_state public.appointment_status,
  service_name TEXT,
  client_name TEXT,
  client_phone TEXT,
  clinical_notes TEXT,
  booking_note TEXT,
  client_is_guest BOOLEAN
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    a.id,
    a.starts_at,
    a.duration_minutes,
    a.status,
    s.name,
    COALESCE(p.full_name, a.guest_name),
    COALESCE(p.phone, a.guest_phone),
    n.body,
    a.client_notes,
    a.client_id IS NULL
  FROM public.appointments a
  JOIN public.services s ON s.id = a.service_id
  LEFT JOIN public.profiles p ON p.id = a.client_id
  LEFT JOIN public.client_notes n ON n.client_id = a.client_id
 WHERE a.professional_id = public.my_professional_id()
   AND a.status IN ('pending', 'confirmed')
   AND a.starts_at + (a.duration_minutes * INTERVAL '1 minute') >= now()
   AND a.starts_at < now() + (GREATEST(COALESCE(_days, 30), 1) * INTERVAL '1 day')
 ORDER BY a.starts_at
$$;

REVOKE ALL ON FUNCTION public.my_agenda(INTEGER) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.my_agenda(INTEGER) TO authenticated;

COMMENT ON FUNCTION public.my_agenda(INTEGER) IS
  'Los próximos turnos de la profesional conectada, con el tratamiento y la '
  'clienta. SECURITY DEFINER porque cruza profiles y client_notes, que ella no '
  'puede leer sueltas; el alcance lo fija auth.uid() y no hay parámetro para '
  'pedir la agenda de otra persona.';
