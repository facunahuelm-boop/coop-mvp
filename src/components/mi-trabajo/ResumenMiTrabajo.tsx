"use client";

import { useState, type ReactNode } from "react";
import Link from "next/link";
import { Modal } from "../ui-client";

// Fase 10 del sistema de gestión de Comisiones (20/09, "Mi trabajo /
// Requiere mi atención / Centro de actividad") — mismo componente que
// ResumenSolicitudes.tsx/ResumenFinanzas.tsx/ResumenDecisiones.tsx, en su
// propia carpeta por módulo (mismo criterio ya usado en el resto del
// proyecto: cada módulo tiene su copia, no se comparte entre módulos).

export type ResumenTileItem = {
  label: ReactNode;
  sublabel?: ReactNode;
  href?: string;
};

export type ResumenTileDef = {
  id: string;
  label: string;
  value: string;
  color?: "verde" | "amarillo" | "rojo";
  items: ResumenTileItem[];
  vacioTexto?: string;
};

export function ResumenMiTrabajo({ tiles, columnas = 4 }: { tiles: ResumenTileDef[]; columnas?: 3 | 4 | 5 }) {
  const [abiertoId, setAbiertoId] = useState<string | null>(null);
  const activo = tiles.find((t) => t.id === abiertoId) || null;

  const dotClass = {
    verde: "bg-[var(--color-verde)]",
    amarillo: "bg-[var(--color-amarillo)]",
    rojo: "bg-[var(--color-rojo)]",
  } as const;

  const gridColsClass = { 3: "sm:grid-cols-3", 4: "sm:grid-cols-4", 5: "sm:grid-cols-5" }[columnas];

  return (
    <>
      <div className={`grid grid-cols-2 ${gridColsClass} gap-2 mb-5`}>
        {tiles.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setAbiertoId(t.id)}
            className="rounded-xl bg-surface-sunken px-3.5 py-3 text-left hover:shadow-[var(--shadow-sm)] hover:bg-[var(--color-brand-50)] transition-all"
          >
            <div className="flex items-center gap-2 text-xs text-ink-muted">
              {t.color && <span className={`h-2 w-2 rounded-full ${dotClass[t.color]}`} />}
              {t.label}
            </div>
            <div className="text-lg font-bold text-ink mt-0.5">{t.value}</div>
          </button>
        ))}
      </div>

      <Modal open={Boolean(activo)} onClose={() => setAbiertoId(null)} title={activo?.label || ""} size="md">
        {activo &&
          (activo.items.length === 0 ? (
            <p className="text-sm text-ink-muted text-center py-6">
              {activo.vacioTexto || "No hay registros en este momento."}
            </p>
          ) : (
            <div className="space-y-1 max-h-[60vh] overflow-y-auto -mx-1 px-1">
              {activo.items.map((it, i) =>
                it.href ? (
                  <Link
                    key={i}
                    href={it.href}
                    className="flex items-center justify-between gap-3 rounded-lg px-2.5 py-2 text-sm hover:bg-surface-sunken transition-colors"
                  >
                    <span className="font-medium text-ink">{it.label}</span>
                    {it.sublabel && <span className="text-xs text-ink-faint text-right shrink-0">{it.sublabel}</span>}
                  </Link>
                ) : (
                  <div key={i} className="flex items-center justify-between gap-3 rounded-lg px-2.5 py-2 text-sm">
                    <span className="font-medium text-ink">{it.label}</span>
                    {it.sublabel && <span className="text-xs text-ink-faint text-right shrink-0">{it.sublabel}</span>}
                  </div>
                )
              )}
            </div>
          ))}
      </Modal>
    </>
  );
}
