/**
 * ─────────────────────────────────────────────────────────────────────────────
 * El contenido editable del sitio. Este archivo es la fuente de verdad.
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * Dos cosas, y las dos viven acá y en ningún otro lado:
 *
 *   1. QUÉ se puede editar de cada página. Lo lee el editor del panel
 *      (`/admin/contenido`) para dibujar el formulario.
 *   2. QUÉ dice cada campo si nadie lo tocó nunca. El default de cada campo es
 *      **exactamente el texto que estaba escrito en el JSX**, copiado tal cual.
 *
 * ── LA PROPIEDAD QUE HAY QUE CUIDAR ───────────────────────────────────────
 *
 * Con la tabla `page_content` vacía, el sitio se ve **igual que antes de que
 * existiera todo esto**. Las páginas leen su contenido con `useContenido()`,
 * que mergea lo guardado en la base SOBRE estos defaults. Por eso:
 *
 *   · una página que nunca se editó muestra el texto original;
 *   · un campo nuevo nace andando, sin tocar la base;
 *   · borrar la fila de una página es "volver al original", no romperla.
 *
 * ⚠️ Entonces: cuando cambies un texto del sitio, cambialo ACÁ y no en el JSX.
 * El JSX ya no tiene textos; tiene `c.loQueSea`.
 *
 * ── AGREGAR UN CAMPO ──────────────────────────────────────────────────────
 *
 * Se agrega el campo en la página que corresponda, con su default, y se lo usa
 * en el JSX. **No hay migración**: `content` es un JSON y lo que no está
 * guardado sale del default. Sacar un campo es al revés — la clave vieja queda
 * en la base sin molestar a nadie, porque el merge la ignora.
 *
 * ── LOS TIPOS DE CAMPO ────────────────────────────────────────────────────
 *
 *   "text"      una línea.
 *   "textarea"  varias líneas. Los saltos SE RESPETAN al mostrarlos: es lo que
 *               usan los titulares partidos a mano ("Calma, / belleza / y
 *               bienestar"), donde el corte de línea es una decisión de diseño.
 *   "image"     una URL de foto. El editor sube el archivo a Cloudinary y
 *               guarda la URL que vuelve.
 *   "lista"     una lista de ítems que el centro puede agregar y borrar (los
 *               horarios de atención, por ejemplo). Cada ítem tiene los
 *               subcampos que declare `itemFields`.
 */

import { CONTACT, OPENING_HOURS } from "@/lib/contact";

// ─────────────────────────────────────────────────────────────────────────────
// Los tipos
// ─────────────────────────────────────────────────────────────────────────────

export type TipoSimple = "text" | "textarea" | "image";

export type CampoSimple = {
  key: string;
  label: string;
  type: TipoSimple;
  default: string;
  /** Aclaración chica debajo del campo, para lo que no se explica solo. */
  ayuda?: string;
};

export type CampoLista = {
  key: string;
  label: string;
  type: "lista";
  /** Cómo se llama UN ítem: sale en el botón "Agregar ..." y en el de borrar. */
  itemLabel: string;
  itemFields: CampoSimple[];
  default: Record<string, string>[];
  ayuda?: string;
};

export type Campo = CampoSimple | CampoLista;

export type Pagina = {
  key: string;
  label: string;
  /** Nombre del ícono de lucide. El editor lo traduce al componente. */
  icon: string;
  /** Una línea que dice de qué página estamos hablando, para el editor. */
  descripcion: string;
  fields: Campo[];
};

/** Lo que se guarda de una página: un valor por campo. */
export type ContenidoDePagina = Record<string, string | Record<string, string>[]>;

/** El mapa completo: { inicio: {...}, footer: {...} }. Es lo que viaja del servidor. */
export type ContenidoDelSitio = Record<string, ContenidoDePagina>;

// ─────────────────────────────────────────────────────────────────────────────
// Las páginas
// ─────────────────────────────────────────────────────────────────────────────

