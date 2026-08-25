-- ============================================================================
-- El centro puede cargar turnos a nombre de una clienta.
--
-- Hasta ahora la única policy de INSERT sobre appointments era "clients create
-- own appointments", con WITH CHECK (client_id = auth.uid()): un turno sólo
-- podía crearlo la propia clienta, para sí misma. El admin quedaba afuera por
-- la misma regla, así que todo lo que entraba por teléfono o WhatsApp —que en
-- un centro de estética es buena parte de la agenda— no tenía forma de
-- registrarse en el sistema. Se cargaba en un cuaderno, y el calendario del
-- panel mostraba una agenda que no era la real.
--
-- En Postgres varias policies permisivas para el mismo comando se combinan con
-- OR, así que agregar esta no le saca nada a la que ya estaba: la clienta sigue
-- pudiendo reservar para sí misma, y ahora el admin además puede hacerlo para
-- cualquiera.
--
-- Lo que esto NO habilita: crear una clienta que todavía no tiene cuenta.
-- appointments.client_id referencia auth.users, y dar de alta un usuario exige
-- la service role desde el servidor. Por ahora el panel sólo puede elegir entre
-- quienes ya se registraron; el alta de clientas sin cuenta queda para cuando
-- exista el primer createServerFn.
-- ============================================================================

CREATE POLICY "admins create appointments" ON public.appointments FOR INSERT TO authenticated
  WITH CHECK (public.has_role(auth.uid(), 'admin'));
