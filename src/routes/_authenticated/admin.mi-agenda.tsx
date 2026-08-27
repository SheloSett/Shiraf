import { useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, Quote, Search, X } from "lucide-react";
import { EstadoTurno } from "@/components/admin/estado-turno";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { WhatsappIcon } from "@/components/whatsapp-icon";
import { api } from "@/lib/api";
import type { RtaMiAgenda } from "@/lib/api-tipos";
import { toWhatsappNumber } from "@/lib/notifications";
import { aSlug, formatDay, formatTime, toDateKey } from "@/lib/shiraf";

export const Route = createFileRoute("/_authenticated/admin/mi-agenda")({
  component: MyAgenda,
});

/** Cuántos días adelante se piden. El mismo número que dice el subtítulo. */
const DAYS_AHEAD = 30;

/**
 * Cuántos días atrás trae el historial.
 *
 * Medio año: alcanza para "¿cuándo vino la última vez?" y para ver una serie de
 * sesiones seguidas, que es para lo que se mira. El servidor además corta en 300
 * filas (`TOPE_DEL_HISTORIAL`), así que este número no puede hacer explotar nada
 * por más que se suba.
 */
const DAYS_BACK = 180;

type Vista = "proximos" | "historial";

/**
 * El valor del filtro «todos los tratamientos».
 *
 * No puede ser la cadena vacía: el `Select` de Radix la usa para representar
 * «sin elegir» y un `SelectItem` con `value=""` tira. Por eso un centinela que
 * ningún tratamiento real puede tener.
 */
const TODOS = "__todos__";

type AgendaRow = {
  appointment_id: string;
  appointment_start: string;
  appointment_minutes: number;
  appointment_state: string;
  service_name: string;
  client_name: string | null;
  client_phone: string | null;
  clinical_notes: string | null;
  booking_note: string | null;
  client_is_guest: boolean;
};

/**
 * "Hoy", "Mañana", "Ayer" o el día escrito.
 *
 * Vale la pena el caso especial: en una lista de turnos, lo primero que se
 * busca es qué toca ahora, y "Hoy" se encuentra de un vistazo donde "martes 19
 * de agosto" hay que leerlo y compararlo con la fecha de la compu.
 *
 * "Ayer" se agregó con el historial: esa lista se lee del último para atrás, así
 * que lo más reciente —y lo que más se mira— cae justo ahí.
 */
function dayLabel(iso: string): string {
  const key = toDateKey(new Date(iso));
  const today = new Date();
  const tomorrow = new Date();
  tomorrow.setDate(today.getDate() + 1);
  const yesterday = new Date();
  yesterday.setDate(today.getDate() - 1);

  if (key === toDateKey(today)) return "Hoy";
  if (key === toDateKey(tomorrow)) return "Mañana";
  if (key === toDateKey(yesterday)) return "Ayer";
  return formatDay(iso);
}

/** Sólo los dígitos, para comparar teléfonos escritos de cualquier forma. */
function soloDigitos(valor: string): string {
  return valor.replace(/\D/g, "");
}

/**
 * La agenda propia de una profesional.
 *
 * Es la única sección del panel que no depende de una casilla de permisos: la
 * habilita tener la ficha de profesional atada a la cuenta, y eso lo hace la
 * dueña desde Accesos. Ver la migración 20260818020000.
 *
 * Todo lo que se muestra llega de `/api/turnos/mi-agenda`, que ya viene filtrado
 * por el servidor a partir de la sesión. Acá no hay ningún `professional_id` que
 * alguien pueda cambiar sin darse cuenta: la pantalla no sabría cómo pedir la
 * agenda de otra persona ni queriendo. Eso vale para las DOS vistas — el
 * historial pasa por la misma ruta y la misma regla.
 */
