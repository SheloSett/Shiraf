import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { KeyRound, Pencil, Plus, ShieldCheck, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Switch } from "@/components/ui/switch";
import { Card, CardContent } from "@/components/ui/card";
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
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { api, apiPut } from "@/lib/api";
import type { RtaEmpleadas, RtaProfesionalesAdmin } from "@/lib/api-tipos";
import { linkProfessionalAccount } from "@/lib/team";
import { createEmployee, deleteEmployee, updateEmployeeAccess } from "@/lib/team.functions";
import {
  impliedBy,
  isUiOnly,
  permissionLabel,
  PERMISSIONS,
  type Permission,
} from "@/lib/permissions";
import { useAccess } from "@/hooks/useAccess";

export const Route = createFileRoute("/_authenticated/admin/accesos")({
  component: AdminTeam,
});

type Ficha = {
  id: string;
  full_name: string;
  specialty: string | null;
  user_id: string | null;
  is_active: boolean;
};

/**
 * El selector de ficha de profesional.
 *
 * Sólo ofrece las fichas libres más la que ya tenga esta cuenta: una atada a
 * otra persona no aparece en la lista, porque elegirla sería sacársela sin
 * decirlo. Para mudar una ficha hay que soltarla primero de quien la tiene.
 *
 * Es un `select` nativo y no el de la librería por lo mismo que en Servicios y
 * en Profesionales: son pocas opciones, y en el celular el nativo abre la rueda
 * del sistema, que se usa mejor que cualquier lista dibujada a mano.
 */
function ProfessionalSelect({
  id,
  value,
  options,
  disabled,
  onChange,
}: {
  id: string;
  value: string;
  options: Ficha[];
  disabled?: boolean;
  onChange: (value: string) => void;
}) {
  return (
    <select
      id={id}
      value={value}
      disabled={disabled}
      onChange={(e) => onChange(e.target.value)}
      className="h-10 w-full rounded-sm border border-input bg-background px-3 text-sm text-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none"
    >
      <option value="">No atiende turnos</option>
      {options.map((ficha) => (
        <option key={ficha.id} value={ficha.id}>
          {ficha.full_name}
          {ficha.specialty ? ` — ${ficha.specialty}` : ""}
          {ficha.is_active ? "" : " (ficha inactiva)"}
        </option>
      ))}
    </select>
  );
}

