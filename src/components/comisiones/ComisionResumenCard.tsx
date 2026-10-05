"use client";

// Comisiones como áreas de trabajo (05/10): el tablero de Comisiones es un
// resumen — cada comisión es una tarjeta chica (qué es, cuántos integrantes,
// una métrica de actividad, lo próximo y su estado). Al tocarla se abre este
// pop-up con un poco más de contexto y la acción "Ver comisión completa",
// que lleva a su página propia (/comisiones/[id], que NO está en el menú).

import { useState } from "react";
import Link from "next/link";
import { Users } from "lucide-react";
import { Modal } from "@/components/ui-client";
import { Badge } from "@/components/ui";

export type ComisionResumen = {
  id: number;
  nombre: string;
  descripcion: string | null;
  objetivo: string | null;
  funcionLabel: string;
  responsable: string | null;
  integrantes: { userId: number; nombre: string; rol: string }[];
  estado: { label: string; color: "verde" | "amarillo" | "gray" | "azul" };
  metrica: { label: string; valor: string } | null;
  proxima: string | null;
  semana: string[];
  actividad: string[];
};

const ROL_LABEL: Record<string, string> = { coordinador: "Coordinador/a", integrante: "Integrante", suplente: "Suplente" };

export function ComisionResumenCard({ c }: { c: ComisionResumen }) {
  const [abierto, setAbierto] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={() => setAbierto(true)}
        className="text-left w-full rounded-2xl border border-border bg-surface p-4 shadow-[var(--shadow-sm)] hover:border-[var(--color-brand-800)]/40 hover:shadow-[var(--shadow-md)] transition-all focus:outline-none focus:ring-2 focus:ring-[var(--color-brand-800)]/30"
      >
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <h3 className="text-[15px] font-bold text-[var(--color-brand-900)] leading-snug">{c.nombre}</h3>
            <p className="text-xs text-ink-faint mt-0.5 flex items-center gap-1">
              <Users size={12} /> {c.integrantes.length} integrante{c.integrantes.length === 1 ? "" : "s"}
            </p>
          </div>
          <span className="shrink-0 whitespace-nowrap"><Badge color={c.estado.color}>{c.estado.label}</Badge></span>
        </div>
        {c.metrica && (
          <p className="mt-3 text-sm text-ink">
            <span className="text-ink-faint">{c.metrica.label}: </span>
            <span className="font-semibold">{c.metrica.valor}</span>
          </p>
        )}
        <p className="mt-1 text-sm text-ink-muted">
          <span className="text-ink-faint">Próxima actividad: </span>
          {c.proxima || "sin agendar"}
        </p>
      </button>

      <Modal
        open={abierto}
        onClose={() => setAbierto(false)}
        title={c.nombre}
        size="lg"
        footer={
          <>
            <button
              type="button"
              onClick={() => setAbierto(false)}
              className="inline-flex items-center justify-center rounded-xl px-4 py-2.5 text-sm font-semibold text-ink-muted hover:bg-surface-sunken transition-colors"
            >
              Cerrar
            </button>
            <Link
              href={`/comisiones/${c.id}`}
              className="inline-flex items-center justify-center rounded-xl px-4 py-2.5 text-sm font-semibold bg-brand-800 text-white hover:bg-brand-700 transition-colors"
            >
              Ver comisión completa →
            </Link>
          </>
        }
      >
        <div className="space-y-4 text-sm">
          <div className="flex flex-wrap items-center gap-2">
            <Badge color="gray">{c.funcionLabel}</Badge>
            <Badge color={c.estado.color}>{c.estado.label}</Badge>
          </div>
          {(c.descripcion || c.objetivo) && (
            <div className="space-y-1 text-ink-muted">
              {c.descripcion && <p>{c.descripcion}</p>}
              {c.objetivo && <p>Objetivo: {c.objetivo}</p>}
            </div>
          )}
          <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-2">
            <div>
              <dt className="text-xs text-ink-faint">Responsable</dt>
              <dd className="font-medium">{c.responsable || "Sin asignar"}</dd>
            </div>
            <div>
              <dt className="text-xs text-ink-faint">Próxima actividad</dt>
              <dd className="font-medium">{c.proxima || "Sin agendar"}</dd>
            </div>
          </dl>

          <div>
            <p className="text-xs font-semibold text-ink-muted uppercase tracking-wide mb-1.5">Integrantes ({c.integrantes.length})</p>
            {c.integrantes.length ? (
              <ul className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-1">
                {c.integrantes.map((m) => (
                  <li key={m.userId} className="flex items-center justify-between gap-2">
                    <span className="truncate">{m.nombre}</span>
                    <span className={`text-xs shrink-0 ${m.rol === "coordinador" ? "text-[var(--color-brand-800)] font-semibold" : "text-ink-faint"}`}>
                      {ROL_LABEL[m.rol] ?? m.rol}
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-ink-faint">Todavía no tiene integrantes.</p>
            )}
          </div>

          {c.actividad.length > 0 && (
            <div>
              <p className="text-xs font-semibold text-ink-muted uppercase tracking-wide mb-1.5">Actividad</p>
              <ul className="space-y-0.5 text-ink-muted">
                {c.actividad.map((a, i) => <li key={i}>{a}</li>)}
              </ul>
            </div>
          )}
          {c.semana.length > 0 && (
            <div>
              <p className="text-xs font-semibold text-ink-muted uppercase tracking-wide mb-1.5">Esta semana</p>
              <ul className="space-y-0.5 text-ink-muted">
                {c.semana.map((a, i) => <li key={i}>{a}</li>)}
              </ul>
            </div>
          )}
        </div>
      </Modal>
    </>
  );
}