function MyAgenda() {
  /*
   * La pestaña, la búsqueda y el filtro viven en `useState` y no en la URL.
   *
   * Es distinto de «Turnos», que sí los tiene en la URL, y el motivo es que allá
   * hacía falta: el calendario enlaza a un turno puntual con `?turno=`, y con el
   * estado local ese enlace abría la pestaña equivocada. Acá no entra nadie por
   * enlace — es la agenda de uno mismo, se llega por el menú — así que la URL no
   * tiene que cargar con nada. Si algún día se enlaza a esta pantalla desde
   * afuera, esto pasa a `validateSearch` como allá.
   */
  const [vista, setVista] = useState<Vista>("proximos");
  const [busqueda, setBusqueda] = useState("");
  const [tratamiento, setTratamiento] = useState<string>(TODOS);

  const esHistorial = vista === "historial";
  const dias = esHistorial ? DAYS_BACK : DAYS_AHEAD;

  const agenda = useQuery({
    // La vista entra en la clave: son dos listas distintas y las dos quedan en
    // caché, así que ir y volver entre pestañas no vuelve a pedir nada.
    queryKey: ["my-agenda", vista],
    // Un turno nuevo lo carga otra persona desde otra pantalla, así que esto se
    // refresca solo: la profesional deja el panel abierto en la cabina.
    staleTime: 60_000,
    refetchOnWindowFocus: true,
    // El refresco automático es sólo para los próximos. El historial es pasado:
    // no le va a aparecer una fila sola mientras se lo mira, y repreguntarlo
    // cada cinco minutos es traer 300 filas para nada.
    refetchInterval: esHistorial ? false : 5 * 60_000,
    queryFn: async () =>
      (
        await api<RtaMiAgenda>(
          `/api/turnos/mi-agenda?dias=${dias}${esHistorial ? "&vista=historial" : ""}`,
        )
      ).turnos,
  });

  const filas: AgendaRow[] = useMemo(() => agenda.data ?? [], [agenda.data]);

  /*
   * El reloj, para el cartelito de estado del historial.
   *
   * `Date.now()` derecho, igual que en «Turnos» y por el mismo motivo: las filas
   * sólo existen cuando la consulta ya respondió, o sea siempre en el navegador.
   * El servidor nunca llega a pintar una, así que no hay dos renders que puedan
   * discrepar y no hace falta el useState-tras-hidratar del calendario.
   */
  const ahora = Date.now();

  /*
   * Las opciones del filtro salen de los turnos que están en pantalla, no del
   * catálogo completo de servicios.
   *
   * Es a propósito: un desplegable con los 40 tratamientos del centro obliga a
   * buscar entre 37 que no le aparecen nunca a esta profesional. Con esto, cada
   * una ve los suyos. La contra es que las opciones cambian al cambiar de
   * pestaña —el historial tiene tratamientos que los próximos no— y por eso el
   * filtro se limpia solo cuando eso pasa; ver `cambiarVista`.
   */
  const tratamientos = useMemo(
    () => [...new Set(filas.map((f) => f.service_name))].sort((a, b) => a.localeCompare(b, "es")),
    [filas],
  );

  const filtradas = useMemo(() => {
    /*
     * El texto se normaliza con `aSlug`, que ya saca tildes y mayúsculas: así
     * "Maria" encuentra a "María" y no hay que escribir una segunda vez la misma
     * regla de acentos que ya vive en `shiraf.ts`.
     *
     * Los teléfonos se comparan aparte, sólo por dígitos, porque `aSlug` deja
     * los espacios como guiones: quien escribe "11 3175" buscando el
     * "1131754091" no encontraría nada si se comparara el mismo texto para las
     * dos cosas.
     *
     * Si alguien escribe algo que no deja ni letras ni dígitos ("+++"), las dos
     * quedan vacías y no se filtra nada. Es correcto: no hay con qué buscar.
     */
    const texto = aSlug(busqueda);
    const digitos = soloDigitos(busqueda);

    return filas.filter((f) => {
      if (tratamiento !== TODOS && f.service_name !== tratamiento) return false;
      if (!texto && !digitos) return true;

      const nombre = aSlug(f.client_name ?? "");
      const telefono = soloDigitos(f.client_phone ?? "");
      return (
        (texto !== "" && nombre.includes(texto)) || (digitos !== "" && telefono.includes(digitos))
      );
    });
  }, [filas, busqueda, tratamiento]);

  // Agrupadas por día, respetando el orden que ya trae la consulta —ascendente
  // en los próximos, descendente en el historial—: un Map conserva el orden de
  // inserción, así que la pantalla no vuelve a ordenar nada y las dos vistas se
  // leen en la dirección que corresponde.
  const days = useMemo(() => {
    const byDay = new Map<string, AgendaRow[]>();
    for (const row of filtradas) {
      const key = toDateKey(new Date(row.appointment_start));
      byDay.set(key, [...(byDay.get(key) ?? []), row]);
    }
    return [...byDay.values()];
  }, [filtradas]);

  const total = filas.length;
  const visibles = filtradas.length;
  const hayFiltro = busqueda.trim() !== "" || tratamiento !== TODOS;

  /** Cambiar de pestaña limpia el filtro de tratamiento: ver `tratamientos`. */
  function cambiarVista(siguiente: Vista) {
    setVista(siguiente);
    setTratamiento(TODOS);
  }

  function limpiarFiltros() {
    setBusqueda("");
    setTratamiento(TODOS);
  }

  return (
    <div>
      <div>
        <p className="text-eyebrow text-muted-foreground">
          {esHistorial ? "Turnos ya pasados" : "Tus próximos turnos"}
        </p>
        <h1 className="mt-3 font-display text-4xl text-foreground">Mi agenda</h1>
      </div>

      <p className="mt-4 max-w-xl text-sm leading-relaxed text-muted-foreground">
        {esHistorial
          ? `Lo que atendiste en los últimos ${DAYS_BACK} días, del último para atrás. Entran también los cancelados: que una clienta haya cancelado es parte de su historia.`
          : `Los turnos asignados a vos para los próximos ${DAYS_AHEAD} días. Los confirma y los cancela el centro; acá los ves para saber qué te toca.`}
      </p>

      <Tabs value={vista} onValueChange={(v) => cambiarVista(v as Vista)} className="mt-8">
        <TabsList>
          <TabsTrigger value="proximos">Próximos</TabsTrigger>
          <TabsTrigger value="historial">Historial</TabsTrigger>
        </TabsList>
      </Tabs>

      {/*
        Los filtros aparecen sólo cuando hay algo que filtrar. Con la agenda
        vacía —o mientras carga— una barra de búsqueda es una promesa de que hay
        contenido: se ve el campo, se escribe, no pasa nada.
      */}
      {total > 0 && (
        <div className="mt-6 flex flex-wrap items-center gap-3">
          <div className="relative min-w-0 flex-1 sm:max-w-xs">
            <Search className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={busqueda}
              onChange={(e) => setBusqueda(e.target.value)}
              placeholder="Buscar clienta o teléfono"
              // `type="search"` y no "text": en el celular abre el teclado con la
              // lupa en vez del enter, y el navegador ofrece limpiar el campo.
              type="search"
              aria-label="Buscar por nombre de clienta o teléfono"
              className="pl-9"
            />
          </div>

          <Select value={tratamiento} onValueChange={setTratamiento}>
            <SelectTrigger className="w-full sm:w-64" aria-label="Filtrar por tratamiento">
              <SelectValue placeholder="Todos los tratamientos" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={TODOS}>Todos los tratamientos</SelectItem>
              {tratamientos.map((t) => (
                <SelectItem key={t} value={t}>
                  {t}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          {hayFiltro && (
            <Button variant="ghost" size="sm" onClick={limpiarFiltros}>
              <X className="h-4 w-4" />
              Limpiar
            </Button>
          )}

          {/* El conteo va al lado de los filtros y no arriba de la lista: es la
              respuesta a lo que se acaba de escribir. */}
          <p className="text-sm text-muted-foreground tabular-nums">
            {hayFiltro ? `${visibles} de ${total}` : `${total} ${total === 1 ? "turno" : "turnos"}`}
          </p>
        </div>
      )}

      {agenda.isLoading && <p className="mt-10 text-sm text-muted-foreground">Cargando…</p>}

      {/*
        El error va separado del vacío y no junto con él, que es el mismo bug
        que ya se corrigió en los horarios de "Nuevo turno": si una consulta que
        falla se dibuja igual que una que volvió sin filas, la pantalla dice "no
        tenés turnos" cuando lo que pasó es que no se pudo preguntar. Y ahí nadie
        revisa: se confía y se pierde el turno.
      */}
      {agenda.isError && (
        <div className="mt-10 max-w-xl rounded-sm border border-destructive/40 bg-destructive/5 p-5">
          <p className="text-sm font-medium text-foreground">No se pudo cargar la agenda.</p>
          <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
            Puede ser la conexión. Volvé a entrar en un rato y, si sigue igual, avisale a la dueña —
            esto no significa que no tengas turnos.
          </p>
        </div>
      )}

      {!agenda.isLoading && !agenda.isError && total === 0 && (
        <div className="mt-10 max-w-xl rounded-sm border border-dashed border-border p-8 text-center">
          <p className="text-sm text-muted-foreground">
            {esHistorial
              ? `No atendiste turnos en los últimos ${DAYS_BACK} días.`
              : `No tenés turnos en los próximos ${DAYS_AHEAD} días.`}
          </p>
        </div>
      )}

      {/*
        «No hay resultados» es un cartel DISTINTO de «no tenés turnos», por el
        mismo motivo que el error está separado del vacío: los turnos están, lo
        que pasa es que el filtro los tapa. Sin el botón para limpiarlo, alguien
        que dejó un tratamiento elegido de antes concluye que le vaciaron la
        agenda.
      */}
      {!agenda.isLoading && !agenda.isError && total > 0 && visibles === 0 && (
        <div className="mt-10 max-w-xl rounded-sm border border-dashed border-border p-8 text-center">
          <p className="text-sm text-foreground">Ningún turno coincide con lo que buscaste.</p>
          <p className="mt-2 text-sm text-muted-foreground">
            Hay {total} {total === 1 ? "turno" : "turnos"} en esta pestaña, pero el filtro los deja
            afuera.
          </p>
          <Button variant="outline" size="sm" className="mt-5" onClick={limpiarFiltros}>
            Limpiar los filtros
          </Button>
        </div>
      )}

      <div className="mt-10 space-y-10">
        {days.map((rows) => {
          /* El rango horario del día. Se ordena una copia de las horas porque el
             historial viene descendente: sin esto, ahí diría "17:00 — 13:40". */
          const horas = rows.map((r) => r.appointment_start).sort();
          const desde = formatTime(horas[0]!);
          const hasta = formatTime(horas[horas.length - 1]!);

          return (
            <section key={rows[0]!.appointment_id}>
              {/* El encabezado del día usa el ancho: el título a la izquierda y
                  el rango horario contra el borde derecho. Antes los dos datos
                  estaban pegados a la izquierda y el resto de la línea era una
                  franja vacía de un metro. */}
              <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1 border-b border-border pb-3">
                <div className="flex items-baseline gap-4">
                  <h2 className="font-display text-2xl text-foreground first-letter:uppercase">
                    {dayLabel(rows[0]!.appointment_start)}
                  </h2>
                  <span className="text-eyebrow text-muted-foreground">
                    {rows.length} {rows.length === 1 ? "turno" : "turnos"}
                  </span>
                </div>
                <span className="text-sm text-muted-foreground tabular-nums">
                  {desde === hasta ? desde : `${desde} — ${hasta}`}
                </span>
              </div>

              {/* `space-y-3` y no `space-y-5`: ahora cada turno tiene su propio
                  borde, y es el borde el que los separa. Antes iban sueltos uno
                  abajo del otro y con una nota clínica de por medio no se veía
                  dónde terminaba uno y empezaba el siguiente. */}
              <ul className="mt-6 space-y-3">
                {rows.map((row) => {
                  const whatsapp = toWhatsappNumber(row.client_phone);
                  const cancelado = row.appointment_state === "cancelled";

                  return (
                    <li
                      key={row.appointment_id}
                      /*
                       * Tres columnas en pantalla grande: hora · turno · contacto
                       * y notas. El ancho del panel no tiene tope y en un monitor
                       * de 1920 esta lista ocupaba una franja finita arriba a la
                       * izquierda, con la caja de la nota clínica estirada a lo
                       * largo de metro y medio.
                       *
                       * En `sm` son dos —la hora al costado y lo demás apilado— y
                       * abajo de eso, una sola.
                       *
                       * Un turno cancelado se apaga entero en vez de esconderse:
                       * en el historial importa que estuvo.
                       */
                      className={`grid gap-x-8 gap-y-4 rounded-sm border border-border bg-card p-5 sm:grid-cols-[5.5rem_minmax(0,1fr)] lg:grid-cols-[5.5rem_minmax(0,1.15fr)_minmax(0,1fr)] ${
                        cancelado ? "opacity-60" : ""
                      }`}
                    >
                      {/* La hora es lo primero que se busca, así que va sola en su
                          columna y con cifras monoespaciadas: la lista se lee para
                          abajo sin que los dígitos se corran. */}
                      <div>
                        <p className="font-display text-2xl tabular-nums text-foreground">
                          {formatTime(row.appointment_start)}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {row.appointment_minutes} min
                        </p>
                      </div>

                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
                          <p className="text-[15px] text-foreground">{row.service_name}</p>

                          {/*
                            En los próximos se marca SÓLO lo que está sin
                            confirmar: ella no confirma turnos, pero tiene que
                            saber cuáles están firmes antes de organizarse el día.
                            Ponerle cartel a los cuatro estados haría que ninguno
                            llame la atención.

                            En el historial se marcan todos, con `EstadoTurno`:
                            ahí la pregunta ya no es "¿va a pasar?" sino "¿qué
                            pasó?", y realizado, cancelado y vencido son tres
                            respuestas distintas. Va con el mismo componente que
                            usan Turnos y el calendario para que el mismo turno no
                            se llame de dos formas según la pantalla.
                          */}
                          {esHistorial ? (
                            <EstadoTurno
                              status={row.appointment_state}
                              startsAt={row.appointment_start}
                              now={ahora}
                            />
                          ) : (
                            row.appointment_state === "pending" && (
                              <Badge variant="outline" className="font-normal text-[10px]">
                                sin confirmar
                              </Badge>
                            )
                          )}
                        </div>

                        <p className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
                          <span className="text-foreground">{row.client_name ?? "Sin nombre"}</span>
                          {row.client_is_guest && (
                            <Badge variant="outline" className="font-normal text-[10px]">
                              invitada
                            </Badge>
                          )}
                        </p>
                      </div>

                      {/*
                        Tercera columna: cómo se la contacta y qué hay que saber
                        antes de entrar a la cabina.

                        El teléfono se mudó acá desde el renglón de la clienta.
                        Antes era un enlace más adentro de una línea de texto; acá
                        tiene su lugar y, sobre todo, le da contenido propio a la
                        columna derecha en TODAS las filas. Si sólo estuvieran las
                        notas, los turnos sin notas —que son la mayoría— dejarían
                        un agujero a la derecha, que es justo lo que se venía a
                        arreglar.

                        En `sm` cae debajo del bloque del medio y no debajo de la
                        hora: por eso el `col-start-2`.
                      */}
                      <div className="min-w-0 sm:col-start-2 lg:col-start-3 lg:row-start-1">
                        {whatsapp ? (
                          <a
                            href={`https://wa.me/${whatsapp}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-2 rounded-sm border border-border px-3 py-1.5 text-sm text-muted-foreground transition-colors hover:border-gold/50 hover:text-foreground"
                          >
                            <WhatsappIcon className="h-4 w-4 shrink-0 text-gold" />
                            <span className="tabular-nums">{row.client_phone}</span>
                          </a>
                        ) : (
                          <p className="text-sm text-muted-foreground">Sin teléfono</p>
                        )}

                        {/* Lo que dejó escrito la clienta al reservar. */}
                        {row.booking_note && (
                          <p className="mt-3 flex gap-2 text-sm leading-relaxed text-muted-foreground">
                            <Quote className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                            {row.booking_note}
                          </p>
                        )}

                        {/* Las notas clínicas: alergias, embarazos, antecedentes.
                            Van destacadas y al final —lo último que se lee antes
                            de entrar a la cabina— porque son las que cambian qué
                            se puede aplicar. */}
                        {row.clinical_notes && (
                          <p className="mt-3 flex gap-2 rounded-sm border border-gold/40 bg-gold/5 p-3 text-sm leading-relaxed text-foreground">
                            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-gold" />
                            {row.clinical_notes}
                          </p>
                        )}
                      </div>
                    </li>
                  );
                })}
              </ul>
            </section>
          );
        })}
      </div>
    </div>
  );
}
