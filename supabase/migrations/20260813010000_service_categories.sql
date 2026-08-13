-- Categorías de servicio como tabla propia, igual que product_categories.
--
-- services.category sigue siendo TEXT por el mismo motivo que en productos: el
-- vínculo se mantiene por nombre y el renombrado desde el panel actualiza los
-- servicios afectados. Además services.category se lee desde el sitio público,
-- así que cambiarlo por una FK obligaría a tocar todas las consultas.

CREATE TABLE public.service_categories (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.service_categories TO authenticated;
GRANT ALL ON public.service_categories TO service_role;

ALTER TABLE public.service_categories ENABLE ROW LEVEL SECURITY;

CREATE POLICY "admins manage service categories" ON public.service_categories FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- Arranca con las categorías que ya estaban en uso: Facial, Corporal,
-- Depilación y Aparatología.
INSERT INTO public.service_categories (name)
SELECT DISTINCT category
FROM public.services
WHERE category IS NOT NULL AND category <> ''
ON CONFLICT (name) DO NOTHING;
