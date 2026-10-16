"use client";

// Llegada desde el pop-up de «Mis comisiones» (Inicio) con ?accion=agregar:
// abre sola la acción principal de la comisión (el primer botón que envuelve)
// y saca el parámetro de la dirección para que no se vuelva a abrir al recargar.

import { useEffect, useRef, type ReactNode } from "react";

export function AbrirAlEntrar({ activo, children }: { activo: boolean; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!activo) return;
    ref.current?.querySelector<HTMLButtonElement>("button")?.click();
    const url = new URL(window.location.href);
    url.searchParams.delete("accion");
    window.history.replaceState(window.history.state, "", url);
  }, [activo]);
  return (
    <div ref={ref} className="contents">
      {children}
    </div>
  );
}
