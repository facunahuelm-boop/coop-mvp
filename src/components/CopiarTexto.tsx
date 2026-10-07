"use client";

import { useState } from "react";

/** Muestra un texto (ej. un link) con un botón para copiarlo. */
export function CopiarTexto({ texto }: { texto: string }) {
  const [copiado, setCopiado] = useState(false);
  return (
    <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
      <input readOnly value={texto} onFocus={(e) => e.currentTarget.select()} className="min-w-0 flex-1 rounded-xl border border-border bg-surface-sunken px-3 py-2 text-sm text-ink" aria-label="Link" />
      <button
        type="button"
        onClick={() => {
          navigator.clipboard
            ?.writeText(texto)
            .then(() => setCopiado(true))
            .catch(() => setCopiado(false));
        }}
        className="inline-flex items-center justify-center rounded-xl border border-border bg-surface px-3.5 py-2 text-sm font-semibold text-ink hover:bg-surface-sunken"
      >
        {copiado ? "Copiado ✓" : "Copiar"}
      </button>
    </div>
  );
}
