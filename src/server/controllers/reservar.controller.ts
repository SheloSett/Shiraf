import { prisma } from "@/server/db";
import { json, type Ctx } from "@/server/http";
import { ausenciasDe, horariosOcupados } from "@/server/services/agenda.service";
import { accesoDe } from "@/server/services/authz.service";
import { cierresDelCentro } from "@/server/services/cierres.service";
import { validarTurno } from "@/server/services/turnos.service";
import {
  claveDeTelefono,
  enlaceDeInvitada,
  MAX_TURNOS_ABIERTOS_POR_TELEFONO,
  turnosDelTelefono,
} from "@/server/services/invitadas.service";
import {
  sacarLaSesionSiguiente,
  sesionAnterior,
  sesionesPendientes,
} from "@/server/services/series.service";
import { comoFecha, comoHora } from "@/server/serializar";
import { avisarSinEsperar } from "@/lib/notifications.server";
import type { RtaDisponibilidad, RtaReserva, RtaSesionesPendientes } from "@/lib/api-tipos";

/**
 * Reservar un turno.
 *
 * 5/10/2026 — decía «Sólo hace falta sesión: es la pantalla de la clienta». Ya
 * no hace falta ni eso: se puede reservar con nombre y teléfono, sin cuenta.
 * La dueña lo pidió porque registrarse era la traba — las clientas terminaban
 * pidiéndole el turno a la secretaria. Qué cambia para quien reserva así está
 * en `reservar`, más abajo.
 */

/**
 * Los horarios de la profesional y los ratos que ya tiene ocupados.
 *
 * ── 🔴 LO QUE SE DEVUELVE DE LOS TURNOS AJENOS ES SÓLO CUÁNDO Y CUÁNTO ────
 *
 * Y eso es toda la regla. En Supabase esto no se podía consultar derecho: la
 * policy `read appointments` sólo deja ver los propios, así que leer la tabla
 * devolvía los horarios de las demás clientas **como libres**. Por eso existía
 * la función `professional_busy_slots`, con SECURITY DEFINER, que devolvía nada
 * más que inicio y duración.
 *
 * Acá pasa lo mismo pero al revés: sin RLS, la consulta traería todo. **El
 * recorte es este `select`**, y por eso el endpoint devuelve
 * `{ starts_at, duration_minutes }` y nunca la fila. Quién reservó, qué
 * tratamiento y con qué nota no son asunto de quien está eligiendo horario.
 *
 * Está garantizado por `horariosOcupados()`, que ya devuelve sólo esos campos:
 * **no lo cambies para que devuelva el turno entero.** El `buffer_minutes` que
 * se sumó el 31/8/2026 entra en la misma promesa: es cuánto tarda la cabina en
 * quedar libre, no algo de la clienta que la ocupó.
 *
 * Las AUSENCIAS salen igual de acotadas: de tal día a tal día, sin el motivo.
 * Por qué la profesional no viene es asunto interno del centro y se queda en
 * `equipo.controller`.
 */
