DROP POLICY IF EXISTS "published services public" ON public.services;
CREATE POLICY "published services anon" ON public.services FOR SELECT TO anon
  USING (is_published);
CREATE POLICY "published services authenticated" ON public.services FOR SELECT TO authenticated
  USING (is_published OR public.has_role(auth.uid(), 'admin'));

DROP POLICY IF EXISTS "active professionals public" ON public.professionals;
CREATE POLICY "active professionals anon" ON public.professionals FOR SELECT TO anon
  USING (is_active);
CREATE POLICY "active professionals authenticated" ON public.professionals FOR SELECT TO authenticated
  USING (is_active OR public.has_role(auth.uid(), 'admin'));