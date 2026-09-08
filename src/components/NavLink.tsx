"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

/**
 * Fase 03 del Plan Maestro (Personalización). El campo color_secundario ya
 * existía en `organizations` y ya se podía cargar desde Configuración →
 * Marca de la cooperativa, pero no se usaba en ninguna pantalla — se
 * guardaba y no pasaba nada. Al mismo tiempo, el menú lateral no marcaba de
 * ninguna forma en qué página estaba parado el usuario (ver Nav.tsx, antes
 * de este cambio: todos los ítems se veían siempre iguales). Este componente
 * resuelve las dos cosas juntas: usa color_secundario (con color_primario
 * como respaldo si la cooperativa no cargó uno) para resaltar el ítem de la
 * página actual, tanto en el menú de escritorio como en el de celular.
 */
export function NavLink({
  href,
  icon,
  label,
  accentColor,
  variant = "sidebar",
}: {
  href: string;
  icon: ReactNode;
  label: string;
  accentColor: string;
  variant?: "sidebar" | "bottom";
}) {
  const pathname = usePathname();
  const isActive = pathname === href || pathname.startsWith(`${href}/`);

  if (variant === "bottom") {
    return (
      <Link
        href={href}
        className="flex-1 flex flex-col items-center gap-0.5 py-2 text-[11px] transition-colors"
        style={{ color: isActive ? accentColor : undefined }}
      >
        <span className="leading-none">{icon}</span>
        {label}
      </Link>
    );
  }

  return (
    <Link
      href={href}
      className="flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm transition-colors"
      style={
        isActive
          ? { backgroundColor: accentColor, color: "#fff", fontWeight: 600 }
          : { color: "rgba(255,255,255,.85)" }
      }
      onMouseEnter={(e) => {
        if (!isActive) e.currentTarget.style.backgroundColor = "rgba(255,255,255,.1)";
      }}
      onMouseLeave={(e) => {
        if (!isActive) e.currentTarget.style.backgroundColor = "transparent";
      }}
    >
      <span className="shrink-0">{icon}</span>
      <span>{label}</span>
    </Link>
  );
}
