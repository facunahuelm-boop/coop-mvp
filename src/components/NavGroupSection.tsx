"use client";

// Fase B del rediseño UI/UX: sección de menú que puede colapsarse. Se usa
// para "Comisiones y reuniones" — el audit encontró que ocupaban lugar fijo
// en el menú aunque se usan con poca frecuencia comparado con Socios, Obra,
// etc. Colapsada por defecto, pero se abre sola si el usuario ya está
// parado en una de sus páginas (así nunca "esconde" dónde está parado).

import { useState, type ReactNode } from "react";
import { usePathname } from "next/navigation";
import { ChevronDown } from "lucide-react";
import { NavLink } from "./NavLink";

export function NavGroupSection({
  label,
  icon,
  items,
  accentColor,
}: {
  label: string;
  icon: ReactNode;
  items: { href: string; label: string; icon: ReactNode }[];
  accentColor: string;
}) {
  const pathname = usePathname();
  const childActive = items.some((i) => pathname === i.href || pathname.startsWith(`${i.href}/`));
  const [open, setOpen] = useState(childActive);
  // Si el usuario navega (client-side) a una de estas páginas mientras el
  // menú sigue montado, se abre solo — nunca debería "esconder" dónde está
  // parado. Se ajusta durante el render (no en un efecto aparte) siguiendo
  // el patrón recomendado por React para sincronizar estado con un cambio
  // de props, evitando un re-render en cascada.
  const [pathnameAnterior, setPathnameAnterior] = useState(pathname);
  if (pathname !== pathnameAnterior) {
    setPathnameAnterior(pathname);
    if (childActive) setOpen(true);
  }

  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="w-full flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm text-white/85 transition-colors hover:bg-surface/10"
      >
        <span className="shrink-0">{icon}</span>
        <span className="flex-1 text-left">{label}</span>
        <ChevronDown size={16} className={`shrink-0 transition-transform ${open ? "rotate-180" : ""}`} />
      </button>
      {open && (
        <div className="pl-4 space-y-0.5 mt-0.5">
          {items.map((i) => (
            <NavLink key={i.href} href={i.href} icon={i.icon} label={i.label} accentColor={accentColor} />
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * Mejora global del sidebar (28/09, pedido explícito — secciones 20-34):
 * versión del mismo patrón de acordeón de acá arriba, pero para el
 * ENCABEZADO de cada grupo del menú (Gestión/Obra/Organización/Documentos/
 * Herramientas/Configuración — Inicio queda siempre visible, sin tocar). El
 * encabezado de grupo antes era un simple `<div>` de texto sin interacción;
 * ahora es un botón que pliega/despliega ese grupo entero. `allHrefs` es la
 * lista de TODOS los hrefs que viven dentro del grupo (incluidos los que ya
 * están plegados adentro de un `NavGroupSection` anidado, como "Comisiones y
 * reuniones" dentro de "Organización") — así, si el usuario está parado en
 * cualquier página de ese grupo, el grupo se abre solo (mismo criterio de
 * "nunca esconder dónde estoy parado" que ya usa `NavGroupSection`). No es
 * un acordeón excluyente: abrir un grupo no cierra los demás (el pedido no
 * lo exige, y así cada grupo "recuerda" su propio estado, sección 30).
 */
export function NavTopGroup({
  label,
  icon,
  allHrefs,
  children,
}: {
  label: string;
  icon: ReactNode;
  allHrefs: string[];
  children: ReactNode;
}) {
  const pathname = usePathname();
  const childActive = allHrefs.some((href) => pathname === href || pathname.startsWith(`${href}/`));
  const [open, setOpen] = useState(childActive);
  const [pathnameAnterior, setPathnameAnterior] = useState(pathname);
  if (pathname !== pathnameAnterior) {
    setPathnameAnterior(pathname);
    if (childActive) setOpen(true);
  }

  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="w-full flex items-center gap-1.5 px-3 pb-1 text-[10.5px] font-semibold uppercase tracking-wide text-white/40 hover:text-white/60 transition-colors"
      >
        <span className="shrink-0 opacity-80">{icon}</span>
        <span className="flex-1 text-left">{label}</span>
        <ChevronDown size={12} className={`shrink-0 transition-transform ${open ? "rotate-180" : ""}`} />
      </button>
      {open && <div className="space-y-0.5">{children}</div>}
    </div>
  );
}
