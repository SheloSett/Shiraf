import { useEffect, useState } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { toast } from "sonner";
import { Logo, LogoWordmark } from "@/components/logo";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { supabase } from "@/integrations/supabase/client";

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
  const [loading, setLoading] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [fullName, setFullName] = useState("");
  const [phone, setPhone] = useState("");
  /** Mail a confirmar. Si está seteado, el registro quedó a la espera. */
  const [pendingEmail, setPendingEmail] = useState<string | null>(null);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      if (data.session) navigate({ to: "/mi-cuenta" });
    });
  }, [navigate]);

  async function signIn(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    setLoading(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    navigate({ to: "/mi-cuenta" });
  }

  async function signUp(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        emailRedirectTo: window.location.origin,
        data: { full_name: fullName, phone },
      },
    });
    setLoading(false);
    if (error) {
      toast.error(error.message);
      return;
    }

    // Si el proyecto exige confirmar el mail, signUp devuelve el usuario pero
    // `session` en null. Antes se anunciaba "Cuenta creada" igual y se navegaba
    // a /mi-cuenta, que sin sesión rebota de vuelta a /auth: el mensaje mentía
    // y el redirect no llevaba a ningún lado.
    if (!data.session) {
      setPendingEmail(email);
      return;
    }

    toast.success("Cuenta creada. ¡Bienvenida a Shiraf!");
    navigate({ to: "/mi-cuenta" });
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
                  <Label htmlFor="password">Contraseña</Label>
                  <Input
                    id="password"
                    type="password"
                    required
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                  />
                </div>
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
                      minLength={6}
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
