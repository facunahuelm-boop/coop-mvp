import type { ReactNode } from "react";
import Link from "next/link";

export function Card({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <div className={`bg-white rounded-2xl border border-black/5 shadow-sm p-4 sm:p-5 ${className}`}>
      {children}
    </div>
  );
}

export function SectionTitle({ children, action }: { children: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex items-center justify-between mb-3">
      <h2 className="text-base sm:text-lg font-semibold text-[#123240]">{children}</h2>
      {action}
    </div>
  );
}

export function PageHeader({ title, subtitle, action }: { title: ReactNode; subtitle?: string; action?: ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-3 mb-5">
      <div>
        <h1 className="text-xl sm:text-2xl font-bold text-[#123240]">{title}</h1>
        {subtitle && <p className="text-sm text-black/60 mt-0.5">{subtitle}</p>}
      </div>
      {action}
    </div>
  );
}

const badgeColors: Record<string, string> = {
  gray: "bg-black/5 text-black/70",
  brand: "bg-[#e7eff1] text-[#1f4e5f]",
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

export function Button({
  children, href, type = "button", variant = "primary", className = "",
}: {
  children: ReactNode; href?: string; type?: "button" | "submit"; variant?: "primary" | "secondary" | "ghost"; className?: string;
}) {
  const styles =
    variant === "primary"
      ? "bg-[#1f4e5f] text-white hover:bg-[#123240]"
      : variant === "secondary"
      ? "bg-[#e7eff1] text-[#1f4e5f] hover:bg-[#d8e6e9]"
      : "text-[#1f4e5f] hover:bg-[#e7eff1]";
  const cls = `inline-flex items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold transition-colors ${styles} ${className}`;
  if (href) return <Link href={href} className={cls}>{children}</Link>;
  return <button type={type} className={cls}>{children}</button>;
}

export function EmptyState({ children }: { children: ReactNode }) {
  return <p className="text-sm text-black/50 italic py-4">{children}</p>;
}

export function StatTile({ label, value, hint, color }: { label: string; value: string; hint?: string; color?: "verde" | "amarillo" | "rojo" }) {
  const dot = color ? { verde: "bg-[var(--color-verde)]", amarillo: "bg-[var(--color-amarillo)]", rojo: "bg-[var(--color-rojo)]" }[color] : null;
  return (
    <div className="rounded-xl bg-[#f2f5f6] px-3.5 py-3">
      <div className="flex items-center gap-2 text-xs text-black/60">
        {dot && <span className={`h-2 w-2 rounded-full ${dot}`} />}
        {label}
      </div>
      <div className="text-lg font-bold text-[#123240] mt-0.5">{value}</div>
      {hint && <div className="text-xs text-black/45 mt-0.5">{hint}</div>}
    </div>
  );
}

export function SemaforoDot({ value }: { value: "verde" | "amarillo" | "rojo" }) {
  const map = { verde: "🟢", amarillo: "🟡", rojo: "🔴" };
  return <span aria-label={value}>{map[value]}</span>;
}

export function Label({ children }: { children: ReactNode }) {
  return <label className="block text-xs font-medium text-black/60 mb-1">{children}</label>;
}

export const inputClass =
  "w-full rounded-lg border border-black/10 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#1f4e5f]/30 focus:border-[#1f4e5f]";
