-- ============================================================================
-- Shiraf — darle rol admin a un usuario.
--
-- ORDEN IMPORTANTE:
--   1. Correr primero supabase/setup-nuevo-proyecto.sql
--   2. Registrarte en la app desde /auth con tu mail y contraseña
--   3. Recién entonces correr esto en el SQL Editor
--
-- Por qué hace falta esto: el trigger handle_new_user le asigna el rol
-- 'client' a todo el que se registra, y la tabla user_roles sólo tiene policy
-- de SELECT — nadie puede insertar roles desde la app, ni siquiera un admin.
-- Es a propósito (si no, cualquiera se haría admin solo), pero significa que
-- el primer admin se crea sí o sí desde acá.
-- ============================================================================

-- 1) Ver quién está registrado. Copiá el mail con el que te diste de alta.
select id, email, created_at
from auth.users
order by created_at desc;

-- 2) Asignar el rol. ⚠️ Reemplazá el mail por el tuyo antes de ejecutar.
insert into public.user_roles (user_id, role)
select id, 'admin'
from auth.users
where email = 'REEMPLAZAR@CON-TU-MAIL.com'
on conflict (user_id, role) do nothing;

-- 3) Verificar que quedó. Tenés que ver tu mail con role = admin.
select u.email, r.role, r.created_at
from public.user_roles r
join auth.users u on u.id = r.user_id
order by r.created_at desc;

-- Después de esto, recargá la app: el link "Panel de administración" aparece
-- en el menú de "Mi cuenta" y /admin deja de mostrar "Acceso restringido".
