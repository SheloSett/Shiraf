-- ============================================================================
-- Distinguir al equipo de las clientas en las listas del panel.
--
-- EL PROBLEMA: `profiles` tiene una fila por CADA cuenta que existe, y nada en
-- esa tabla dice quién es clienta — el rol vive en `user_roles`. Por eso el
-- buscador de "Nuevo turno" y la pantalla de Clientes, que hacían un select de
-- profiles sin filtro, mostraban a las empleadas y a la dueña como si fueran
-- clientas más.
--
-- POR QUÉ NO ALCANZA CON FILTRAR EN EL NAVEGADOR. La policy de user_roles es:
--
--     USING (user_id = auth.uid() OR public.has_role(auth.uid(), 'admin'))
--
-- o sea que sólo la dueña puede leer los roles ajenos. Una empleada que
-- consultara user_roles recibiría únicamente el suyo: sin error, con menos
-- filas, y el código lo leería como "acá no hay nadie del equipo". A la dueña le
-- andaría perfecto y a las empleadas les seguiría saliendo la lista mezclada.
-- Es la peor forma de fallar —en silencio y sólo para algunas— y es exactamente
-- la trampa que ya nos comimos con professional_busy_slots.
--
-- LA DECISIÓN DE PRODUCTO, que es distinta en cada pantalla:
--
--   Clientes  → el equipo NO se muestra. Es la base de clientas —a quién le
--               vendo, a quién hace mucho que no veo— y una empleada con 0
--               turnos ensucia esa lectura.
--   Nuevo turno → el equipo SÍ se muestra, con una etiqueta «Equipo» y ordenado
--               al final. Una empleada también se atiende en el centro, y
--               esconderla dejaría su turno sin ninguna forma de cargarse.
--
-- Por eso la función devuelve quiénes son del equipo y no una lista ya filtrada:
-- cada pantalla decide qué hacer con el dato.
-- ============================================================================

-- Devuelve sólo IDS, ningún dato personal: es un "cuáles de estos perfiles son
-- del equipo", para que la interfaz pueda etiquetarlos.
--
-- La columna de salida se llama member_id y no user_id a propósito, por lo mismo
-- que slot_start/slot_minutes en 20260813020000: en RETURNS TABLE los nombres de
-- salida quedan en el mismo ámbito que las columnas de la tabla, y repetir
-- `user_id` invita a un "column reference is ambiguous" en cuanto alguien
-- agregue una condición sin calificar.
CREATE OR REPLACE FUNCTION public.team_member_ids()
RETURNS TABLE (member_id UUID)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT DISTINCT r.user_id
  FROM public.user_roles r
  WHERE r.role <> 'client'
    -- El mismo candado que la policy de SELECT de profiles (migración
    -- 20260813070000): quien puede ver la lista de clientas puede saber cuáles
    -- de esos perfiles son del equipo. No se filtra nada nuevo — son ids que
    -- este mismo usuario ya puede leer enteros, con nombre y teléfono, en
    -- profiles.
    AND (
      public.has_permission(auth.uid(), 'clients_contact')
      OR public.has_permission(auth.uid(), 'appointments')
    )
$$;

-- anon no tiene nada que hacer acá: las listas del panel son de gente logueada.
REVOKE ALL ON FUNCTION public.team_member_ids() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.team_member_ids() TO authenticated;
