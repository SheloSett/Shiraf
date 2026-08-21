import { useEffect, useState } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Logo, LogoWordmark } from "@/components/logo";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { apiPost } from "@/lib/api";
import { olvidarSesion, pedirSesion } from "@/lib/sesion";
import { MIN_PASSWORD_LENGTH } from "@/lib/password";
import { isTeamAccount } from "@/lib/roles";

export const Route = createFileRoute("/auth")({
  head: () => ({
    meta: [
      { title: "Ingresar o crear cuenta — Shiraf" },
      {
        name: "description",
        content:
          "Accedé a tu cuenta de Shiraf para reservar turnos, ver tu historial de tratamientos y tus próximas citas.",
      },
      { property: "og:title", content: "Ingresar o crear cuenta — Shiraf" },
      {
        property: "og:description",
        content: "Ingresá para reservar turnos y ver tu historial de tratamientos.",
      },
    ],
  }),
  component: AuthPage,
});

function AuthPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [loading, setLoading] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [fullName, setFullName] = useState("");
  const [phone, setPhone] = useState("");
  /** Mail a confirmar. Si está seteado, el registro quedó a la espera. */
  const [pendingEmail, setPendingEmail] = useState<string | null>(null);
  /** Mail al que se mandó el enlace de recuperación, si se pidió uno. */
  const [recoverySent, setRecoverySent] = useState<string | null>(null);

  /**
   * A dónde va cada quien después de ingresar.
   *
   * Antes todas terminaban en /mi-cuenta. Para la dueña y las empleadas eso era
   * la pantalla equivocada: entraban con la cuenta del centro y aterrizaban en
   * el espacio de clienta, sin nada suyo adentro y sin ninguna puerta visible al
   * panel. Había que saberse la URL /admin de memoria.
   */
  async function goToMyPlace() {
    const team = await isTeamAccount(queryClient);
    navigate({ to: team ? "/admin" : "/mi-cuenta" });
  }

  // Ya venía con sesión abierta: no la dejamos en el formulario de ingreso, la
  // mandamos a donde le corresponde. La lógica va escrita adentro del efecto y
  // no llamando a goToMyPlace para no tener que declararla como dependencia:
  // es una función nueva en cada render y el efecto se volvería a disparar.
  useEffect(() => {
    void pedirSesion(queryClient).then(async (sesion) => {
      if (!sesion) return;
      const team = await isTeamAccount(queryClient);
      navigate({ to: team ? "/admin" : "/mi-cuenta" });
    });
  }, [navigate, queryClient]);

  async function signIn(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    try {
      await apiPost("/api/auth/login", { email, password });
      // La sesión vive en una cookie httpOnly, así que no hay nada que guardar
      // acá: lo único que hace falta es tirar lo que react-query recuerde de la
      // sesión anterior. Es lo que antes hacía onAuthStateChange.
      await olvidarSesion(queryClient);
      await goToMyPlace();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "No se pudo ingresar.");
    } finally {
      setLoading(false);
    }
  }

  /**
   * Manda el mail con el enlace para elegir una contraseña nueva.
   *
   * Siempre dice "listo", exista o no la cuenta. Si respondiera distinto según
   * el caso, cualquiera podría averiguar qué mails están registrados en el
   * centro probando de a uno — y acá saber que alguien es clienta ya es
   * información sobre su salud.
   */
  async function requestRecovery() {
    if (!email.trim()) {
      toast.error("Escribí tu mail arriba y volvé a tocar el enlace.");
      return;
    }
    setLoading(true);
    // No se mira si falla: la respuesta es siempre la misma exista o no la
    // cuenta, y eso ya lo garantiza el servidor. Mostrar un error acá sería
    // justamente la diferencia que se quiere evitar.
    await apiPost("/api/auth/forgot-password", { email: email.trim() }).catch(() => {});
    setLoading(false);
    setRecoverySent(email.trim());
  }

  async function signUp(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    try {
      await apiPost("/api/auth/register", { email, password, fullName, phone });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "No se pudo crear la cuenta.");
      return;
    } finally {
      setLoading(false);
    }

    // El alta NO deja la sesión abierta, y es a propósito: hasta que no confirma
    // el mail no se le vinculan los turnos que había sacado como invitada,
    // porque ese vínculo se busca POR MAIL. Sin confirmar, cualquiera se
    // registraría con el mail de otra y vería sus turnos.
    //
    // Antes acá se preguntaba si vino sesión, porque con Supabase dependía de
    // una casilla del panel. Ahora no depende de nada: nunca viene.
    setPendingEmail(email);
  }

  return (
    <div className="grid min-h-screen lg:grid-cols-2">
      <div className="surface-olive hidden flex-col justify-between p-12 lg:flex">
        <LogoWordmark tone="light" />
        <div>
          <h1 className="max-w-sm text-5xl leading-tight text-primary-foreground">
            Tu espacio de calma, ordenado.
          </h1>
          <p className="mt-6 max-w-sm text-sm leading-relaxed text-primary-foreground/70">
            Reservá turnos, seguí tu historial de tratamientos y no te pierdas ninguna cita.
          </p>
        </div>
        <p className="text-eyebrow text-primary-foreground/50">Calma, belleza y bienestar</p>
      </div>

      <div className="flex items-center justify-center px-5 py-16">
        <div className="w-full max-w-sm">
          <div className="flex justify-center lg:hidden">
            <Logo className="h-16 w-16" />
          </div>

          <Tabs defaultValue="signin" className="mt-8">
            <TabsList className="grid w-full grid-cols-2">
              <TabsTrigger value="signin">Ingresar</TabsTrigger>
              <TabsTrigger value="signup">Crear cuenta</TabsTrigger>
            </TabsList>

            <TabsContent value="signin">
              <form onSubmit={signIn} className="mt-6 space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="email">Mail</Label>
                  <Input
                    id="email"
                    type="email"
                    required
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                  />
                </div>
                <div className="space-y-2">
                  <div className="flex items-baseline justify-between gap-3">
                    <Label htmlFor="password">Contraseña</Label>
                    {/* type=button: dentro de un <form>, un botón sin type
                        envía el formulario e intentaría iniciar sesión. */}
                    <button
                      type="button"
                      onClick={requestRecovery}
                      disabled={loading}
                      className="text-xs text-muted-foreground underline underline-offset-2 transition-colors hover:text-foreground"
                    >
                      Olvidé mi contraseña
                    </button>
                  </div>
                  <Input
                    id="password"
                    type="password"
                    required
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                  />
                </div>

                {recoverySent && (
                  <div className="rounded-sm border border-gold/50 bg-gold/10 p-4">
                    <p className="text-xs leading-relaxed text-foreground">
                      Si <span className="font-medium">{recoverySent}</span> tiene una cuenta, le
                      llega un enlace para elegir una contraseña nueva. Dura una hora y sirve una
                      sola vez. Revisá también el correo no deseado.
                    </p>
                  </div>
                )}

                <Button type="submit" className="w-full" disabled={loading}>
                  Ingresar
                </Button>
              </form>
            </TabsContent>

            <TabsContent value="signup">
              {pendingEmail ? (
                <div className="mt-6 rounded-sm border border-gold/50 bg-gold/10 p-6 text-center">
                  <p className="text-eyebrow text-gold">Falta un paso</p>
                  <h2 className="mt-4 font-display text-3xl leading-tight text-foreground">
                    Verificá tu mail
                  </h2>
                  <p className="mt-4 text-sm leading-relaxed text-muted-foreground">
                    Te mandamos un enlace de confirmación a{" "}
                    <span className="text-foreground">{pendingEmail}</span>. Abrilo para activar tu
                    cuenta y después ingresá.
                  </p>
                  <p className="mt-4 text-xs leading-relaxed text-muted-foreground">
                    Si no lo ves, revisá la carpeta de spam.
                  </p>
                  <Button
                    variant="outline"
                    className="mt-6"
                    onClick={() => {
                      setPendingEmail(null);
                      setPassword("");
                    }}
                  >
                    Usar otro mail
                  </Button>
                </div>
              ) : (
                <form onSubmit={signUp} className="mt-6 space-y-4">
                  <div className="space-y-2">
                    <Label htmlFor="name">Nombre y apellido</Label>
                    <Input
                      id="name"
                      required
                      value={fullName}
                      onChange={(e) => setFullName(e.target.value)}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="phone">Teléfono</Label>
                    <Input id="phone" value={phone} onChange={(e) => setPhone(e.target.value)} />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="email2">Mail</Label>
                    <Input
                      id="email2"
                      type="email"
                      required
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="password2">Contraseña</Label>
                    <Input
                      id="password2"
                      type="password"
                      required
                      // Era 6 acá y 8 en el alta de empleadas, sin que nadie lo
                      // hubiera decidido. Unificado en MIN_PASSWORD_LENGTH.
                      minLength={MIN_PASSWORD_LENGTH}
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                    />
                  </div>
                  <Button type="submit" className="w-full" disabled={loading}>
                    Crear cuenta
                  </Button>
                </form>
              )}
            </TabsContent>
          </Tabs>

          <p className="mt-6 text-center text-xs leading-relaxed text-muted-foreground">
            Al crear tu cuenta vas a poder reservar turnos y ver tu historial de tratamientos.
          </p>
        </div>
      </div>
    </div>
  );
}