export async function disponibilidad(ctx: Ctx) {
  const profesionalId = ctx.url.searchParams.get("profesional");
  const fecha = ctx.url.searchParams.get("fecha");
  if (!profesionalId || !fecha) return json({ error: "Falta la profesional o la fecha." }, 400);

  /**
   * El turno que se está moviendo, para que no se cuente a sí mismo. Lo manda
   * el diálogo de reprogramar; al reservar de cero no viene.
   *
   * No se valida de quién es, y no hace falta — mirar el 🔴 de arriba, que
   * dice qué se devuelve: `{ starts_at, duration_minutes }` y nada más.
   * Mandar un id ajeno no revela nada nuevo, sólo ESCONDE un rato ocupado; y
   * quien se esconda un horario ocupado lo único que consigue es que la
   * reserva le rebote con el 409 del trigger, que es la única autoridad sobre
   * el solape. Pedir sesión para esto sería pedirla para nada.
   */
  const excluir = ctx.url.searchParams.get("excluir");

  const desde = new Date(fecha);
  if (Number.isNaN(desde.getTime())) return json({ error: "Esa fecha no se entiende." }, 400);
  desde.setHours(0, 0, 0, 0);
  const hasta = new Date(desde);
  hasta.setDate(hasta.getDate() + 1);

  /**
   * Hasta qué día traer las AUSENCIAS. Sólo las ausencias.
   *
   * El calendario del panel pinta un mes entero y necesita saber qué días la
   * profesional no viene, no sólo el del día elegido: sin esto, una semana de
   * vacaciones se mostraría como disponible hasta que alguien hiciera clic.
   *
   * ── LOS TURNOS OCUPADOS NO SE ENSANCHAN ──────────────────────────────────
   *
   * `hasta` sigue siendo el día siguiente para `horariosOcupados`. Lo que sale
   * de ahí son los ratos ocupados de la agenda —anónimos, pero ratos ocupados— y
   * no hay motivo para entregar un mes de eso cuando lo que se está armando son
   * los horarios de UN día. Las ausencias son otra cosa: es "no vengo", que el
   * sitio ya publica de mil maneras.
   *
   * El tope de 62 días es para que el parámetro no se convierta en un
   * exportador: dos meses es lo máximo que un calendario muestra de una.
   */
  const TOPE_DE_DIAS = 62;
  const crudoHasta = ctx.url.searchParams.get("hasta");
  const finDeAusencias = crudoHasta ? new Date(crudoHasta) : null;
  const hastaAusencias =
    finDeAusencias && !Number.isNaN(finDeAusencias.getTime()) && finDeAusencias > desde
      ? new Date(
          Math.min(finDeAusencias.getTime(), desde.getTime() + TOPE_DE_DIAS * 24 * 60 * 60 * 1000),
        )
      : hasta;

  // 5/9/2026 — se suman los días que el centro no abre, con la misma ventana
  // que las ausencias: los necesita el calendario del mes igual que a ellas.
  // La línea vieja queda comentada por la regla de este repo.
  //   const [horarios, ocupados, ausencias] = await Promise.all([
  const [horarios, ocupados, ausencias, cierres] = await Promise.all([
    prisma.professional_schedules.findMany({
      where: { professional_id: profesionalId },
      select: { weekday: true, start_time: true, end_time: true },
      orderBy: [{ weekday: "asc" }, { start_time: "asc" }],
    }),
    horariosOcupados(profesionalId, desde, hasta, excluir ?? undefined),
    ausenciasDe(profesionalId, desde, hastaAusencias),
    cierresDelCentro(desde, hastaAusencias),
  ]);

  return json({
    schedules: horarios.map((h) => ({
      weekday: h.weekday,
      start_time: comoHora(h.start_time),
      end_time: comoHora(h.end_time),
    })),
    busy: ocupados.map((o) => ({
      starts_at: o.empiezaEn.toISOString(),
      duration_minutes: o.minutos,
      buffer_minutes: o.margen,
    })),
    /*
     * Las ausencias de la profesional Y los días que el centro no abre, en la
     * misma lista (5/9/2026).
     *
     * Mezclados a propósito. Los cuatro lugares que leen esto —`buildSlots`, el
     * calendario del mes, el selector del panel y el diálogo con el que la
     * clienta se mueve el turno— hacen con cada tramo exactamente lo mismo:
     * tachar el día. Ninguno necesita saber si es que ella no viene o que no
     * viene nadie. Un campo aparte habría obligado a tocar los cuatro para
     * concatenar dos listas, y el que se olvidara seguiría ofreciendo el
     * feriado como disponible.
     *
     * El día que una pantalla necesite distinguirlos —para decir "el centro
     * está cerrado" en vez de "no atiende"—, ahí se gana el campo propio.
     *
     *   ausencias: ausencias.map((a) => ({
     */
    ausencias: [...ausencias, ...cierres].map((a) => ({
      starts_on: comoFecha(a.empiezaEl),
      ends_on: comoFecha(a.terminaEl),
    })),
  } satisfies RtaDisponibilidad);
}

/**
 * Reservar.
 *
 * Tres cosas que no las decide quien reserva:
 *
 * 1. **`client_id` sale de la sesión.** Es la traducción de `auth.uid()`: si
 *    viniera en el cuerpo, cualquiera reservaría a nombre de otra.
 * 2. **El precio y la duración los fija `validarTurno()`**, que los lee del
 *    tratamiento. El precio queda congelado al día de la reserva, que es el
 *    sentido de que la columna exista. En Supabase esto lo hacía el trigger
 *    `validate_appointment`.
 * 3. **El solape lo sigue frenando la base**, con `check_appointment_overlap`.
 *    No se chequea acá a propósito: "fijate si está libre" y después "insertá"
 *    son dos operaciones, y entre una y otra entra otra reserva. Es la razón
 *    por la que ese trigger se quedó en SQL — ver la Fase 3 del plan.
 *
 * ── SIN CUENTA (5/10/2026) ────────────────────────────────────────────────
 *
 * Si no hay sesión, el turno queda a nombre de una INVITADA: `guest_name` y
 * `guest_phone`, que son los mismos campos que ya usaba el centro para anotar a
 * alguien por teléfono. No se crea ninguna cuenta ni se pide mail.
 *
 * El punto 1 sigue valiendo al pie de la letra: con sesión, el turno es de la
 * sesión y los datos de invitada que vengan en el cuerpo se ignoran. Nadie con
 * cuenta puede reservar "como otra".
 *
 * Lo que se le exige a la invitada, y por qué cada cosa:
 *
 *   · **Un celular argentino que sirva para WhatsApp.** No es burocracia: es la
 *     dirección. Sin mail, el comprobante y el enlace a sus turnos le llegan
 *     por ahí o no le llegan.
 *   · **No más de `MAX_TURNOS_ABIERTOS_POR_TELEFONO` turnos por venir** con el
 *     mismo número. Es el freno a los turnos falsos; el otro es el tope por
 *     conexión, que está en la ruta.
 *
 * Y lo que NO se le devuelve: el enlace a sus turnos. Viaja sólo adentro del
 * WhatsApp, porque acá no hay ninguna prueba de que el teléfono que escribió
 * sea suyo. Ver `guest_links` en el esquema.
 *
 * Los avisos de este turno los dispara el servidor, no la pantalla: el porqué
 * está en `avisarSinEsperar`.
 */
