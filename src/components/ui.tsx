import type { ReactNode } from "react";
import Link from "next/link";
import { Plus } from "lucide-react";

// Fase A del rediseño UI/UX (ver Plan Maestro): estos componentes ahora usan
// los tokens semánticos definidos en globals.css (--color-ink, --color-surface,
// --color-border, etc.) en vez de hex sueltos como "var(--color-brand-900)" repetidos a mano.
// El resto de las pantallas todavía tiene hex sueltos — se van migrando de a
// una en las fases siguientes, así que este cambio no rompe nada existente.

export function Card({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <div className={`bg-surface rounded-2xl border border-border shadow-[var(--shadow-sm)] p-4 sm:p-5 ${className}`}>
      {children}
    </div>
  );
}

export function SectionTitle({ children, action }: { children: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex items-center justify-between mb-3">
      <h2 className="text-base sm:text-lg font-semibold text-ink">{children}</h2>
      {action}
    </div>
  );
}

export function PageHeader({ title, subtitle, action }: { title: ReactNode; subtitle?: string; action?: ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-3 mb-5">
      <div>
        <h1 className="text-xl sm:text-2xl font-bold text-ink">{title}</h1>
        {subtitle && <p className="text-sm text-ink-muted mt-0.5">{subtitle}</p>}
      </div>
      {action}
    </div>
  );
}

const badgeColors: Record<string, string> = {
  gray: "bg-ink/5 text-ink-muted",
  brand: "bg-brand-100 text-brand-800",
  verde: "bg-[var(--color-verde-bg)] text-[var(--color-verde)]",
  amarillo: "bg-[var(--color-amarillo-bg)] text-[var(--color-amarillo)]",
  rojo: "bg-[var(--color-rojo-bg)] text-[var(--color-rojo)]",
};

