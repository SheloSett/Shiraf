import { useEffect, useState } from "react";
import { createFileRoute, Link, redirect } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { CalendarDays, History, KeyRound, MailWarning, User } from "lucide-react";
import { SiteHeader } from "@/components/site-header";
import { SiteFooter } from "@/components/site-footer";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { api, apiPost, apiPut } from "@/lib/api";
import { ReprogramarTurnoDialog } from "@/components/reprogramar-turno-dialog";
import { CancelarTurnoDialog } from "@/components/cancelar-turno-dialog";
import { notifyAppointment } from "@/lib/notifications.functions";
import type { MiTurno, RtaMiCuenta, RtaMisTurnos } from "@/lib/api-tipos";
import {
  formatDateTime,
  formatMoney,
  HORAS_PARA_QUE_LA_CLIENTA_TOQUE_SU_TURNO,
  laClientaTodaviaPuede,
  STATUS_LABEL,
} from "@/lib/shiraf";
import { passwordProblem } from "@/lib/password";
import { isTeamAccount } from "@/lib/roles";
import { sesionQuery } from "@/lib/sesion";

export const Route = createFileRoute("/_authenticated/mi-cuenta")({
  /**
   * Las cuentas del centro no pasan por acá: van derecho al panel.
   *
   * Esta pantalla es de clienta —próximos turnos, historial, reservar—. La
   * dueña y las empleadas no son clientas: su cuenta existe para trabajar, y
   * dejarlas acá las hacía aterrizar en una página vacía ("No tenés turnos
   * pendientes") sin ninguna señal de que el panel existía.
   *
   * Lo que sí necesitaban de acá —cambiar la contraseña que les dictaron— se
   * mudó a /admin/cuenta.
   */
  beforeLoad: async ({ context }) => {
    if (await isTeamAccount(context.queryClient)) {
      throw redirect({ to: "/admin" });
    }
  },
  head: () => ({
    meta: [
      { title: "Mi cuenta y turnos — Shiraf" },
      {
        name: "description",
        content:
          "Tus datos, tus próximos turnos y el historial de tratamientos realizados en Shiraf.",
      },
      { property: "og:title", content: "Mi cuenta y turnos — Shiraf" },
      {
        property: "og:description",
        content: "Consultá tus próximos turnos y tu historial de tratamientos.",
      },
    ],
  }),
  component: AccountPage,
});

/**
 * "Todavía no confirmaste tu mail", con el botón para que se lo manden de nuevo.
 *
 * ── POR QUÉ ESTO EXISTE ───────────────────────────────────────────────────
 *
 * Desde el 4/9/2026 el alta entra derecho, sin pasar por la casilla. La
 * confirmación dejó de ser una tranquera y quedó siendo lo que siempre fue de
 * verdad: la prueba de que el mail es suyo, que es lo único que habilita el
 * traspaso de los turnos que sacó como invitada (ver `verifyEmail` en el
 * controller). Este cartel es el que lo pide, y sólo lo pide: no bloquea nada.
 *
 * Por eso el texto habla de los turnos anteriores y no de "activar la cuenta".
 * La cuenta ya está activa — decir lo contrario sería el mismo malentendido que
 * teníamos antes, ahora en un cartel más chico.
 */
function AvisoMailSinConfirmar() {
  const sesion = useQuery(sesionQuery());

  const reenviar = useMutation({
    mutationFn: async () =>
      await apiPost<{ mensaje?: string }>("/api/auth/resend-verification", undefined),
    onSuccess: (r) => toast.success(r?.mensaje ?? "Listo, te lo mandamos de nuevo."),
    onError: (e: Error) => toast.error(e.message),
  });

  // Mientras la sesión carga no se dibuja nada. Un cartel que aparece medio
  // segundo después de la pantalla y empuja todo hacia abajo se lee como un
  // error, y encima le saltaría a quien ya confirmó.
  if (!sesion.data || sesion.data.emailVerificado) return null;

  return (
    <div className="mt-8 flex flex-wrap items-center justify-between gap-4 rounded-sm border border-gold/50 bg-gold/10 p-5">
      <div className="flex items-start gap-3">
        <MailWarning className="mt-0.5 h-5 w-5 shrink-0 text-gold" />
        <div>
          <p className="text-sm text-foreground">Te falta confirmar tu mail</p>
          <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
            Mandamos un enlace a {sesion.data.email}. Abrilo y sumamos acá los turnos que hayas
            sacado antes de tener cuenta. Si no lo ves, fijate en el correo no deseado.
          </p>
        </div>
      </div>
      <Button
        size="sm"
        variant="outline"
        disabled={reenviar.isPending}
        onClick={() => reenviar.mutate()}
      >
        {reenviar.isPending ? "Mandando…" : "Reenviar el mail"}
      </Button>
    </div>
  );
}

