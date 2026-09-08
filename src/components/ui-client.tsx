"use client";

// Fase A del rediseño UI/UX: piezas interactivas que no existían todavía
// (Modal, diálogo de confirmación, avisos de guardado/error). Van en un
// archivo aparte de ui.tsx porque necesitan "use client" (manejan estado y
// eventos de teclado) — así ui.tsx sigue siendo liviano para las pantallas
// que sólo renderizan datos del servidor.
//
// Todavía no están conectados a ninguna pantalla: se usan a partir de la
// Fase B, cuando reemplacemos los "¿estás seguro?" implícitos (o inexistentes)
// por confirmaciones y avisos con palabras humanas.

import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { Button } from "./ui";

export function Modal({
  open, onClose, title, children, footer,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children?: ReactNode;
  footer?: ReactNode;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-ink/40"
      role="dialog"
      aria-modal="true"
      aria-label={title}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="w-full max-w-md rounded-2xl bg-surface p-5 shadow-[var(--shadow-lg)]">
        <h2 className="text-lg font-semibold text-ink mb-2">{title}</h2>
        {children && <div className="text-sm text-ink-muted">{children}</div>}
        {footer && <div className="mt-5 flex justify-end gap-2">{footer}</div>}
      </div>
    </div>
  );
}

// Reemplaza a los confirm() nativos del navegador (que además de verse feos,
// bloquean la pestaña entera). Pensado para texto humano: "¿Eliminar a Juan
// Pérez de la lista de espera?" en vez de "¿Confirma la operación?".
export function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel = "Sí, continuar",
  cancelLabel = "Cancelar",
  danger,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  title: string;
  description?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <Modal
      open={open}
      onClose={onCancel}
      title={title}
      footer={
        <>
          <Button variant="ghost" onClick={onCancel}>
            {cancelLabel}
          </Button>
          <Button variant={danger ? "danger" : "primary"} onClick={onConfirm}>
            {confirmLabel}
          </Button>
        </>
      }
    >
      {description}
    </Modal>
  );
}

// Avisos de guardado/error ("Cambios guardados", "No se pudo guardar, probá
// de nuevo") — para que cada acción tenga una confirmación visible en vez de
// que la pantalla simplemente se quede como estaba.
type ToastTone = "ok" | "error";
type ToastItem = { id: number; message: string; tone: ToastTone };
type ToastContextValue = { show: (message: string, tone?: ToastTone) => void };
const ToastContext = createContext<ToastContextValue | null>(null);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const idRef = useRef(0);

  const show = useCallback((message: string, tone: ToastTone = "ok") => {
    const id = ++idRef.current;
    setToasts((t) => [...t, { id, message, tone }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 4000);
  }, []);

  return (
    <ToastContext.Provider value={{ show }}>
      {children}
      <div className="fixed bottom-4 inset-x-0 z-[60] flex flex-col items-center gap-2 px-4 pointer-events-none safe-bottom">
        {toasts.map((t) => (
          <div
            key={t.id}
            role="status"
            className={`pointer-events-auto max-w-sm w-full sm:w-auto rounded-xl px-4 py-3 text-sm font-medium shadow-[var(--shadow-md)] ${
              t.tone === "error"
                ? "bg-[var(--color-rojo-bg)] text-[var(--color-rojo)]"
                : "bg-[var(--color-verde-bg)] text-[var(--color-verde)]"
            }`}
          >
            {t.message}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast debe usarse dentro de <ToastProvider>");
  return ctx;
}
