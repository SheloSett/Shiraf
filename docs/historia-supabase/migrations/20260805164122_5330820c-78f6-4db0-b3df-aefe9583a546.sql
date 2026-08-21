-- ROLES
CREATE TYPE public.app_role AS ENUM ('admin', 'professional', 'client');

CREATE TABLE public.profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  full_name TEXT,
  phone TEXT,
  birth_date DATE,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.profiles TO authenticated;
GRANT ALL ON public.profiles TO service_role;
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

CREATE TABLE public.user_roles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role public.app_role NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, role)
);
GRANT SELECT ON public.user_roles TO authenticated;
GRANT ALL ON public.user_roles TO service_role;
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.has_role(_user_id UUID, _role public.app_role)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role = _role)
$$;

CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END; $$;

CREATE POLICY "own profile select" ON public.profiles FOR SELECT TO authenticated
  USING (auth.uid() = id OR public.has_role(auth.uid(), 'admin'));
CREATE POLICY "own profile insert" ON public.profiles FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = id);
CREATE POLICY "own profile update" ON public.profiles FOR UPDATE TO authenticated
  USING (auth.uid() = id OR public.has_role(auth.uid(), 'admin'))
  WITH CHECK (auth.uid() = id OR public.has_role(auth.uid(), 'admin'));
CREATE TRIGGER profiles_updated_at BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE POLICY "read own roles" ON public.user_roles FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR public.has_role(auth.uid(), 'admin'));

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.profiles (id, full_name, phone)
  VALUES (NEW.id, NEW.raw_user_meta_data->>'full_name', NEW.raw_user_meta_data->>'phone')
  ON CONFLICT (id) DO NOTHING;
  INSERT INTO public.user_roles (user_id, role) VALUES (NEW.id, 'client')
  ON CONFLICT (user_id, role) DO NOTHING;
  RETURN NEW;
END; $$;

