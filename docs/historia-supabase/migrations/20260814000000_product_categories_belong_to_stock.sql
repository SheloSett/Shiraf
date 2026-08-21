-- ============================================================================
-- Las categorías de producto pasan de 'catalog' a 'stock'.
--
-- En la migración 20260813070000 quedaron bajo 'catalog', igual que las de
-- servicio. Es un error: 'catalog' es el catálogo público —los tratamientos que
-- la clienta ve y sus precios— y las categorías de PRODUCTO son internas:
-- agrupan cremas, lociones e insumos que no aparecen en ningún lado del sitio.
--
-- El síntoma era concreto: en el panel, "Categorías" cuelga de Productos, así
-- que una empleada con 'stock' veía el link, entraba, y la base le rechazaba
-- todo. El menú prometía algo que la RLS no cumplía.
-- ============================================================================

DROP POLICY IF EXISTS "manage product categories" ON public.product_categories;
CREATE POLICY "manage product categories" ON public.product_categories FOR ALL TO authenticated
  USING (public.has_permission(auth.uid(), 'stock'))
  WITH CHECK (public.has_permission(auth.uid(), 'stock'));
