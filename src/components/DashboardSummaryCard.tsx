import type { ReactNode } from "react";

// Componente dedicado para las 4 tarjetas de "Resumen personal" del Inicio
// (Tareas vencidas / Tareas pendientes / Calendario / Finanzas) — rediseño
// quirúrgico pedido explícitamente por el cliente, sólo de esta sección.
// Se crea aparte de <SummaryCard> (components/DashboardCard.tsx) —que sigue
// usándose sin cambios en el resto del dashboard (Comisiones, Documentos,
// "Mi cuenta", etc.)— para no generar efectos secundarios en ningún otro
// módulo. Reutiliza los mismos envoltorios interactivos ya existentes
// (<DashboardCardModal> / <DashboardCardLink>) para el click/teclado: este
// componente es puramente visual, no maneja estado ni navegación propia.
//
// Reglas de diseño pedidas y respetadas acá:
//  - Sólo tokens de color/sombra ya existentes en globals.css (ningún color
//    nuevo).
//  - El valor principal NUNCA cambia de color según si es positivo/negativo
//    (p.ej. un saldo financiero negativo no se pone rojo solo): el semáforo
//    vive únicamente en el badge/estado (prop `status`, con ícono + texto,
//    nunca sólo color) — por defecto el valor va en `--color-ink` neutro.
//  - Ícono en contenedor circular de 40px (dentro del rango 36-42px pedido).
//  - Radio de borde 16px (rounded-2xl), borde sutil, sombra liviana, sin
//    efectos exagerados: transición de 200ms y sólo leve realce de borde y
//    sombra en hover/foco.

export type SummaryTone = "azul" | "violeta" | "teal" | "verde" | "ambar" | "rojo" | "neutro";

const TONE_FG: Record<SummaryTone, string> = {
  azul: "var(--accent-blue)",
  violeta: "var(--accent-violet)",
  teal: "var(--accent-teal)",
  verde: "var(--color-verde)",
  ambar: "var(--color-amarillo)",
  rojo: "var(--color-rojo)",
  neutro: "var(--color-ink-muted)",
};
const TONE_BG: Record<SummaryTone, string> = {
  azul: "var(--accent-blue-bg)",
  violeta: "var(--accent-violet-bg)",
  teal: "var(--accent-teal-bg)",
  verde: "var(--color-verde-bg)",
  ambar: "var(--color-amarillo-bg)",
  rojo: "var(--color-rojo-bg)",
  neutro: "var(--color-surface-sunken)",
};

export function DashboardSummaryCard({
  icon,
  title,
  value,
  status,
  description,
  action = "Ver detalle →",
  tone = "neutro",
}: {
  /** Ícono Lucide (18-20px), va dentro de un chip circular tintado según `tone`. */
  icon: ReactNode;
  title: string;
  /** Dato principal — siempre en color neutro (--color-ink), nunca semáforo. */
  value: ReactNode;
  /** Estado/badge secundario — única pieza con color semántico, siempre con ícono+texto. */
  status?: ReactNode;
  description?: string;
  action?: string | null;
  /** Color del ícono/chip únicamente — nunca tiñe el valor principal. */
  tone?: SummaryTone;
}) {
  return (
    <div
      className="rounded-2xl border border-border bg-surface shadow-[var(--shadow-sm)] p-5 h-full min-h-[152px] flex flex-col gap-2.5
                 transition-[box-shadow,border-color] duration-200 ease-out
                 group-hover:shadow-[var(--shadow-md)] group-hover:border-[var(--color-border-strong)]
                 group-focus-visible:shadow-[var(--shadow-md)] group-focus-visible:border-[var(--color-border-strong)]"
    >
      <div className="flex items-center gap-3">
        <span
          className="inline-flex items-center justify-center w-10 h-10 rounded-xl shrink-0"
          style={{ background: TONE_BG[tone], color: TONE_FG[tone] }}
          aria-hidden
        >
          {icon}
        </span>
        <span className="text-sm font-semibold text-ink-muted truncate">{title}</span>
      </div>

      <div className="text-[1.75rem] leading-tight font-bold text-ink truncate">{value}</div>

      {status && <div>{status}</div>}
      {description && <p className="text-sm text-ink-faint truncate">{description}</p>}

      {action && (
        <div className="text-sm font-semibold mt-auto pt-1 text-[var(--color-brand-800)]">{action}</div>
      )}
    </div>
  );
}
