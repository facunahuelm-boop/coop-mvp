"use client";

import { useState, type ReactNode } from "react";
import { Modal } from "./ui-client";

// Único pedacito de interactividad de las tarjetas del Inicio: abrir/cerrar
// el modal de detalle. Mismo patrón ya usado en la app (AutoSubmitSelect.tsx,
// ConfirmarEliminar.tsx) — un wrapper "use client" chico, sin lógica de
// negocio, que recibe contenido ya armado (ReactNode) del Server Component
// padre. Nunca recibe una función del servidor: eso rompería la app (ver el
// incidente de BuscadorFilas.tsx documentado en REQUIREMENTS.md).
export function CardModalTrigger({
  title,
  size,
  trigger,
  children,
}: {
  title: string;
  size: "md" | "lg" | "xl";
  trigger: ReactNode;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="group block w-full h-full text-left rounded-2xl"
        aria-haspopup="dialog"
      >
        {trigger}
      </button>
      <Modal open={open} onClose={() => setOpen(false)} title={title} size={size}>
        {children}
      </Modal>
    </>
  );
}