CREATE TRIGGER on_auth_user_created AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- SERVICES
CREATE TABLE public.services (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  description TEXT,
  category TEXT NOT NULL DEFAULT 'General',
  duration_minutes INTEGER NOT NULL DEFAULT 60,
  price NUMERIC(12,2) NOT NULL DEFAULT 0,
  image_url TEXT,
  is_published BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT ON public.services TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.services TO authenticated;
GRANT ALL ON public.services TO service_role;
ALTER TABLE public.services ENABLE ROW LEVEL SECURITY;
CREATE POLICY "published services public" ON public.services FOR SELECT TO anon, authenticated
  USING (is_published OR public.has_role(auth.uid(), 'admin'));
CREATE POLICY "admins manage services" ON public.services FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin')) WITH CHECK (public.has_role(auth.uid(), 'admin'));
CREATE TRIGGER services_updated_at BEFORE UPDATE ON public.services
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- PROFESSIONALS
CREATE TABLE public.professionals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  full_name TEXT NOT NULL,
  specialty TEXT,
  bio TEXT,
  avatar_url TEXT,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT ON public.professionals TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.professionals TO authenticated;
GRANT ALL ON public.professionals TO service_role;
ALTER TABLE public.professionals ENABLE ROW LEVEL SECURITY;
CREATE POLICY "active professionals public" ON public.professionals FOR SELECT TO anon, authenticated
  USING (is_active OR public.has_role(auth.uid(), 'admin'));
CREATE POLICY "admins manage professionals" ON public.professionals FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin')) WITH CHECK (public.has_role(auth.uid(), 'admin'));
CREATE TRIGGER professionals_updated_at BEFORE UPDATE ON public.professionals
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TABLE public.professional_services (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  professional_id UUID NOT NULL REFERENCES public.professionals(id) ON DELETE CASCADE,
  service_id UUID NOT NULL REFERENCES public.services(id) ON DELETE CASCADE,
  UNIQUE (professional_id, service_id)
);
GRANT SELECT ON public.professional_services TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.professional_services TO authenticated;
GRANT ALL ON public.professional_services TO service_role;
ALTER TABLE public.professional_services ENABLE ROW LEVEL SECURITY;
CREATE POLICY "professional services public" ON public.professional_services FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "admins manage professional services" ON public.professional_services FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin')) WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE TABLE public.professional_schedules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  professional_id UUID NOT NULL REFERENCES public.professionals(id) ON DELETE CASCADE,
  weekday SMALLINT NOT NULL CHECK (weekday BETWEEN 0 AND 6),
  start_time TIME NOT NULL,
  end_time TIME NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT ON public.professional_schedules TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.professional_schedules TO authenticated;
GRANT ALL ON public.professional_schedules TO service_role;
ALTER TABLE public.professional_schedules ENABLE ROW LEVEL SECURITY;
CREATE POLICY "schedules public" ON public.professional_schedules FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "admins manage schedules" ON public.professional_schedules FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin')) WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- APPOINTMENTS
CREATE TYPE public.appointment_status AS ENUM ('pending', 'confirmed', 'completed', 'cancelled');

CREATE TABLE public.appointments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  service_id UUID NOT NULL REFERENCES public.services(id) ON DELETE RESTRICT,
  professional_id UUID REFERENCES public.professionals(id) ON DELETE SET NULL,
  starts_at TIMESTAMPTZ NOT NULL,
  duration_minutes INTEGER NOT NULL DEFAULT 60,
  status public.appointment_status NOT NULL DEFAULT 'pending',
  client_notes TEXT,
  admin_notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX appointments_starts_at_idx ON public.appointments (starts_at);
CREATE INDEX appointments_client_idx ON public.appointments (client_id);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.appointments TO authenticated;
GRANT ALL ON public.appointments TO service_role;
ALTER TABLE public.appointments ENABLE ROW LEVEL SECURITY;
CREATE POLICY "clients read own appointments" ON public.appointments FOR SELECT TO authenticated
  USING (client_id = auth.uid() OR public.has_role(auth.uid(), 'admin'));
CREATE POLICY "clients create own appointments" ON public.appointments FOR INSERT TO authenticated
  WITH CHECK (client_id = auth.uid());
CREATE POLICY "clients update own appointments" ON public.appointments FOR UPDATE TO authenticated
  USING (client_id = auth.uid() OR public.has_role(auth.uid(), 'admin'))
  WITH CHECK (client_id = auth.uid() OR public.has_role(auth.uid(), 'admin'));
CREATE POLICY "admins delete appointments" ON public.appointments FOR DELETE TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));
CREATE TRIGGER appointments_updated_at BEFORE UPDATE ON public.appointments
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- STOCK
CREATE TABLE public.products (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  brand TEXT,
  category TEXT NOT NULL DEFAULT 'Cremas',
  unit TEXT NOT NULL DEFAULT 'unidad',
  stock NUMERIC(12,2) NOT NULL DEFAULT 0,
  min_stock NUMERIC(12,2) NOT NULL DEFAULT 0,
  cost NUMERIC(12,2),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.products TO authenticated;
GRANT ALL ON public.products TO service_role;
ALTER TABLE public.products ENABLE ROW LEVEL SECURITY;
CREATE POLICY "admins manage products" ON public.products FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin')) WITH CHECK (public.has_role(auth.uid(), 'admin'));
CREATE TRIGGER products_updated_at BEFORE UPDATE ON public.products
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TABLE public.stock_movements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id UUID NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  quantity NUMERIC(12,2) NOT NULL,
  reason TEXT,
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.stock_movements TO authenticated;
GRANT ALL ON public.stock_movements TO service_role;
ALTER TABLE public.stock_movements ENABLE ROW LEVEL SECURITY;
CREATE POLICY "admins manage stock movements" ON public.stock_movements FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin')) WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- SEED
INSERT INTO public.services (id, name, description, category, duration_minutes, price, is_published) VALUES
 ('11111111-1111-4111-8111-111111111101', 'Limpieza facial profunda', 'Higiene profunda con extracción, vapor y mascarilla calmante.', 'Facial', 60, 28000, true),
 ('11111111-1111-4111-8111-111111111102', 'Peeling químico', 'Renovación celular con ácidos para manchas y textura.', 'Facial', 45, 35000, true),
 ('11111111-1111-4111-8111-111111111103', 'Masaje descontracturante', 'Masaje profundo de espalda, cuello y hombros.', 'Corporal', 60, 25000, true),
 ('11111111-1111-4111-8111-111111111104', 'Drenaje linfático', 'Técnica manual suave para reducir retención de líquidos.', 'Corporal', 75, 30000, true),
 ('11111111-1111-4111-8111-111111111105', 'Depilación definitiva', 'Sesión con equipo de luz pulsada por zona.', 'Depilación', 30, 22000, true),
 ('11111111-1111-4111-8111-111111111106', 'Radiofrecuencia facial', 'Tensado y estímulo de colágeno.', 'Aparatología', 45, 38000, true);

INSERT INTO public.professionals (id, full_name, specialty, bio, is_active) VALUES
 ('22222222-2222-4222-8222-222222222201', 'Valentina Ríos', 'Cosmetología facial', 'Especialista en limpiezas profundas y peelings.', true),
 ('22222222-2222-4222-8222-222222222202', 'Camila Duarte', 'Masajes y drenaje', 'Masoterapeuta con 8 años de experiencia.', true),
 ('22222222-2222-4222-8222-222222222203', 'Julieta Pérez', 'Aparatología', 'A cargo de radiofrecuencia y depilación definitiva.', true);

INSERT INTO public.professional_services (professional_id, service_id) VALUES
 ('22222222-2222-4222-8222-222222222201','11111111-1111-4111-8111-111111111101'),
 ('22222222-2222-4222-8222-222222222201','11111111-1111-4111-8111-111111111102'),
 ('22222222-2222-4222-8222-222222222202','11111111-1111-4111-8111-111111111103'),
 ('22222222-2222-4222-8222-222222222202','11111111-1111-4111-8111-111111111104'),
 ('22222222-2222-4222-8222-222222222203','11111111-1111-4111-8111-111111111105'),
 ('22222222-2222-4222-8222-222222222203','11111111-1111-4111-8111-111111111106'),
 ('22222222-2222-4222-8222-222222222201','11111111-1111-4111-8111-111111111106');

INSERT INTO public.professional_schedules (professional_id, weekday, start_time, end_time) VALUES
 ('22222222-2222-4222-8222-222222222201',1,'09:00','17:00'),
 ('22222222-2222-4222-8222-222222222201',2,'09:00','17:00'),
 ('22222222-2222-4222-8222-222222222201',3,'09:00','17:00'),
 ('22222222-2222-4222-8222-222222222201',4,'09:00','17:00'),
 ('22222222-2222-4222-8222-222222222201',5,'09:00','13:00'),
 ('22222222-2222-4222-8222-222222222202',2,'13:00','20:00'),
 ('22222222-2222-4222-8222-222222222202',4,'13:00','20:00'),
 ('22222222-2222-4222-8222-222222222202',6,'10:00','15:00'),
 ('22222222-2222-4222-8222-222222222203',1,'14:00','20:00'),
 ('22222222-2222-4222-8222-222222222203',3,'14:00','20:00'),
 ('22222222-2222-4222-8222-222222222203',5,'14:00','20:00');

INSERT INTO public.products (name, brand, category, unit, stock, min_stock, cost) VALUES
 ('Crema hidratante ácido hialurónico', 'Idraet', 'Cremas', 'pote 250g', 8, 3, 12000),
 ('Loción tónica sin alcohol', 'Lidherma', 'Lociones', 'botella 500ml', 4, 5, 8000),
 ('Gel conductor ultrasonido', 'Fitoderm', 'Insumos', 'bidón 1L', 2, 2, 6000),
 ('Mascarilla calmante de avena', 'Idraet', 'Cremas', 'pote 500g', 6, 2, 15000),
 ('Aceite de almendras neutro', 'Natural Life', 'Lociones', 'botella 1L', 10, 4, 9000),
 ('Ampollas vitamina C', 'Lidherma', 'Insumos', 'caja x10', 1, 3, 18000);