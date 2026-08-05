import { createFileRoute } from "@tanstack/react-router";
import { Clock, Instagram, Mail, MapPin, Phone } from "lucide-react";
import { SiteHeader } from "@/components/site-header";
import { SiteFooter } from "@/components/site-footer";

export const Route = createFileRoute("/contacto")({
  head: () => ({
    meta: [
      { title: "Contacto y horarios — Shiraf" },
      {
        name: "description",
        content:
          "Dirección, teléfono, mail y horarios de atención del centro de estética Shiraf. Escribinos para asesorarte sobre tratamientos.",
      },
      { property: "og:title", content: "Contacto y horarios — Shiraf" },
      {
        property: "og:description",
        content: "Dónde estamos, cómo contactarnos y nuestros horarios de atención.",
      },
    ],
  }),
  component: ContactPage,
});

const items = [
  { icon: MapPin, label: "Dirección", value: "Av. Siempreviva 1234, Buenos Aires" },
  { icon: Phone, label: "Teléfono / WhatsApp", value: "+54 9 11 5555-5555" },
  { icon: Mail, label: "Mail", value: "hola@shiraf.com" },
  { icon: Instagram, label: "Instagram", value: "@shiraf.estetica" },
];

function ContactPage() {
  return (
    <div className="min-h-screen">
      <SiteHeader />

      <section className="mx-auto max-w-6xl px-5 pt-16 pb-20">
        <p className="text-eyebrow text-muted-foreground">Estamos cerca</p>
        <h1 className="mt-4 text-5xl text-foreground">Contacto</h1>
        <div className="gold-rule mt-6" />

        <div className="mt-12 grid gap-12 md:grid-cols-2">
          <ul className="space-y-7">
            {items.map((item) => (
              <li key={item.label} className="flex gap-4">
                <item.icon className="mt-1 h-5 w-5 shrink-0 text-gold" />
                <div>
                  <p className="text-eyebrow text-muted-foreground">{item.label}</p>
                  <p className="mt-1 text-[15px] text-foreground">{item.value}</p>
                </div>
              </li>
            ))}
          </ul>

          <div className="surface-olive rounded-sm p-8">
            <Clock className="h-5 w-5 text-gold" />
            <p className="text-eyebrow mt-4 text-primary-foreground/70">Horarios</p>
            <ul className="mt-4 space-y-2 text-[15px] text-primary-foreground">
              <li className="flex justify-between gap-6">
                <span>Lunes a viernes</span>
                <span className="text-primary-foreground/75">9:00 — 20:00</span>
              </li>
              <li className="flex justify-between gap-6">
                <span>Sábados</span>
                <span className="text-primary-foreground/75">9:00 — 15:00</span>
              </li>
              <li className="flex justify-between gap-6">
                <span>Domingos</span>
                <span className="text-primary-foreground/75">Cerrado</span>
              </li>
            </ul>
            <p className="mt-8 text-sm leading-relaxed text-primary-foreground/70">
              Los turnos se reservan online y quedan pendientes hasta que el centro los confirma.
            </p>
          </div>
        </div>
      </section>

      <SiteFooter />
    </div>
  );
}
