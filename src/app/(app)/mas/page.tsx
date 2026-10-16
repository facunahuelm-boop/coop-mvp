import type { ReactNode } from "react";
import { getCurrentUser } from "@/lib/auth";
import { groupsFor, itemsFor, itemsAccesibles } from "@/components/Nav";
import { get } from "@/lib/db";
import { logoutAction } from "@/lib/actions/auth";
import Link from "next/link";
import { ROLE_LABELS } from "@/lib/roles";
import { redirect } from "next/navigation";
import { Avatar } from "@/components/EntidadLink";
import { ChevronDown, ChevronRight, Compass, Eye, FileText, HardHat, Home, Landmark, LayoutGrid, LogOut, Settings, Users, Wallet } from "lucide-react";

// Menú del celular (rediseño 16/10, pedido explícito: "más fácil, lo más
// sencillo y estéticamente lindo"). Antes era una lista de ~3000 px con todos
// los ítems a la vista; ahora: la persona arriba, y cada grupo es una sección
// plegable con su ícono — se abre sólo lo que se busca. Mismos ítems y mismos
// permisos de siempre (groupsFor / itemsAccesibles de Nav.tsx).
const ICONO_GRUPO: Record<string, { icon: ReactNode; bg: string; fg: string }> = {
  Inicio: { icon: <Home size={18} />, bg: "var(--accent-blue-bg)", fg: "var(--accent-blue)" },
  "Socios y vivienda": { icon: <Users size={18} />, bg: "var(--accent-teal-bg)", fg: "var(--accent-teal)" },
  Finanzas: { icon: <Wallet size={18} />, bg: "var(--accent-amber-bg)", fg: "var(--accent-amber)" },
  "Obra y trámites": { icon: <HardHat size={18} />, bg: "var(--accent-violet-bg)", fg: "var(--accent-violet)" },
  "Comisiones y reuniones": { icon: <Compass size={18} />, bg: "var(--accent-blue-bg)", fg: "var(--accent-blue)" },
  "Asambleas y Consejo": { icon: <Landmark size={18} />, bg: "var(--accent-violet-bg)", fg: "var(--accent-violet)" },
  Documentos: { icon: <FileText size={18} />, bg: "var(--accent-teal-bg)", fg: "var(--accent-teal)" },
  "Control y transparencia": { icon: <Eye size={18} />, bg: "var(--accent-amber-bg)", fg: "var(--accent-amber)" },
  "Mis secciones": { icon: <Home size={18} />, bg: "var(--accent-blue-bg)", fg: "var(--accent-blue)" },
  Administración: { icon: <Settings size={18} />, bg: "var(--color-surface-sunken)", fg: "var(--color-ink-muted)" },
  "Otras secciones": { icon: <LayoutGrid size={18} />, bg: "var(--color-surface-sunken)", fg: "var(--color-ink-muted)" },
};

type Item = { href: string; label: string; icon: ReactNode };

function Fila({ i }: { i: Item }) {
  return (
    <Link href={i.href} className="flex items-center gap-3 px-4 py-3.5 text-[15px] text-ink active:bg-surface-sunken hover:bg-surface-sunken/60">
      <span className="shrink-0 text-ink-muted">{i.icon}</span>
      <span className="flex-1">{i.label}</span>
      <ChevronRight size={16} className="shrink-0 text-ink-faint" aria-hidden />
    </Link>
  );
}

function Grupo({ label, items, abierto = false }: { label: string; items: Item[]; abierto?: boolean }) {
  const deco = ICONO_GRUPO[label] ?? ICONO_GRUPO["Otras secciones"];
  return (
    <details open={abierto} className="group overflow-hidden rounded-2xl border border-border bg-surface shadow-[var(--shadow-sm)]">
      <summary className="flex cursor-pointer list-none items-center gap-3 px-4 py-3.5 [&::-webkit-details-marker]:hidden">
        <span className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl" style={{ background: deco.bg, color: deco.fg }} aria-hidden>
          {deco.icon}
        </span>
        <span className="flex-1 text-[15px] font-semibold text-ink">{label}</span>
        <span className="text-xs text-ink-faint">{items.length}</span>
        <ChevronDown size={18} className="shrink-0 text-ink-faint transition-transform group-open:rotate-180" aria-hidden />
      </summary>
      <div className="divide-y divide-border border-t border-border">
        {items.map((i) => (
          <Fila key={i.href} i={i} />
        ))}
      </div>
    </details>
  );
}

export default async function MasPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  const esSocio = !!(await get<{ id: number }>(`SELECT id FROM socios WHERE user_id = ? LIMIT 1`, [user.id]).catch(() => undefined));
  // "Inicio" ya está en la barra de abajo: no se repite acá.
  const groups = groupsFor(user, esSocio)
    .map((g) => ({ ...g, items: g.items.filter((i) => i.href !== "/dashboard") }))
    .filter((g) => g.items.length > 0);
  // Fase 1D: lo que la persona puede abrir pero no está en su menú corto
  // (por ejemplo, el socio puede consultar las comisiones o las asambleas).
  const enMenu = new Set(itemsFor(user, esSocio).map((i) => i.href));
  const otras = itemsAccesibles(user, esSocio).filter((i) => !enMenu.has(i.href) && i.href !== "/alertas");
  // El socio tiene una sola lista corta: va abierta. El resto, todo plegado.
  const unaSola = groups.length === 1;

  return (
    <div className="space-y-5">
      <Link
        href={`/usuarios/${user.id}`}
        className="flex items-center gap-3 rounded-2xl border border-border bg-surface p-4 shadow-[var(--shadow-sm)] active:bg-surface-sunken"
      >
        <Avatar url={user.avatar_url} nombre={user.nombre} size={48} />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-base font-bold text-ink">{user.nombre}</span>
          <span className="block truncate text-sm text-ink-muted">{ROLE_LABELS[user.rol]} · Ver mi perfil</span>
        </span>
        <ChevronRight size={18} className="shrink-0 text-ink-faint" aria-hidden />
      </Link>

      <div className="space-y-2.5">
        {groups.map((g) => (
          <Grupo key={g.label} label={unaSola ? "Mis secciones" : g.label} items={g.items} abierto={unaSola} />
        ))}
        {otras.length > 0 && <Grupo label="Otras secciones" items={otras} />}
      </div>

      <form action={logoutAction}>
        <button className="flex w-full items-center justify-center gap-2 rounded-2xl border border-border bg-surface py-3.5 text-[15px] font-semibold text-[var(--color-rojo)] active:bg-surface-sunken">
          <LogOut size={18} aria-hidden /> Cerrar sesión
        </button>
      </form>
    </div>
  );
}
