import { createFileRoute, Outlet, redirect } from "@tanstack/react-router";
import { pedirSesion } from "@/lib/sesion";

export const Route = createFileRoute("/_authenticated")({
  ssr: false,
  beforeLoad: async ({ context }) => {
    const sesion = await pedirSesion(context.queryClient);
    if (!sesion) throw redirect({ to: "/auth" });
    // Se devuelve la sesión entera y no sólo el id: los `beforeLoad` de más
    // adentro ya preguntaban por el rol, y así no tienen que volver a pedirla.
    return { user: sesion };
  },
  component: () => <Outlet />,
});