export function Badge({ children, color = "gray" }: { children: ReactNode; color?: keyof typeof badgeColors }) {
  return (
    <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-medium ${badgeColors[color]}`}>
      {children}
    </span>
  );
}

// Rediseño de botones "Agregar" (15/09, pedido explícito): un solo patrón
// visual reutilizable para TODA acción de creación del sistema (agregar
// usuario, núcleo, comisión, tarea, evento, proveedor, compra, presupuesto,
// documento, gasto, ingreso, comunicación, categoría, etc.) en vez de que
// cada pantalla arme el suyo a mano. Verde = "crear", pero el mismo verde
// suave del semáforo de estado (--color-verde) que ya usa el resto del
// sistema — a propósito NO un verde nuevo/flúo, para no romper la paleta
// coherente. Se expone como un variant más de `Button` (no un componente
// aparte) para que CUALQUIER lugar que ya use `Button`/`SubmitButton` lo
// consiga gratis con sólo `variant="add"`, sin otro componente que aprender.
const ADD_BUTTON_STYLES =
  "border-2 border-[var(--color-verde)] text-[var(--color-verde)] bg-transparent hover:bg-[var(--color-verde-bg)]";

export function Button({
  children, href, type = "button", variant = "primary", className = "", onClick, disabled,
}: {
  children: ReactNode;
  href?: string;
  type?: "button" | "submit";
  variant?: "primary" | "secondary" | "ghost" | "danger" | "add";
  className?: string;
  onClick?: () => void;
  disabled?: boolean;
}) {
  const styles =
    variant === "primary"
      ? "bg-brand-800 text-white hover:bg-brand-900"
      : variant === "secondary"
      ? "bg-brand-100 text-brand-800 hover:bg-brand-100/70"
      : variant === "danger"
      ? "bg-[var(--color-rojo)] text-white hover:brightness-90"
      : variant === "add"
      ? ADD_BUTTON_STYLES
      : "text-brand-800 hover:bg-brand-100";
  const cls = `inline-flex items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold transition-colors disabled:opacity-50 disabled:pointer-events-none ${styles} ${className}`;
  if (href) return <Link href={href} className={cls}>{children}</Link>;
  return (
    <button type={type} className={cls} onClick={onClick} disabled={disabled}>
      {children}
    </button>
  );
}

/**
 * `AddButton`: atajo sobre `Button variant="add"` que además agrega el
 * ícono "+" siempre (para no repetir `<Plus size={16} />` en cada pantalla
 * ni arriesgarse a que alguien lo omita). Sirve tanto para navegar a una
 * pantalla de creación (`href`) como para un submit directo (`type="submit"`,
 * aunque para eso conviene `AddSubmitButton` de ui-client.tsx, que además
 * deshabilita/renombra el botón mientras la Server Action está en curso).
 */
export function AddButton({
  children, href, type = "button", className = "", onClick, disabled,
}: {
  children: ReactNode;
  href?: string;
  type?: "button" | "submit";
  className?: string;
  onClick?: () => void;
  disabled?: boolean;
}) {
  return (
    <Button href={href} type={type} variant="add" className={className} onClick={onClick} disabled={disabled}>
      <Plus size={16} aria-hidden />
      {children}
    </Button>
  );
}

/**
 * `AddButtonSummary`: mismo look que `AddButton`, pero como `<summary>` —
 * para el patrón "revelar un formulario chico de creación inline" (antes:
 * `<summary className="cursor-pointer text-sm font-semibold ...">+ Agregar
 * socio</summary>`, un simple link de texto con un "+" pegado, repetido a
 * mano en 11+ pantallas). Mismas clases visuales que `Button variant="add"`
 * (no se puede reusar `Button` directo porque un `<summary>` no es un
 * `<button>`/`<Link>`, es lo que le da al `<details>` el toggle nativo de
 * abrir/cerrar) — `list-none` + ocultar el marcador nativo del navegador
 * para que se vea igual que un botón real, no como una lista desplegable.
 */
export function AddButtonSummary({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <summary
      className={`inline-flex items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold transition-colors cursor-pointer select-none list-none [&::-webkit-details-marker]:hidden ${ADD_BUTTON_STYLES} ${className}`}
    >
      <Plus size={16} aria-hidden />
      {children}
    </summary>
  );
}

// Estado vacío explicativo: además del texto, admite un ícono y una acción
// (ej. un botón "+ Agregar socio"). icon/action son opcionales para no romper
// los ~40 usos existentes que sólo pasan texto.
export function EmptyState({
  children, icon, action,
}: { children: ReactNode; icon?: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center text-center gap-2 py-8 px-3">
      {icon && <div className="text-2xl" aria-hidden>{icon}</div>}
      <p className="text-sm text-ink-muted max-w-sm">{children}</p>
      {action && <div className="mt-1">{action}</div>}
    </div>
  );
}

export function StatTile({ label, value, hint, color }: { label: string; value: string; hint?: string; color?: "verde" | "amarillo" | "rojo" }) {
  const dot = color ? { verde: "bg-[var(--color-verde)]", amarillo: "bg-[var(--color-amarillo)]", rojo: "bg-[var(--color-rojo)]" }[color] : null;
  return (
    <div className="rounded-xl bg-surface-sunken px-3.5 py-3">
      <div className="flex items-center gap-2 text-xs text-ink-muted">
        {dot && <span className={`h-2 w-2 rounded-full ${dot}`} />}
        {label}
      </div>
      <div className="text-lg font-bold text-ink mt-0.5">{value}</div>
      {hint && <div className="text-xs text-ink-faint mt-0.5">{hint}</div>}
    </div>
  );
}

export function SemaforoDot({ value }: { value: "verde" | "amarillo" | "rojo" }) {
  const map = { verde: "🟢", amarillo: "🟡", rojo: "🔴" };
  return <span aria-label={value}>{map[value]}</span>;
}

export function Label({ children }: { children: ReactNode }) {
  return <label className="block text-xs font-medium text-ink-muted mb-1">{children}</label>;
}

export const inputClass =
  "w-full rounded-lg border border-ink/10 bg-surface px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--color-brand-800)]/30 focus:border-[var(--color-brand-800)]";

// ---------- Bloques de carga (loaders), para reemplazar "cargando..." a
// texto plano por un placeholder que respeta la forma del contenido real.
export function Skeleton({ className = "" }: { className?: string }) {
  return <div className={`animate-pulse rounded-lg bg-ink/8 ${className}`} />;
}

export function SkeletonLines({ lines = 3, className = "" }: { lines?: number; className?: string }) {
  return (
    <div className={`space-y-2 ${className}`}>
      {Array.from({ length: lines }).map((_, i) => (
        <Skeleton key={i} className={`h-3.5 ${i === lines - 1 ? "w-2/3" : "w-full"}`} />
      ))}
    </div>
  );
}

// ---------- Tabla estándar: envuelve el scroll horizontal para que nunca sea
// la página entera la que se desplaza de costado, y da estilo consistente a
// encabezados/celdas. Las pantallas existentes siguen con su <table> propia
// por ahora — ésta se usa a partir de la Fase C, pantalla por pantalla.
export function Table({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <div className={`overflow-x-auto ${className}`}>
      <table className="w-full text-sm border-collapse">{children}</table>
    </div>
  );
}

export function Th({ children, className = "" }: { children?: ReactNode; className?: string }) {
  return (
    <th className={`text-left text-sm font-semibold text-ink-muted border-b border-border py-2.5 pr-4 ${className}`}>
      {children}
    </th>
  );
}

export function Td({ children, className = "" }: { children?: ReactNode; className?: string }) {
  return <td className={`py-2.5 pr-4 border-b border-border/60 ${className}`}>{children}</td>;
}
