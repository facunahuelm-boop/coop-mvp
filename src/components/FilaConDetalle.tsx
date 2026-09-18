"use client";

import { useState, type ReactNode } from "react";
import Link from "next/link";
import { Eye } from "lucide-react";
import { Modal } from "./ui-client";
import { Badge } from "./ui";
import { esClickEnControl } from "./TablaFiltrable";

/**
 * Rediseño de Contactos/Proveedores/Núcleos (18/09): "al hacer clic en un
 * registro NO llevar a otra pantalla, primero abrir un pop-up de detalle"
 * (pedido explícito, sección 9). Este componente envuelve la fila (el <tr>
 * completo, no una <Card> nueva) y le agrega esa apertura, más un ícono de
 * "ver" al final — sin tocar cómo cada pantalla arma sus propias <td> (se
 * pasan tal cual como `children`, JSX ya armado por el Server Component
 * llamador, mismo criterio de siempre: nunca una función cruza ese límite).
 *
 * El pop-up es un resumen liviano, no una edición completa: el botón
 * "Ver ficha completa" linkea a la pantalla de detalle YA EXISTENTE de cada
 * módulo (socios/[id], proveedores/[id]) — evita duplicar los formularios de
 * edición reales, que siguen siendo la única fuente de verdad para editar.
 */

export type SeccionDetalle = { titulo?: string; items: { label: string; valor: ReactNode }[] };

const ESTADO_BADGE: Record<string, "verde" | "amarillo" | "rojo" | "gray"> = {
  activo: "verde",
  habitual: "verde",
  aprobado: "verde",
  pendiente: "amarillo",
  nuevo: "amarillo",
  en_evaluacion: "amarillo",
  en_espera: "amarillo",
  inactivo: "gray",
  baja: "rojo",
};

export function EstadoBadge({ estado, label }: { estado: string; label?: string }) {
  return <Badge color={ESTADO_BADGE[estado] || "gray"}>{label || estado}</Badge>;
}

export function FilaConDetalle({
  titulo,
  subtitulo,
  secciones,
  editarHref,
  colSpanAcciones = 1,
  children,
}: {
  titulo: string;
  subtitulo?: string;
  secciones: SeccionDetalle[];
  editarHref?: string;
  /** Ancho (en columnas) reservado para la celda de acciones al final — casi
   * siempre 1 (un solo ícono de "ver"). */
  colSpanAcciones?: number;
  children: ReactNode;
}) {
  const [abierto, setAbierto] = useState(false);

  return (
    <>
      <tr
        onClick={(e) => {
          if (esClickEnControl(e)) return;
          setAbierto(true);
        }}
        className="border-b border-border/60 last:border-0 hover:bg-page-bg cursor-pointer transition-colors"
      >
        {children}
        <td className="py-2 pr-3 text-right" colSpan={colSpanAcciones}>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              setAbierto(true);
            }}
            title="Ver detalles"
            aria-label="Ver detalles"
            className="inline-flex items-center justify-center h-7 w-7 rounded-full text-ink-faint hover:bg-surface-sunken hover:text-ink"
          >
            <Eye size={15} />
          </button>
        </td>
      </tr>

      <Modal
        open={abierto}
        onClose={() => setAbierto(false)}
        title={titulo}
        footer={
          <>
            <button
              type="button"
              onClick={() => setAbierto(false)}
              className="inline-flex items-center justify-center rounded-xl px-4 py-2.5 text-sm font-semibold text-ink-muted hover:bg-surface-sunken transition-colors"
            >
              Cerrar
            </button>
            {editarHref && (
              <Link
                href={editarHref}
                className="inline-flex items-center justify-center rounded-xl px-4 py-2.5 text-sm font-semibold bg-brand-800 text-white hover:bg-brand-700 transition-colors"
              >
                Ver ficha completa →
              </Link>
            )}
          </>
        }
      >
        {subtitulo && <p className="text-xs text-ink-faint mb-3">{subtitulo}</p>}
        <div className="space-y-4">
          {secciones.map((s, i) => (
            <div key={i}>
              {s.titulo && (
                <p className="text-xs font-semibold text-ink-muted uppercase tracking-wide mb-1.5">{s.titulo}</p>
              )}
              <div className="space-y-1.5">
                {s.items.map((it, j) => (
                  <div key={j} className="flex items-start justify-between gap-3 text-sm">
                    <span className="text-ink-faint shrink-0">{it.label}</span>
                    <span className="text-ink font-medium text-right">{it.valor}</span>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </Modal>
    </>
  );
}
