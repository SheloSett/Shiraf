import { createFileRoute, Outlet } from "@tanstack/react-router";

/**
 * Layout de /servicios. No dibuja nada propio, pero tiene que existir.
 *
 * Sin este archivo, TanStack arma un padre virtual para /servicios y el SSR
 * resuelve mal el estado: la página renderiza el listado correcto pero responde
 * HTTP 404, con lo que Google la desindexaría. Es el mismo patrón que ya usa
 * admin.tsx junto a admin.index.tsx.
 */
export const Route = createFileRoute("/servicios")({
  component: () => <Outlet />,
});
