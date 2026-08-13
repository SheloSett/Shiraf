-- Categorías de producto como tabla propia.
--
-- Antes las categorías eran texto libre dentro de products.category: existían
-- sólo porque algún producto las usaba, y no había forma de crearlas ni
-- renombrarlas sin tocar productos uno por uno.
--
-- products.category sigue siendo TEXT a propósito. Cambiarlo por una FK
-- obligaría a migrar los datos y a regenerar los tipos de products, y no
-- compensa para el tamaño de este catálogo. El vínculo se mantiene por nombre,
-- y el renombrado desde el panel actualiza los productos afectados.

CREATE TABLE public.product_categories (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.product_categories TO authenticated;
GRANT ALL ON public.product_categories TO service_role;

ALTER TABLE public.product_categories ENABLE ROW LEVEL SECURITY;

CREATE POLICY "admins manage product categories" ON public.product_categories FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- Arranca con las categorías que ya estaban en uso, para no perder nada.
INSERT INTO public.product_categories (name)
SELECT DISTINCT category
FROM public.products
WHERE category IS NOT NULL AND category <> ''
ON CONFLICT (name) DO NOTHING;
