import { CONTACT } from "@/lib/contact";
import { TOLERANCIA_MINUTOS } from "@/lib/shiraf";
import type { AppointmentEvent, NotifiableAppointment } from "@/lib/notifications";

/**
 * Los ocho avisos, escritos como plantillas de WhatsApp.
 *
 * ── POR QUÉ ESTO NO ES EL TEXTO DE `notifications.ts` ─────────────────────
 *
 * Porque WhatsApp no deja mandar texto libre. Fuera de las 24 horas siguientes a
 * que la clienta escriba —y un recordatorio del día antes está siempre fuera—
 * sólo se puede mandar una **plantilla aprobada por Meta**: un texto fijo con
 * huecos numerados, `{{1}}`, `{{2}}`, que se revisó una vez y después no se
 * toca.
 *
 * O sea que el mensaje no se arma acá: se arma **allá**, en los servidores de
 * Meta, y lo único que viaja es la lista de valores para los huecos. Por eso
 * este archivo no puede reusar `buildAppointmentMessage()` — esa función
 * devuelve el texto entero ya redactado, que es exactamente lo que WhatsApp no
 * acepta.
 *
 * ⚠️ Los pedazos —el nombre, la fecha en palabras, el tratamiento— están
 * escritos de nuevo abajo y NO importados. No es lo que uno querría: los
 * equivalentes de `notifications.ts` (`whenPhrase`, `whatPhrase`, `firstName`)
 * son internos de ese archivo. Se reescriben porque acá además hay que garantizar
 * dos cosas que allá no hacen falta —que ningún valor salga vacío y que ninguno
 * tenga saltos de línea—, así que exportarlos tampoco alcanzaría sin envolverlos.
 *
 * **La consecuencia hay que tenerla presente: son dos redacciones de la misma
 * frase.** Si se cambia cómo se escribe una fecha en `notifications.ts`, hay que
 * cambiarla acá o el mail y el WhatsApp del mismo turno van a decir la hora de
 * dos formas distintas.
 *
 * ── 🔴 EL `cuerpo` DE ACÁ ES LO QUE HAY QUE PEGAR EN META ─────────────────
 *
 * Cada entrada tiene el texto exacto que se carga en el formulario de plantillas
 * de Meta. **Tiene que coincidir carácter por carácter con lo aprobado.** Si se
 * cambia una coma acá y no se vuelve a pedir aprobación allá, no pasa nada
 * visible: Meta sigue mandando SU versión, la vieja, y el archivo miente.
 *
 * Al revés es peor y sí rompe: si se agrega o se saca un `{{n}}`, la cantidad de
 * parámetros deja de coincidir con la plantilla aprobada y Meta rechaza el envío
 * entero con un error de parámetros.
 *
 * **Este archivo es la fuente**: `docs/whatsapp-automatico.md` explica el trámite
 * y lista los nombres y el orden de las variables, pero manda a leer el `cuerpo`
 * de acá en vez de copiarlo. Dos copias del mismo texto es cómo empiezan a decir
 * cosas distintas.
 *
 * ── LAS REGLAS DE META QUE CONDICIONAN CÓMO ESTÁN ESCRITOS ────────────────
 *
 *   · Un parámetro **no puede venir vacío**. Nada de `""`: Meta rechaza el
 *     mensaje. Por eso los datos opcionales —el tratamiento, el motivo de una
 *     cancelación— tienen un texto de reemplazo y no se omiten.
 *   · Un parámetro **no puede tener saltos de línea** ni tabs. Lo que en el mail
 *     es un renglón aparte, acá va adentro de la misma frase.
 *   · El cuerpo **no puede empezar ni terminar con un parámetro**, ni tener dos
 *     pegados.
 *   · Categoría **utility** los ocho: son avisos sobre una operación que la
 *     persona ya tiene con el negocio. Es la más barata y la que Meta aprueba
 *     sin discutir. Ninguno es marketing y ninguno tiene que parecerlo.
 */

/** Lo que se manda cuando un dato opcional no está. Nunca vacío: Meta lo rechaza. */
const SIN_DATO = "—";

