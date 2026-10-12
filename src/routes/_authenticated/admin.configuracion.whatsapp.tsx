import { useEffect, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { QrCode, RefreshCw, Unlink } from "lucide-react";
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
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { api, apiPost } from "@/lib/api";
import type { RtaWhatsappEstado, RtaWhatsappQr } from "@/lib/api-tipos";
import { cn } from "@/lib/utils";

/**
 * La conexión del chip de avisos, para la dueña (11/10/2026).
 *
 * Hasta hoy, cuando el chip se desvinculaba, reconectarlo era cosa del
 * desarrollador: terminal del VPS, la llave de Evolution, un QR dibujado en la
 * consola. La decisión fue que el chip lo maneja la dueña, así que esta
 * pantalla le da lo mismo que daban esos comandos, con un clic cada uno:
 *
 *   · El estado, que se actualiza solo.
 *   · «Reconectar», que reinicia la conexión sin pedir QR. Alcanza cuando el
 *     teléfono estuvo apagado un rato.
 *   · «Vincular de nuevo», que muestra el QR acá mismo para escanearlo desde
 *     el teléfono. Es para cuando la sesión se perdió del todo.
 *
 * El QR se renueva solo cada veinte segundos mientras está a la vista, porque
 * vence; y en cuanto la conexión abre, se esconde y avisa. Ver el controlador
 * (`whatsapp.controller.ts`) para el porqué de cada endpoint.
 */
export const Route = createFileRoute("/_authenticated/admin/configuracion/whatsapp")({
  head: () => ({
    meta: [{ title: "WhatsApp de avisos — Panel Shiraf" }],
  }),
  component: WhatsappDeAvisos,
});

const ESTADOS: Record<
  NonNullable<RtaWhatsappEstado["estado"]> | "sin-dato",
  { texto: string; punto: string; detalle: string }
> = {
  open: {
    texto: "Conectado",
    punto: "bg-emerald-500",
    detalle: "Los avisos están saliendo por WhatsApp.",
  },
  connecting: {
    texto: "Conectando…",
    punto: "bg-gold animate-pulse",
    detalle: "Está intentando abrir la sesión. Suele tardar menos de un minuto.",
  },
  close: {
    texto: "Desconectado",
    punto: "bg-destructive",
    detalle:
      "Por WhatsApp no sale ningún aviso hasta que se reconecte. Los mails siguen saliendo igual.",
  },
  "sin-dato": {
    texto: "Sin respuesta",
    punto: "bg-muted-foreground",
    detalle: "El servicio de WhatsApp no contesta. Si sigue así en unos minutos, avisale a Shelo.",
  },
};

function WhatsappDeAvisos() {
  const queryClient = useQueryClient();
  const [mostrarQr, setMostrarQr] = useState(false);
  const [confirmarDesvincular, setConfirmarDesvincular] = useState(false);

  const estado = useQuery({
    queryKey: ["whatsapp-estado"],
    queryFn: () => api<RtaWhatsappEstado>("/api/whatsapp/estado"),
    // Conectado se mira cada medio minuto; en cualquier otro estado, cada
    // cinco segundos, que es cuando alguien está esperando que cambie.
    refetchInterval: (query) => (query.state.data?.estado === "open" ? 30_000 : 5_000),
  });

  const conectado = estado.data?.estado === "open";
  const porEvolution = estado.data?.transporte === "evolution";

  const qr = useQuery({
    queryKey: ["whatsapp-qr"],
    queryFn: () => api<RtaWhatsappQr>("/api/whatsapp/qr"),
    enabled: mostrarQr && porEvolution && !conectado,
    // Un QR vence a los pocos segundos: se pide uno nuevo mientras está a la
    // vista, y nunca se muestra uno guardado de antes.
    refetchInterval: 20_000,
    staleTime: 0,
    gcTime: 0,
    retry: false,
  });

  // Escaneó: la conexión abrió. Se esconde el QR y se festeja.
  useEffect(() => {
    if (mostrarQr && conectado) {
      setMostrarQr(false);
      toast.success("WhatsApp conectado.", { description: "Los avisos vuelven a salir." });
    }
  }, [mostrarQr, conectado]);

  const reconectar = useMutation({
    mutationFn: () => apiPost<{ ok: true }>("/api/whatsapp/reconectar"),
    onSuccess: () => {
      toast.success("Reiniciando la conexión.", {
        description: "En unos segundos se actualiza el estado acá arriba.",
      });
      // Evolution tarda unos segundos en volver a abrir; el refetch de cinco
      // segundos lo va a ver, esto sólo apura la primera mirada.
      setTimeout(() => queryClient.invalidateQueries({ queryKey: ["whatsapp-estado"] }), 4_000);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const desvincular = useMutation({
    mutationFn: () => apiPost<{ ok: true }>("/api/whatsapp/desvincular"),
    onSuccess: () => {
      setConfirmarDesvincular(false);
      toast.success("Sesión cerrada.", { description: "Escaneá el QR para vincular de nuevo." });
      queryClient.invalidateQueries({ queryKey: ["whatsapp-estado"] });
      setMostrarQr(true);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const info = estado.data ? ESTADOS[estado.data.estado ?? "sin-dato"] : null;

  return (
    <div>
      <div>
        <p className="text-eyebrow text-muted-foreground">Configuración</p>
        <h1 className="mt-3 font-display text-4xl text-foreground">WhatsApp de avisos</h1>
      </div>

      <p className="mt-4 max-w-2xl text-sm leading-relaxed text-muted-foreground">
        Los avisos de turno salen por WhatsApp desde el chip del centro, que está vinculado a este
        sistema como si fuera WhatsApp Web. Si el teléfono del chip se queda apagado o sin internet
        varios días, la conexión se corta. Acá se ve cómo está y se vuelve a conectar sin ayuda de
        nadie.
      </p>

      {estado.isLoading ? (
        <p className="mt-8 text-sm text-muted-foreground">Consultando…</p>
      ) : estado.isError ? (
        <p className="mt-8 text-sm text-destructive">{(estado.error as Error).message}</p>
      ) : !porEvolution ? (
        <Card className="mt-8 max-w-xl border-border/80 shadow-soft">
          <CardContent className="p-5">
            <p className="font-medium text-foreground">
              {estado.data?.transporte === "meta"
                ? "Los avisos salen por la API oficial de Meta."
                : "El WhatsApp de avisos no está encendido en este servidor."}
            </p>
            <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
              {estado.data?.transporte === "meta"
                ? "Por ese camino no hay chip ni QR: no hay nada que reconectar desde acá."
                : "Los avisos están saliendo sólo por mail. Encenderlo es cosa del servidor, no de esta pantalla."}
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="mt-8 grid gap-8 lg:grid-cols-[minmax(0,24rem)_1fr]">
          <Card className="h-fit border-border/80 shadow-soft">
            <CardContent className="space-y-5 p-5">
              <div className="flex items-center gap-3">
                <span className={cn("h-3 w-3 shrink-0 rounded-full", info?.punto)} />
                <p className="font-display text-2xl text-foreground">{info?.texto}</p>
              </div>
              <p className="text-sm leading-relaxed text-muted-foreground">{info?.detalle}</p>

              <div className="flex flex-col gap-2">
                <Button
                  variant="outline"
                  disabled={reconectar.isPending || conectado}
                  onClick={() => reconectar.mutate()}
                >
                  <RefreshCw
                    className={cn("mr-2 h-4 w-4", reconectar.isPending && "animate-spin")}
                  />
                  Reconectar
                </Button>
                <Button
                  disabled={conectado || mostrarQr}
                  onClick={() => setMostrarQr(true)}
                  title={conectado ? "Ya está conectado: no hace falta vincular" : undefined}
                >
                  <QrCode className="mr-2 h-4 w-4" /> Vincular de nuevo
                </Button>
              </div>

              <p className="text-xs leading-relaxed text-muted-foreground">
                Probá primero «Reconectar»: si el teléfono sólo estuvo apagado un rato, alcanza. Si
                a los dos minutos sigue desconectado, «Vincular de nuevo».
              </p>

              {/* Desvincular es la salida para un caso raro: el teléfono ya no
                  muestra el dispositivo pero Evolution cree que lo tiene y no
                  da QR. Va chico y con confirmación, porque corta a propósito
                  lo que todavía podía estar andando. */}
              <button
                type="button"
                className="flex items-center gap-1.5 text-xs text-muted-foreground underline-offset-4 hover:underline"
                onClick={() => setConfirmarDesvincular(true)}
              >
                <Unlink className="h-3.5 w-3.5" /> Cerrar la sesión y empezar de cero
              </button>
            </CardContent>
          </Card>

          <div>
            {mostrarQr && !conectado ? (
              <Card className="border-border/80 shadow-soft">
                <CardContent className="p-5">
                  <p className="font-medium text-foreground">Escaneá este código desde el chip</p>
                  <ol className="mt-2 list-decimal space-y-1 pl-5 text-sm leading-relaxed text-muted-foreground">
                    <li>Agarrá el teléfono del chip de avisos, prendido y con internet.</li>
                    <li>
                      En WhatsApp: los tres puntos de arriba a la derecha →{" "}
                      <b>Dispositivos vinculados</b> → <b>Vincular un dispositivo</b>.
                    </li>
                    <li>Apuntá la cámara a este código. En cuanto conecte, esto avisa solo.</li>
                  </ol>

                  <div className="mt-5 flex flex-col items-center gap-3">
                    {qr.isLoading ? (
                      <p className="text-sm text-muted-foreground">Generando el código…</p>
                    ) : qr.isError ? (
                      <p className="text-sm text-destructive">{(qr.error as Error).message}</p>
                    ) : qr.data?.base64 ? (
                      <img
                        src={qr.data.base64}
                        alt="Código QR para vincular el chip de avisos"
                        className="h-64 w-64 rounded-sm border border-border bg-white p-2"
                      />
                    ) : (
                      <p className="text-sm text-muted-foreground">
                        No vino el código. Probá «Cerrar la sesión y empezar de cero» y volvé a
                        intentar.
                      </p>
                    )}
                    {qr.data?.pairingCode && (
                      <p className="text-xs text-muted-foreground">
                        Sin cámara, en «Vincular con el número de teléfono»:{" "}
                        <b className="tracking-widest">{qr.data.pairingCode}</b>
                      </p>
                    )}
                    <p className="text-xs text-muted-foreground">
                      El código se renueva solo cada veinte segundos.
                    </p>
                    <Button variant="ghost" size="sm" onClick={() => setMostrarQr(false)}>
                      Cancelar
                    </Button>
                  </div>
                </CardContent>
              </Card>
            ) : (
              <div className="max-w-xl rounded-sm border border-dashed border-border p-6">
                <p className="text-sm font-medium text-foreground">Para que no se corte</p>
                <ul className="mt-2 list-disc space-y-1 pl-5 text-sm leading-relaxed text-muted-foreground">
                  <li>
                    El teléfono del chip queda prendido, enchufado y con WiFi, todo el tiempo.
                  </li>
                  <li>En ese teléfono, sin ahorro de batería para WhatsApp.</li>
                  <li>
                    Si igual se corta, el sistema lo reintenta solo cada diez minutos. Si no vuelve,
                    te llega un mail y se arregla desde acá.
                  </li>
                </ul>
              </div>
            )}
          </div>
        </div>
      )}

      <AlertDialog open={confirmarDesvincular} onOpenChange={setConfirmarDesvincular}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Cerrar la sesión del chip?</AlertDialogTitle>
            <AlertDialogDescription>
              Los avisos por WhatsApp dejan de salir hasta que escanees el QR de nuevo. Es para
              cuando «Vincular de nuevo» no muestra ningún código.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Dejar como está</AlertDialogCancel>
            <AlertDialogAction
              disabled={desvincular.isPending}
              onClick={(e) => {
                e.preventDefault();
                desvincular.mutate();
              }}
            >
              Cerrar la sesión
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
