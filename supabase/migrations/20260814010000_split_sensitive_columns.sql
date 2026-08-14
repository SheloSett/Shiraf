-- ============================================================================
-- Las notas clínicas y los costos salen a su propia tabla.
--
-- POR QUÉ: los permisos 'clients_notes' y 'stock_costs' eran los dos únicos que
-- no tenían respaldo en la base. Escondían UNA COLUMNA —profiles.notes y
-- products.cost— y la RLS es row-level: puede decidir si ves un producto, no si
-- ves su costo. Un GRANT por columna tampoco servía, porque la dueña y la
-- secretaria son el mismo rol de Postgres (`authenticated`) y le habría sacado
-- la columna a las dos.
--
-- Mientras eso estuviera así, tildar o destildar esas casillas sólo cambiaba lo
-- que se dibujaba en pantalla: alguien con la clave publishable —que es pública
-- y viaja en el bundle— leía la columna igual, y entrando por URL a mano el
-- dato aparecía. Un candado dibujado.
--
-- Sacando el dato a una tabla propia, la RLS vuelve a poder hacer su trabajo:
-- ahora es una FILA lo que se protege, que es justamente lo que sabe hacer.
--
-- SOBRE LOS DATOS: primero se copian a la tabla nueva y recién después se
-- vacían las columnas viejas, todo en la misma transacción — si la copia
-- fallara, no se pierde nada. Las columnas NO se borran: quedan vacías y
-- marcadas como obsoletas, así el cambio es reversible.
-- ============================================================================

-- ── 1. Notas de la clienta ──────────────────────────────────────────────────
-- Una fila por clienta, igual que la columna que reemplaza: mi-cuenta muestra
-- un solo cuadro de texto y no un historial. Si algún día el centro quiere
-- llevar un registro con fechas, esto se convierte en varias filas sin tocar
-- las policies.
CREATE TABLE public.client_notes (
  client_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  body TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.client_notes TO authenticated;
GRANT ALL ON public.client_notes TO service_role;
ALTER TABLE public.client_notes ENABLE ROW LEVEL SECURITY;

-- La clienta ve y edita la suya —la escribió ella desde mi-cuenta— y del lado
-- del centro hace falta el permiso específico. Tener 'clients_contact' alcanza
-- para el teléfono, no para las alergias.
CREATE POLICY "read client notes" ON public.client_notes FOR SELECT TO authenticated
  USING (client_id = auth.uid() OR public.has_permission(auth.uid(), 'clients_notes'));

CREATE POLICY "write client notes" ON public.client_notes FOR INSERT TO authenticated
  WITH CHECK (client_id = auth.uid() OR public.has_permission(auth.uid(), 'clients_notes'));

CREATE POLICY "update client notes" ON public.client_notes FOR UPDATE TO authenticated
  USING (client_id = auth.uid() OR public.has_permission(auth.uid(), 'clients_notes'))
  WITH CHECK (client_id = auth.uid() OR public.has_permission(auth.uid(), 'clients_notes'));

CREATE TRIGGER client_notes_updated_at BEFORE UPDATE ON public.client_notes
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

INSERT INTO public.client_notes (client_id, body)
SELECT id, notes
  FROM public.profiles
 WHERE notes IS NOT NULL AND btrim(notes) <> ''
ON CONFLICT (client_id) DO NOTHING;

UPDATE public.profiles SET notes = NULL WHERE notes IS NOT NULL;

COMMENT ON COLUMN public.profiles.notes IS
  'OBSOLETA — migrada a public.client_notes el 2026-08-14. Se dejó vacía en vez '
  'de borrarla para que el cambio sea reversible. No leer ni escribir: cualquiera '
  'con acceso a la ficha la vería, que es justo lo que se vino a evitar.';

-- ── 2. Costos de compra ─────────────────────────────────────────────────────
CREATE TABLE public.product_costs (
  product_id UUID PRIMARY KEY REFERENCES public.products(id) ON DELETE CASCADE,
  cost NUMERIC(12,2),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.product_costs TO authenticated;
GRANT ALL ON public.product_costs TO service_role;
ALTER TABLE public.product_costs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "manage product costs" ON public.product_costs FOR ALL TO authenticated
  USING (public.has_permission(auth.uid(), 'stock_costs'))
  WITH CHECK (public.has_permission(auth.uid(), 'stock_costs'));

CREATE TRIGGER product_costs_updated_at BEFORE UPDATE ON public.product_costs
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

INSERT INTO public.product_costs (product_id, cost)
SELECT id, cost
  FROM public.products
 WHERE cost IS NOT NULL
ON CONFLICT (product_id) DO NOTHING;

UPDATE public.products SET cost = NULL WHERE cost IS NOT NULL;

COMMENT ON COLUMN public.products.cost IS
  'OBSOLETA — migrada a public.product_costs el 2026-08-14. Se dejó vacía en vez '
  'de borrarla para que el cambio sea reversible. No leer ni escribir: con '
  'permiso de stock alcanzaba para verla, y el costo de compra no es lo mismo '
  'que el stock.';