export async function reservar(ctx: Ctx) {
  const serviceId = ctx.body["service_id"];
  const profesionalId = ctx.body["professional_id"];
  const cuando = ctx.body["starts_at"];
  const nota = typeof ctx.body["client_notes"] === "string" ? ctx.body["client_notes"].trim() : "";

  if (typeof serviceId !== "string" || typeof cuando !== "string") {
    return json({ error: "Faltan datos del turno." }, 400);
  }
  const starts_at = new Date(cuando);
  if (Number.isNaN(starts_at.getTime())) return json({ error: "Ese horario no se entiende." }, 400);

  /*
   * Qué opción del tratamiento se eligió, cuando el tratamiento tiene.
   *
   * Viaja el ID y NUNCA el precio ni la duración: los busca `validarTurno` en
   * la base, por lo mismo que ya hacía con los del tratamiento. Ver el punto 2
   * de arriba, que ahora vale para las dos cosas.
   */
  const variantId = typeof ctx.body["variant_id"] === "string" ? ctx.body["variant_id"] : null;

  /*
   * De quién es el turno: de la sesión si hay, y si no de quien dejó su nombre
   * y su teléfono. Los dos casos escriben campos distintos y nunca los dos a
   * la vez — el tipo lo dice para que el `create` de abajo no pueda mezclarlos.
   */
  let deQuien: { client_id: string } | { guest_name: string; guest_phone: string };

  if (ctx.user) {
    deQuien = { client_id: ctx.user.id };
  } else {
    const nombre = typeof ctx.body["guest_name"] === "string" ? ctx.body["guest_name"].trim() : "";
    const telefono =
      typeof ctx.body["guest_phone"] === "string" ? ctx.body["guest_phone"].trim() : "";

    // Tres letras es el mínimo para que no sea una inicial; el máximo es para
    // que el campo no sirva de buzón: el nombre sale en el panel y en los
    // avisos al centro.
    if (nombre.length < 3 || nombre.length > 80) {
      return json({ error: "Decinos tu nombre y apellido." }, 400);
    }

    const clave = claveDeTelefono(telefono);
    if (!clave || telefono.length > 30) {
      return json(
        {
          error:
            "Ese teléfono no parece un celular argentino. Escribilo con el código de área, por ejemplo 11 2345 6789.",
        },
        400,
      );
    }

    const abiertos = await turnosDelTelefono(clave, { soloAbiertos: true });
    if (abiertos.length >= MAX_TURNOS_ABIERTOS_POR_TELEFONO) {
      return json(
        {
          error: `Ya hay ${MAX_TURNOS_ABIERTOS_POR_TELEFONO} turnos por venir con ese teléfono. Para sacar otro, escribinos.`,
        },
        422,
      );
    }

    // El teléfono se guarda como lo escribió: es lo que va a leer el centro, y
    // normalizarlo acá le borraría la forma en que la persona se lo sabe.
    deQuien = { guest_name: nombre, guest_phone: telefono };
  }

  // Antes: `await validarTurno(await accesoDe(ctx.user!.id), {`. Sin cuenta no
  // hay acceso que mirar, y `validarTurno` ya sabía recibir null: es "alguien
  // que no es del centro", que es lo que una invitada es.
  const validado = await validarTurno(ctx.user ? await accesoDe(ctx.user.id) : null, {
    service_id: serviceId,
    variant_id: variantId,
    professional_id: typeof profesionalId === "string" ? profesionalId : null,
    starts_at,
  });

  /*
   * El turno NACE CONFIRMADO, y sin `seen_at`.
   *
   * Ninguna de las dos cosas se escribe acá: las pone el esquema. El `status`
   * cae en `@default(confirmed)` —desde el 6/9/2026, cuando el centro pidió que
   * reservar por el sitio no necesitara que nadie aceptara nada— y `seen_at`
   * queda en NULL, que es exactamente lo que hace que este turno aparezca en la
   * pestaña «Sin ver» del panel.
   *
   * Es el único lugar del código donde un turno nace sin ver. Los dos altas del
   * panel (`turnos.controller`) escriben `seen_at` a mano: el centro no tiene
   * que avisarse de lo que acaba de cargar él mismo.
   */
  const creado = await prisma.appointments.create({
    data: {
      // Antes: `client_id: ctx.user!.id,`. Ahora puede ser una invitada.
      ...deQuien,
      service_id: serviceId,
      variant_id: variantId,
      professional_id: typeof profesionalId === "string" ? profesionalId : null,
      starts_at,
      // El tope es por la invitada: la nota la lee el centro y sin cuenta no
      // hay a quién reclamarle un texto de diez páginas.
      client_notes: nota.slice(0, 600) || null,
      ...validado,
    },
    select: { id: true },
  });

  const invitada = !ctx.user;

  // Con cuenta, los dos avisos los pide la pantalla, como siempre. Sin cuenta
  // salen de acá. Primero el de ella, que es quien está mirando el teléfono.
  if (invitada) avisarSinEsperar(creado.id, ["requested", "new-request"]);

  /*
   * Fuera de producción, el enlace de la invitada se escribe en la consola del
   * servidor.
   *
   * Es para poder probar «Mis turnos» en la máquina de desarrollo, donde no hay
   * chip de WhatsApp y el enlace no tiene por dónde llegar: se reserva sin
   * cuenta, se copia de la terminal y se abre.
   *
   * 🔴 SÓLO fuera de producción, y el `if` no es decorativo: el enlace es la
   * llave del historial de esa persona. En el log del VPS lo leería cualquiera
   * con acceso al servidor. Y sigue sin viajar en la respuesta, acá tampoco.
   */
  if (invitada && process.env["NODE_ENV"] !== "production" && "guest_phone" in deQuien) {
    void enlaceDeInvitada(deQuien.guest_phone)
      .then((enlace) => console.log(`[dev] Enlace de la invitada: ${enlace ?? "(sin enlace)"}`))
      .catch((error: unknown) => console.error("[dev] No se pudo armar el enlace:", error));
  }

  // return json({ id: creado.id });
  return json({ id: creado.id, invitada } satisfies RtaReserva);
}

