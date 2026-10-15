"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { QrCode } from "lucide-react";
import { Modal } from "@/components/ui-client";

/**
 * Ícono de QR de la barra superior. Abre el escáner con la cámara del
 * celular (pide el permiso del navegador la primera vez) y, al leer el QR
 * de asistencia de la obra, lleva a «Llegué / Me voy». Solo acepta códigos
 * con la forma /fichar/<código> de esta misma cooperativa: cualquier otro QR
 * se descarta. El QR lo genera únicamente la directiva (ver /qr-obra).
 */
type Estado = "pidiendo" | "escaneando" | "denegada" | "sinCamara" | "invalido";

// Acepta una URL completa o solo la ruta; devuelve la ruta interna o null.
function rutaFichar(texto: string): string | null {
  try {
    const u = new URL(texto, window.location.origin);
    if (u.origin !== window.location.origin) return null;
    return /^\/fichar\/[A-Za-z0-9_-]{8,40}$/.test(u.pathname) ? u.pathname : null;
  } catch {
    return null;
  }
}

export function EscanerQrBoton({ puedeGenerar, variante = "claro" }: { puedeGenerar: boolean; variante?: "claro" | "oscuro" }) {
  const [abierto, setAbierto] = useState(false);
  const [estado, setEstado] = useState<Estado>("pidiendo");
  const videoRef = useRef<HTMLVideoElement>(null);
  const flujoRef = useRef<MediaStream | null>(null);
  const router = useRouter();

  const apagar = useCallback(() => {
    flujoRef.current?.getTracks().forEach((t) => t.stop());
    flujoRef.current = null;
  }, []);

  const cerrar = useCallback(() => {
    apagar();
    setAbierto(false);
  }, [apagar]);

  useEffect(() => {
    if (!abierto) return;
    let activo = true;
    let raf = 0;
    let ultimoInvalido = 0;
    (async () => {
      if (!navigator.mediaDevices?.getUserMedia) {
        setEstado("sinCamara");
        return;
      }
      let flujo: MediaStream;
      try {
        flujo = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: "environment" } }, audio: false });
      } catch (e) {
        if (!activo) return;
        const nombre = (e as DOMException)?.name;
        setEstado(nombre === "NotAllowedError" || nombre === "SecurityError" ? "denegada" : "sinCamara");
        return;
      }
      if (!activo) {
        flujo.getTracks().forEach((t) => t.stop());
        return;
      }
      flujoRef.current = flujo;
      const video = videoRef.current;
      if (!video) return;
      video.srcObject = flujo;
      await video.play().catch(() => {});
      setEstado("escaneando");

      // Usa el detector nativo si el navegador lo trae; si no, jsQR.
      const Nativo = (window as unknown as { BarcodeDetector?: new (o: { formats: string[] }) => { detect: (v: HTMLVideoElement) => Promise<{ rawValue: string }[]> } }).BarcodeDetector;
      const detector = Nativo ? new Nativo({ formats: ["qr_code"] }) : null;
      const jsQR = detector ? null : (await import("jsqr")).default;
      const lienzo = document.createElement("canvas");
      const ctx = lienzo.getContext("2d", { willReadFrequently: true });

      const paso = async () => {
        if (!activo) return;
        if (video.readyState >= 2 && video.videoWidth > 0) {
          let texto: string | null = null;
          try {
            if (detector) {
              texto = (await detector.detect(video))[0]?.rawValue ?? null;
            } else if (jsQR && ctx) {
              lienzo.width = video.videoWidth;
              lienzo.height = video.videoHeight;
              ctx.drawImage(video, 0, 0);
              texto = jsQR(ctx.getImageData(0, 0, lienzo.width, lienzo.height).data, lienzo.width, lienzo.height)?.data ?? null;
            }
          } catch {
            /* un cuadro que no se pudo leer: se sigue con el siguiente */
          }
          if (texto) {
            const ruta = rutaFichar(texto);
            if (ruta) {
              apagar();
              setAbierto(false);
              router.push(ruta);
              return;
            }
            const ahora = Date.now();
            if (ahora - ultimoInvalido > 1500) {
              ultimoInvalido = ahora;
              setEstado("invalido");
              setTimeout(() => activo && setEstado("escaneando"), 1800);
            }
          }
        }
        raf = requestAnimationFrame(() => void paso());
      };
      raf = requestAnimationFrame(() => void paso());
    })();

    return () => {
      activo = false;
      cancelAnimationFrame(raf);
      apagar();
    };
  }, [abierto, apagar, router]);

  const claseBoton =
    variante === "oscuro"
      ? "inline-flex items-center justify-center h-10 w-10 rounded-full border border-white/30 text-white hover:bg-white/10"
      : "inline-flex items-center justify-center h-10 w-10 rounded-full border border-border bg-surface-sunken text-ink-muted hover:bg-brand-100 transition-colors";

  return (
    <>
      <button type="button" onClick={() => {
          setEstado("pidiendo");
          setAbierto(true);
        }} aria-label="Escanear el QR de asistencia" title="Escanear el QR de asistencia" className={claseBoton}>
        <QrCode size={18} />
      </button>
      <Modal open={abierto} onClose={cerrar} title="Escanear QR de la obra">
        <div className="space-y-3">
          {(estado === "pidiendo" || estado === "escaneando" || estado === "invalido") && (
            <>
              <div className="relative overflow-hidden rounded-xl bg-black aspect-square">
                <video ref={videoRef} playsInline muted className="h-full w-full object-cover" />
                <div className="pointer-events-none absolute inset-8 rounded-2xl border-2 border-white/80" />
              </div>
              <p className="text-sm text-ink-muted" role="status">
                {estado === "pidiendo" && "Aceptá el permiso de la cámara cuando el celular te lo pida."}
                {estado === "escaneando" && "Apuntá al QR de asistencia que muestra la directiva."}
                {estado === "invalido" && <span className="font-semibold text-[var(--color-rojo)]">Ese QR no es el de asistencia de la obra.</span>}
              </p>
            </>
          )}
          {estado === "denegada" && (
            <p className="rounded-xl bg-[var(--color-amarillo-bg)] p-3 text-sm text-ink" role="alert">
              La cámara está bloqueada. Tocá el candado junto a la dirección del sitio, permití la cámara y volvé a abrir el escáner.
            </p>
          )}
          {estado === "sinCamara" && (
            <p className="rounded-xl bg-[var(--color-amarillo-bg)] p-3 text-sm text-ink" role="alert">
              No se pudo usar la cámara en este dispositivo. Podés escanear el QR con la cámara normal del celular.
            </p>
          )}
          {puedeGenerar && (
            <Link href="/qr-obra" onClick={cerrar} className="block text-center text-sm font-semibold underline text-[var(--color-brand-800)]">
              Mostrar el QR del día (directiva)
            </Link>
          )}
        </div>
      </Modal>
    </>
  );
}
