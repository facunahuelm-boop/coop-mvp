import Link from "next/link";
import type { ReactNode } from "react";
import type { SessionUser } from "@/lib/auth";
import { canRead, ROLE_LABELS, type Module } from "@/lib/roles";
import { logoutAction } from "@/lib/actions/auth";
import { Saludo } from "./Saludo";
import { NavLink } from "./NavLink";
import { NavGroupSection } from "./NavGroupSection";
import { Logo3D } from "./Logo3D";
import {
  Home,
  Bell,
  Mail,
  ShoppingCart,
  Truck,
  Wallet,
  HardHat,
  Handshake,
  ShieldCheck,
  Wrench,
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
  Receipt,
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
// El grupo "Obra" agrupa lo específico de la etapa de construcción. Fase D
// (etapas de cooperativa + módulos, ver Configuración → Módulos): estos tres
// módulos (obra, trabajo, seguridad) se ocultan solos mientras la
// cooperativa todavía no arrancó a construir (pre_obra) o ya terminó y está
// habitada — sólo tienen sentido día a día durante la etapa "obra". Un admin
// puede forzar a mano que se muestren u oculten igual desde Configuración →
// Módulos si su caso es distinto (por ejemplo, una cooperativa habitada que
// igual quiere dejar Obra visible como archivo histórico).
const ICON_SIZE = 18;

// "reclamos" (Reclamos y Mantenimiento, ver roles.ts) es el caso opuesto a
// obra/trabajo/seguridad: no tiene mucho sentido antes de que haya gente
// viviendo ahí, así que su default por etapa se invierte (visible recién en
// "habitada") en vez de sumarse a la lista de abajo con el mismo criterio.
//
/** Módulos cuyo default de visibilidad depende de la etapa de la cooperativa,
 * y en qué etapa(s) se muestran por defecto (el override manual de
 * Configuración → Módulos siempre gana, sea cual sea el default). */
const ETAPA_DEFAULT: Partial<Record<Module, string[]>> = {
  obra: ["obra"],
  trabajo: ["obra"],
  seguridad: ["obra"],
  reclamos: ["habitada"],
};

const GROUPS: NavGroup[] = [
  {
    label: "Inicio",
    items: [
      { href: "/dashboard", label: "Inicio", icon: <Home size={ICON_SIZE} /> },
      { href: "/alertas", label: "Alertas", icon: <Bell size={ICON_SIZE} /> },
      { href: "/calendario", label: "Calendario", icon: <CalendarDays size={ICON_SIZE} /> },
    ],
  },
  {
    label: "Gestión",
    items: [
      { href: "/compras", label: "Compras", icon: <ShoppingCart size={ICON_SIZE} />, mod: "compras" },
      { href: "/proveedores", label: "Proveedores", icon: <Truck size={ICON_SIZE} />, mod: "compras" },
      // Sin "mod": el resumen de Gastos por Comisión lo ve cualquier usuario
      // autenticado (decisión confirmada: "todos ven el resumen, cada uno
      // edita solo lo suyo") — el permiso real de editar/cargar/anular un
      // gasto se valida en el servidor (puedeUsarGastos + puedeGestionarComision
      // en actions/gastos.ts), acá solo se decide si el ítem del menú aparece.
      { href: "/gastos", label: "Gastos", icon: <Receipt size={ICON_SIZE} /> },
      { href: "/reclamos", label: "Reclamos", icon: <Wrench size={ICON_SIZE} />, mod: "reclamos" },
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
      { href: "/mails", label: "Mails", icon: <Mail size={ICON_SIZE} /> },
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

/**
 * Decide si un módulo de los que dependen de la etapa (obra/trabajo/
 * seguridad) se muestra. El override manual de Configuración → Módulos
 * siempre gana; si no hay override, la etapa es el default: sólo se
 * muestran mientras la cooperativa está "en obra".
 */
function moduloVisible(mod: Module | undefined, etapa: string, overrides: Record<string, string>): boolean {
  const etapasDefault = mod ? ETAPA_DEFAULT[mod] : undefined;
  if (!mod || !etapasDefault) return true;
  const forzado = overrides[mod];
  if (forzado === "mostrar") return true;
  if (forzado === "ocultar") return false;
  return etapasDefault.includes(etapa);
}

function itemsFor(user: SessionUser) {
  return ALL_ITEMS.filter((i) => moduloVisible(i.mod, user.etapa, user.modulos_override)).filter(
    (i) => !i.mod || canRead(user.rol, i.mod)
  );
}

function groupsFor(user: SessionUser): NavGroup[] {
  return GROUPS.map((g) => ({
    label: g.label,
    items: g.items
      .filter((i) => moduloVisible(i.mod, user.etapa, user.modulos_override))
      .filter((i) => !i.mod || canRead(user.rol, i.mod)),
  })).filter((g) => g.items.length > 0);
}

export function Sidebar({ user }: { user: SessionUser }) {
  // La Sidebar (barra lateral de escritorio) ya no lista "Alertas" ni
  // "Buscador" como ítems del menú — pedido explícito: que la lista sea más
  // corta. Alertas y Buscar ahora se acceden desde los íconos junto al
  // saludo, arriba de la pantalla de Inicio. Se filtra recién acá (no se
  // saca de GROUPS/ALL_ITEMS) para no tocar el menú "Más" del celular ni la
  // barra inferior (BottomNav), que los siguen mostrando tal cual estaban.
  const OCULTOS_EN_SIDEBAR = ["/alertas", "/buscar"];
  const groups = groupsFor(user)
    .map((g) => ({ ...g, items: g.items.filter((i) => !OCULTOS_EN_SIDEBAR.includes(i.href)) }))
    .filter((g) => g.items.length > 0);
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
      <div className="px-5 py-4 flex items-center gap-2.5 border-b border-white/10">
        {logo_url ? (
          <img src={logo_url} alt={nombre} className="h-9 w-9 rounded-full object-cover flex-shrink-0" />
        ) : (
          <Logo3D src="/coova-logo-horizontal.png" width={100} height={30} className="flex-shrink-0" />
        )}
        <div className="min-w-0">
          <div className="text-sm font-bold leading-tight truncate">{nombre}</div>
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
        <div className="text-xs text-white/60">
          <Saludo nombre={user.nombre.split(" ")[0]} />
        </div>
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
    <nav className="md:hidden fixed bottom-0 inset-x-0 z-20 bg-surface border-t border-ink/10 safe-bottom">
      <div className="flex text-ink/45">
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

export { ALL_ITEMS, itemsFor, groupsFor, moduloVisible };
