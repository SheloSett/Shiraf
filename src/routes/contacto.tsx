import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Instagram, Mail, MapPin, Phone } from "lucide-react";
import { SiteHeader } from "@/components/site-header";
import { SiteFooter } from "@/components/site-footer";
import { Reveal } from "@/components/reveal";
import { TiktokIcon } from "@/components/tiktok-icon";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { api } from "@/lib/api";
import type { RtaServicios } from "@/lib/api-tipos";
import { buildWhatsappUrl, CONTACT, OPENING_HOURS } from "@/lib/contact";

export const Route = createFileRoute("/contacto")({
  head: () => ({
    meta: [
      { title: "Contacto y horarios — Shiraf" },
      {
        name: "description",
        content:
          "Escribinos por WhatsApp, conocé la dirección, los horarios de atención y cómo llegar al centro de estética Shiraf.",
      },
      { property: "og:title", content: "Contacto y horarios — Shiraf" },
      {
        property: "og:description",
        content: "Consultanos por WhatsApp. Dirección, horarios y cómo llegar.",
      },
    ],
  }),
  component: ContactPage,
});

function ContactPage() {
  const [name, setName] = useState("");
  const [treatment, setTreatment] = useState("");
  const [message, setMessage] = useState("");

  // Los tratamientos publicados alimentan el desplegable: la consulta llega con
  // el nombre exacto del servicio en vez de una descripción aproximada.
  const services = useQuery({
    queryKey: ["services", "published", "contacto"],
    queryFn: async () => (await api<RtaServicios>("/api/publico/servicios")).servicios,
  });

  function openWhatsapp(event: React.FormEvent) {
    event.preventDefault();
    const url = buildWhatsappUrl({ name, treatment, message });
    // Gesto del usuario: los bloqueadores de popups lo dejan pasar. En celular
    // abre la app directamente.
    window.open(url, "_blank", "noopener,noreferrer");
  }

  return (
    // `clip` y no `hidden`: `overflow-x: hidden` convierte al div en contenedor
    // de scroll y rompe el `sticky` del header, que dejaba de acompañar la
    // página. `clip` recorta igual sin crear el contenedor.
    <div className="min-h-screen overflow-x-clip">
      <SiteHeader />

      {/* Sin portada: la página entra directo al formulario. El h1 lo lleva
          "Escribinos", que es lo que la persona vino a hacer. */}
      <section className="grid lg:grid-cols-12">
        <div className="grid gap-16 px-5 pt-14 pb-20 lg:col-span-10 lg:col-start-2 lg:grid-cols-[1.15fr_1fr] lg:gap-20 lg:px-0 lg:pt-20 lg:pb-28">
          {/* Formulario. No manda mail ni guarda nada: redacta el mensaje y
              abre WhatsApp, que es donde el centro ya atiende. Cero backend,
              cero turnos perdidos en una casilla que nadie mira. */}
          <Reveal>
            <p className="text-eyebrow text-muted-foreground">Estamos cerca</p>
            <h1 className="display-section mt-5 text-foreground">Escribinos</h1>
            <p className="mt-6 max-w-md text-[15px] leading-relaxed text-muted-foreground">
              Si no sabés qué tratamiento te conviene, contanos y te asesoramos. Respondemos por
              WhatsApp dentro del horario de atención.
            </p>

            <form onSubmit={openWhatsapp} className="mt-10 space-y-6">
              <div className="space-y-2">
                <Label htmlFor="name">Tu nombre</Label>
                <Input
                  id="name"
                  required
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Cómo te llamás"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="treatment">Tratamiento de interés</Label>
                <select
                  id="treatment"
                  value={treatment}
                  onChange={(e) => setTreatment(e.target.value)}
                  className="h-10 w-full rounded-sm border border-input bg-background px-3 text-sm text-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none"
                >
                  <option value="">Todavía no sé / consulta general</option>
                  {services.data?.map((s) => (
                    <option key={s.id} value={s.name}>
                      {s.category} · {s.name}
                    </option>
                  ))}
                  {/* Salida para lo que no está en la lista: el detalle lo pone
                      la persona en el campo de consulta. */}
                  <option value="Otro (lo detallo abajo)">Otro — lo escribo en la consulta</option>
                </select>
              </div>

              <div className="space-y-2">
                <Label htmlFor="message">Tu consulta</Label>
                <Textarea
                  id="message"
                  rows={4}
                  value={message}
                  onChange={(e) => setMessage(e.target.value)}
                  placeholder="Contanos qué te gustaría tratar, o preguntanos lo que necesites."
                />
              </div>

              <Button type="submit" size="lg" className="w-full sm:w-auto">
                Enviar por WhatsApp
              </Button>

              <p className="text-xs leading-relaxed text-muted-foreground">
                Se abre WhatsApp con el mensaje ya escrito. Podés revisarlo antes de enviarlo.
              </p>
            </form>
          </Reveal>

          {/* Datos directos, para quien prefiere no llenar nada. */}
          <Reveal delay={120}>
            {/* Mismo eyebrow + título que la columna izquierda, para que los
                dos encabezados arranquen a la misma altura. */}
            <p className="text-eyebrow text-muted-foreground">Visitanos</p>
            <h2 className="display-section mt-5 text-foreground">Dónde estamos</h2>

            {/* Dos columnas: los cuatro datos entran en el alto del formulario y
                dejan lugar al mapa abajo. */}
            <ul className="mt-10 grid gap-7 sm:grid-cols-2">
              <li className="flex gap-4">
                <MapPin className="mt-1 h-4 w-4 shrink-0 text-gold" />
                <div>
                  <p className="text-eyebrow text-muted-foreground/70">Dirección</p>
                  <a
                    href={CONTACT.mapsUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="mt-1 block text-[15px] text-foreground underline-offset-4 hover:underline"
                  >
                    {CONTACT.address}, {CONTACT.city}
                  </a>
                </div>
              </li>

              <li className="flex gap-4">
                <Phone className="mt-1 h-4 w-4 shrink-0 text-gold" />
                <div>
                  <p className="text-eyebrow text-muted-foreground/70">Teléfono / WhatsApp</p>
                  <a
                    href={buildWhatsappUrl({})}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="mt-1 block text-[15px] text-foreground underline-offset-4 hover:underline"
                  >
                    {CONTACT.phoneDisplay}
                  </a>
                </div>
              </li>

              <li className="flex gap-4">
                <Mail className="mt-1 h-4 w-4 shrink-0 text-gold" />
                <div>
                  <p className="text-eyebrow text-muted-foreground/70">Mail</p>
                  <a
                    href={`mailto:${CONTACT.email}`}
                    className="mt-1 block text-[15px] text-foreground underline-offset-4 hover:underline"
                  >
                    {CONTACT.email}
                  </a>
                </div>
              </li>

              <li className="flex gap-4">
                <Instagram className="mt-1 h-4 w-4 shrink-0 text-gold" />
                <div>
                  <p className="text-eyebrow text-muted-foreground/70">Instagram</p>
                  <a
                    href={CONTACT.instagramUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="mt-1 block text-[15px] text-foreground underline-offset-4 hover:underline"
                  >
                    {CONTACT.instagram}
                  </a>
                </div>
              </li>

              <li className="flex gap-4">
                <TiktokIcon className="mt-1 h-4 w-4 shrink-0 text-gold" />
                <div>
                  <p className="text-eyebrow text-muted-foreground/70">TikTok</p>
                  <a
                    href={CONTACT.tiktokUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="mt-1 block text-[15px] text-foreground underline-offset-4 hover:underline"
                  >
                    {CONTACT.tiktok}
                  </a>
                </div>
              </li>
            </ul>

            {/* Mapa. La dirección de arriba sigue abriendo Google Maps en una
                pestaña; esto es para ubicarse sin salir de la página. */}
            <div className="mt-10 overflow-hidden rounded-sm border border-border">
              <iframe
                title="Ubicación de Shiraf en el mapa"
                src={CONTACT.mapsEmbedUrl}
                loading="lazy"
                referrerPolicy="no-referrer-when-downgrade"
                className="block h-[300px] w-full border-0 lg:h-[340px]"
              />
            </div>
          </Reveal>
        </div>
      </section>

      {/* Campo de color a sangre: cierra la página y llena el vacío que quedaba
          entre el contenido y el footer. */}
      <section className="surface-olive grain">
        <div className="grid lg:grid-cols-12">
          <div className="px-5 py-24 lg:col-span-10 lg:col-start-2 lg:px-0 lg:py-28">
            <Reveal>
              <p className="text-eyebrow text-primary-foreground/60">Horarios de atención</p>
            </Reveal>

            <dl className="mt-12 grid gap-x-16 gap-y-10 sm:grid-cols-3">
              {OPENING_HOURS.map((slot, i) => (
                <Reveal key={slot.days} delay={i * 80}>
                  <dt className="text-eyebrow text-gold">{slot.days}</dt>
                  <dd className="mt-4 font-display text-4xl leading-none text-primary-foreground">
                    {slot.hours}
                  </dd>
                </Reveal>
              ))}
            </dl>

            <Reveal delay={260}>
              <p className="mt-16 max-w-md border-t border-primary-foreground/20 pt-8 text-sm leading-relaxed text-primary-foreground/70">
                Los turnos se reservan online y quedan pendientes hasta que el centro los confirma.
              </p>
            </Reveal>
          </div>
        </div>
      </section>

      {/* La sección de acá arriba es oliva, así que el footer va pegado. */}
      <SiteFooter flush />
    </div>
  );
}
