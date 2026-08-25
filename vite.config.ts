// @lovable.dev/vite-tanstack-config already includes the following — do NOT add them manually
// or the app will break with duplicate plugins:
//   - TanStack devtools (dev-only, first), tanstackStart, viteReact, tailwindcss, tsConfigPaths,
//     nitro (build-only using cloudflare as a default target), VITE_* env injection, @ path alias,
//     React/TanStack dedupe, error logger plugins, and sandbox detection (port/host/strictPort).
// You can pass additional config via defineConfig({ vite: { ... }, etc... }) if needed.
import { defineConfig } from "@lovable.dev/vite-tanstack-config";

/**
 * Desarrollo adentro del contenedor: Vite no se entera de que editaste.
 *
 * El compose monta el código del host (`.:/app`) y Vite corre adentro. En
 * Windows con Docker Desktop ese puente NO transporta los avisos del sistema de
 * archivos: el archivo nuevo está adentro del contenedor —se puede leer con
 * `docker exec cat`— pero el watcher de Vite nunca recibe el evento, así que
 * sigue sirviendo la versión vieja que tiene en memoria.
 *
 * Lo peor del síntoma es que no parece un problema de herramientas: la pantalla
 * carga bien, sin errores, simplemente el cambio no está. Y recargar no ayuda,
 * porque lo viejo lo sirve el servidor, no la caché del navegador. Ya nos costó
 * un rato acá: el botón del calendario estaba escrito y no aparecía.
 *
 * `usePolling` le pide a Vite que revise los archivos por reloj en vez de
 * esperar avisos. Cuesta un poco de CPU, y por eso va sólo cuando el compose
 * enciende la variable — corriendo `bun run dev` en la máquina, sin contenedor,
 * los avisos funcionan bien y esto queda apagado.
 */
const revisarPorReloj = process.env["SHIRAF_DEV_POLLING"] === "1";

/**
 * El puerto al que el navegador le habla para la recarga en vivo.
 *
 * Adentro del contenedor Vite escucha en el 8080 y le dice al navegador que se
 * conecte ahí, pero desde el host el que existe es el 8081 (el mapeo del
 * compose). Sin esto el websocket de HMR no conecta y hay que recargar a mano.
 *
 * Va en `server.ws` y no en `server.hmr`: en Vite 8 lo segundo sigue andando
 * pero avisa por consola que está deprecado —lo dijo al arrancar el contenedor—
 * y `server.ws.clientPort` es el nombre nuevo de exactamente lo mismo.
 */
const puertoHmr = Number(process.env["SHIRAF_DEV_HMR_PORT"] ?? "");

export default defineConfig({
  tanstackStart: {
    // Redirect TanStack Start's bundled server entry to src/server.ts (our SSR error wrapper).
    // nitro/vite builds from this
    server: { entry: "server" },
  },
  vite: {
    server: {
      ...(revisarPorReloj ? { watch: { usePolling: true, interval: 400 } } : {}),
      ...(puertoHmr ? { ws: { clientPort: puertoHmr } } : {}),
    },
  },
});
