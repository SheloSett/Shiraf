-- ============================================================================
-- Almacenamiento de fotos de tratamientos.
--
-- Va en Supabase Storage, no en un servicio aparte: el proyecto ya lo tiene,
-- usa las mismas policies de RLS que el resto y sirve las imágenes por CDN.
--
-- services.image_url ya existía en el esquema original y nunca se había usado:
-- guarda la URL pública que devuelve Storage. No hace falta tocar la tabla.
--
-- Si alguna de estas sentencias falla por permisos sobre storage.objects
-- (depende de cómo esté el proyecto), se puede hacer lo mismo desde el panel:
-- Storage → New bucket "servicios" marcado como público, y las policies desde
-- la pestaña Policies de ese bucket.
-- ============================================================================

-- Público en lectura: las fotos se ven en el sitio sin estar logueado. La
-- escritura la controlan las policies de abajo.
INSERT INTO storage.buckets (id, name, public)
VALUES ('servicios', 'servicios', true)
ON CONFLICT (id) DO UPDATE SET public = true;

DROP POLICY IF EXISTS "servicios lectura publica" ON storage.objects;
CREATE POLICY "servicios lectura publica" ON storage.objects FOR SELECT TO anon, authenticated
  USING (bucket_id = 'servicios');

DROP POLICY IF EXISTS "servicios alta admin" ON storage.objects;
CREATE POLICY "servicios alta admin" ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'servicios' AND public.has_role(auth.uid(), 'admin'));

DROP POLICY IF EXISTS "servicios cambio admin" ON storage.objects;
CREATE POLICY "servicios cambio admin" ON storage.objects FOR UPDATE TO authenticated
  USING (bucket_id = 'servicios' AND public.has_role(auth.uid(), 'admin'))
  WITH CHECK (bucket_id = 'servicios' AND public.has_role(auth.uid(), 'admin'));

DROP POLICY IF EXISTS "servicios baja admin" ON storage.objects;
CREATE POLICY "servicios baja admin" ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'servicios' AND public.has_role(auth.uid(), 'admin'));