// ─────────────────────────────────────────────────────────────────────────────
// La sesión que sigue, sacada por la clienta
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Las sesiones que le falta sacar a quien está conectada.
 *
 * Es lo que alimenta el cartel del sitio y el aviso de la pantalla de reserva.
 * Sale de la sesión y de nada más, igual que «Mi cuenta».
 */
export async function misSesionesPendientes(ctx: Ctx) {
  return json({
    pendientes: await sesionesPendientes({ client_id: ctx.user!.id }),
  } satisfies RtaSesionesPendientes);
}

/**
 * La clienta saca la sesión que sigue de un tratamiento suyo.
 *
 * Manda de qué turno parte —la sesión que ya se hizo— y el horario. Todo lo
 * demás lo copia el servidor de ese turno. Las reglas, y en qué se diferencian
 * de las del panel, están en `sacarLaSesionSiguiente`.
 */
export async function sacarMiSesionSiguiente(ctx: Ctx) {
  const id = ctx.body["appointment_id"];
  const cuando = ctx.body["starts_at"];
  if (typeof id !== "string" || typeof cuando !== "string") {
    return json({ error: "Faltan datos del turno." }, 400);
  }
  const starts_at = new Date(cuando);
  if (Number.isNaN(starts_at.getTime())) return json({ error: "Ese horario no se entiende." }, 400);

  const userId = ctx.user!.id;

  // 404 y no 403 si es de otra: decir "existe pero no es tuyo" ya confirma que
  // ese turno existe. Mismo criterio que cancelar.
  const anterior = await sesionAnterior(id, { client_id: userId });
  if (!anterior) return json({ error: "Ese turno no existe." }, 404);

  const profesionalId = ctx.body["professional_id"];
  const nota = typeof ctx.body["client_notes"] === "string" ? ctx.body["client_notes"].trim() : "";

  const creado = await sacarLaSesionSiguiente(anterior, {
    starts_at,
    professional_id: typeof profesionalId === "string" && profesionalId ? profesionalId : null,
    client_notes: nota.slice(0, 600) || null,
    acceso: await accesoDe(userId),
  });

  return json(creado);
}
