import Link from "next/link";
import type { ReactNode } from "react";

export type QuickLinkItem = { href: string; label: string; icon: ReactNode };

/**
 * Mejora quirúrgica del header (pedido explícito, 26/09): accesos rápidos de
 * navegación — "Mi trabajo" / "Comisiones" / "Socios" — a la izquierda del
 * buscador en la Top Bar de escritorio. Distinto de los "Accesos rápidos"
 * que existieron antes acá (ver la nota grande al final de Nav.tsx): aquellos
 * eran botones de ACCIÓN (Nueva solicitud de compra, Registrar movimiento) y
 * se sacaron de la cabecera; esto es navegación pura hacia pantallas que ya
 * existen. El permiso de cada ítem lo decide quien llama a este componente
 * (Nav.tsx, con el mismo `itemsFor(user)` que ya usa la Sidebar) — este
 * componente sólo dibuja lo que le pasan, nunca decide visibilidad por rol.
 *
 * Server-safe (sin "use client"): son <Link> planos sin estado propio, igual
 * que <DashboardCardLink>. Deliberadamente sin fondo/borde en reposo (pedido
 * explícito: "no quiero tres botones grandes... no quiero tarjetas") — sólo
 * texto+ícono con un fondo muy sutil al hover, mismo radio y misma curva de
 * transición (150-200ms) que ya usa el resto de la Top Bar.
 */
export function HeaderQuickLinks({ items }: { items: QuickLinkItem[] }) {
  if (items.length === 0) return null;
  return (
    <nav aria-label="Accesos rápidos" className="hidden md:flex items-center gap-0.5">
      {items.map((item) => (
        <Link
          key={item.href}
          href={item.href}
          title={item.label}
          aria-label={item.label}
          className="flex items-center gap-1.5 rounded-lg px-2 lg:px-2.5 py-2 text-sm font-medium text-ink-muted hover:bg-surface-sunken hover:text-ink transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-focus-ring)]"
        >
          <span aria-hidden className="shrink-0">
            {item.icon}
          </span>
          {/* Texto visible sólo desde `lg`: en el rango angosto de `md` (ver
              punto 13 del pedido, "tablet") prioriza los íconos para no
              apretar el buscador ni el resto de la cabecera. */}
          <span className="hidden lg:inline">{item.label}</span>
        </Link>
      ))}
    </nav>
  );
}
