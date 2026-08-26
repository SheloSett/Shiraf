import { defineConfig, loadEnv } from "vite";
import viteReact from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import tsConfigPaths from "vite-tsconfig-paths";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import { nitro } from "nitro/vite";

/**
 * La configuración de Vite, escrita acá.
 *
 * ── POR QUÉ YA NO SALE DE @lovable.dev/vite-tanstack-config ───────────────
 *
 * El proyecto nació en Lovable y ese paquete armaba todo el build. Al dejar de
 * usar el editor quedaba una dependencia que decidía cosas importantes —qué
 * plugins corren y en qué orden, a qué apunta el deploy— dentro de un archivo
 * que nadie de acá puede leer ni versionar.
 *
 * Lo que hacía está reproducido abajo, plugin por plugin, leyéndolo de su
 * `dist`. Lo que NO se copió, y por qué:
 *
 *   · Los devtools de TanStack, dos loggers de errores de desarrollo y un proxy
 *     de assets: son comodidades del editor y no eran dependencias del proyecto.
 *   · El puente de dev-server y el «hmr gate»: sólo se activaban adentro del
 *     sandbox de Lovable, que ya no se usa.
 *   · `css.transformer: "lightningcss"`: lightningcss venía como dependencia de
 *     ese paquete, no de éste. Sin él Vite usa su transformador de siempre, y
 *     Tailwind 4 hace lo suyo igual.
 *   · El preset de Nitro `cloudflare-module`, que era a donde publicaba Lovable.
 *     Acá el deploy es Docker: el Dockerfile fija `NITRO_PRESET=node-server`, y
 *     sin default declarado Nitro también elige Node. Un default de Cloudflare
 *     sólo podía confundir.
 *
 * ── EL ORDEN DE LOS PLUGINS NO ES DECORATIVO ──────────────────────────────
 *
 * Es el mismo que traía el paquete: tailwind, alias de tsconfig, tanstackStart,
 * nitro y recién al final React. Moverlos rompe cosas que no se ven enseguida.
 */

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

export default defineConfig(({ command, mode }) => ({
  /**
   * Las VITE_* inyectadas a mano.
   *
   * Vite ya las expone en `import.meta.env` del lado del cliente, pero el
   * paquete de Lovable las declaraba además como `define`, y eso es lo que
   * también las hace llegar al bundle del SERVIDOR. Sin esto,
   * `VITE_CLOUDINARY_CLOUD_NAME` se cae a "" durante el SSR y las fotos de los
   * tratamientos salen rotas en la primera pintada.
   */
  define: Object.fromEntries(
    Object.entries(loadEnv(mode, process.cwd(), "VITE_")).map(([clave, valor]) => [
      `import.meta.env.${clave}`,
      JSON.stringify(valor),
    ]),
  ),

  resolve: {
    alias: { "@": `${process.cwd()}/src` },
    /**
     * Una sola copia de React y de react-query.
     *
     * Con dos, los hooks tiran «Invalid hook call» y react-query queda con dos
     * cachés que no se ven entre sí. Pasa fácil: cualquier dependencia que traiga
     * su propio React en una versión distinta abre la segunda copia.
     */
    dedupe: [
      "react",
      "react-dom",
      "react/jsx-runtime",
      "react/jsx-dev-runtime",
      "@tanstack/react-query",
      "@tanstack/query-core",
    ],
  },

  optimizeDeps: {
    include: [
      "react",
      "react-dom",
      "react-dom/client",
      "react/jsx-runtime",
      "react/jsx-dev-runtime",
    ],
    ignoreOutdatedRequests: true,
  },

  server: {
    host: "::",
    port: 8080,
    ...(revisarPorReloj ? { watch: { usePolling: true, interval: 400 } } : {}),
    ...(puertoHmr ? { ws: { clientPort: puertoHmr } } : {}),
  },

  plugins: [
    tailwindcss(),
    tsConfigPaths({ projects: ["./tsconfig.json"] }),
    tanstackStart({
      /**
       * Que un import de `src/server/**` desde el cliente sea un ERROR y no un
       * bundle silencioso con Prisma y el JWT_SECRET adentro. Venía del paquete
       * de Lovable y es de lo más valioso que traía.
       */
      importProtection: {
        behavior: "error",
        client: { files: ["**/server/**"], specifiers: ["server-only"] },
      },
      // El servidor arranca por src/server.ts, que envuelve los errores de SSR
      // y programa los recordatorios. Nitro construye desde ahí.
      server: { entry: "server" },
    }),
    // Sólo al construir: en `dev` no hace falta y alarga el arranque.
    ...(command === "build" ? [nitro()] : []),
    viteReact(),
  ],
}));
