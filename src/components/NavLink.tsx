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
 *
 * Punto 26 del rediseño "Color secundario + Top Bar": el estado activo era
 * antes un relleno sólido del color de acento con texto blanco — llamativo,
 * pero es exactamente el patrón de "tarjeta saturada" que el resto de este
 * rediseño evitó a propósito (ver SummaryCard/StatTile). Se reemplaza acá
 * por el mismo criterio ("color con elegancia"): fondo sutil (un lavado
 * translúcido del color de acento, no un relleno sólido), el color de acento
 * pasa al texto/ícono en vez del fondo, y un indicador lateral (una barrita
 * vertical pegada al borde de la barra de navegación) — tres señales a la
 * vez en vez de solo el color, para que se note con claridad incluso para
 * quien tiene dificultad para distinguir colores.
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
  const fondoSutil = `color-mix(in srgb, ${accentColor} 20%, transparent)`;

  if (variant === "bottom") {
    return (
      <Link
        href={href}
        className="relative flex-1 flex flex-col items-center gap-0.5 py-2 text-[11px] transition-colors"
        style={{ color: isActive ? accentColor : undefined }}
      >
        {isActive && (
          <>
            {/* Indicador lateral adaptado a una barra horizontal: acá "lateral"
                se traduce en una barrita arriba del ítem (el equivalente del
                borde izquierdo del menú de escritorio, pero para una fila de
                pestañas horizontal). */}
            <span
              className="absolute top-0 left-1/2 -translate-x-1/2 h-[3px] w-6 rounded-full"
              style={{ backgroundColor: accentColor }}
            />
            <span
              className="absolute inset-x-1 inset-y-0.5 -z-10 rounded-xl"
              style={{ backgroundColor: fondoSutil }}
            />
          </>
        )}
        <span className="leading-none">{icon}</span>
        {label}
      </Link>
    );
  }

  return (
    <Link
      href={href}
      className="relative flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm transition-colors"
      style={
        isActive
          ? { backgroundColor: fondoSutil, color: accentColor, fontWeight: 600 }
          : { color: "rgba(255,255,255,.85)" }
      }
      onMouseEnter={(e) => {
        if (!isActive) e.currentTarget.style.backgroundColor = "rgba(255,255,255,.1)";
      }}
      onMouseLeave={(e) => {
        if (!isActive) e.currentTarget.style.backgroundColor = "transparent";
      }}
    >
      {isActive && (
        <span
          className="absolute -left-2 top-1 bottom-1 w-[3px] rounded-full"
          style={{ backgroundColor: accentColor }}
        />
      )}
      <span className="shrink-0">{icon}</span>
      <span>{label}</span>
    </Link>
  );
}
