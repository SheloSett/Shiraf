-- ============================================================================
-- Permisos por empleada.
--
-- Hasta acá "admin" era todo o nada: para que alguien pudiera cargar un turno
-- había que darle también los precios, el stock, los costos de compra y las
-- notas de todas las clientas. La dueña define qué ve cada empleada.
--
-- DOS REGLAS QUE SOSTIENEN TODO ESTO:
--
--   1. El admin está POR ENCIMA del sistema de permisos, no adentro.
--      has_permission() le devuelve true siempre, sin mirar la tabla. Si el
--      admin fuera "un usuario con todas las casillas tildadas", alcanzaría con
--      destildarlas para dejar al local sin nadie que pueda administrarlo, y
--      eso sólo se arreglaría desde el SQL Editor.
--
--   2. Ningún permiso puede otorgar permisos, y ninguno puede crear un admin.
--      Escribir en user_permissions exige el ROL admin, no un permiso — si
--      "gestionar equipo" alcanzara, una secretaria se auto-tilda el resto. Y
--      la policy de user_roles prohíbe explícitamente insertar 'admin': un
--      segundo admin se sigue creando a mano con supabase/crear-admin.sql, que
--      es la misma decisión que ya venía tomada en el proyecto.
-- ============================================================================

CREATE TYPE public.app_permission AS ENUM (
  'appointments',     -- gestionar turnos (ver todos, confirmar, cargar, cancelar)
  'clients_contact',  -- ver la ficha y el teléfono de las clientas
  'clients_notes',    -- ver las notas clínicas (alergias, embarazos)
  'catalog',          -- editar tratamientos, precios y categorías
  'stock',            -- mover stock y editar productos
  'stock_costs',      -- ver los costos de compra
  'team'              -- gestionar profesionales, sus horarios y tratamientos
);

CREATE TABLE public.user_permissions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  permission public.app_permission NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, permission)
);

GRANT SELECT, INSERT, DELETE ON public.user_permissions TO authenticated;
GRANT ALL ON public.user_permissions TO service_role;
ALTER TABLE public.user_permissions ENABLE ROW LEVEL SECURITY;

-- Cada una ve las suyas; el admin ve las de todas.
CREATE POLICY "read permissions" ON public.user_permissions FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR public.has_role(auth.uid(), 'admin'));