export const PAGINAS: Pagina[] = [
  {
    key: "inicio",
    label: "Inicio",
    icon: "Home",
    descripcion:
      "La portada: el titular sobre la foto, la franja de valores, las tarjetas de tratamientos y el cierre con los datos del centro.",
    fields: [
      {
        key: "heroEyebrow",
        label: "Línea chica de arriba",
        type: "text",
        default: "Centro de estética",
      },
      /*
       * El titular de la portada nueva (5/10/2026) tiene campo PROPIO, y el de
       * la anterior —`heroTitulo`, acá abajo— no se tocó.
       *
       * No es prolijidad: son dos frases distintas para dos diseños distintos,
       * y `heroTitulo` puede estar guardado en la base con el texto viejo. Con
       * un campo solo, la portada nueva saldría con el titular anterior hasta
       * que alguien lo edite, y si después se vuelve atrás, la anterior saldría
       * con el nuevo y sus asteriscos a la vista. Así cada portada conserva el
       * suyo y el interruptor de index.tsx (`PORTADA_NUEVA`) cambia las dos
       * cosas juntas.
       */
      {
        key: "portadaTitulo",
        label: "Titular grande",
        type: "textarea",
        default: "Tu momento\nde *calma,*\nbelleza y\nbienestar.",
        ayuda:
          "Cada renglón se muestra en una línea distinta. Lo que encierres entre asteriscos sale en dorado: *calma,*",
      },
      {
        key: "portadaBajada",
        label: "Texto debajo del titular",
        type: "textarea",
        default: "Tratamientos personalizados\nen un espacio pensado para vos.",
        ayuda: "Cada renglón se muestra en una línea distinta.",
      },
      {
        key: "heroTitulo",
        label: "Titular grande (portada anterior)",
        type: "textarea",
        default: "Calma,\nbelleza\ny bienestar",
        ayuda:
          "No se muestra con la portada nueva: queda guardado por si se vuelve a la anterior. Cada renglón se muestra en una línea distinta.",
      },
      {
        key: "heroImagen",
        label: "Foto del inicio",
        type: "image",
        default: "",
        ayuda: "Si no subís ninguna, se muestra la foto original de la sala de tratamientos.",
      },
      {
        key: "heroImagenAlt",
        label: "Descripción de la foto",
        type: "text",
        default: "Sala de tratamientos de Shiraf con paredes verde oliva y detalles dorados",
        ayuda:
          "No se ve en pantalla: la leen Google y los lectores de pantalla de personas ciegas.",
      },
      {
        key: "heroBotonPrimario",
        label: "Botón principal",
        type: "text",
        default: "Reservar turno",
      },
      {
        key: "heroBotonSecundario",
        label: "Enlace de al lado",
        type: "text",
        default: "Ver tratamientos",
      },

      // ── La franja de valores, debajo de la foto ──────────────────────────
      {
        key: "valores",
        label: "Franja de valores",
        type: "lista",
        itemLabel: "valor",
        itemFields: [{ key: "texto", label: "Texto", type: "text", default: "" }],
        default: [
          { texto: "Bienestar para cuerpo y mente" },
          { texto: "Tratamientos personalizados" },
          { texto: "Productos de alta calidad" },
          { texto: "Vida sana, belleza real" },
        ],
        ayuda:
          "Los íconos van en orden fijo —hoja, rostro, flor de loto, corazón— y se repiten si agregás más de cuatro. Sin ninguno, la franja no se muestra.",
      },

      // ── Las tarjetas de tratamientos ─────────────────────────────────────
      {
        key: "experienciasEyebrow",
        label: "Línea chica de las tarjetas",
        type: "text",
        default: "Nuestros tratamientos",
      },
      {
        key: "experienciasTitulo",
        label: "Título de las tarjetas",
        type: "text",
        default: "Elegí tu experiencia",
      },
      /*
       * Las tarjetas NO salen del catálogo, y es a propósito.
       *
       * Una categoría del catálogo es un nombre y nada más: no tiene foto ni
       * descripción, y las fotos de los tratamientos son flyers con el texto ya
       * dibujado, que debajo de un título quedan ilegibles. Acá cada tarjeta
       * trae lo suyo, y `categoria` es sólo a dónde lleva al tocarla.
       */
      {
        key: "experiencias",
        label: "Tarjetas de tratamientos",
        type: "lista",
        itemLabel: "tarjeta",
        itemFields: [
          { key: "titulo", label: "Título", type: "text", default: "" },
          { key: "texto", label: "Descripción", type: "text", default: "" },
          { key: "imagen", label: "Foto", type: "image", default: "" },
          { key: "categoria", label: "Categoría que abre", type: "text", default: "" },
        ],
        default: [
          {
            titulo: "Faciales",
            texto: "Limpieza, hidratación y rejuvenecimiento.",
            imagen: "",
            categoria: "",
          },
          {
            titulo: "Masajes y terapias",
            texto: "Relajación, alivio y equilibrio para tu cuerpo.",
            imagen: "",
            categoria: "",
          },
          {
            titulo: "Tratamientos corporales",
            texto: "Reafirmación, tonificación y modelado.",
            imagen: "",
            categoria: "",
          },
          {
            titulo: "Mirada y belleza",
            texto: "Cejas, pestañas y tratamientos especiales.",
            imagen: "",
            categoria: "",
          },
        ],
        ayuda:
          "La foto conviene vertical, y sin texto encima: el título y la descripción se escriben sobre ella. En «Categoría que abre» va el nombre de la categoría tal como está en Servicios; vacío, la tarjeta abre todos los tratamientos.",
      },

      {
        key: "equipoEyebrow",
        label: "Línea chica de la sección del equipo",
        type: "text",
        default: "El equipo",
      },
      {
        key: "equipoTitulo",
        label: "Título de la sección del equipo",
        type: "text",
        default: "Profesionales",
      },
      {
        key: "equipoLink",
        label: "Enlace al final del equipo",
        type: "text",
        default: "Conocer al equipo",
      },

      {
        key: "cierreTitulo",
        label: "Título del cierre",
        type: "textarea",
        default: "Reservá tu próximo\nmomento de calma.",
      },
      {
        key: "cierreTexto",
        label: "Texto del cierre",
        type: "textarea",
        default: "Elegís el tratamiento, el día y la profesional. Nosotros confirmamos el turno.",
      },
      { key: "cierreBoton", label: "Botón del cierre", type: "text", default: "Sacar turno" },

      {
        key: "antesEyebrow",
        label: "Título del recuadro de horarios",
        type: "text",
        default: "Antes de venir",
        ayuda: "Los horarios y la dirección que se muestran ahí se editan en «Datos del centro».",
      },
      {
        key: "antesBotonMapa",
        label: "Botón del mapa",
        type: "text",
        default: "Ver en Google Maps",
      },
      {
        key: "antesBotonWhatsapp",
        label: "Botón de WhatsApp",
        type: "text",
        default: "Escribir por WhatsApp",
      },
    ],
  },

  {
    key: "servicios",
    label: "Servicios",
    icon: "Sparkles",
    descripcion:
      "El encabezado de la carta de tratamientos. Los tratamientos y sus precios se cargan en Servicios, no acá.",
    fields: [
      {
        key: "eyebrow",
        label: "Línea chica de arriba",
        type: "text",
        default: "Carta de tratamientos",
      },
      {
        key: "titulo",
        label: "Titular",
        type: "text",
        default: "Cómo te vas a consentir hoy",
      },
      {
        key: "bajada",
        label: "Texto de al lado del titular",
        type: "textarea",
        default:
          "Cada tratamiento se realiza con cosmética profesional y una evaluación previa de la piel. Los precios pueden ajustarse según la zona a tratar.",
      },
      {
        key: "filtroEyebrow",
        label: "Título del filtro de categorías",
        type: "text",
        default: "Ver por categoría",
      },
    ],
  },

  {
    key: "profesionales",
    label: "Profesionales",
    icon: "Users",
    descripcion:
      "El encabezado del equipo. Los nombres, especialidades y horarios salen de la ficha de cada profesional.",
    fields: [
      { key: "eyebrow", label: "Línea chica de arriba", type: "text", default: "El equipo" },
      { key: "titulo", label: "Titular", type: "text", default: "Profesionales" },
      {
        key: "bajada",
        label: "Texto debajo del titular",
        type: "textarea",
        default:
          "Cada profesional trabaja en tratamientos y horarios específicos. Al reservar podés elegir con quién querés atenderte.",
      },
    ],
  },

  {
    key: "contacto",
    label: "Contacto",
    icon: "MessageCircle",
    descripcion:
      "Los textos de la página de contacto. La dirección, el teléfono y los horarios se editan en «Datos del centro».",
    fields: [
      {
        key: "formEyebrow",
        label: "Línea chica del formulario",
        type: "text",
        default: "Estamos cerca",
      },
      { key: "formTitulo", label: "Título del formulario", type: "text", default: "Escribinos" },
      {
        key: "formBajada",
        label: "Texto debajo del título",
        type: "textarea",
        default:
          "Si no sabés qué tratamiento te conviene, contanos y te asesoramos. Respondemos por WhatsApp dentro del horario de atención.",
      },
      {
        key: "formBoton",
        label: "Botón del formulario",
        type: "text",
        default: "Enviar por WhatsApp",
      },
      {
        key: "formNota",
        label: "Aclaración debajo del botón",
        type: "textarea",
        default: "Se abre WhatsApp con el mensaje ya escrito. Podés revisarlo antes de enviarlo.",
      },
      {
        key: "datosEyebrow",
        label: "Línea chica de los datos",
        type: "text",
        default: "Visitanos",
      },
      { key: "datosTitulo", label: "Título de los datos", type: "text", default: "Dónde estamos" },
      {
        key: "horariosEyebrow",
        label: "Título de la franja de horarios",
        type: "text",
        default: "Horarios de atención",
      },
      {
        key: "horariosNota",
        label: "Aclaración debajo de los horarios",
        type: "textarea",
        default:
          "Los turnos se reservan online y quedan pendientes hasta que el centro los confirma.",
      },
    ],
  },

  {
    key: "datos",
    label: "Datos del centro",
    icon: "MapPin",
    descripcion:
      "La dirección, el WhatsApp, las redes y los horarios. Se usan en TODO el sitio: el inicio, contacto y el pie de página.",
    fields: [
      {
        key: "whatsappNumero",
        label: "WhatsApp (sólo números, con el código de país)",
        type: "text",
        default: CONTACT.whatsappNumber,
        ayuda:
          "Sin +, sin espacios ni guiones. Es el número al que llegan todas las consultas del sitio.",
      },
      {
        key: "telefonoVisible",
        label: "Teléfono como se muestra",
        type: "text",
        default: CONTACT.phoneDisplay,
        ayuda: "Éste es sólo el texto que se lee. El enlace usa el número de arriba.",
      },
      { key: "email", label: "Mail del centro", type: "text", default: CONTACT.email },
      {
        key: "instagram",
        label: "Instagram (usuario)",
        type: "text",
        default: CONTACT.instagram,
      },
      {
        key: "instagramUrl",
        label: "Instagram (enlace completo)",
        type: "text",
        default: CONTACT.instagramUrl,
      },
      { key: "tiktok", label: "TikTok (usuario)", type: "text", default: CONTACT.tiktok },
      {
        key: "tiktokUrl",
        label: "TikTok (enlace completo)",
        type: "text",
        default: CONTACT.tiktokUrl,
      },
      {
        key: "direccion",
        label: "Dirección que se muestra en el sitio",
        type: "text",
        default: CONTACT.address,
        ayuda:
          "La que ve cualquiera que entre a la web, sin haber reservado nada. Podés poner sólo el barrio si no querés la dirección exacta a la vista.",
      },
      { key: "ciudad", label: "Ciudad", type: "text", default: CONTACT.city },
      /*
       * La dirección de verdad, la que necesita quien SÍ tiene turno.
       *
       * ── POR QUÉ SON DOS CAMPOS Y NO UNO ───────────────────────────────────
       *
       * 14/9/2026. El centro no quiere la dirección exacta a la vista en el
       * sitio —puso "Barrio Belgrano"— y está bien: quien entra a mirar
       * tratamientos no necesita saber el piso y la oficina.
       *
       * Pero a la clienta que reservó hay que decirle a dónde ir, y hasta hoy
       * los avisos usaban el MISMO campo que el sitio. O sea que esconder la
       * dirección en la web dejaba a las clientas con turno sin saber la
       * dirección: el mail decía "Te esperamos en Barrio Belgrano".
       *
       * No se puede resolver con un solo campo porque son dos públicos
       * distintos. Éste no aparece en ninguna pantalla del sitio: lo leen sólo
       * el mail y el WhatsApp de los avisos de turno.
       */
      {
        key: "direccionExacta",
        label: "Dirección completa, para los avisos de turno",
        type: "text",
        default: CONTACT.address,
        ayuda:
          "Con piso y oficina. NO se muestra en el sitio: va sólo en el mail y el WhatsApp de quien ya tiene turno, que necesita saber a dónde ir.",
      },
      {
        key: "mapsUrl",
        label: "Enlace de Google Maps",
        type: "text",
        default: CONTACT.mapsUrl,
        ayuda: "El que abre Maps en una pestaña nueva, desde el inicio y desde Contacto.",
      },
      {
        key: "mapsEmbedUrl",
        label: "Enlace del mapa incrustado",
        type: "text",
        default: CONTACT.mapsEmbedUrl,
        ayuda:
          "El mapa que se ve dentro de la página de Contacto. Es la misma dirección con «&output=embed» al final.",
      },
      {
        key: "horarios",
        label: "Horarios de atención",
        type: "lista",
        itemLabel: "horario",
        itemFields: [
          { key: "dias", label: "Días", type: "text", default: "" },
          { key: "horas", label: "Horario", type: "text", default: "" },
        ],
        // Los mismos tres renglones que OPENING_HOURS, que es de donde salían.
        // Escribir "Cerrado" en el horario lo muestra más apagado, igual que hoy.
        default: OPENING_HOURS.map((h) => ({ dias: h.days, horas: h.hours })),
        ayuda: "Si un día está cerrado, escribí «Cerrado» en el horario y se muestra más apagado.",
      },
    ],
  },

  {
    key: "footer",
    label: "Pie de página",
    icon: "PanelBottom",
    descripcion:
      "Los títulos de las columnas del pie y el copyright. Los datos de contacto salen de «Datos del centro».",
    fields: [
      {
        key: "navTitulo",
        label: "Título de la columna de enlaces",
        type: "text",
        default: "Navegación",
      },
      {
        key: "datosTitulo",
        label: "Título de la columna de datos",
        type: "text",
        default: "Visitanos",
      },
      {
        key: "copyright",
        label: "Texto del copyright",
        type: "text",
        default: "Shiraf. Todos los derechos reservados.",
        ayuda: "El «©» y el año se agregan solos adelante.",
      },
    ],
  },
];

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

