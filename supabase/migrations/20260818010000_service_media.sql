-- ============================================================================
-- Galería de tratamientos: varias fotos y videos, mezclados y ordenables.
--
-- Hasta acá cada tratamiento tenía UNA foto, en services.image_url. Alcanzaba
-- para la tarjeta del catálogo, pero no para mostrar un tratamiento: no había
-- forma de cargar el antes y después, ni un video del procedimiento.
--
-- ── POR QUÉ services.image_url NO SE BORRA ─────────────────────────────────
--
-- Se queda, pero deja de escribirse a mano: pasa a ser una copia de la PORTADA,
-- mantenida por un trigger. La razón es que tres pantallas —el panel del home,
-- la tarjeta del catálogo y la miniatura del panel— necesitan una sola imagen y
-- nada más, y con la columna siguen resolviéndolo con el mismo SELECT de
-- siempre, sin un join por fila y sin tocar una línea de su código.
--
-- Es dato duplicado, que normalmente es una mala idea. Acá se banca porque la
-- copia NO la mantiene la aplicación sino la base: no hay ningún camino por el
-- que la portada quede distinta de la primera foto de la galería, ni siquiera
-- si alguien escribe por la API a mano. Lo que sí hay que respetar es que
-- image_url ya no se escribe desde el formulario: la manda el trigger.
--
-- La portada es la primera IMAGEN, no el primer elemento. Un video primero en
-- la galería no sirve de portada: la tarjeta del catálogo es un <img>.
-- ============================================================================

CREATE TYPE public.media_kind AS ENUM ('image', 'video');

CREATE TABLE public.service_media (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  service_id UUID NOT NULL REFERENCES public.services(id) ON DELETE CASCADE,
  url TEXT NOT NULL,
  kind public.media_kind NOT NULL,
  -- Sin UNIQUE (service_id, position) a propósito: reordenar de a una fila
  -- pasa por estados con posiciones repetidas, y un único constraint obligaría
  -- a hacerlo DEFERRABLE o a numerar con huecos. El orden se desempata por
  -- created_at, así que un empate es feo pero no ambiguo.
  position INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX service_media_service_position_idx
  ON public.service_media (service_id, position, created_at);

GRANT SELECT ON public.service_media TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.service_media TO authenticated;
GRANT ALL ON public.service_media TO service_role;

ALTER TABLE public.service_media ENABLE ROW LEVEL SECURITY;

-- ── Policies: las mismas que services, heredadas del tratamiento ───────────
-- El EXISTS contra services corre CON la RLS de services aplicada, que es justo
-- lo que se quiere: anon sólo ve las filas de tratamientos publicados, así que
-- el EXISTS le da falso para todo lo demás sin que haya que repetir la regla.
CREATE POLICY "published service media anon" ON public.service_media FOR SELECT TO anon
  USING (
    EXISTS (
      SELECT 1 FROM public.services s
      WHERE s.id = service_id AND s.is_published
    )
  );

CREATE POLICY "published service media authenticated" ON public.service_media
  FOR SELECT TO authenticated
  USING (
    public.has_permission(auth.uid(), 'catalog')
    OR EXISTS (
      SELECT 1 FROM public.services s
      WHERE s.id = service_id AND s.is_published
    )
  );

-- Editar la galería es editar el catálogo: el mismo permiso que el tratamiento.
CREATE POLICY "manage service media" ON public.service_media FOR ALL TO authenticated
  USING (public.has_permission(auth.uid(), 'catalog'))
  WITH CHECK (public.has_permission(auth.uid(), 'catalog'));

-- ── La portada, mantenida por la base ──────────────────────────────────────
-- SECURITY DEFINER porque el UPDATE sobre services lo dispara la RLS de quien
-- inserta en service_media, y no tiene por qué coincidir: acá ya se verificó el
-- permiso 'catalog' en la policy de arriba para poder llegar hasta este punto.
CREATE OR REPLACE FUNCTION public.sync_service_cover()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  target UUID := COALESCE(NEW.service_id, OLD.service_id);
BEGIN
  -- Si el tratamiento se está borrando, el CASCADE ya se llevó su fila de
  -- services y este UPDATE no matchea nada. Es el caso normal, no un error.
  UPDATE public.services s
     SET image_url = (
           SELECT m.url
             FROM public.service_media m
            WHERE m.service_id = target
              AND m.kind = 'image'
            ORDER BY m.position, m.created_at
            LIMIT 1
         )
   WHERE s.id = target;

  RETURN NULL; -- AFTER trigger: el valor de retorno se ignora.
END;
$$;

CREATE TRIGGER trg_sync_service_cover
  AFTER INSERT OR DELETE OR UPDATE OF service_id, url, kind, position
  ON public.service_media
  FOR EACH ROW EXECUTE FUNCTION public.sync_service_cover();

-- ── Backfill: la foto que ya tenía cada tratamiento pasa a ser su galería ──
-- Sin esto, publicar esta migración dejaría todo el catálogo sin fotos: las
-- pantallas nuevas leen service_media y ahí no habría nada.
INSERT INTO public.service_media (service_id, url, kind, position)
SELECT s.id, s.image_url, 'image', 0
  FROM public.services s
 WHERE s.image_url IS NOT NULL
   AND s.image_url <> '';
