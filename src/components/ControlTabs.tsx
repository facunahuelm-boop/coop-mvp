import Link from "next/link";
import { canRead, type Role } from "@/lib/roles";

/**
 * Fase 2F — «Control y transparencia» como una sola sección: pestañas
 * arriba de Panel Fiscal, Auditoría, Cumplimiento, Transparencia y
 * Reportes. Cada rol ve sólo las que puede abrir (las páginas siguen en
 * su misma dirección).
 */
const PESTANAS: { href: string; nombre: string; control?: boolean }[] = [
  { href: "/transparencia", nombre: "¿En qué se gasta?" },
  { href: "/fiscal", nombre: "Panel Fiscal", control: true },
  { href: "/auditoria", nombre: "Auditoría", control: true },
  { href: "/cumplimiento", nombre: "Cumplimiento", control: true },
  { href: "/reportes", nombre: "Reportes" },
];

export function ControlTabs({ actual, rol }: { actual: string; rol: Role }) {
  const visibles = PESTANAS.filter((p) => !p.control || canRead(rol, "auditoria"));
  if (visibles.length < 2) return null;
  return (
    <nav aria-label="Control y transparencia" className="-mx-1 mb-4 flex gap-1 overflow-x-auto px-1 pb-1">
      {visibles.map((p) => (
        <Link
          key={p.href}
          href={p.href}
          aria-current={p.href === actual ? "page" : undefined}
          className={`whitespace-nowrap rounded-full px-3.5 py-1.5 text-sm font-semibold ${p.href === actual ? "bg-brand-100 text-brand-800" : "text-ink-muted hover:bg-surface-sunken"}`}
        >
          {p.nombre}
        </Link>
      ))}
    </nav>
  );
}