/**
 * El mail de la cuenta, y el pedido para cambiarlo.
 *
 * ── POR QUÉ NO SE GUARDA CON EL RESTO DE LA FICHA ─────────────────────────
 *
 * Porque no es un dato más: es con lo que entra. El nombre y el teléfono se
 * guardan y listo; el mail se guarda en `pending_email` y no pasa nada hasta que
 * la clienta abre el enlace que le llega A LA DIRECCIÓN NUEVA. Ese rodeo es lo
 * único que evita que un dedazo —una letra de más en el dominio— la deje afuera
 * de su propia cuenta sin forma de volver, porque «olvidé mi contraseña» le
 * mandaría el enlace a una casilla que no existe.
 *
 * Por eso tiene su propio botón y su propio cartel de estado, en vez de vivir
 * adentro de "Guardar cambios".
 */
function MiMail() {
  const sesion = useQuery(sesionQuery());
  const [email, setEmail] = useState("");
  const [tocado, setTocado] = useState(false);

  const actual = sesion.data?.email ?? "";
  const pendiente = sesion.data?.emailPendiente ?? null;

  // Mientras no lo toque, el campo muestra el mail de la cuenta. `tocado` existe
  // para que la sesión —que se vuelve a pedir sola cada minuto— no le pise lo
  // que está escribiendo a mitad de camino.
  const valor = tocado ? email : actual;

  const cambiar = useMutation({
    mutationFn: async () =>
      await apiPost<{ mensaje?: string }>("/api/auth/change-email", { email: valor.trim() }),
    onSuccess: (r) => {
      setTocado(false);
      toast.success(r?.mensaje ?? "Te mandamos un enlace a la dirección nueva.");
      // Para que aparezca el renglón del pendiente sin esperar al refresco.
      void sesion.refetch();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const cambio = valor.trim().toLowerCase() !== actual.toLowerCase() && valor.trim().length > 0;

  return (
    <>
      <Label htmlFor="email">Mail</Label>
      <div className="flex flex-wrap items-center gap-3">
        <Input
          id="email"
          type="email"
          autoComplete="email"
          className="min-w-56 flex-1"
          value={valor}
          onChange={(e) => {
            setTocado(true);
            setEmail(e.target.value);
          }}
        />
        {/* El botón sólo aparece cuando de verdad escribió otra dirección. Un
            botón siempre visible al lado de un campo que no cambió invita a
            apretarlo y recibir "ése es el mail que ya tenés". */}
        {cambio && (
          <Button variant="outline" disabled={cambiar.isPending} onClick={() => cambiar.mutate()}>
            {cambiar.isPending ? "Mandando…" : "Cambiar mail"}
          </Button>
        )}
      </div>

      {pendiente ? (
        <p className="text-sm leading-relaxed text-muted-foreground">
          Te mandamos un enlace a <span className="text-foreground">{pendiente}</span>. Hasta que no
          lo abras seguís entrando con {actual}. El enlace dura una hora.
        </p>
      ) : (
        <p className="text-sm leading-relaxed text-muted-foreground">
          Es con lo que entrás y a donde te llegan los avisos de tus turnos. Si lo cambiás, te
          mandamos un enlace a la dirección nueva para confirmarla.
        </p>
      )}
    </>
  );
}

function AccountPage() {
  const queryClient = useQueryClient();
  const [fullName, setFullName] = useState("");
  const [phone, setPhone] = useState("");
  const [notes, setNotes] = useState("");
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [newPasswordAgain, setNewPasswordAgain] = useState("");

  const changePassword = useMutation({
    mutationFn: async () => {
      const problem = passwordProblem(newPassword, newPasswordAgain);
      if (problem) throw new Error(problem);
      // ⚠️ Ahora hace falta la contraseña ACTUAL, que Supabase no pedía teniendo
      // sesión abierta. Es lo que hace changePassword en Ecommerce_mm, y evita
      // que alguien que se encuentra una sesión abierta —un celular prestado,
      // una compu del centro— se apropie de la cuenta cambiándole la clave.
      await apiPut("/api/auth/password", { currentPassword, newPassword });
    },
    onSuccess: () => {
      setCurrentPassword("");
      setNewPassword("");
      setNewPasswordAgain("");
      toast.success("Contraseña actualizada.");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const profile = useQuery({
    queryKey: ["my-profile"],
    // Ya no hace falta preguntar quién soy: el servidor lo saca de la cookie.
    // La ficha y la nota vienen juntas — la nota vive en client_notes desde la
    // migración 20260814010000, para que "Ver notas clínicas" sea un candado de
    // verdad y no un filtro de pantalla.
    queryFn: async () => (await api<RtaMiCuenta>("/api/mi-cuenta")).ficha,
  });

  useEffect(() => {
    if (profile.data) {
      setFullName(profile.data.full_name ?? "");
      setPhone(profile.data.phone ?? "");
      setNotes(profile.data.notes ?? "");
    }
  }, [profile.data]);

  const appointments = useQuery({
    queryKey: ["my-appointments"],
    // El filtro por client_id sigue siendo explícito, ahora en el controller:
    // sin él la dueña o una secretaria abrirían SU cuenta y verían ahí los
    // turnos de todas las clientas, mezclados con los suyos.
    queryFn: async () => (await api<RtaMisTurnos>("/api/mi-cuenta/turnos")).turnos,
  });

  const saveProfile = useMutation({
    // La ficha y la nota se guardan en una transacción del lado del servidor.
    // Antes eran dos pedidos sueltos: si el segundo fallaba, quedaba el nombre
    // cambiado y la nota no.
    mutationFn: () => apiPut("/api/mi-cuenta", { full_name: fullName, phone, notes }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["my-profile"] });
      toast.success("Datos actualizados.");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  /** El turno abierto en el diálogo de cambiar, o null. */
  const [reprogramando, setReprogramando] = useState<MiTurno | null>(null);
  /** El turno que la clienta está por cancelar, o null. */
  const [cancelando, setCancelando] = useState<MiTurno | null>(null);

  const cancel = useMutation({
    mutationFn: async ({ id, motivo }: { id: string; motivo: string }) => {
      await apiPut(`/api/mi-cuenta/turnos/${id}/cancelar`, motivo ? { motivo } : {});

      // Avisarle al CENTRO, que es el que necesita enterarse: le quedó un hueco
      // en la agenda que todavía se puede vender, y con suerte el motivo
      // escrito. A la clienta no se le manda nada — acaba de cancelar ella.
      //
      // El fallo se traga: el turno ya está cancelado y es lo que le importa a
      // quien apretó el botón. Un mail que no sale no puede convertirse en
      // "no se pudo cancelar", que la haría intentar de nuevo.
      await notifyAppointment({
        data: { appointmentId: id, event: "client-cancelled" },
      }).catch(() => undefined);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["my-appointments"] });
      setCancelando(null);
      toast.success("Turno cancelado.");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const now = Date.now();
  const all = appointments.data ?? [];
  const upcoming = all
    .filter((a) => new Date(a.starts_at).getTime() >= now && a.status !== "cancelled")
    .sort((a, b) => a.starts_at.localeCompare(b.starts_at));
  const history = all.filter(
    (a) => new Date(a.starts_at).getTime() < now || a.status === "cancelled",
  );

  return (
    <div className="min-h-screen">
      <SiteHeader />

      <section className="mx-auto max-w-5xl px-5 pt-14 pb-20">
        <p className="text-eyebrow text-muted-foreground">Mi espacio</p>
        <h1 className="mt-4 text-5xl text-foreground">
          Hola{fullName ? `, ${fullName.split(" ")[0]}` : ""}
        </h1>
        <div className="gold-rule mt-6" />

        <AvisoMailSinConfirmar />

        <div className="mt-12 flex items-center gap-3">
          <CalendarDays className="h-5 w-5 text-gold" />
          <h2 className="font-display text-2xl text-foreground">Próximos turnos</h2>
        </div>

        <div className="mt-5 space-y-3">
          {upcoming.map((a) => (
            <Card key={a.id} className="border-border/80 shadow-soft">
              <CardContent className="flex flex-wrap items-center justify-between gap-4 p-5">
                <div>
                  <p className="font-display text-xl text-foreground">{a.services?.name}</p>
                  <p className="mt-1 text-sm text-muted-foreground">
                    {formatDateTime(a.starts_at)} · {a.professionals?.full_name}
                    {/* En qué sesión va, cuando el tratamiento es de varias:
                        con tres turnos del mismo nombre en la lista, es lo
                        único que los distingue. */}
                    {a.sessions_total > 1 && ` · sesión ${a.session_number} de ${a.sessions_total}`}
                  </p>
                </div>
                <div className="flex items-center gap-3">
                  <Badge variant={a.status === "confirmed" ? "default" : "secondary"}>
                    {STATUS_LABEL[a.status]}
                  </Badge>
                  {/* El paquete se cobra una sola vez, en la primera sesión;
                      las otras valen 0 y escribir "$ 0" se leería como un
                      error. */}
                  <span className="text-sm text-muted-foreground">
                    {a.sessions_total > 1 && a.session_number > 1
                      ? "Incluida"
                      : formatMoney(a.services?.price)}
                  </span>
                  {/* Cancelar sale sólo con margen. Pasadas las horas del
                      corte el botón se va y queda dicho qué hacer, en vez de
                      dejarlo ahí para que el servidor lo rechace después del
                      clic — que enseña la regla en el peor momento y parece un
                      error del sitio.

                      El servidor la comprueba igual, en `cancelarMiTurno`:
                      esto es cortesía, no el candado. */}
                  {laClientaTodaviaPuede(a.starts_at, now) ? (
                    <>
                      {/* Cambiar antes que cancelar, y con más peso: es lo que
                          la clienta quiere casi siempre —no puede ESE día, no
                          que no quiere venir— y es lo que al centro le conviene
                          que elija, porque así el lugar no se pierde. */}
                      <Button size="sm" variant="outline" onClick={() => setReprogramando(a)}>
                        Cambiar
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => setCancelando(a)}>
                        Cancelar
                      </Button>
                    </>
                  ) : (
                    <span
                      className="text-xs text-muted-foreground"
                      title={`Faltan menos de ${HORAS_PARA_QUE_LA_CLIENTA_TOQUE_SU_TURNO} horas`}
                    >
                      Para cambiarlo o cancelarlo, escribinos
                    </span>
                  )}
                </div>
              </CardContent>
            </Card>
          ))}
          {upcoming.length === 0 && (
            <Card className="border-dashed border-border bg-transparent shadow-none">
              <CardContent className="flex flex-wrap items-center justify-between gap-4 p-6">
                <p className="text-sm text-muted-foreground">No tenés turnos pendientes.</p>
                <Button asChild size="sm">
                  <Link to="/reservar">Reservar turno</Link>
                </Button>
              </CardContent>
            </Card>
          )}
        </div>

        <div className="mt-14 flex items-center gap-3">
          <History className="h-5 w-5 text-gold" />
          <h2 className="font-display text-2xl text-foreground">Historial</h2>
        </div>
        <div className="mt-5 divide-y divide-border border-y border-border">
          {history.map((a) => (
            <div key={a.id} className="flex flex-wrap items-center justify-between gap-3 py-4">
              <div>
                <p className="text-[15px] text-foreground">{a.services?.name}</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {formatDateTime(a.starts_at)} · {a.professionals?.full_name}
                </p>
              </div>
              <Badge variant="outline">{STATUS_LABEL[a.status]}</Badge>
            </div>
          ))}
          {history.length === 0 && (
            <p className="py-4 text-sm text-muted-foreground">
              Todavía no hay visitas registradas.
            </p>
          )}
        </div>

        <div className="mt-14 flex items-center gap-3">
          <User className="h-5 w-5 text-gold" />
          <h2 className="font-display text-2xl text-foreground">Mis datos</h2>
        </div>
        <Card className="mt-5 border-border/80 shadow-soft">
          <CardContent className="grid gap-4 p-6 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="fullName">Nombre y apellido</Label>
              <Input id="fullName" value={fullName} onChange={(e) => setFullName(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="phone">Teléfono</Label>
              <Input id="phone" value={phone} onChange={(e) => setPhone(e.target.value)} />
            </div>
            {/* El mail va acá abajo y con su propio botón, separado de
                "Guardar cambios". No es capricho de maquetado: cambiar el mail
                no se aplica al guardar, se aplica cuando la clienta abre el
                enlace que le llega a la dirección nueva. Meterlo adentro del
                mismo botón haría creer que ya está hecho. */}
            <div className="space-y-2 sm:col-span-2">
              <MiMail />
            </div>
            <div className="space-y-2 sm:col-span-2">
              <Label htmlFor="notes">Notas (alergias, tipo de piel, preferencias)</Label>
              <Textarea id="notes" value={notes} onChange={(e) => setNotes(e.target.value)} />
            </div>
            <div className="sm:col-span-2">
              <Button onClick={() => saveProfile.mutate()} disabled={saveProfile.isPending}>
                Guardar cambios
              </Button>
            </div>
          </CardContent>
        </Card>

        {/* Cambio de contraseña de la clienta. La versión del equipo vive en
            /admin/cuenta: esta pantalla ya no la ven, porque una cuenta del
            centro se desvía al panel antes de llegar acá. */}
        <div className="mt-14 flex items-center gap-3">
          <KeyRound className="h-5 w-5 text-gold" />
          <h2 className="font-display text-2xl text-foreground">Contraseña</h2>
        </div>
        <Card className="mt-5 border-border/80 shadow-soft">
          <CardContent className="grid gap-4 p-6 sm:grid-cols-2">
            <div className="space-y-2 sm:col-span-2">
              <Label htmlFor="current-pass">Tu contraseña actual</Label>
              <Input
                id="current-pass"
                type="password"
                autoComplete="current-password"
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="new-pass">Contraseña nueva</Label>
              <Input
                id="new-pass"
                type="password"
                autoComplete="new-password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="new-pass-2">Repetila</Label>
              <Input
                id="new-pass-2"
                type="password"
                autoComplete="new-password"
                value={newPasswordAgain}
                onChange={(e) => setNewPasswordAgain(e.target.value)}
              />
            </div>

            {newPassword.length > 0 && passwordProblem(newPassword, newPasswordAgain) && (
              <p className="text-xs text-destructive sm:col-span-2">
                {passwordProblem(newPassword, newPasswordAgain)}
              </p>
            )}

            <div className="sm:col-span-2">
              <Button
                onClick={() => changePassword.mutate()}
                disabled={
                  changePassword.isPending ||
                  currentPassword.length === 0 ||
                  newPasswordAgain.length === 0 ||
                  passwordProblem(newPassword, newPasswordAgain) !== null
                }
              >
                {changePassword.isPending ? "Cambiando…" : "Cambiar contraseña"}
              </Button>
              <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
                Al cambiarla seguís conectada acá, pero vas a tener que usar la nueva la próxima vez
                que ingreses.
              </p>
            </div>
          </CardContent>
        </Card>
      </section>

      <ReprogramarTurnoDialog
        turno={reprogramando}
        onOpenChange={(abierto) => !abierto && setReprogramando(null)}
      />

      {/* El mismo cartel que usa el panel, con los textos dados vuelta: acá el
          motivo no se le manda a nadie por mail a la clienta —lo escribe ella—
          sino que viaja al centro con el aviso de que se liberó el horario. */}
      <CancelarTurnoDialog
        turno={
          cancelando ? { id: cancelando.id, cuando: formatDateTime(cancelando.starts_at) } : null
        }
        quien="clienta"
        pendiente={cancel.isPending}
        onOpenChange={(abierto) => !abierto && setCancelando(null)}
        onConfirmar={(motivo) => cancelando && cancel.mutate({ id: cancelando.id, motivo })}
      />

      <SiteFooter />
    </div>
  );
}
