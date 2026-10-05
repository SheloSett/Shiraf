/**
 * Que quien fue a ingresar DESDE la pantalla de reserva vuelva a la reserva
 * (5/10/2026).
 *
 * ── POR QUÉ EXISTE ────────────────────────────────────────────────────────
 *
 * /reservar le pregunta a quien llega sin sesión si quiere seguir sin cuenta o
 * ingresar. La que elige ingresar va a /auth, y /auth manda a todas las
 * clientas a «Mi cuenta» al terminar. Sin esto, el turno que estaba por sacar
 * se le pierde por el camino: entra, cae en su cuenta, y tiene que acordarse de
 * volver a apretar «Reservar» y elegir de nuevo el tratamiento.
 *
 * ── POR QUÉ `sessionStorage` Y NO UN PARÁMETRO EN LA URL ──────────────────
 *
 * Porque /auth navega en cinco lugares distintos —ingresar, registrarse, la
 * sesión que ya estaba abierta, el cartel del mail que no salió— y un parámetro
 * habría que arrastrarlo por los cinco. Acá lo lee UN lugar, el que decide a
 * dónde va cada quien. Y un "volvé a tal dirección" que viaja en la URL es
 * además la forma clásica de que alguien arme un enlace que redirige a donde
 * quiere; esto no sale del navegador.
 *
 * Vale por media hora y una sola vez. Si alguien dijo "ingresar", se arrepintió
 * y entra a su cuenta al otro día desde el header, no tiene por qué aterrizar
 * en una reserva que ya no recuerda haber empezado.
 */

const CLAVE = "shiraf:volver-a-reservar";
const VIGENCIA_MS = 30 * 60 * 1000;

/** Lo que /reservar entiende en su dirección: con qué venía elegido. */
export type DestinoDeReserva = { service?: string; professional?: string };

/** Anota que hay una reserva esperando a que esta persona termine de ingresar. */
export function recordarReserva(destino: DestinoDeReserva): void {
  try {
    sessionStorage.setItem(CLAVE, JSON.stringify({ ...destino, cuando: Date.now() }));
  } catch {
    // Ventana privada o almacenamiento lleno: ingresa igual y cae en su cuenta,
    // que es lo que pasaba antes de que esto existiera.
  }
}

/**
 * La reserva que estaba esperando, si hay una y sigue vigente. **La consume**:
 * la segunda vez que se pregunta ya no está.
 */
export function reservaPendiente(): DestinoDeReserva | null {
  try {
    const crudo = sessionStorage.getItem(CLAVE);
    if (!crudo) return null;
    sessionStorage.removeItem(CLAVE);

    const guardado = JSON.parse(crudo) as {
      service?: unknown;
      professional?: unknown;
      cuando?: unknown;
    };
    if (typeof guardado.cuando !== "number" || Date.now() - guardado.cuando > VIGENCIA_MS) {
      return null;
    }

    // Claves que se omiten y no que van en `undefined`: es lo que espera el
    // `search` de /reservar. Ver el comentario del tipo `Search` allá.
    const destino: DestinoDeReserva = {};
    if (typeof guardado.service === "string") destino.service = guardado.service;
    if (typeof guardado.professional === "string") destino.professional = guardado.professional;
    return destino;
  } catch {
    return null;
  }
}