-- Repartir accesos es del ROL admin. A propósito no es un permiso delegable.
CREATE POLICY "admin grants permissions" ON public.user_permissions FOR INSERT TO authenticated
  WITH CHECK (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "admin revokes permissions" ON public.user_permissions FOR DELETE TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

-- ── has_permission ─────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.has_permission(
  _user_id UUID,
  _permission public.app_permission
)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  -- El admin primero y sin consultar la tabla: es la regla 1 de arriba.
  SELECT public.has_role(_user_id, 'admin')
      OR EXISTS (
           SELECT 1 FROM public.user_permissions
            WHERE user_id = _user_id AND permission = _permission
         )
$$;

REVOKE ALL ON FUNCTION public.has_permission(UUID, public.app_permission)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.has_permission(UUID, public.app_permission)
  TO authenticated;

-- ── Alta y baja de empleadas ───────────────────────────────────────────────
-- user_roles no tenía ninguna policy de escritura: nadie podía asignar roles
-- desde la app, ni siquiera el admin. Era deliberado (si no, cualquiera se
-- hacía admin solo), pero también dejaba el alta de empleadas fuera del panel.
--
-- Se abre sólo para el admin y sólo para roles que NO son admin. Un segundo
-- admin sigue exigiendo el SQL Editor: es la puerta que no conviene poner en
-- una pantalla web.
CREATE POLICY "admin assigns non-admin roles" ON public.user_roles FOR INSERT TO authenticated
  WITH CHECK (public.has_role(auth.uid(), 'admin') AND role <> 'admin');

CREATE POLICY "admin removes non-admin roles" ON public.user_roles FOR DELETE TO authenticated
  USING (public.has_role(auth.uid(), 'admin') AND role <> 'admin');

GRANT INSERT, DELETE ON public.user_roles TO authenticated;

-- ── Reescritura de las policies existentes ─────────────────────────────────
-- Todas decían has_role(admin). Pasan a has_permission(...), que ya incluye al
-- admin, así que la dueña no pierde nada y la empleada gana sólo lo tildado.

-- Catálogo
DROP POLICY IF EXISTS "admins manage services" ON public.services;
CREATE POLICY "manage services" ON public.services FOR ALL TO authenticated
  USING (public.has_permission(auth.uid(), 'catalog'))
  WITH CHECK (public.has_permission(auth.uid(), 'catalog'));

DROP POLICY IF EXISTS "admins manage service categories" ON public.service_categories;
CREATE POLICY "manage service categories" ON public.service_categories FOR ALL TO authenticated
  USING (public.has_permission(auth.uid(), 'catalog'))
  WITH CHECK (public.has_permission(auth.uid(), 'catalog'));

DROP POLICY IF EXISTS "admins manage product categories" ON public.product_categories;
CREATE POLICY "manage product categories" ON public.product_categories FOR ALL TO authenticated
  USING (public.has_permission(auth.uid(), 'catalog'))
  WITH CHECK (public.has_permission(auth.uid(), 'catalog'));

-- El catálogo despublicado también lo ve quien puede editarlo.
DROP POLICY IF EXISTS "published services authenticated" ON public.services;
CREATE POLICY "published services authenticated" ON public.services FOR SELECT TO authenticated
  USING (is_published OR public.has_permission(auth.uid(), 'catalog'));

-- Equipo
DROP POLICY IF EXISTS "admins manage professionals" ON public.professionals;
CREATE POLICY "manage professionals" ON public.professionals FOR ALL TO authenticated
  USING (public.has_permission(auth.uid(), 'team'))
  WITH CHECK (public.has_permission(auth.uid(), 'team'));

DROP POLICY IF EXISTS "active professionals authenticated" ON public.professionals;
CREATE POLICY "active professionals authenticated" ON public.professionals FOR SELECT TO authenticated
  USING (is_active OR public.has_permission(auth.uid(), 'team'));

DROP POLICY IF EXISTS "admins manage professional services" ON public.professional_services;
CREATE POLICY "manage professional services" ON public.professional_services FOR ALL TO authenticated
  USING (public.has_permission(auth.uid(), 'team'))
  WITH CHECK (public.has_permission(auth.uid(), 'team'));

DROP POLICY IF EXISTS "admins manage schedules" ON public.professional_schedules;
CREATE POLICY "manage schedules" ON public.professional_schedules FOR ALL TO authenticated
  USING (public.has_permission(auth.uid(), 'team'))
  WITH CHECK (public.has_permission(auth.uid(), 'team'));

-- Stock
DROP POLICY IF EXISTS "admins manage products" ON public.products;
CREATE POLICY "manage products" ON public.products FOR ALL TO authenticated
  USING (public.has_permission(auth.uid(), 'stock'))
  WITH CHECK (public.has_permission(auth.uid(), 'stock'));

DROP POLICY IF EXISTS "admins manage stock movements" ON public.stock_movements;
CREATE POLICY "manage stock movements" ON public.stock_movements FOR ALL TO authenticated
  USING (public.has_permission(auth.uid(), 'stock'))
  WITH CHECK (public.has_permission(auth.uid(), 'stock'));

-- Turnos
DROP POLICY IF EXISTS "clients read own appointments" ON public.appointments;
CREATE POLICY "read appointments" ON public.appointments FOR SELECT TO authenticated
  USING (client_id = auth.uid() OR public.has_permission(auth.uid(), 'appointments'));

DROP POLICY IF EXISTS "clients update own appointments" ON public.appointments;
CREATE POLICY "update appointments" ON public.appointments FOR UPDATE TO authenticated
  USING (client_id = auth.uid() OR public.has_permission(auth.uid(), 'appointments'))
  WITH CHECK (client_id = auth.uid() OR public.has_permission(auth.uid(), 'appointments'));

DROP POLICY IF EXISTS "admins create appointments" ON public.appointments;
CREATE POLICY "staff create appointments" ON public.appointments FOR INSERT TO authenticated
  WITH CHECK (public.has_permission(auth.uid(), 'appointments'));

DROP POLICY IF EXISTS "admins delete appointments" ON public.appointments;
CREATE POLICY "delete appointments" ON public.appointments FOR DELETE TO authenticated
  USING (public.has_permission(auth.uid(), 'appointments'));

-- Clientas. Se acepta 'appointments' además de 'clients_contact' porque la
-- pantalla de turnos muestra el nombre y el teléfono de quien reservó: sin
-- esto, una secretaria que sólo gestiona turnos vería una agenda de "—".
DROP POLICY IF EXISTS "own profile select" ON public.profiles;
CREATE POLICY "read profiles" ON public.profiles FOR SELECT TO authenticated
  USING (
    auth.uid() = id
    OR public.has_permission(auth.uid(), 'clients_contact')
    OR public.has_permission(auth.uid(), 'appointments')
  );

DROP POLICY IF EXISTS "own profile update" ON public.profiles;
CREATE POLICY "update profiles" ON public.profiles FOR UPDATE TO authenticated
  USING (auth.uid() = id OR public.has_permission(auth.uid(), 'clients_contact'))
  WITH CHECK (auth.uid() = id OR public.has_permission(auth.uid(), 'clients_contact'));

-- Fotos de tratamientos: quien edita el catálogo puede subirlas.
DROP POLICY IF EXISTS "servicios alta admin" ON storage.objects;
CREATE POLICY "servicios alta" ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'servicios' AND public.has_permission(auth.uid(), 'catalog'));

DROP POLICY IF EXISTS "servicios cambio admin" ON storage.objects;
CREATE POLICY "servicios cambio" ON storage.objects FOR UPDATE TO authenticated
  USING (bucket_id = 'servicios' AND public.has_permission(auth.uid(), 'catalog'))
  WITH CHECK (bucket_id = 'servicios' AND public.has_permission(auth.uid(), 'catalog'));

DROP POLICY IF EXISTS "servicios baja admin" ON storage.objects;
CREATE POLICY "servicios baja" ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'servicios' AND public.has_permission(auth.uid(), 'catalog'));

-- ── Nota sobre los dos permisos que la RLS no puede sostener sola ───────────
-- 'clients_notes' y 'stock_costs' esconden UNA COLUMNA (profiles.notes y
-- products.cost), no una fila. La RLS es row-level: puede decidir si ves un
-- producto, no si ves su costo. Un GRANT por columna tampoco sirve, porque
-- admin y staff son el mismo rol de Postgres (`authenticated`) y le sacaría la
-- columna a las dos.
--
-- Por ahora esos dos filtran en la interfaz, no en la base: alcanzan para
-- ordenar el día a día, pero alguien con la clave publishable y ganas podría
-- leer la columna igual. Para que sean reales hay que mover esos datos a su
-- propia tabla (client_notes y product_costs), que además arregla algo que ya
-- estaba mal: hoy profiles.notes lo escribe la clienta desde mi-cuenta y el
-- panel lo lee como si fueran notas del centro. Queda como paso siguiente.
