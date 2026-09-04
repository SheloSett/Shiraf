import { useMemo, useRef, useState } from "react";
import { createFileRoute, useLoaderData, useRouter } from "@tanstack/react-router";
import { useMutation } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  Home,
  ImagePlus,
  MapPin,
  MessageCircle,
  PanelBottom,
  Plus,
  Sparkles,
  Trash2,
  Users,
  type LucideIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { guardarContenido } from "@/lib/contenido.functions";
import {
  conDefaults,
  PAGINAS,
  type Campo,
  type ContenidoDePagina,
  type ContenidoDelSitio,
} from "@/lib/contenido";
import { uploadServiceMedia } from "@/lib/storage";
import { cn } from "@/lib/utils";

/**
 * El editor del contenido del sitio. **Sólo la dueña.**
 *
 * A la izquierda las páginas, a la derecha los campos de la que esté elegida.
 * Qué campos tiene cada una lo dice `src/lib/contenido.ts`: **acá no hay ni un
 * texto del sitio escrito**, sólo la manera de editarlos. Agregar un campo es
 * tocar ese archivo y aparece solo en esta pantalla.
 *
 * ── DE DÓNDE SALE LO QUE SE MUESTRA ───────────────────────────────────────
 *
 * Del loader de la raíz, que ya trajo el contenido de las seis páginas para
 * dibujar el sitio. O sea que esta pantalla **no pide nada al abrirse**: el
 * dato ya está en memoria. Al guardar se invalida el router para que ese loader
 * vuelva a correr y el sitio muestre lo nuevo sin recargar a mano.
 *
 * ── QUÉ ES `baseline` ─────────────────────────────────────────────────────
 *
 * Una copia de cómo estaba la página cuando se abrió. Sirve para dos cosas que
 * el centro pidió mirando el panel de la inmobiliaria: saber si hay cambios sin
 * guardar, y poder descartarlos. Sin eso, "Guardar" está siempre disponible y
 * nadie sabe si tocó algo o no.
 */
export const Route = createFileRoute("/_authenticated/admin/contenido")({
  head: () => ({
    meta: [{ title: "Contenido del sitio — Panel Shiraf" }],
  }),
  component: AdminContenido,
});

/** Los íconos que nombra el esquema, traducidos al componente de lucide. */
const ICONOS: Record<string, LucideIcon> = {
  Home,
  Sparkles,
  Users,
  MessageCircle,
  MapPin,
  PanelBottom,
};

/** El contenido de todas las páginas, con los defaults ya aplicados. */
function armarValores(guardado: ContenidoDelSitio): Record<string, ContenidoDePagina> {
  const salida: Record<string, ContenidoDePagina> = {};
  for (const pagina of PAGINAS) salida[pagina.key] = conDefaults(pagina.key, guardado[pagina.key]);
  return salida;
}