/** Las claves válidas. El servidor rechaza cualquier otra. */
export const CLAVES_DE_PAGINA = PAGINAS.map((p) => p.key);

export function esquemaDe(pagina: string): Pagina | undefined {
  return PAGINAS.find((p) => p.key === pagina);
}

export function esPaginaValida(pagina: string): boolean {
  return CLAVES_DE_PAGINA.includes(pagina);
}

/** Todo lo que dice una página si nadie la editó. */
export function defaultsDe(pagina: string): ContenidoDePagina {
  const esquema = esquemaDe(pagina);
  if (!esquema) return {};

  const salida: ContenidoDePagina = {};
  for (const campo of esquema.fields) {
    // Las listas se copian, no se referencian: el editor las muta al agregar y
    // borrar ítems, y si compartieran el array con el esquema, editar una vez
    // cambiaría el default para toda la sesión.
    salida[campo.key] =
      campo.type === "lista" ? campo.default.map((item) => ({ ...item })) : campo.default;
  }
  return salida;
}

/**
 * Lo guardado, apoyado sobre los defaults.
 *
 * ⚠️ El orden importa y no es intercambiable: los defaults van primero y lo
 * guardado los pisa. Al revés, editar una página no cambiaría nada — y es un
 * error que se ve recién en producción, con el centro preguntando por qué no se
 * guarda lo que guardó.
 *
 * Un campo guardado en vacío ("") SE RESPETA: si el centro borró un texto, es
 * porque no lo quiere, y volver a poner el default sería no dejarlo borrar
 * nunca.
 */