function AdminTeam() {
  const queryClient = useQueryClient();
  const { isAdmin, loading } = useAccess();

  const [open, setOpen] = useState(false);
  const [deleting, setDeleting] = useState<{ id: string; name: string } | null>(null);

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [fullName, setFullName] = useState("");
  const [phone, setPhone] = useState("");
  const [draftProfessional, setDraftProfessional] = useState("");
  const [draftPermissions, setDraftPermissions] = useState<Set<Permission>>(new Set());

  function closeForm() {
    setOpen(false);
    setEmail("");
    setPassword("");
    setFullName("");
    setPhone("");
    setDraftProfessional("");
    setDraftPermissions(new Set());
  }

  // Las empleadas: quienes tienen el rol staff, con su ficha y sus accesos.
  const team = useQuery({
    queryKey: ["admin-team"],
    enabled: isAdmin,
    // Antes esto eran TRES consultas encadenadas —los roles, después los
    // profiles de esos ids, después sus permisos— porque no había forma de
    // joinear sin una vista. Ahora es una.
    queryFn: async () =>
      (await api<RtaEmpleadas>("/api/equipo/empleadas")).empleadas.map((e) => ({
        ...e,
        permissions: e.permissions as Permission[],
      })),
  });

  // Las fichas de profesional, para poder atarle una a una cuenta. La ficha es
  // lo que el sitio muestra —nombre, especialidad, qué tratamientos hace— y la
  // cuenta es con lo que entra; hasta la migración 20260818020000 eran dos cosas
  // sueltas y por eso una profesional no tenía forma de ver sus propios turnos.
  const professionals = useQuery({
    queryKey: ["admin-team-professionals"],
    enabled: isAdmin,
    queryFn: async () =>
      (await api<RtaProfesionalesAdmin>("/api/equipo/profesionales")).profesionales,
  });

  const link = useMutation({
    mutationFn: async ({ userId, professionalId }: { userId: string; professionalId: string }) =>
      await linkProfessionalAccount(userId, professionalId),
    onSuccess: async (_result, variables) => {
      await queryClient.invalidateQueries({ queryKey: ["admin-team-professionals"] });
      // Y la lista de Profesionales, que es OTRA clave sobre la misma tabla y
      // muestra el mismo dato con otras palabras ("Entra al panel y ve su
      // agenda" / "Sin acceso al panel"). Sin esto, atar una ficha desde acá
      // dejaba esa pantalla diciendo que la profesional no tiene acceso hasta
      // que la caché venciera sola. El camino inverso —"Darle acceso" desde
      // Profesionales— ya invalidaba las dos.
      await queryClient.invalidateQueries({ queryKey: ["admin-professionals"] });
      toast.success(
        variables.professionalId
          ? "Ficha vinculada: ya ve su agenda al entrar al panel."
          : "Ficha desvinculada.",
      );
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const create = useMutation({
    mutationFn: async () => {
      // Server function: crear una cuenta necesita la service role, que no puede
      // acercarse al navegador. El rol de la dueña se vuelve a verificar del
      // lado servidor, no alcanza con que esta pantalla esté visible.
      const created = await createEmployee({
        data: {
          email: email.trim(),
          password,
          fullName: fullName.trim(),
          phone: phone.trim() || undefined,
          permissions: [...draftPermissions],
        },
      });

      // El vínculo con la ficha va después y desde el navegador: es un UPDATE
      // común sobre `professionals` que la dueña ya puede hacer con su propia
      // sesión. Meterlo adentro de la server function obligaría a hacerlo con la
      // service role —la clave que bypasea toda la RLS— para algo que no la
      // necesita.
      //
      // Si falla, la cuenta igual quedó creada y sirve: no se deshace nada, se
      // avisa, y la ficha se ata después desde la tarjeta.
      if (draftProfessional) {
        try {
          await linkProfessionalAccount(created.id, draftProfessional);
        } catch (error) {
          return { ...created, linkError: error instanceof Error ? error.message : "" };
        }
      }
      return { ...created, linkError: null as string | null };
    },
    onSuccess: async (result) => {
      await queryClient.invalidateQueries({ queryKey: ["admin-team"] });
      await queryClient.invalidateQueries({ queryKey: ["admin-team-professionals"] });
      // El alta también puede atar una ficha (el desplegable del formulario),
      // así que Profesionales queda igual de desactualizada que en `link`.
      await queryClient.invalidateQueries({ queryKey: ["admin-professionals"] });
      closeForm();
      if (result.linkError) {
        toast.warning(
          `Se creó la cuenta de ${result.fullName}, pero la ficha de profesional no se pudo vincular. Atala desde su tarjeta. (${result.linkError})`,
        );
      } else {
        toast.success(`${result.fullName} ya puede entrar con ${result.email}.`);
      }
    },
    onError: (e: Error) => toast.error(e.message),
  });

  // Tildar y destildar va directo contra la tabla: la policy sólo deja escribir
  // ahí al rol admin, así que no hace falta pasar por el servidor.
  const togglePermission = useMutation({
    mutationFn: async ({
      userId,
      permission,
      grant,
    }: {
      userId: string;
      permission: Permission;
      grant: boolean;
    }) => {
      await apiPut("/api/equipo/empleadas/" + userId + "/permiso", { permission, grant });
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["admin-team"] }),
    onError: (e: Error) => toast.error(e.message),
  });

  /**
   * Dar de baja sin borrar, y volver a dar de alta.
   *
   * Es lo que faltaba: antes, para que alguien dejara de entrar, había que
   * borrarle la cuenta — y con eso se iban también sus accesos tildados, que
   * después hay que volver a armar uno por uno si la persona vuelve.
   *
   * La baja vale en el acto aunque la empleada tenga la sesión abierta: el
   * servidor mira `is_active` en cada pedido, no sólo al entrar.
   */
  /** La empleada a la que se le están cambiando el mail o la contraseña. */
  const [editando, setEditando] = useState<{ id: string; name: string; email: string } | null>(
    null,
  );

  const toggleActive = useMutation({
    mutationFn: ({ userId, value }: { userId: string; value: boolean }) =>
      apiPut("/api/equipo/empleadas/" + userId + "/activa", { is_active: value }),
    onSuccess: async (_data, vars) => {
      await queryClient.invalidateQueries({ queryKey: ["admin-team"] });
      toast.success(vars.value ? "Cuenta dada de alta." : "Cuenta dada de baja.");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const remove = useMutation({
    mutationFn: async (userId: string) => await deleteEmployee({ data: { userId } }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["admin-team"] });
      setDeleting(null);
      toast.success("Cuenta eliminada.");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  if (loading) {
    return <p className="text-sm text-muted-foreground">Verificando permisos…</p>;
  }

  // Esta pantalla es sólo de la dueña: repartir accesos no es un permiso
  // delegable, o una secretaria se tildaría el resto sola.
  if (!isAdmin) {
    return (
      <div className="max-w-md">
        <h1 className="font-display text-3xl text-foreground">Sólo para la dueña</h1>
        <p className="mt-3 text-sm text-muted-foreground">
          El alta de empleadas y el reparto de accesos no se delegan.
        </p>
      </div>
    );
  }

  // Qué falta para poder crear. Se calcula como lista y no como un booleano
  // suelto porque el botón se muestra deshabilitado, y un botón apagado sin
  // explicación no se distingue de uno roto: hay que decir qué corregir.
  const missing = [
    !fullName.trim() && "el nombre",
    !email.trim() && "el mail",
    password.length === 0
      ? "la contraseña"
      : password.length < 8 &&
        `una contraseña más larga (tenés ${password.length} de 8 caracteres)`,
  ].filter((item): item is string => Boolean(item));

  const ready = missing.length === 0;

  const fichas: Ficha[] = professionals.data ?? [];
  /** La ficha atada a esta cuenta, si tiene alguna. */
  const fichaOf = (userId: string) => fichas.find((f) => f.user_id === userId) ?? null;
  /** Las que puede elegir: las libres, más la suya. */
  const fichasFor = (userId: string) => fichas.filter((f) => !f.user_id || f.user_id === userId);

  return (
    <div>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          {/*
           * 27/8/2026 — esta sección se llamaba "Equipo" y se renombró a
           * "Accesos".
           *
           * "Equipo" y "Profesionales" son dos palabras que suenan a lo mismo
           * —la gente que trabaja en el centro— y el panel las usaba para dos
           * cosas distintas: allá se carga la FICHA (especialidad, reseña,
           * horarios, tratamientos), que es lo que sale publicado en el sitio;
           * acá se reparte la LLAVE del panel. Con los dos nombres parecidos,
           * crear a alguien en una y verla aparecer en la otra se lee como un
           * duplicado en vez de como lo que es: la misma persona, con ficha y
           * con cuenta.
           *
           * "Accesos" y no "Cuentas" porque es la palabra que ya usa el resto
           * del panel — "sin accesos todavía", "2 de 6 accesos", "Tus accesos"
           * en /admin/cuenta.
           *
           * La ruta acompañó: /admin/equipo pasó a /admin/accesos, y este
           * archivo a admin.accesos.tsx —el ruteo es por nombre de archivo, así
           * que las dos cosas son la misma—. Con eso hay que tocar también el
           * `to` del menú en admin.tsx y ADMIN_ROUTES en permissions.ts, que es
           * el guard que rebota a quien escribe la URL a mano: si esa tabla se
           * queda con la ruta vieja, la nueva cae en el fail-closed del final y
           * la sección se vuelve inaccesible hasta para la dueña.
           *
           * La API **no** cambió: sigue siendo `/api/equipo/*`. Eso no se ve
           * desde el navegador y renombrarlo arrastra routers, controllers y
           * claves de caché sin que nadie note la diferencia.
           */}
          <p className="text-eyebrow text-muted-foreground">Quién entra al panel</p>
          <h1 className="mt-3 font-display text-4xl text-foreground">Accesos</h1>
        </div>
        <Button onClick={() => setOpen(true)}>
          <Plus className="mr-2 h-4 w-4" /> Nueva empleada
        </Button>
      </div>

      <p className="mt-4 max-w-xl text-sm text-muted-foreground">
        Cada empleada ve únicamente lo que le tildes. Vos, como dueña, ves todo siempre: no tenés
        casillas justamente para que nadie pueda dejarte afuera de tu propio panel.
      </p>

      <div className="mt-8 space-y-4">
        {team.data?.map((member) => (
          <Card key={member.id} className="border-border/80 shadow-soft">
            <CardContent className="p-6">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div>
                  <h2 className="font-display text-2xl text-foreground">
                    {member.full_name}
                    {!member.is_active && (
                      <Badge variant="outline" className="ml-3 align-middle text-xs font-normal">
                        Dada de baja
                      </Badge>
                    )}
                  </h2>
                  {/* El mail a la vista: es con lo que entra al panel, y sin verlo
                      no había forma de saber cuál cuenta es cuál. */}
                  <p className="mt-1 text-sm text-muted-foreground">{member.email}</p>
                  <p className="mt-0.5 text-sm text-muted-foreground">
                    {member.phone ?? "Sin teléfono"} ·{" "}
                    {member.permissions.length === 0
                      ? "sin accesos todavía"
                      : `${member.permissions.length} de ${PERMISSIONS.length} accesos`}
                  </p>
                </div>

                <div className="flex items-center gap-3">
                  {/* El interruptor es la baja REVERSIBLE: le corta la entrada sin
                      perderle los accesos tildados. El tacho, al lado, sigue
                      siendo la definitiva. Son dos cosas distintas y por eso
                      están las dos. */}
                  <label className="flex cursor-pointer items-center gap-2 text-sm text-muted-foreground">
                    <Switch
                      checked={member.is_active}
                      disabled={toggleActive.isPending}
                      onCheckedChange={(value) => toggleActive.mutate({ userId: member.id, value })}
                      aria-label={`Habilitar el ingreso de ${member.full_name}`}
                    />
                    Puede entrar
                  </label>
                  <Button
                    size="icon"
                    variant="ghost"
                    className="h-9 w-9"
                    aria-label={`Cambiar el mail o la contraseña de ${member.full_name}`}
                    title="Cambiar mail o contraseña"
                    onClick={() =>
                      setEditando({
                        id: member.id,
                        name: member.full_name,
                        email: member.email,
                      })
                    }
                  >
                    <Pencil className="h-4 w-4" />
                  </Button>
                  <Button
                    size="icon"
                    variant="ghost"
                    className="h-9 w-9 text-destructive hover:text-destructive"
                    aria-label={`Eliminar la cuenta de ${member.full_name}`}
                    onClick={() => setDeleting({ id: member.id, name: member.full_name })}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </div>

              <div className="mt-5 grid gap-2 sm:grid-cols-2">
                {PERMISSIONS.map((permission) => {
                  const granted = member.permissions.includes(permission.value);
                  // Si otro permiso tildado ya lo arrastra, se muestra tildado y
                  // bloqueado: destildarlo no le sacaría el acceso, porque la
                  // policy lo concede por la otra vía.
                  const from = impliedBy(permission.value, member.permissions);
                  return (
                    <label
                      key={permission.value}
                      className={`flex items-start gap-3 rounded-sm border border-border p-3 ${
                        from ? "bg-secondary/40" : "cursor-pointer"
                      }`}
                    >
                      <Checkbox
                        className="mt-0.5"
                        checked={granted || !!from}
                        disabled={togglePermission.isPending || !!from}
                        onCheckedChange={(checked) =>
                          togglePermission.mutate({
                            userId: member.id,
                            permission: permission.value,
                            grant: checked === true,
                          })
                        }
                      />
                      <span className="min-w-0">
                        <span className="flex flex-wrap items-center gap-2 text-sm text-foreground">
                          {permission.label}
                          {isUiOnly(permission) && (
                            <Badge variant="outline" className="font-normal text-[10px]">
                              sólo en pantalla
                            </Badge>
                          )}
                        </span>
                        <span className="mt-0.5 block text-xs leading-relaxed text-muted-foreground">
                          {from
                            ? `Incluido en "${permissionLabel(from)}": para sacárselo, destildá ese.`
                            : permission.description}
                        </span>
                      </span>
                    </label>
                  );
                })}
              </div>

              {/* La ficha va separada de las casillas a propósito: no es un
                  acceso más que se reparte, es decir QUIÉN ES esta persona en
                  el centro. Y no le suma nada del negocio — con la ficha atada
                  ve sus propios turnos y nada más. */}
              <div className="mt-5 border-t border-border pt-5">
                <Label htmlFor={`ficha-${member.id}`} className="text-sm">
                  Ficha de profesional
                </Label>
                <div className="mt-2 max-w-sm">
                  <ProfessionalSelect
                    id={`ficha-${member.id}`}
                    value={fichaOf(member.id)?.id ?? ""}
                    options={fichasFor(member.id)}
                    disabled={link.isPending || professionals.isLoading}
                    onChange={(professionalId) =>
                      link.mutate({ userId: member.id, professionalId })
                    }
                  />
                </div>
                <p className="mt-2 max-w-sm text-xs leading-relaxed text-muted-foreground">
                  {fichaOf(member.id)
                    ? "Al entrar al panel ve “Mi agenda”: sus próximos turnos con el tratamiento, el día, la hora y la clienta."
                    : "Si atiende turnos, elegí su ficha y va a ver su propia agenda al entrar. No le suma ningún otro acceso."}
                </p>
              </div>
            </CardContent>
          </Card>
        ))}

        {team.data?.length === 0 && (
          <Card className="border-dashed border-border bg-transparent shadow-none">
            <CardContent className="p-8 text-center">
              <p className="text-sm text-muted-foreground">
                Todavía no hay empleadas. Creá la primera con el botón de arriba.
              </p>
            </CardContent>
          </Card>
        )}
      </div>

      <p className="mt-6 flex items-start gap-2 text-xs leading-relaxed text-muted-foreground">
        <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0" />
        Los siete accesos los bloquea la base, no sólo esta pantalla: sin la casilla tildada el dato
        no sale, aunque se intente entrar por fuera del panel.
      </p>

      {/* ── Alta ────────────────────────────────────────────────────────── */}
      <Dialog open={open} onOpenChange={(next) => (next ? setOpen(true) : closeForm())}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
          <DialogHeader>
            <DialogTitle className="font-display text-2xl">Nueva empleada</DialogTitle>
            <DialogDescription>
              Se crea la cuenta y ya puede entrar. Pasale el mail y la contraseña que definas acá.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="e-name">Nombre y apellido</Label>
              <Input id="e-name" value={fullName} onChange={(e) => setFullName(e.target.value)} />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="e-email">Mail</Label>
                <Input
                  id="e-email"
                  type="email"
                  autoComplete="off"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="e-phone">Teléfono</Label>
                <Input id="e-phone" value={phone} onChange={(e) => setPhone(e.target.value)} />
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="e-password">Contraseña inicial</Label>
              <Input
                id="e-password"
                type="text"
                autoComplete="off"
                placeholder="Mínimo 8 caracteres"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                aria-invalid={password.length > 0 && password.length < 8}
              />
              {/* El largo mínimo lo pide Supabase. Se avisa mientras se escribe
                  y no recién al enviar: el botón está deshabilitado hasta que se
                  cumpla, así que sin esto no hay forma de saber qué falta. */}
              {password.length > 0 && password.length < 8 && (
                <p className="text-xs text-destructive">
                  Le faltan {8 - password.length}{" "}
                  {8 - password.length === 1 ? "caracter" : "caracteres"}: el mínimo es 8.
                </p>
              )}
              <p className="flex items-start gap-2 text-xs leading-relaxed text-muted-foreground">
                <KeyRound className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                Se muestra en texto plano a propósito: tenés que poder copiarla para dársela.
                Después ella la cambia desde Mi cuenta.
              </p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="e-ficha">Ficha de profesional</Label>
              <ProfessionalSelect
                id="e-ficha"
                value={draftProfessional}
                options={fichas.filter((f) => !f.user_id)}
                onChange={setDraftProfessional}
              />
              <p className="text-xs leading-relaxed text-muted-foreground">
                Si atiende turnos, atala a su ficha: al entrar al panel va a ver “Mi agenda” con sus
                propios turnos. Es lo único que gana con esto — el resto son las casillas de abajo.
                La ficha se puede atar o soltar después.
              </p>
            </div>

            <div>
              <p className="text-eyebrow border-b border-border pb-3 text-gold">
                A qué le das acceso
              </p>
              <div className="mt-4 grid gap-2">
                {PERMISSIONS.map((permission) => {
                  const from = impliedBy(permission.value, draftPermissions);
                  return (
                    <label
                      key={permission.value}
                      className={`flex items-start gap-3 rounded-sm border border-border p-3 ${
                        from ? "bg-secondary/40" : "cursor-pointer"
                      }`}
                    >
                      <Checkbox
                        className="mt-0.5"
                        checked={draftPermissions.has(permission.value) || !!from}
                        disabled={!!from}
                        onCheckedChange={(checked) =>
                          setDraftPermissions((prev) => {
                            const next = new Set(prev);
                            if (checked) next.add(permission.value);
                            else next.delete(permission.value);
                            return next;
                          })
                        }
                      />
                      <span className="min-w-0">
                        <span className="flex flex-wrap items-center gap-2 text-sm text-foreground">
                          {permission.label}
                          {isUiOnly(permission) && (
                            <Badge variant="outline" className="font-normal text-[10px]">
                              sólo en pantalla
                            </Badge>
                          )}
                        </span>
                        <span className="mt-0.5 block text-xs leading-relaxed text-muted-foreground">
                          {from
                            ? `Incluido en "${permissionLabel(from)}".`
                            : permission.description}
                        </span>
                      </span>
                    </label>
                  );
                })}
              </div>
            </div>

            <div className="space-y-2">
              {!ready && (
                <p className="text-center text-xs text-muted-foreground">
                  Falta {missing.join(", ").replace(/, ([^,]*)$/, " y $1")}.
                </p>
              )}
              <Button
                className="w-full"
                size="lg"
                disabled={!ready || create.isPending}
                onClick={() => create.mutate()}
              >
                {create.isPending ? "Creando…" : "Crear empleada"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <CambiarAcceso empleada={editando} onClose={() => setEditando(null)} />

      <AlertDialog open={!!deleting} onOpenChange={(next) => !next && setDeleting(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="font-display text-2xl">
              ¿Eliminar la cuenta de {deleting?.name}?
            </AlertDialogTitle>
            <AlertDialogDescription>
              Esto es definitivo: se borra la cuenta con sus accesos tildados y no hay vuelta atrás.
              Si sólo querés que deje de entrar por un tiempo, usá el interruptor «Puede entrar» —
              le corta la entrada en el acto y le guarda los accesos para cuando vuelva.
              <span className="mt-3 block">
                Los turnos que haya cargado no se tocan en ninguno de los dos casos: quedan a nombre
                de la clienta, no de quien los cargó. Su ficha de profesional, si tiene, también
                queda.
              </span>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => deleting && remove.mutate(deleting.id)}
              disabled={remove.isPending}
            >
              Eliminar la cuenta
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

/**
 * Cambiarle el mail o la contraseña a una empleada.
 *
 * ── LOS DOS CAMPOS SON OPCIONALES, Y CADA UNO POR SU LADO ─────────────────
 *
 * Se manda sólo lo que se tocó. Dejar la contraseña vacía significa "no la
 * cambies", no "ponele una vacía" — que es la confusión clásica de un formulario
 * que muestra los dos campos juntos. El mail viene cargado con el actual; si no
 * se toca, tampoco viaja.
 *
 * ── LO QUE ESTO NO HACE ───────────────────────────────────────────────────
 *
 * No le corta la sesión. El token está firmado y no guarda la contraseña, así
 * que la empleada que tenga el panel abierto lo sigue teniendo abierto: lo único
 * que cambia es con qué entra la próxima vez. Para cortarle el acceso YA está el
 * interruptor «Puede entrar», que se mira en cada pedido.
 *
 * Se lo dice en el diálogo, porque es exactamente lo que alguien espera que pase
 * y no pasa.
 */
function CambiarAcceso({
  empleada,
  onClose,
}: {
  empleada: { id: string; name: string; email: string } | null;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  // El mail arranca con el que tiene. Se sincroniza contra el id y no contra el
  // objeto: sin la comparación, cada renderizado del padre pisaría lo que la
  // dueña está escribiendo.
  const [paraId, setParaId] = useState<string | null>(null);
  if (empleada && paraId !== empleada.id) {
    setParaId(empleada.id);
    setEmail(empleada.email);
    setPassword("");
  }

  const guardar = useMutation({
    mutationFn: async () => {
      const cambios: { userId: string; email?: string; password?: string } = {
        userId: empleada!.id,
      };
      // Sólo lo que cambió de verdad. El mail se compara en minúscula porque el
      // servidor lo guarda así: sin eso, escribirlo con una mayúscula distinta
      // contaría como cambio y dispararía el chequeo de "ya existe" contra la
      // propia cuenta.
      const mail = email.trim().toLowerCase();
      if (mail !== empleada!.email.toLowerCase()) cambios.email = mail;
      if (password !== "") cambios.password = password;
      return await updateEmployeeAccess({ data: cambios });
    },
    onSuccess: async (r) => {
      await queryClient.invalidateQueries({ queryKey: ["admin-team"] });
      const que =
        r.emailCambiado && r.claveCambiada
          ? "Mail y contraseña actualizados."
          : r.emailCambiado
            ? "Mail actualizado."
            : "Contraseña actualizada.";
      toast.success(que);
      onClose();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const mailNuevo =
    empleada !== null && email.trim().toLowerCase() !== empleada.email.toLowerCase();
  const hayAlgo = mailNuevo || password !== "";
  const claveCorta = password !== "" && password.length < 8;

  return (
    <Dialog open={empleada !== null} onOpenChange={(next) => !next && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="font-display text-2xl">Acceso de {empleada?.name}</DialogTitle>
          <DialogDescription>
            Cambiá lo que haga falta y dejá el resto como está. La contraseña vacía significa que no
            se toca.
          </DialogDescription>
        </DialogHeader>

        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (hayAlgo && !claveCorta) guardar.mutate();
          }}
        >
          <div className="space-y-2">
            <Label htmlFor="empleada-email">Mail</Label>
            <Input
              id="empleada-email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="empleada@ejemplo.com"
            />
            <p className="text-xs text-muted-foreground">Es con lo que entra al panel.</p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="empleada-password">Contraseña nueva</Label>
            <Input
              id="empleada-password"
              type="text"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Dejala vacía para no cambiarla"
              // `type="text"` a propósito, igual que en el alta: la dueña se la
              // tiene que poder leer para dictársela. Esconderla detrás de
              // puntitos obliga a escribirla a ciegas y después no hay forma de
              // saber qué quedó.
              autoComplete="new-password"
            />
            {claveCorta && (
              <p className="text-xs font-medium text-destructive">
                Necesita al menos 8 caracteres.
              </p>
            )}
          </div>

          {password !== "" && (
            <p className="rounded-sm border border-border bg-secondary/40 p-3 text-xs text-muted-foreground">
              Si ahora mismo tiene el panel abierto, <strong>no se le va a cerrar</strong>: la
              contraseña nueva rige para la próxima vez que entre. Si lo que querés es sacarla ya,
              usá el interruptor «Puede entrar».
            </p>
          )}

          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="ghost" onClick={onClose}>
              Cancelar
            </Button>
            <Button type="submit" disabled={!hayAlgo || claveCorta || guardar.isPending}>
              Guardar
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
