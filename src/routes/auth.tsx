import { useEffect, useState } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Logo, LogoWordmark } from "@/components/logo";
import { PasswordInput } from "@/components/password-input";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { apiPost } from "@/lib/api";
import { buildWhatsappUrl } from "@/lib/contact";
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
  /**
   * Por qué NO salió el mail de confirmación, cuando no salió.
   *
   * El servidor lo devuelve en `avisoMail` desde que existe el alta, y esta
   * pantalla lo venía tirando a la basura: hacía el POST y ni miraba la
   * respuesta. El resultado era el peor de los dos mundos —la cuenta creada y un
   * cartel diciendo "te mandamos un mail" que era mentira— y nadie se enteraba
   * hasta que la clienta escribía por WhatsApp. Pasó el 4/9/2026.
   */
  const [avisoMail, setAvisoMail] = useState<string | null>(null);
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
      olvidarSesion(queryClient);
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
    // `avisoMail` viaja sólo cuando el mail NO salió. La cuenta igual quedó
    // creada —el alta no depende del correo—, así que esto no es un error del
    // registro: es la diferencia entre "andá a ver tu casilla" y "escribinos,
    // que no te va a llegar nada".
    let respuesta: { avisoMail?: string };
    try {
      respuesta = await apiPost<{ avisoMail?: string }>("/api/auth/register", {
        email,
        password,
        fullName,
        phone,
      });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "No se pudo crear la cuenta.");
      return;
    } finally {
      setLoading(false);
    }

    // ── EL ALTA AHORA SÍ DEJA LA SESIÓN ABIERTA ─────────────────────────────
    //
    // Hasta el 4/9/2026 acá se frenaba con un "Verificá tu mail" y había que ir
    // a la casilla antes de poder entrar. No servía para lo que parecía servir:
    // `login` nunca miró si el mail estaba confirmado, así que quien cerraba ese
    // cartel y tocaba "Ingresar" pasaba igual. Y el enlace del mail, encima,
    // llevaba a una ruta que no existía.
    //
    // Lo que de verdad espera a la confirmación es el traspaso de los turnos de
    // invitada, que se busca POR MAIL: sin la prueba de que la casilla es suya,
    // alguien se registraría con el mail de otra y se quedaría con su historial.
    // Eso sigue igual, en `verifyEmail`. Lo único que cambió es que ya no se le
    // cobra a TODA el alta el precio de una regla que protege una sola cosa.
    //
    // Si el mail no salió no se dice nada acá: el cartel de /mi-cuenta lo cuenta
    // con el botón para reintentar al lado, que es más útil que un aviso en una
    // pantalla que estamos por dejar atrás.
    if (respuesta?.avisoMail) {
      // Alcanza con éste: ahora es `avisoMail` el que decide si hay cartel y
      // cuál. El `pendingEmail` que lo acompañaba se fue con la pantalla de
      // "verificá tu mail", que era lo único que necesitaba saber a qué
      // dirección se estaba esperando.
      setAvisoMail(respuesta.avisoMail);
      return;
    }

    olvidarSesion(queryClient);
    toast.success("Cuenta creada. Te mandamos un mail para confirmar tu dirección.");
    await goToMyPlace();
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
                  <PasswordInput
                    id="password"
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
              {/*
                Este cartel quedó SÓLO para cuando el mail no salió. El de
                "verificá tu mail y después ingresá" se fue: ahora el alta entra
                derecho, y lo único que espera a la confirmación es el historial
                de invitada. Ver `signUp`.

                Cuando el mail no sale, en cambio, sigue habiendo algo que
                contar: la cuenta está creada y sirve, pero el enlace no va a
                llegar, y mandarla a esperarlo sería mentirle. Se le da el
                WhatsApp del centro, que es el canal que siempre funciona.
              */}
              {avisoMail ? (
                <div className="mt-6 rounded-sm border border-gold/50 bg-gold/10 p-6 text-center">
                  <p className="text-eyebrow text-gold">Tu cuenta quedó creada</p>
                  <h2 className="mt-4 font-display text-3xl leading-tight text-foreground">
                    No pudimos mandarte el mail
                  </h2>
                  <p className="mt-4 text-sm leading-relaxed text-muted-foreground">
                    Ya podés entrar y reservar. Lo que no salió es el mail de confirmación, así que
                    no lo esperes: escribinos y confirmamos{" "}
                    <span className="text-foreground">{email}</span> nosotras, y ahí aparecen los
                    turnos que hayas sacado antes de tener cuenta.
                  </p>
                  <p className="mt-4 text-xs leading-relaxed text-muted-foreground">
                    Motivo: {avisoMail}
                  </p>
                  <Button
                    className="mt-6 w-full"
                    onClick={() => {
                      olvidarSesion(queryClient);
                      void goToMyPlace();
                    }}
                  >
                    Ir a mi cuenta
                  </Button>
                  <Button asChild variant="outline" className="mt-3 w-full">
                    <a
                      href={buildWhatsappUrl({
                        name: fullName,
                        message: `Me registré con ${email} y no me llegó el mail de confirmación.`,
                      })}
                      target="_blank"
                      rel="noreferrer"
                    >
                      Escribirnos por WhatsApp
                    </a>
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
                    <PasswordInput
                      id="password2"
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
