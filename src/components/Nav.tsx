import Link from "next/link";
import type { ReactNode } from "react";
import type { SessionUser } from "@/lib/auth";
import { canRead, ROLE_LABELS, type Module } from "@/lib/roles";
import { logoutAction } from "@/lib/actions/auth";
import { NavLink } from "./NavLink";
import { NavGroupSection } from "./NavGroupSection";
import {
  Home,
  Bell,
  ShoppingCart,
  Truck,
  Wallet,
  HardHat,
  Handshake,
  ShieldCheck,
  Users,
  Compass,
  CalendarDays,
  FileText,
  Search,
  Sparkles,
  BarChart3,
  Settings,
  History,
  Menu,
} from "lucide-react";

type NavItem = { href: string; label: string; icon: ReactNode; mod?: Module };
type NavGroup = { label: string; items: NavItem[] };

// Navegación agrupada (Fase 2 del plan de transformación a plataforma;
// iconos e íconos de Comisiones/Reuniones revisados en la Fase B del
// rediseño UI/UX). Antes, el menú listaba cada módulo suelto en una sola
// lista larga; ahora se agrupan por función (Inicio / Gestión / Obra /
// Organización / Documentos / Herramientas / Configuración). Los íconos
// eran emojis puestos directo en el código — se ven distinto según
// dispositivo/SO, algo especialmente riesgoso para alguien que necesita
// reconocer símbolos con claridad. Ahora son íconos SVG de una sola
// librería (lucide-react), con el mismo trazo y grosor en todos lados.
//
// El grupo "Obra" agrupa lo específico de la etapa de construcción — no
// todas las cooperativas están en esa etapa. Por ahora se muestra siempre
// (como hoy), y en la Fase D (etapas de cooperativa) va a poder ocultarse
// automáticamente cuando la cooperativa configure su etapa como "habitada",
// con la posibilidad de que un admin lo reactive a mano si lo necesita.
const ICON_SIZE = 18;

const GROUPS: NavGroup[] = [
  {
    label: "Inicio",
    items: [
      { href: "/dashboard", label: "Inicio", icon: <Home size={ICON_SIZE} /> },
      { href: "/alertas", label: "Alertas", icon: <Bell size={ICON_SIZE} /> },
    ],
  },
  {
    label: "Gestión",
    items: [
      { href: "/compras", label: "Compras", icon: <ShoppingCart size={ICON_SIZE} />, mod: "compras" },
      { href: "/proveedores", label: "Proveedores", icon: <Truck size={ICON_SIZE} />, mod: "compras" },
      { href: "/finanzas", label: "Finanzas", icon: <Wallet size={ICON_SIZE} />, mod: "finanzas" },
    ],
  },
  {
    label: "Obra",
    items: [
      { href: "/obra", label: "Obra", icon: <HardHat size={ICON_SIZE} />, mod: "obra" },
      { href: "/trabajo", label: "Trabajo", icon: <Handshake size={ICON_SIZE} />, mod: "trabajo" },
      { href: "/seguridad", label: "Seguridad", icon: <ShieldCheck size={ICON_SIZE} />, mod: "seguridad" },
    ],
  },
  {
    label: "Organización",
    items: [
      { href: "/socios", label: "Socios", icon: <Users size={ICON_SIZE} />, mod: "socios" },
      { href: "/comisiones", label: "Comisiones", icon: <Compass size={ICON_SIZE} />, mod: "comisiones" },
      { href: "/reuniones", label: "Reuniones", icon: <CalendarDays size={ICON_SIZE} />, mod: "comisiones" },
    ],
  },
  {
    label: "Documentos",
    items: [{ href: "/documentos", label: "Documentos", icon: <FileText size={ICON_SIZE} />, mod: "documentos" }],
  },
  {
    label: "Herramientas",
    items: [
      { href: "/buscar", label: "Buscador", icon: <Search size={ICON_SIZE} /> },
      { href: "/ia", label: "Asistente IA", icon: <Sparkles size={ICON_SIZE} /> },
      { href: "/reportes", label: "Reportes", icon: <BarChart3 size={ICON_SIZE} /> },
    ],
  },
  {
    label: "Configuración",
    items: [
      { href: "/configuracion", label: "Configuración", icon: <Settings size={ICON_SIZE} /> },
      { href: "/auditoria", label: "Auditoría", icon: <History size={ICON_SIZE} />, mod: "auditoria" },
    ],
  },
];