function AdminContenido() {
  const router = useRouter();
  const guardado = useLoaderData({ from: "__root__" });

  const [paginaActiva, setPaginaActiva] = useState(PAGINAS[0]!.key);
  const [valores, setValores] = useState(() => armarValores(guardado));
  const [baseline, setBaseline] = useState(() => armarValores(guardado));
  /** Qué campo está subiendo una foto ahora mismo. `null` = ninguno. */
  const [subiendo, setSubiendo] = useState<string | null>(null);
  const inputsDeArchivo = useRef<Record<string, HTMLInputElement | null>>({});

  const esquema = PAGINAS.find((p) => p.key === paginaActiva)!;
  const actuales = valores[paginaActiva] ?? {};

  // Comparar por JSON y no campo por campo: los campos lista son arrays de
  // objetos y un `===` diría que cambiaron siempre, porque el editor los
  // reemplaza enteros en cada tecla.
  const hayCambios = useMemo(
    () => JSON.stringify(valores[paginaActiva]) !== JSON.stringify(baseline[paginaActiva]),
    [valores, baseline, paginaActiva],
  );

  function escribir(campo: string, valor: string | Record<string, string>[]) {
    setValores((previo) => ({
      ...previo,
      [paginaActiva]: { ...previo[paginaActiva], [campo]: valor },
    }));
  }

  /**
   * El valor de un campo de texto, siempre como string.
   *
   * Los inputs no aceptan otra cosa, y el valor de un campo puede ser una lista.
   * Sin esto habría un `typeof ... === "string" ? ... : ""` repetido en cada
   * input, que es la clase de repetición que un día alguien copia mal.
   */
  function valorTexto(campo: string): string {
    const valor = actuales[campo];
    return typeof valor === "string" ? valor : "";
  }

  /** Los ítems de un campo lista, siempre como array aunque el valor esté raro. */
  function itemsDe(campo: string): Record<string, string>[] {
    const valor = actuales[campo];
    return Array.isArray(valor) ? valor : [];
  }

  function escribirItem(campo: string, indice: number, sub: string, valor: string) {
    const items = itemsDe(campo).map((item, i) =>
      i === indice ? { ...item, [sub]: valor } : item,
    );
    escribir(campo, items);
  }

  function agregarItem(campo: Campo) {
    if (campo.type !== "lista") return;
    const vacio: Record<string, string> = {};
    for (const sub of campo.itemFields) vacio[sub.key] = sub.default;
    escribir(campo.key, [...itemsDe(campo.key), vacio]);
  }

  function borrarItem(campo: string, indice: number) {
    escribir(
      campo,
      itemsDe(campo).filter((_, i) => i !== indice),
    );
  }

  /**
   * Sube una foto y deja su URL en el campo.
   *
   * Reusa `uploadServiceMedia`, que es la subida del catálogo: comprime en el
   * navegador, pide la firma al servidor y manda el archivo derecho a
   * Cloudinary. El nombre habla de tratamientos porque nació ahí, pero lo que
   * hace no tiene nada de específico — y escribir una segunda subida para esta
   * pantalla sería tener dos lugares donde arreglar el mismo bug.
   *
   * La firma exige el permiso `catalog`; la dueña lo pasa siempre por ser
   * dueña, y esta pantalla es sólo de ella, así que no hay caso en el que
   * alguien llegue hasta acá y la firma lo rechace.
   */
  async function subirFoto(
    clave: string,
    archivo: File | undefined,
    aplicar: (url: string) => void,
  ) {
    if (!archivo) return;
    setSubiendo(clave);
    try {
      const { url } = await uploadServiceMedia(archivo);
      aplicar(url);
      toast.success("Foto subida. Acordate de guardar los cambios.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "No se pudo subir la foto.");
    } finally {
      setSubiendo(null);
    }
  }

  const guardar = useMutation({
    mutationFn: () =>
      guardarContenido({ data: { pagina: paginaActiva, contenido: valores[paginaActiva]! } }),
    onSuccess: async () => {
      setBaseline((previo) => ({ ...previo, [paginaActiva]: valores[paginaActiva]! }));
      // El sitio lee el contenido desde el loader de la raíz, que ya corrió.
      // Sin esto, lo recién guardado no se ve hasta recargar la página.
      await router.invalidate();
      toast.success("Contenido guardado. Ya se ve en el sitio.");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  function descartar() {
    setValores((previo) => ({ ...previo, [paginaActiva]: baseline[paginaActiva]! }));
  }

  return (
    <div>
      <p className="text-eyebrow text-muted-foreground">El sitio público</p>
      <h1 className="mt-3 font-display text-4xl text-foreground">Contenido del sitio</h1>
      <p className="mt-4 max-w-2xl text-sm text-muted-foreground">
        Los textos y las fotos de las páginas que ve la clienta. Lo que no se toca desde acá son los
        tratamientos, las profesionales y los precios: eso se carga en sus propias secciones y el
        sitio lo muestra solo.
      </p>

      <div className="mt-10 flex flex-col gap-8 lg:flex-row">
        {/* Las páginas. En celular es una tira que se desplaza a lo ancho, el
            mismo recurso que usa el menú del panel. */}
        <nav className="flex shrink-0 gap-2 overflow-x-auto lg:w-56 lg:flex-col lg:overflow-visible">
          {PAGINAS.map((pagina) => {
            const Icono = ICONOS[pagina.icon] ?? Home;
            const activa = pagina.key === paginaActiva;
            return (
              <button
                key={pagina.key}
                type="button"
                onClick={() => setPaginaActiva(pagina.key)}
                className={cn(
                  "flex shrink-0 items-center gap-3 rounded-sm px-3 py-2.5 text-left text-sm transition-colors",
                  activa
                    ? "bg-primary text-primary-foreground"
                    : "text-muted-foreground hover:bg-accent/20 hover:text-foreground",
                )}
              >
                <Icono className="h-4 w-4 shrink-0" />
                {pagina.label}
              </button>
            );
          })}
        </nav>

        {/* Los campos de la página elegida. */}
        <section className="min-w-0 flex-1">
          <div className="rounded-sm border border-border bg-card">
            <div className="border-b border-border px-6 py-5">
              <h2 className="font-display text-2xl text-foreground">{esquema.label}</h2>
              <p className="mt-2 text-sm text-muted-foreground">{esquema.descripcion}</p>
            </div>

            <div className="space-y-7 px-6 py-7">
              {esquema.fields.map((campo) => (
                <div key={campo.key} className="space-y-2">
                  <Label htmlFor={`${paginaActiva}-${campo.key}`}>{campo.label}</Label>

                  {campo.type === "text" && (
                    <Input
                      id={`${paginaActiva}-${campo.key}`}
                      value={valorTexto(campo.key)}
                      onChange={(e) => escribir(campo.key, e.target.value)}
                    />
                  )}

                  {campo.type === "textarea" && (
                    <Textarea
                      id={`${paginaActiva}-${campo.key}`}
                      rows={3}
                      value={valorTexto(campo.key)}
                      onChange={(e) => escribir(campo.key, e.target.value)}
                    />
                  )}

                  {campo.type === "image" && (
                    <div className="flex flex-col gap-4 sm:flex-row sm:items-start">
                      <div className="flex h-28 w-44 shrink-0 items-center justify-center overflow-hidden rounded-sm border border-border bg-muted">
                        {actuales[campo.key] ? (
                          <img
                            src={String(actuales[campo.key])}
                            alt={campo.label}
                            className="h-full w-full object-cover"
                          />
                        ) : (
                          <ImagePlus className="h-6 w-6 text-muted-foreground" />
                        )}
                      </div>
                      <div className="flex flex-1 flex-wrap items-center gap-2">
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          disabled={subiendo === campo.key}
                          onClick={() => inputsDeArchivo.current[campo.key]?.click()}
                        >
                          {subiendo === campo.key ? "Subiendo…" : "Subir una foto"}
                        </Button>
                        {/* Volver al default es borrar el valor, no subir la
                            foto original de nuevo: el JSX cae a la imagen que
                            viene con el sitio cuando el campo está vacío. */}
                        {actuales[campo.key] ? (
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            onClick={() => escribir(campo.key, "")}
                          >
                            Volver a la original
                          </Button>
                        ) : null}
                        <input
                          ref={(el) => {
                            inputsDeArchivo.current[campo.key] = el;
                          }}
                          type="file"
                          accept="image/*"
                          className="hidden"
                          onChange={(e) => {
                            void subirFoto(campo.key, e.target.files?.[0], (url) =>
                              escribir(campo.key, url),
                            );
                            // Se limpia para que elegir DOS VECES el mismo
                            // archivo vuelva a disparar el change.
                            e.target.value = "";
                          }}
                        />
                      </div>
                    </div>
                  )}

                  {campo.type === "lista" && (
                    <div className="space-y-3">
                      {itemsDe(campo.key).map((item, indice) => (
                        <div
                          key={indice}
                          className="flex items-start gap-3 rounded-sm border border-border bg-background p-3"
                        >
                          <div className="grid flex-1 gap-3 sm:grid-cols-2">
                            {campo.itemFields.map((sub) => (
                              <div key={sub.key} className="space-y-1.5">
                                <Label className="text-xs text-muted-foreground">{sub.label}</Label>
                                <Input
                                  value={item[sub.key] ?? ""}
                                  onChange={(e) =>
                                    escribirItem(campo.key, indice, sub.key, e.target.value)
                                  }
                                />
                              </div>
                            ))}
                          </div>
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            title={`Eliminar ${campo.itemLabel}`}
                            onClick={() => borrarItem(campo.key, indice)}
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>
                      ))}
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => agregarItem(campo)}
                      >
                        <Plus className="h-4 w-4" /> Agregar {campo.itemLabel}
                      </Button>
                    </div>
                  )}

                  {campo.ayuda && (
                    <p className="text-xs leading-relaxed text-muted-foreground">{campo.ayuda}</p>
                  )}
                </div>
              ))}
            </div>

            <div className="flex flex-col items-center justify-between gap-3 border-t border-border px-6 py-5 sm:flex-row">
              <span className="text-xs text-muted-foreground">
                {hayCambios ? "Tenés cambios sin guardar." : "Todo guardado."}
              </span>
              <div className="flex gap-2">
                <Button
                  type="button"
                  variant="outline"
                  disabled={!hayCambios || guardar.isPending}
                  onClick={descartar}
                >
                  Descartar cambios
                </Button>
                <Button
                  type="button"
                  disabled={!hayCambios || guardar.isPending}
                  onClick={() => guardar.mutate()}
                >
                  {guardar.isPending ? "Guardando…" : "Guardar cambios"}
                </Button>
              </div>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}
