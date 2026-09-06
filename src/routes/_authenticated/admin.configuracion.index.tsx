import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowUpRight } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { useAccess } from "@/hooks/useAccess";
import { SECCIONES_DE_CONFIGURACION } from "@/lib/configuracion";

export const Route = createFileRoute("/_authenticated/admin/configuracion/")({
  head: () => ({
    meta: [{ title: "Configuración — Panel Shiraf" }],
  }),
  component: Configuracion,
});

/**
 * La portada de Configuración.
 *
 * ── POR QUÉ UNA PORTADA Y NO SÓLO EL DESPLEGABLE DEL MENÚ ─────────────────
 *
 * Porque el menú necesita a dónde llevar cuando se toca «Configuración» —las
 * otras secciones con subsecciones, Servicios y Productos, son pantallas de
 * verdad—, y porque esto va a crecer: hoy son dos cosas, y cuando sean cinco
 * una portada que explique cada una en una línea vale más que cinco entradas
 * de menú que hay que abrir para saber qué son.
 *
 * Muestra sólo lo que la persona puede abrir. Las subsecciones piden accesos
 * distintos —ver `SECCIONES_DE_CONFIGURACION`— y el menú ya esconde la
 * sección entera a quien no puede abrir ninguna; pero la URL escrita a mano
 * llega igual, así que ese caso también tiene que decir algo.
 */
function Configuracion() {
  const { allows } = useAccess();
  const secciones = SECCIONES_DE_CONFIGURACION.filter((s) => allows(s.access));

  return (
    <div>
      <div>
        <p className="text-eyebrow text-muted-foreground">Panel</p>
        <h1 className="mt-3 font-display text-4xl text-foreground">Configuración</h1>
      </div>

      <p className="mt-4 max-w-2xl text-sm leading-relaxed text-muted-foreground">
        Lo que el centro decide una vez y vale para todo: qué días no se abre, qué dice el sitio.
        Por ahora estas dos; lo que siga va a ir entrando acá.
      </p>

      {secciones.length === 0 ? (
        <div className="mt-8 max-w-xl rounded-sm border border-dashed border-border p-8 text-center">
          <p className="text-sm text-foreground">No tenés acceso a ninguna de estas secciones.</p>
          <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
            Cerrar días pide «Gestionar turnos»; el contenido del sitio es de la dueña.
          </p>
        </div>
      ) : (
        <div className="mt-8 grid gap-4 sm:grid-cols-2">
          {secciones.map((s) => (
            /* La tarjeta entera es el enlace, no sólo el «Abrir»: es una
               portada, y en una portada se toca lo que se quiere abrir. */
            <Link key={s.to} to={s.to} className="group block">
              <Card className="h-full border-border/80 shadow-soft transition-colors group-hover:border-primary/40">
                <CardContent className="p-5">
                  <div className="flex items-center gap-3">
                    <s.icon className="h-5 w-5 shrink-0 text-gold" />
                    <p className="font-display text-xl text-foreground">{s.label}</p>
                  </div>
                  <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                    {s.descripcion}
                  </p>
                  <p className="text-eyebrow mt-4 flex items-center gap-1 text-gold">
                    Abrir <ArrowUpRight className="h-3.5 w-3.5" />
                  </p>
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