/** Un dato que va adentro de un parámetro, sin saltos de línea ni espacios de más. */
function enUnaLinea(valor: string): string {
  return valor.replace(/\s+/g, " ").trim();
}

/** El parámetro, o el guión si no hay nada. Nunca devuelve la cadena vacía. */
function oSinDato(valor: string | null | undefined): string {
  const limpio = enUnaLinea(valor ?? "");
  return limpio === "" ? SIN_DATO : limpio;
}

export type PlantillaDeAviso = {
  /**
   * El nombre con el que quedó registrada en Meta.
   *
   * Minúsculas y guiones bajos, que es lo único que Meta acepta. Cambiarlo acá
   * sin crear la plantilla allá hace que el envío falle con "template not
   * found".
   */
  nombre: string;
  /** El texto exacto que se carga en Meta. Ver la advertencia de arriba. */
  cuerpo: string;
  /** Los valores de los `{{n}}`, en orden. Ninguno puede salir vacío. */
  params: (a: NotifiableAppointment) => string[];
};

/**
 * El idioma con el que se registran las plantillas en Meta.
 *
 * `es_AR` y no `es` a secas: si la plantilla se carga con un idioma y se manda
 * con otro, Meta contesta que no existe. Se puede pisar con `WHATSAPP_LANG` por
 * si al crearlas en el panel quedan como `es`.
 */
export const IDIOMA_POR_DEFECTO = "es_AR";

const lugar = `${CONTACT.address}, ${CONTACT.city}`;
const tolerancia = `Te esperamos hasta ${TOLERANCIA_MINUTOS} minutos; pasado ese rato el turno se libera.`;

export const PLANTILLAS: Record<AppointmentEvent, PlantillaDeAviso> = {
  // ── A la clienta ────────────────────────────────────────────────────────
  requested: {
    nombre: "turno_pedido",
    cuerpo: `Hola {{1}}, te escribimos de Shiraf.

Recibimos tu pedido de turno {{2}} para {{3}}.

Todavía no está confirmado: lo revisamos y te avisamos por acá.

Te esperamos en ${lugar}. ${tolerancia}`,
    params: (a) => [nombre(a), cuando(a), queCosa(a)],
  },

  confirmed: {
    nombre: "turno_confirmado",
    cuerpo: `Hola {{1}}, te escribimos de Shiraf.

Tu turno {{2}} para {{3}} quedó confirmado.

Te esperamos en ${lugar}. ${tolerancia}

Si no podés venir, avisanos y lo reprogramamos.`,
    params: (a) => [nombre(a), cuando(a), queCosa(a)],
  },

  cancelled: {
    nombre: "turno_cancelado",
    cuerpo: `Hola {{1}}, te escribimos de Shiraf.

Tuvimos que cancelar tu turno {{2}} para {{3}}.

Motivo: {{4}}

Perdón por el cambio. Escribinos y te buscamos otro horario.`,
    // El motivo es opcional en la base, pero el hueco no lo es acá: cuando no
    // hay, va la frase entera y no un guión suelto, que se leería como un error.
    params: (a) => [
      nombre(a),
      cuando(a),
      queCosa(a),
      oSinDato(a.cancelReason) === SIN_DATO
        ? "no nos dejaron el detalle"
        : oSinDato(a.cancelReason),
    ],
  },

  rescheduled: {
    nombre: "turno_movido",
    cuerpo: `Hola {{1}}, te escribimos de Shiraf.

Tuvimos que mover tu turno para {{2}}. Queda {{3}}.

Te esperamos en ${lugar}.

Si ese horario no te sirve, avisanos y buscamos otro.`,
    // Ojo con el orden: acá el tratamiento va ANTES que la fecha, al revés que
    // en los otros tres. Es como quedó redactada la frase, y los huecos siguen
    // al texto y no a una convención.
    params: (a) => [nombre(a), queCosa(a), cuando(a)],
  },

  reminder: {
    nombre: "turno_recordatorio",
    cuerpo: `Hola {{1}}, te escribimos de Shiraf.

Te recordamos tu turno {{2}} para {{3}}.

Te esperamos en ${lugar}. ${tolerancia}

Si no podés venir, avisanos así liberamos el horario.`,
    params: (a) => [nombre(a), cuando(a), queCosa(a)],
  },

  // ── Al centro ───────────────────────────────────────────────────────────
  //
  // Van al WhatsApp del centro, no al de la clienta. Son notificaciones de
  // trabajo y por eso cambian de tono: no saludan ni se despiden.
  //
  // El nombre completo de la clienta y su teléfono van en el mismo parámetro:
  // dos huecos pegados no los acepta Meta, y separarlos con texto de relleno
  // sería inventar palabras para cumplir una regla.
  "new-request": {
    nombre: "centro_turno_nuevo",
    cuerpo: `Entró un turno por el sitio y espera confirmación.

{{1}}
Turno {{2}} para {{3}}.

Confirmalo desde el panel: ${CONTACT.siteUrl}/admin/turnos`,
    params: (a) => [quienEs(a), cuando(a), queCosa(a)],
  },

  "client-cancelled": {
    nombre: "centro_clienta_cancelo",
    cuerpo: `Una clienta canceló su turno.

{{1}}
Era {{2}} para {{3}}. Motivo: {{4}}

El horario quedó libre: ${CONTACT.siteUrl}/admin/turnos`,
    params: (a) => [
      quienEs(a),
      cuando(a),
      queCosa(a),
      oSinDato(a.cancelReason) === SIN_DATO ? "no lo dejó escrito" : oSinDato(a.cancelReason),
    ],
  },

  "client-rescheduled": {
    nombre: "centro_clienta_movio",
    cuerpo: `Una clienta se movió el turno sola.

{{1}}
Queda {{2}} para {{3}}.

Se liberó el horario que tenía antes: ${CONTACT.siteUrl}/admin/turnos`,
    params: (a) => [quienEs(a), cuando(a), queCosa(a)],
  },
};

