"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { cambiarLetraGrandeAction } from "@/lib/actions/preferencias";

/**
 * Fase 1A (accesibilidad): interruptor "Letra grande". Se aplica al instante
 * en esta pantalla y queda guardado en la cuenta.
 */
export function LetraGrandeToggle({ activo }: { activo: boolean }) {
  const [on, setOn] = useState(activo);
  const [pendiente, startTransition] = useTransition();
  const router = useRouter();

  const cambiar = () => {
    const nuevo = !on;
    setOn(nuevo);
    document.documentElement.style.fontSize = nuevo ? "112.5%" : "";
    startTransition(async () => {
      await cambiarLetraGrandeAction(nuevo);
      router.refresh();
    });
  };

  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      onClick={cambiar}
      disabled={pendiente}
      className="w-full flex items-center justify-between gap-3 rounded-xl border border-border bg-surface px-4 py-3 text-left hover:bg-surface-sunken transition-colors"
    >
      <span>
        <span className="block text-[15px] font-semibold text-ink">Letra grande</span>
        <span className="block text-sm text-ink-muted">Agranda todo el texto de COOVA para leerlo más cómodo.</span>
      </span>
      <span
        aria-hidden
        className={`relative inline-flex h-7 w-12 shrink-0 rounded-full transition-colors ${on ? "bg-[var(--color-brand-800)]" : "bg-slate-300"}`}
      >
        <span className={`absolute top-0.5 h-6 w-6 rounded-full bg-white shadow transition-all ${on ? "left-[1.375rem]" : "left-0.5"}`} />
      </span>
      <span className="sr-only">{on ? "Activada" : "Desactivada"}</span>
    </button>
  );
}
