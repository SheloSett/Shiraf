import { useState } from "react";
import { Check, Pencil, Plus, Trash2, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

export type Category = { id: string; name: string };

/**
 * El valor que toma el desplegable de destino cuando se elige crear una
 * categoría nueva en lugar de mudar a una existente.
 *
 * Lleva los dos guiones bajos para que no pueda chocar con el nombre real de
 * ninguna categoría: el `value` de las otras opciones es el nombre tal cual.
 */
const NUEVA = "__nueva__";

/**
 * Pantalla de categorías. La usan productos y servicios: son la misma tabla con
 * distinto nombre, así que lo único que cambia son los textos y las funciones
 * que tocan la base.
 *
 * Las consultas y mutaciones viven en cada ruta, no acá: `supabase.from()` con
 * un nombre de tabla dinámico pierde el tipado de la fila, y prefiero mantener
 * cada página tipada contra su propia tabla.
 */
export function CategoryManager({
  eyebrow,
  title,
  description,
  itemLabel,
  categories,
  usage,
  onCreate,
  onRename,
  onRemove,
  isBusy = false,
}: {
  eyebrow: string;
  title: string;
  description: string;
  /** Cómo llamar a lo que agrupa: "productos", "tratamientos"… */
  itemLabel: string;
  categories: Category[] | undefined;
  /** Cuántos elementos usa cada categoría, por nombre. */
  usage: Map<string, number> | undefined;
  onCreate: (name: string) => void;
  onRename: (args: { id: string; from: string; to: string }) => void;
  /**
   * `destino` es el nombre de la categoría a la que mudar lo que usaba ésta.
   * `crear` va en true cuando ese nombre todavía no existe y hay que darlo de
   * alta — es lo que respalda la opción «Crear una categoría nueva…».
   */
  onRemove: (args: { id: string; destino: string; crear: boolean }) => void;
  isBusy?: boolean;
}) {
  const [newName, setNewName] = useState("");
  const [editing, setEditing] = useState<{ id: string; name: string } | null>(null);
  const [deleting, setDeleting] = useState<{ id: string; name: string; count: number } | null>(
    null,
  );
  /**
   * A dónde mudar lo que usaba la categoría que se está por borrar.
   *
   * Vacío mientras no se elija. El botón de confirmar queda deshabilitado hasta
   * que haya uno, así que no se puede borrar dejando huérfanos — que era
   * justamente lo que pasaba antes.
   *
   * El valor centinela `NUEVA` significa «una que todavía no existe»: el nombre
   * se escribe abajo, en `nombreNuevo`. Es un centinela y no un `""` porque el
   * vacío ya quiere decir «no elegí nada».
   */
  const [destino, setDestino] = useState("");
  /** El nombre de la categoría a crear, cuando el destino elegido es `NUEVA`. */
  const [nombreNuevo, setNombreNuevo] = useState("");

  /** Las otras categorías, que son los destinos posibles. */
  const destinos = (categories ?? []).filter((c) => c.id !== deleting?.id);

  const creandoDestino = destino === NUEVA;
  /** El nombre que finalmente se manda: el tipeado si es nueva, el elegido si no. */
  const destinoFinal = creandoDestino ? nombreNuevo.trim() : destino;
  /**
   * Un nombre que ya está en la lista no se crea de nuevo: se trata como si se
   * hubiera elegido del desplegable. Sin esto, escribir "Facial" cuando "Facial"
   * ya existe chocaría contra el índice único y saldría como error interno.
   */
  const yaExiste = destinos.some((c) => c.name.toLowerCase() === destinoFinal.toLowerCase());

  /** Cerrar el diálogo deja el formulario limpio para la próxima vez. */
  function cerrarBorrado() {
    setDeleting(null);
    setDestino("");
    setNombreNuevo("");
  }

  return (
    <div>
      <p className="text-eyebrow text-muted-foreground">{eyebrow}</p>
      <h1 className="mt-3 font-display text-4xl text-foreground">{title}</h1>
      <p className="mt-4 max-w-lg text-sm text-muted-foreground">{description}</p>

      <form
        className="mt-8 flex max-w-md gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (newName.trim()) {
            onCreate(newName.trim());
            setNewName("");
          }
        }}
      >
        <Input
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          placeholder="Nombre de la categoría"
          aria-label="Nombre de la categoría"
        />
        <Button type="submit" disabled={!newName.trim() || isBusy}>
          <Plus className="mr-2 h-4 w-4" /> Crear
        </Button>
      </form>

      <div className="mt-8 max-w-2xl rounded-sm border border-border bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Categoría</TableHead>
              <TableHead className="capitalize">{itemLabel}</TableHead>
              <TableHead className="w-24 text-right">Acciones</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {categories?.map((c) => {
              const count = usage?.get(c.name) ?? 0;
              const isEditing = editing?.id === c.id;

              return (
                <TableRow key={c.id}>
                  <TableCell>
                    {isEditing ? (
                      <form
                        className="flex items-center gap-2"
                        onSubmit={(e) => {
                          e.preventDefault();
                          const next = editing.name.trim();
                          if (next && next !== c.name) {
                            onRename({ id: c.id, from: c.name, to: next });
                          }
                          setEditing(null);
                        }}
                      >
                        <Input
                          className="h-9 max-w-56"
                          autoFocus
                          value={editing.name}
                          onChange={(e) => setEditing({ id: c.id, name: e.target.value })}
                          aria-label={`Nuevo nombre para ${c.name}`}
                        />
                        <Button
                          type="submit"
                          size="icon"
                          variant="outline"
                          className="h-9 w-9"
                          aria-label="Guardar"
                          disabled={isBusy}
                        >
                          <Check className="h-4 w-4" />
                        </Button>
                        <Button
                          type="button"
                          size="icon"
                          variant="ghost"
                          className="h-9 w-9"
                          aria-label="Cancelar"
                          onClick={() => setEditing(null)}
                        >
                          <X className="h-4 w-4" />
                        </Button>
                      </form>
                    ) : (
                      <span className="text-foreground">{c.name}</span>
                    )}
                  </TableCell>

                  <TableCell>
                    <Badge variant="secondary" className="font-normal">
                      {count}
                    </Badge>
                  </TableCell>

                  <TableCell>
                    <div className="flex items-center justify-end gap-1">
                      <Button
                        size="icon"
                        variant="ghost"
                        className="h-9 w-9"
                        aria-label={`Renombrar ${c.name}`}
                        onClick={() => setEditing({ id: c.id, name: c.name })}
                      >
                        <Pencil className="h-4 w-4" />
                      </Button>
                      <Button
                        size="icon"
                        variant="ghost"
                        className="h-9 w-9 text-destructive hover:text-destructive"
                        aria-label={`Eliminar ${c.name}`}
                        onClick={() => setDeleting({ id: c.id, name: c.name, count })}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              );
            })}

            {categories?.length === 0 && (
              <TableRow>
                <TableCell colSpan={3} className="py-10 text-center text-sm text-muted-foreground">
                  Todavía no hay categorías. Creá la primera arriba.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>

      <AlertDialog
        open={!!deleting}
        onOpenChange={(next) => {
          if (next) return;
          cerrarBorrado();
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="font-display text-2xl">
              ¿Eliminar {deleting?.name}?
            </AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div>
                {deleting && deleting.count > 0 ? (
                  <>
                    <p>
                      {deleting.count}{" "}
                      {deleting.count > 1
                        ? `${itemLabel} la usan`
                        : `${itemLabel.replace(/s$/, "")} la usa`}
                      . No se borran: hay que mudarlos a otra categoría.
                    </p>

                    {/* El desplegable se muestra SIEMPRE, aunque no haya otra
                        categoría. Antes, en ese caso, decía "es la única que hay,
                        creá otra antes de borrar ésta" y no dejaba seguir — había
                        que salir, crear la categoría arriba y volver a entrar.
                        Con la opción de crearla acá mismo ese callejón sin salida
                        desaparece, así que ese cartel ya no va. */}
                    <div className="mt-4 space-y-2">
                      <Label htmlFor="destino-categoria">Mudarlos a</Label>
                      {/* `select` nativo, igual que en Servicios y Accesos: son
                          pocas opciones y en el celular abre la rueda del
                          sistema, que se usa mejor que cualquier lista
                          dibujada a mano. */}
                      <select
                        id="destino-categoria"
                        value={destino}
                        onChange={(e) => setDestino(e.target.value)}
                        className="h-10 w-full rounded-sm border border-input bg-background px-3 text-sm text-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none"
                      >
                        <option value="">Elegí una…</option>
                        {destinos.map((c) => (
                          <option key={c.id} value={c.name}>
                            {c.name}
                          </option>
                        ))}
                        <option value={NUEVA}>➕ Crear una categoría nueva…</option>
                      </select>

                      {creandoDestino && (
                        <div className="space-y-2 pt-2">
                          <Label htmlFor="destino-nuevo">Nombre de la categoría nueva</Label>
                          <Input
                            id="destino-nuevo"
                            autoFocus
                            value={nombreNuevo}
                            onChange={(e) => setNombreNuevo(e.target.value)}
                            placeholder={`Adónde van estos ${itemLabel}`}
                          />
                          {/* Si el nombre tipeado ya existe, no se crea nada: se
                              muda a la que está. Se avisa para que no parezca que
                              el botón no hizo lo que decía. */}
                          {yaExiste && (
                            <p className="text-xs text-muted-foreground">
                              Esa categoría ya existe: los vamos a mudar ahí.
                            </p>
                          )}
                        </div>
                      )}
                    </div>
                  </>
                ) : (
                  <p>No hay nada usando esta categoría.</p>
                )}
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              // Las dos condiciones juntas: mientras se está guardando, y
              // mientras la categoría esté en uso pero no haya un destino con
              // nombre. La segunda es la que hace imposible dejar huérfanos —
              // y con `destinoFinal` cubre también el caso de elegir "crear una
              // nueva" y dejar el campo del nombre vacío.
              disabled={isBusy || (!!deleting && deleting.count > 0 && !destinoFinal)}
              onClick={() => {
                if (deleting) {
                  // `crear` sólo si de verdad hay que darla de alta: si el nombre
                  // tipeado coincide con una que ya está, se muda a ésa.
                  onRemove({
                    id: deleting.id,
                    destino: destinoFinal,
                    crear: creandoDestino && !yaExiste,
                  });
                }
                cerrarBorrado();
              }}
            >
              Eliminar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