export function conDefaults(
  pagina: string,
  guardado: ContenidoDePagina | undefined,
): ContenidoDePagina {
  const base = defaultsDe(pagina);
  if (!guardado) return base;

  const salida = { ...base };
  for (const campo of esquemaDe(pagina)?.fields ?? []) {
    const valor = guardado[campo.key];
    if (valor === undefined || valor === null) continue;
    // Se verifica la FORMA además de la presencia: una clave que quedó guardada
    // como texto cuando el campo pasó a ser lista reventaría el `.map()` de la
    // página con "valor.map is not a function", que es un error de render — o
    // sea, pantalla en blanco.
    if (campo.type === "lista") {
      if (Array.isArray(valor)) salida[campo.key] = valor;
    } else if (typeof valor === "string") {
      salida[campo.key] = valor;
    }
  }
  return salida;
}

/**
 * El texto de un campo, siempre como string.
 *
 * Existe para que el JSX no tenga que hacer `String(c.titulo)` en cada uso: el
 * valor de un campo puede ser una lista, así que TypeScript no lo deja pasar
 * derecho a un `<p>`.
 */
export function texto(contenido: ContenidoDePagina, key: string): string {
  const valor = contenido[key];
  return typeof valor === "string" ? valor : "";
}

/** Los ítems de un campo lista, siempre como array. */
export function lista(contenido: ContenidoDePagina, key: string): Record<string, string>[] {
  const valor = contenido[key];
  return Array.isArray(valor) ? valor : [];
}

/**
 * Un texto de varias líneas, cortado en renglones para renderizar.
 *
 * Los titulares del sitio están partidos a mano —"Calma, / belleza / y
 * bienestar"— y ese corte es una decisión de diseño, no un accidente del ancho
 * de pantalla. Guardarlos en un textarea y renderizarlos con `<br />` mantiene
 * esa decisión en manos de quien escribe el texto.
 */
export function renglones(valor: string): string[] {
  return valor.split("\n");
}

/**
 * Un renglón partido en tramos, para pintar de dorado lo que venga entre
 * asteriscos: "de *calma,*" → "de " normal y "calma," en dorado.
 *
 * Es la única marca que entiende un titular, y es una sola a propósito: el
 * campo lo escribe la dueña en un textarea, no en un editor. Un asterisco sin
 * su par deja en dorado todo lo que sigue hasta el final del renglón, que se ve
 * en el acto y se arregla cerrándolo.
 */
export function tramos(renglon: string): { texto: string; dorado: boolean }[] {
  return renglon
    .split("*")
    .map((texto, i) => ({ texto, dorado: i % 2 === 1 }))
    .filter((tramo) => tramo.texto !== "");
}