// Dentro de "Organización", Comisiones y Reuniones se muestran plegadas por
// defecto (se usan con mucha menos frecuencia que Socios) — ver
// NavGroupSection. Socios queda siempre visible porque es lo que se
// consulta día a día.
const GRUPO_COLAPSABLE = {
  grupo: "Organización",
  hrefsColapsados: ["/comisiones", "/reuniones"],
  label: "Comisiones y reuniones",
  icon: <Compass size={ICON_SIZE} />,
};

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
  const { nombre, logo_url, color_primario, color_secundario } = user.organizacion;
  // El acento del ítem activo usa el color secundario de la cooperativa si
  // lo cargó en Configuración → Marca; si no, cae en el color principal, así
  // el resaltado nunca queda sin color aunque la cooperativa no haya
  // configurado un secundario todavía.
  const acento = color_secundario || color_primario;
  return (
    <aside
      className="hidden md:flex md:w-64 md:flex-col md:fixed md:inset-y-0 text-white"
      style={{ backgroundColor: color_primario }}
    >
      <div className="px-5 py-5 flex items-center gap-2 border-b border-white/10">
        <img src={logo_url || "/logo-coova.png"} alt={nombre} className="h-9 w-9 rounded-full object-cover" />
        <div>
          <div className="text-sm font-bold leading-tight">{nombre}</div>
          <div className="text-[11px] text-white/60 leading-tight">Sistema de gestión</div>
        </div>
      </div>
      <nav className="flex-1 overflow-y-auto py-3 px-2 space-y-4">
        {groups.map((g) => {
          const colapsados =
            g.label === GRUPO_COLAPSABLE.grupo
              ? g.items.filter((i) => GRUPO_COLAPSABLE.hrefsColapsados.includes(i.href))
              : [];
          const sueltos = g.items.filter((i) => !colapsados.includes(i));
          return (
            <div key={g.label}>
              <div className="px-3 pb-1 text-[10.5px] font-semibold uppercase tracking-wide text-white/40">
                {g.label}
              </div>
              <div className="space-y-0.5">
                {sueltos.map((i) => (
                  <NavLink key={i.href} href={i.href} icon={i.icon} label={i.label} accentColor={acento} />
                ))}
                {colapsados.length > 0 && (
                  <NavGroupSection
                    label={GRUPO_COLAPSABLE.label}
                    icon={GRUPO_COLAPSABLE.icon}
                    items={colapsados}
                    accentColor={acento}
                  />
                )}
              </div>
            </div>
          );
        })}
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
  const { nombre, logo_url, color_primario } = user.organizacion;
  return (
    <header
      className="md:hidden sticky top-0 z-20 text-white px-4 py-3 flex items-center justify-between"
      style={{ backgroundColor: color_primario }}
    >
      <div className="flex items-center gap-2">
        <img src={logo_url || "/logo-coova.png"} alt={nombre} className="h-7 w-7 rounded-full object-cover" />
        <span className="text-sm font-bold">{nombre}</span>
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
  const acento = user.organizacion.color_secundario || user.organizacion.color_primario;
  return (
    <nav className="md:hidden fixed bottom-0 inset-x-0 z-20 bg-white border-t border-black/10 safe-bottom">
      <div className="flex text-black/45">
        {items.map((i) => (
          <NavLink key={i.href} href={i.href} icon={i.icon} label={i.label} accentColor={acento} variant="bottom" />
        ))}
        <Link href="/mas" className="flex-1 flex flex-col items-center gap-0.5 py-2 text-[11px]">
          <Menu size={ICON_SIZE} className="mx-auto" />
          Más
        </Link>
      </div>
    </nav>
  );
}

export { ALL_ITEMS, itemsFor, groupsFor };
