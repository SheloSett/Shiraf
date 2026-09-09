import { prisma } from "@/server/db";
import { CONTACT } from "@/lib/contact";
import { conDefaults, texto, type ContenidoDePagina } from "@/lib/contenido";

/**
 * Los datos del centro —dirección, teléfono, WhatsApp— como están HOY.
 *
 * ── EL PROBLEMA QUE VIENE A RESOLVER ──────────────────────────────────────
 *
 * Estos datos viven en dos lugares y nadie los sincronizaba:
 *
 *   · `src/lib/contact.ts`, fijo en el código.
 *   · La página «Datos del centro» del panel (`page_content`, página "datos"),
 *     que la dueña puede editar, y cuyos defaults salen de `contact.ts`.
 *
 * El sitio público lee el del panel. **Los avisos leían el del código.** O sea
 * que el día que la dueña cambiara el número o se mudara el local, el sitio iba
 * a mostrar lo nuevo y todos los mails de turno iban a seguir firmando con lo
 * viejo, sin que nadie se enterara hasta que una clienta llamara a un número que
 * ya no existe o fuera a la dirección de antes.
 *
 * Es exactamente lo que `contact.ts` fue creado para evitar —su comentario de
 * arriba cuenta que el teléfono ya había divergido una vez entre el footer y la
 * página de contacto—, reintroducido por otra puerta cuando el panel se volvió
 * editable. Encontrado el 9/9/2026, antes de que rompiera nada: mientras nadie
 * tocara esos campos, los dos valores coincidían.
 *
 * ── POR QUÉ NUNCA FALLA ───────────────────────────────────────────────────
 *
 * Si la base no contesta, devuelve los de `contact.ts` y lo deja en el log. Es
 * el mismo criterio que `obtenerContenido`: un problema al leer el contenido no
 * puede hacer que un turno confirmado se quede sin aviso. Los datos de respaldo
 * son, además, los mismos que el panel muestra como default.
 */
export type DatosDelCentro = {
  /** Sólo dígitos, para armar enlaces y para mandar por WhatsApp. */
  whatsappNumero: string;
  /** El teléfono como se lee, para mostrarlo escrito. */
  telefonoVisible: string;
  direccion: string;
  ciudad: string;
  /** "Vuelta de Obligado 2443, Oficina 302, Buenos Aires", ya armado. */
  lugar: string;
};

/** Lo que se usa cuando la base no contesta: lo mismo que el panel trae por defecto. */
function deRespaldo(): DatosDelCentro {
  return {
    whatsappNumero: CONTACT.whatsappNumber,
    telefonoVisible: CONTACT.phoneDisplay,
    direccion: CONTACT.address,
    ciudad: CONTACT.city,
    lugar: `${CONTACT.address}, ${CONTACT.city}`,
  };
}

export async function datosDelCentro(): Promise<DatosDelCentro> {
  let guardado: ContenidoDePagina | undefined;

  try {
    const fila = await prisma.page_content.findUnique({
      where: { page: "datos" },
      select: { content: true },
    });

    // La misma defensa que `obtenerContenido`: una fila cuyo `content` no sea un
    // objeto —alguien tocó la base a mano, o quedó de una versión vieja— se
    // ignora en vez de romper el aviso.
    if (fila?.content && typeof fila.content === "object" && !Array.isArray(fila.content)) {
      guardado = fila.content as ContenidoDePagina;
    }
  } catch (error) {
    console.error("[datos-centro] No se pudieron leer los datos del centro:", error);
    return deRespaldo();
  }

  // `conDefaults` rellena lo que falte con los defaults del esquema, que son los
  // de `contact.ts`. Se usa esa función y no un `??` campo por campo para que el
  // día que alguien agregue un campo al panel, esto lo tome sin tocar nada.
  const datos = conDefaults("datos", guardado);
  const respaldo = deRespaldo();

  /*
   * Un campo vacío cae al respaldo, y acá eso es distinto de lo que hace el
   * sitio.
   *
   * `conDefaults` respeta el vacío a propósito: si el centro borró un texto, es
   * porque no lo quiere. En una página eso está bien —se deja de mostrar una
   * franja—; en un aviso de turno no: un mail que dice "Te esperamos en ," o que
   * manda a escribir a un número en blanco es peor que uno con el dato viejo.
   */
  const valor = (key: string, respaldoDelCampo: string): string =>
    texto(datos, key).trim() || respaldoDelCampo;

  const direccion = valor("direccion", respaldo.direccion);
  const ciudad = valor("ciudad", respaldo.ciudad);

  return {
    whatsappNumero: valor("whatsappNumero", respaldo.whatsappNumero),
    telefonoVisible: valor("telefonoVisible", respaldo.telefonoVisible),
    direccion,
    ciudad,
    lugar: `${direccion}, ${ciudad}`,
  };
}
