"use client";

// Llegada con ?accion=<accion> (desde el pop-up de «Mis comisiones» o los
// accesos del panel de la Directiva en Inicio): abre sola la acción que
// envuelve — el primer botón o desplegable (<summary>) — la muestra en
// pantalla y saca el parámetro de la dirección para que no se vuelva a abrir
// al recargar.

import { useEffect, useRef, type ReactNode } from "react";

export function AbrirAlEntrar({ accion, children }: { accion: string; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const url = new URL(window.location.href);
    if (url.searchParams.get("accion") !== accion) return;
    const disparador = ref.current?.querySelector<HTMLElement>("summary, button");
    disparador?.click();
    disparador?.scrollIntoView({ block: "center" });
    url.searchParams.delete("accion");
    window.history.replaceState(window.history.state, "", url);
  }, [accion]);
  return (
    <div ref={ref} className="contents">
      {children}
    </div>
  );
}
