import type { ReactNode } from "react";
import Link from "next/link";
import { CardModalTrigger } from "./DashboardCardClient";

// Rediseño del Inicio (dashboard) — Sept. 2026. Principio rector pedido:
// RESUMEN → CLICK → POP-UP → DETALLE. El Inicio anterior (ver historial en
// dashboard/page.tsx) mostraba una <Card> larga y completa por módulo,
// siempre desplegada; acá cada módulo pasa a ser una tarjeta chica con
// jerarquía de 4 niveles (ícono+título, dato principal, estado secundario,
// acción "Ver detalle →") y el contenido completo que antes vivía adentro de
// la Card se movió a un modal que se abre al hacer click/Enter en la
// tarjeta. No se agregó ningún dato nuevo ni se tocó ninguna consulta: estos
// componentes son puramente de presentación, reciben como props los mismos
// valores que ya calculaba dashboard/page.tsx.
//
// Dos formas de usar una tarjeta:
//  - <DashboardCardModal title=".." trigger={<SummaryCard .. />}>{detalle}</DashboardCardModal>
//    cuando hay más información para mostrar en un pop-up (Finanzas, Tareas,
//    Calendario, una Comisión, etc).
//  - <Link href=".."><SummaryCard .. /></Link>
//    cuando la tarjeta ya lleva a su propia pantalla completa y no hace
//    falta duplicar esa pantalla en un modal (ej: Documentos, Comunicaciones).

export function DashboardGrid({ children }: { children: ReactNode }) {
  return <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 items-stretch">{children}</div>;
}

// Sección con título (ej. "Comisiones") + grilla propia adentro — para no
// mezclar visualmente bloques que tienen distinto significado (Resumen
// personal / Comisiones / Información), tal como pide el punto de jerarquía
// del pedido, pero sin inventar un componente nuevo por sección.
export function DashboardSection({ title, action, children }: { title: string; action?: ReactNode; children: ReactNode }) {
  return (
    <section className="mb-6">
      <div className="flex items-center justify-between mb-2.5">
        <h2 className="text-sm font-bold uppercase tracking-wide text-ink-faint">{title}</h2>
        {action}
      </div>
      {children}
    </section>
  );
}

type EstadoVisual = "ok" | "atencion" | "alerta" | "error" | "neutral";

const ESTADO_STYLES: Record<EstadoVisual, { texto: string; cls: string; icon: string }> = {
  ok: { texto: "Al día", cls: "text-[var(--color-verde)]", icon: "✓" },
  atencion: { texto: "Pendiente", cls: "text-[var(--color-amarillo)]", icon: "⚠" },
  alerta: { texto: "Atención", cls: "text-[var(--color-amarillo)]", icon: "!" },
  error: { texto: "Error", cls: "text-[var(--color-rojo)]", icon: "×" },
  neutral: { texto: "", cls: "text-ink-muted", icon: "" },
};

/** Estado con ícono + texto (nunca solo color) — pedido explícito de que el
 * estado se entienda sin depender únicamente del color. */
export function EstadoTag({ estado, texto }: { estado: EstadoVisual; texto?: string }) {
  const e = ESTADO_STYLES[estado];
  return (
    <span className={`inline-flex items-center gap-1 text-xs font-semibold ${e.cls}`}>
      <span aria-hidden>{e.icon}</span>
      {texto ?? e.texto}
    </span>
  );
}

/**
 * Tarjeta compacta con jerarquía de 4 niveles: 1) título+ícono, 2) dato
 * principal, 3) estado/dato secundario, 4) acción. Todas las tarjetas del
 * Inicio comparten este mismo componente para que ningún módulo "se sienta
 * diseñado por separado" (pedido explícito de consistencia).
 */
export function SummaryCard({
  icon,
  title,
  value,
  status,
  hint,
  action = "Ver detalle →",
  loading,
  error,
}: {
  icon: ReactNode;
  title: string;
  value?: ReactNode;
  status?: ReactNode;
  hint?: string;
  action?: string | null;
  loading?: boolean;
  error?: string;
}) {
  if (loading) {
    return (
      <div className="rounded-2xl border border-border bg-surface shadow-[var(--shadow-sm)] p-4 h-full flex flex-col gap-2.5 min-h-[132px]">
        <div className="h-3 w-2/3 rounded bg-ink/8 animate-pulse" />
        <div className="h-6 w-1/2 rounded bg-ink/8 animate-pulse" />
        <div className="h-3 w-1/3 rounded bg-ink/8 animate-pulse" />
      </div>
    );
  }
  return (
    <div className="rounded-2xl border border-border bg-surface shadow-[var(--shadow-sm)] p-4 h-full min-h-[132px] flex flex-col gap-1.5 transition-all group-hover:shadow-[var(--shadow-lg)] group-hover:border-[var(--color-brand-700)]/30 group-focus-visible:shadow-[var(--shadow-lg)]">
      <div className="flex items-center gap-1.5 text-xs font-semibold text-ink-muted uppercase tracking-wide">
        <span className="text-[var(--color-brand-800)]" aria-hidden>{icon}</span>
        <span className="truncate">{title}</span>
      </div>
      {error ? (
        <p className="text-xs text-[var(--color-rojo)] mt-1">No pudimos cargar esta información.</p>
      ) : (
        <>
          <div className="text-xl sm:text-2xl font-bold text-ink leading-tight truncate">{value}</div>
          {status && <div>{status}</div>}
          {hint && <p className="text-xs text-ink-faint truncate">{hint}</p>}
        </>
      )}
      {action && (
        <div className="text-xs font-semibold text-[var(--color-brand-800)] mt-auto pt-1.5">{error ? "Reintentar" : action}</div>
      )}
    </div>
  );
}

/**
 * Envoltorio server-safe para una tarjeta que sólo navega a su propia
 * pantalla (no necesita pop-up porque no hay nada más para "resumir" — ej.
 * Documentos, Comunicaciones). No lleva estado ni "use client": el click lo
 * maneja el <Link> nativo.
 */
export function DashboardCardLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <Link href={href} className="group block h-full rounded-2xl">
      {children}
    </Link>
  );
}

/**
 * Envoltorio que abre un modal de detalle al hacer click/Enter en la
 * tarjeta. `trigger` y `detail` son contenido ya renderizado por el Server
 * Component (dashboard/page.tsx) — nunca una función — así se respeta el
 * límite Server→Client establecido en el resto de la app (ver
 * BuscadorFilas.tsx / MonthCalendar.tsx): un Client Component puede recibir
 * ReactNode como prop, pero jamás un callback que no sea una Server Action.
 * El estado open/close vive enteramente en CardModalTrigger (client).
 */
export function DashboardCardModal({
  title,
  size = "md",
  trigger,
  children,
}: {
  title: string;
  size?: "md" | "lg" | "xl";
  trigger: ReactNode;
  children: ReactNode;
}) {
  return (
    <CardModalTrigger title={title} size={size} trigger={trigger}>
      {children}
    </CardModalTrigger>
  );
}
