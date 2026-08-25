-- ============================================================================
-- Renombrar una categoría, de una sola vez.
--
-- EL PROBLEMA: el panel hacía dos UPDATE sueltos —uno a la tabla de categorías
-- y otro arrastrando el nombre a los productos o tratamientos que la usaban— y
-- entre los dos no había nada que los atara. Si el segundo fallaba, la
-- categoría quedaba renombrada y los elementos apuntando al nombre viejo, que
-- ya no existía en la lista: desaparecían del agrupado del sitio público sin
-- que nadie hubiera pedido eso, y había que repararlos a mano uno por uno.
--
-- Adentro de una función los dos UPDATE comparten transacción: o pasan los dos
-- o no pasa ninguno.
--
-- SOBRE POR QUÉ EL PERMISO SE CHEQUEA A MANO:
-- Las funciones son SECURITY INVOKER (el default), así que la RLS se aplica. El
-- problema es que en un UPDATE la RLS no da error cuando falta permiso: filtra
-- las filas y el UPDATE afecta cero. La operación "salía bien" sin haber hecho
-- nada. Por eso se pregunta primero y se levanta una excepción.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.rename_service_category(_id UUID, _to TEXT)
RETURNS VOID
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  old_name TEXT;
  new_name TEXT := btrim(_to);
BEGIN
  IF NOT public.has_permission(auth.uid(), 'catalog') THEN
    RAISE EXCEPTION 'No tenés permiso para editar el catálogo.';
  END IF;

  IF new_name = '' THEN
    RAISE EXCEPTION 'El nombre no puede quedar vacío.';
  END IF;

  SELECT name INTO old_name FROM public.service_categories WHERE id = _id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Esa categoría no existe.';
  END IF;

  IF old_name = new_name THEN
    RETURN;  -- nada que hacer
  END IF;

  UPDATE public.service_categories SET name = new_name WHERE id = _id;
  UPDATE public.services SET category = new_name WHERE category = old_name;
END;
$$;

REVOKE ALL ON FUNCTION public.rename_service_category(UUID, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rename_service_category(UUID, TEXT) TO authenticated;

-- Igual para productos, pero pidiendo 'stock': las categorías de producto son
-- internas y no forman parte del catálogo público. Ver migración 20260814000000.
CREATE OR REPLACE FUNCTION public.rename_product_category(_id UUID, _to TEXT)
RETURNS VOID
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  old_name TEXT;
  new_name TEXT := btrim(_to);
BEGIN
  IF NOT public.has_permission(auth.uid(), 'stock') THEN
    RAISE EXCEPTION 'No tenés permiso para editar el stock.';
  END IF;

  IF new_name = '' THEN
    RAISE EXCEPTION 'El nombre no puede quedar vacío.';
  END IF;

  SELECT name INTO old_name FROM public.product_categories WHERE id = _id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Esa categoría no existe.';
  END IF;

  IF old_name = new_name THEN
    RETURN;
  END IF;

  UPDATE public.product_categories SET name = new_name WHERE id = _id;
  UPDATE public.products SET category = new_name WHERE category = old_name;
END;
$$;

REVOKE ALL ON FUNCTION public.rename_product_category(UUID, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rename_product_category(UUID, TEXT) TO authenticated;