// ─────────────────────────────────────────────────────────────────────────────
// Los pedazos
//
// Cada uno envuelve a su equivalente de `notifications.ts` y le agrega lo único
// que WhatsApp exige de más: que no venga vacío y que no tenga saltos de línea.
// ─────────────────────────────────────────────────────────────────────────────

function nombre(a: NotifiableAppointment): string {
  const primero = enUnaLinea(a.clientName).split(" ")[0];
  // "Clienta" y no el guión: es un saludo, y "Hola —" se lee como un error de la
  // app. El nombre falta sólo en turnos cargados a las apuradas por teléfono.
  return primero && primero !== "" ? primero : "Clienta";
}

function quienEs(a: NotifiableAppointment): string {
  const quien = enUnaLinea(a.clientName) || "Sin nombre";
  const tel = enUnaLinea(a.clientPhone ?? "");
  return tel ? `${quien} · ${tel}` : quien;
}

function cuando(a: NotifiableAppointment): string {
  return oSinDato(frase(a.startsAt));
}

function queCosa(a: NotifiableAppointment): string {
  const { serviceName, professionalName } = a;
  if (serviceName && professionalName) return enUnaLinea(`${serviceName}, con ${professionalName}`);
  if (serviceName) return enUnaLinea(serviceName);
  if (professionalName) return enUnaLinea(`tu turno con ${professionalName}`);
  // Nunca vacío. Pasa sólo si el tratamiento se borró del catálogo y el turno
  // tampoco tiene el nombre congelado, que es un turno viejo y roto.
  return "tu tratamiento";
}

/**
 * "el jueves 21 de agosto a las 14:30".
 *
 * Se escribe acá y no se importa de `notifications.ts` porque allá `whenPhrase`
 * es interna. Es la misma receta y el mismo huso: si una de las dos cambia, la
 * otra tiene que cambiar igual — el mail y el WhatsApp del mismo turno no pueden
 * decir horas distintas.
 */
function frase(startsAt: string): string {
  const date = new Date(startsAt);
  const dia = date.toLocaleDateString("es-AR", {
    weekday: "long",
    day: "2-digit",
    month: "long",
    timeZone: "America/Argentina/Buenos_Aires",
  });
  const hora = date.toLocaleTimeString("es-AR", {
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
    timeZone: "America/Argentina/Buenos_Aires",
  });
  return `el ${dia} a las ${hora}`;
}
