"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

/** Fase 3F — la pantalla del proyector se actualiza sola cada pocos segundos, y muestra la hora. */
export function RefrescoAutomatico({ segundos = 4 }: { segundos?: number }) {
  const router = useRouter();
  const [hora, setHora] = useState("");
  useEffect(() => {
    const reloj = () => setHora(new Date().toLocaleTimeString("es-UY", { hour: "2-digit", minute: "2-digit", timeZone: "America/Montevideo" }));
    reloj();
    const t = setInterval(() => {
      router.refresh();
      reloj();
    }, segundos * 1000);
    return () => clearInterval(t);
  }, [router, segundos]);
  return <span suppressHydrationWarning>{hora}</span>;
}

export function PantallaCompletaBoton() {
  return (
    <button
      type="button"
      onClick={() => (document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen()).catch(() => {})}
      className="rounded-lg border border-white/30 px-3 py-1.5 text-sm font-semibold text-white/80 hover:bg-white/10"
    >
      Pantalla completa
    </button>
  );
}
