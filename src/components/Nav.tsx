import Link from "next/link";
import type { SessionUser } from "@/lib/auth";
import { canRead, ROLE_LABELS, type Module } from "@/lib/roles";
import { logoutAction } from "@/lib/actions/auth";

type NavItem = { href: string; label: string; icon: string; mod?: Module };
type NavGroup = { label: string; items: NavItem[] };

// Navegación agrupada (Fase 2 del plan de transformación a plataforma).
// Antes, el menú listaba cada módulo suelto en una sola lista larga; ahora
// se agrupan por función, igual que en la estructura de referencia acordada
// (Inicio / Gestión / Organización / Documentos / Comunicación / Herramientas
// / Configuración). Todavía sólo aparecen acá los módulos que YA existen en
// el sistema — a medida que se construyan Socios, Comisiones, Reuniones,
// etc. (próximas fases), se agregan como una entrada más en el grupo que
// corresponda, sin tener que rediseñar el menú de nuevo.
//
// El grupo "Obra" agrupa lo específico de la etapa de construcción — no
// todas las cooperativas están en esa etapa. Por ahora se muestra siempre
// (como hoy), y en la Fase de personalización va a poder ocultarse cuando
// la cooperativa configure su etapa como "habitada".
const GROUPS: NavGroup[] = [
  {
    label: "Inicio",
    items: [
      { href: "/dashboard", label: "Inicio", icon: "🏠" },
      { href: "/alertas", label: "Alertas", icon: "🔔" },
    ],
  },
  {
    label: "Gestión",
    items: [
      { href: "/compras", label: "Compras", icon: "🛒", mod: "compras" },
      { href: "/finanzas", label: "Finanzas", icon: "💰", mod: "finanzas" },
    ],
  },
  {
    label: "Obra",
    items: [
      { href: "/obra", label: "Obra", icon: "🏗️", mod: "obra" },
      { href: "/trabajo", label: "Trabajo", icon: "🤝", mod: "trabajo" },
      { href: "/seguridad", label: "Seguridad", icon: "🦺", mod: "seguridad" },
    ],
  },
  {
    label: "Organización",
    items: [
      { href: "/comisiones", label: "Comisiones", icon: "🧭", mod: "comisiones" },
      { href: "/reuniones", label: "Reuniones", icon: "🗓️", mod: "comisiones" },
    ],
  },
  {
    label: "Documentos",
    items: [{ href: "/documentos", label: "Documentos", icon: "📄", mod: "documentos" }],
  },
  {
    label: "Herramientas",
    items: [
      { href: "/buscar", label: "Buscador", icon: "🔍" },
      { href: "/ia", label: "Asistente IA", icon: "✨" },
      { href: "/reportes", label: "Reportes", icon: "📊" },
    ],
  },
  {
    label: "Configuración",
    items: [
      { href: "/configuracion", label: "Configuración", icon: "⚙️" },
      { href: "/auditoria", label: "Auditoría", icon: "🔎", mod: "auditoria" },
    ],
  },
];

const ALL_ITEMS: NavItem[] = GROUPS.flatMap((g) => g.items);

// Fase de personalización: una cooperativa "habitada" (ya no está en obra)
// no necesita ver el grupo específico de construcción — se oculta entero,
// no módulo por módulo, porque los tres (Obra, Trabajo, Seguridad) dejan de
// tener sentido juntos una vez terminada la obra.
function gruposVisiblesParaEtapa(etapa: string): NavGroup[] {
  if (etapa === "habitada") return GROUPS.filter((g) => g.label !== "Obra");
  return GROUPS;
}

function itemsFor(user: SessionUser) {
  const visibles = gruposVisiblesParaEtapa(user.etapa).flatMap((g) => g.items);
  return ALL_ITEMS.filter((i) => visibles.includes(i)).filter((i) => !i.mod || canRead(user.rol, i.mod));
}

function groupsFor(user: SessionUser): NavGroup[] {
  return gruposVisiblesParaEtapa(user.etapa)
    .map((g) => ({
      label: g.label,
      items: g.items.filter((i) => !i.mod || canRead(user.rol, i.mod)),
    }))
    .filter((g) => g.items.length > 0);
}

export function Sidebar({ user }: { user: SessionUser }) {
  const groups = groupsFor(user);
  return (
    <aside className="hidden md:flex md:w-64 md:flex-col md:fixed md:inset-y-0 bg-[#123240] text-white">
      <div className="px-5 py-5 flex items-center gap-2 border-b border-white/10">
        <img src="/logo-coova.png" alt="COOVA" className="h-9 w-9 rounded-full" />
        <div>
          <div className="text-sm font-bold leading-tight">COOVA</div>
          <div className="text-[11px] text-white/60 leading-tight">Sistema de gestión</div>
        </div>
      </div>
      <nav className="flex-1 overflow-y-auto py-3 px-2 space-y-4">
        {groups.map((g) => (
          <div key={g.label}>
            <div className="px-3 pb-1 text-[10.5px] font-semibold uppercase tracking-wide text-white/40">
              {g.label}
            </div>
            <div className="space-y-0.5">
              {g.items.map((i) => (
                <Link key={i.href} href={i.href} className="flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm text-white/85 hover:bg-white/10">
                  <span>{i.icon}</span>
                  <span>{i.label}</span>
                </Link>
              ))}
            </div>
          </div>
        ))}
      </nav>
      <div className="px-4 py-4 border-t border-white/10">
        <div className="text-xs text-white/60">{user.nombre}</div>
        <div className="text-[11px] text-white/40">{ROLE_LABELS[user.rol]}</div>
        <form action={logoutAction}>
          <button className="mt-2 text-xs text-white/70 hover:text-white underline underline-offset-2">Cerrar sesión</button>
        </form>
      </div>
    </aside>
  );
}

export function TopBar({ user }: { user: SessionUser }) {
  return (
    <header className="md:hidden sticky top-0 z-20 bg-[#123240] text-white px-4 py-3 flex items-center justify-between">
      <div className="flex items-center gap-2">
        <img src="/logo-coova.png" alt="COOVA" className="h-7 w-7 rounded-full" />
        <span className="text-sm font-bold">COOVA</span>
      </div>
      <div className="text-right leading-tight">
        <div className="text-xs">{user.nombre.split(" ")[0]}</div>
        <div className="text-[10px] text-white/50">{ROLE_LABELS[user.rol]}</div>
      </div>
    </header>
  );
}

export function BottomNav({ user }: { user: SessionUser }) {
  // Prioriza en celular lo que cualquier socio necesita todos los días,
  // independientemente de la etapa de la cooperativa (Obra/Trabajo quedan
  // igual de accesibles desde "Más", pero no son universales como Buscar
  // o Documentos).
  const primary = ["/dashboard", "/buscar", "/documentos", "/alertas"];
  const items = itemsFor(user).filter((i) => primary.includes(i.href));
  return (
    <nav className="md:hidden fixed bottom-0 inset-x-0 z-20 bg-white border-t border-black/10 safe-bottom">
      <div className="flex">
        {items.map((i) => (
          <Link key={i.href} href={i.href} className="flex-1 flex flex-col items-center gap-0.5 py-2 text-[11px] text-[#123240]/80">
            <span className="text-lg leading-none">{i.icon}</span>
            {i.label}
          </Link>
        ))}
        <Link href="/mas" className="flex-1 flex flex-col items-center gap-0.5 py-2 text-[11px] text-[#123240]/80">
          <span className="text-lg leading-none">☰</span>
          Más
        </Link>
      </div>
    </nav>
  );
}

export { ALL_ITEMS, itemsFor, groupsFor };
