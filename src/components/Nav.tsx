import Link from "next/link";
import type { ReactNode } from "react";
import type { SessionUser } from "@/lib/auth";
import { canRead, canEdit, ROLE_LABELS, type Module } from "@/lib/roles";
import { logoutAction } from "@/lib/actions/auth";
import { Saludo } from "./Saludo";
import { NavLink } from "./NavLink";
import { NavTopGroup } from "./NavGroupSection";
import { Logo3D } from "./Logo3D";
import { Avatar } from "./EntidadLink";
import { TopBarClient } from "./TopBarClient";
import { HeaderQuickLinks, type QuickLinkItem } from "./HeaderQuickLinks";
import { MiCuenta } from "./MiCuenta";
import type { MiCuentaData } from "@/lib/logic";
import {
  Home,
  Bell,
  Mail,
  ShoppingCart,
  Truck,
  Wallet,
  HardHat,
  Milestone,
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
  BookUser,
  Send,
  Gavel,
  MessageSquare,
  Inbox,
  Megaphone,
  Rocket,
  FileSignature,
  QrCode,
  ListChecks,
  BookOpen,
  Landmark,
  UserCog,
  ClipboardCheck,
  Eye,
  FileCheck2,
  Zap,
  UserPlus,
  Building2,
  LifeBuoy,
  FileUp,
  BriefcaseBusiness,
  UsersRound,
  UserRound,
  House as HomeIcon,
  Clock,
  Scale,
} from "lucide-react";

type NavItem = {
  href: string;
  label: string;
  icon: ReactNode;
  mod?: Module;
  soloPlataforma?: boolean;
  /** Fase 1D: sólo en estas etapas de la cooperativa (ej. "Mis horas" sólo en obra). */
  etapas?: string[];
  /** Fase 1D: sólo para quien tiene ficha de socio (o rol socio). */
  soloSocios?: boolean;
  /** Fase 3A: sólo quien organiza las horas (conducción o Comisión de Trabajo). */
  soloHoras?: boolean;
  /** Fase 2H: sólo el admin de la cooperativa. */
  soloAdmin?: boolean;
  /** Fase 2F: sólo para quien manda avisos oficiales (mismo criterio que actions/avisos.ts). */
  soloEmisores?: boolean;
};
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

// Fase 1D (menú por rol, "máximo 9 entradas"): el menú se reorganizó en 9
// grupos con nombres de la vida de la cooperativa, y el socio común ve sólo
// lo suyo (ver MENU_SOCIO). Ninguna pantalla se quitó: todas siguen en su
// misma dirección y en "Más". Cambios de lugar:
//  - "Trabajo" (registro anterior de jornadas) sale del menú: las horas ahora
//    se organizan en la Comisión de Trabajo (planificación, asistencia y
//    libreta). La pantalla sigue en /trabajo y se enlaza desde la libreta.
//  - Panel Fiscal, Auditoría, Cumplimiento, Transparencia y Reportes quedan
//    juntos en "Control y transparencia".
//  - Reglamento, Configuración y las herramientas de administración quedan
//    juntos en "Administración".
const GROUPS: NavGroup[] = [
  {
    label: "Inicio",
    items: [
      { href: "/dashboard", label: "Inicio", icon: <Home size={ICON_SIZE} /> },
      { href: "/mi-vivienda", label: "Mi vivienda", icon: <HomeIcon size={ICON_SIZE} />, soloSocios: true },
      { href: "/mis-horas", label: "Mis horas", icon: <Clock size={ICON_SIZE} />, soloSocios: true, etapas: ["obra"] },
      { href: "/alertas", label: "Alertas", icon: <Bell size={ICON_SIZE} /> },
      { href: "/notificaciones", label: "Avisos", icon: <Inbox size={ICON_SIZE} /> },
      // Fase 2F: los avisos oficiales le llegan a todos en «Avisos» (y arriba del Inicio); esta pantalla es para mandarlos.
      { href: "/avisos", label: "Avisos oficiales", icon: <Megaphone size={ICON_SIZE} />, soloEmisores: true },
      { href: "/encuestas", label: "Encuestas", icon: <ListChecks size={ICON_SIZE} />, soloEmisores: true },
      { href: "/mi-trabajo", label: "Mi trabajo", icon: <ListChecks size={ICON_SIZE} /> },
      { href: "/calendario", label: "Calendario", icon: <CalendarDays size={ICON_SIZE} /> },
    ],
  },
  {
    label: "Socios y vivienda",
    items: [
      { href: "/socios", label: "Socios y núcleos", icon: <Users size={ICON_SIZE} />, mod: "socios" },
      { href: "/contactos", label: "Directorio", icon: <BookUser size={ICON_SIZE} /> },
      { href: "/reclamos", label: "Reclamos y mantenimiento", icon: <Wrench size={ICON_SIZE} />, mod: "reclamos" },
      { href: "/mantenimiento", label: "Mantenimiento preventivo", icon: <Wrench size={ICON_SIZE} />, mod: "reclamos", etapas: ["habitada"] },
      { href: "/reservas", label: "Reservas de espacios", icon: <CalendarDays size={ICON_SIZE} />, etapas: ["habitada"] },
    ],
  },
  {
    label: "Finanzas",
    items: [
      { href: "/finanzas", label: "Finanzas y cuotas", icon: <Wallet size={ICON_SIZE} />, mod: "finanzas" },
      { href: "/compras", label: "Compras", icon: <ShoppingCart size={ICON_SIZE} />, mod: "compras" },
      { href: "/proveedores", label: "Proveedores", icon: <Truck size={ICON_SIZE} />, mod: "compras" },
      // Sin "mod": el resumen de Gastos por Comisión lo ve cualquier usuario
      // autenticado ("todos ven el resumen, cada uno edita solo lo suyo").
      { href: "/gastos", label: "Gastos de comisiones", icon: <Receipt size={ICON_SIZE} /> },
      { href: "/liquidaciones", label: "Liquidaciones de egreso", icon: <Receipt size={ICON_SIZE} />, mod: "finanzas" },
    ],
  },
  {
    label: "Obra y trámites",
    items: [
      { href: "/tramites", label: "¿En qué estamos?", icon: <Milestone size={ICON_SIZE} />, etapas: ["pre_obra", "obra"] },
      { href: "/obra", label: "Avance de obra", icon: <HardHat size={ICON_SIZE} />, mod: "obra" },
      { href: "/qr-obra", label: "QR de asistencia", icon: <QrCode size={ICON_SIZE} />, mod: "trabajo", soloHoras: true },
      { href: "/seguridad", label: "Seguridad", icon: <ShieldCheck size={ICON_SIZE} />, mod: "seguridad" },
    ],
  },
  // Pedido explícito (05/10): "Comisiones y reuniones" es un grupo propio.
  {
    label: "Comisiones y reuniones",
    items: [
      { href: "/comisiones", label: "Comisiones", icon: <Compass size={ICON_SIZE} />, mod: "comisiones" },
      { href: "/reuniones", label: "Reuniones", icon: <CalendarDays size={ICON_SIZE} />, mod: "comisiones" },
      { href: "/solicitudes", label: "Solicitudes", icon: <Send size={ICON_SIZE} />, mod: "comisiones" },
      { href: "/decisiones", label: "Decisiones", icon: <Gavel size={ICON_SIZE} />, mod: "comisiones" },
      { href: "/comunicaciones", label: "Comunicaciones", icon: <MessageSquare size={ICON_SIZE} />, mod: "comisiones" },
    ],
  },
  {
    label: "Asambleas y Consejo",
    items: [
      { href: "/asambleas", label: "Asambleas", icon: <Landmark size={ICON_SIZE} />, mod: "comisiones" },
      { href: "/consejo-directivo", label: "Consejo Directivo", icon: <UserCog size={ICON_SIZE} />, mod: "comisiones" },
      { href: "/libros-sociales", label: "Libros sociales", icon: <BookOpen size={ICON_SIZE} />, mod: "comisiones" },
    ],
  },
  {
    label: "Documentos",
    items: [
      { href: "/documentos", label: "Documentos", icon: <FileText size={ICON_SIZE} />, mod: "documentos" },
      // Fase 2H: constancias y notas con variables (mismo criterio que quien manda avisos).
      { href: "/plantillas", label: "Plantillas de texto", icon: <FileSignature size={ICON_SIZE} />, soloEmisores: true },
    ],
  },
  {
    label: "Control y transparencia",
    items: [
      { href: "/transparencia", label: "¿En qué se gasta?", icon: <Eye size={ICON_SIZE} /> },
      { href: "/salud", label: "Salud de la cooperativa", icon: <ClipboardCheck size={ICON_SIZE} />, mod: "auditoria" },
      { href: "/fiscal", label: "Panel Fiscal", icon: <ClipboardCheck size={ICON_SIZE} />, mod: "auditoria" },
      { href: "/auditoria", label: "Auditoría", icon: <History size={ICON_SIZE} />, mod: "auditoria" },
      { href: "/cumplimiento", label: "Cumplimiento", icon: <FileCheck2 size={ICON_SIZE} />, mod: "auditoria" },
      { href: "/reportes", label: "Reportes", icon: <BarChart3 size={ICON_SIZE} /> },
    ],
  },
  {
    label: "Administración",
    items: [
      { href: "/reglamento", label: "Reglas y avisos", icon: <Scale size={ICON_SIZE} /> },
      { href: "/configuracion", label: "Configuración", icon: <Settings size={ICON_SIZE} /> },
      { href: "/reglas-automaticas", label: "Reglas automáticas", icon: <Zap size={ICON_SIZE} /> },
      { href: "/usuarios", label: "Gestión de usuarios", icon: <UserPlus size={ICON_SIZE} /> },
      { href: "/alta", label: "Alta de la cooperativa", icon: <Rocket size={ICON_SIZE} />, soloAdmin: true },
      { href: "/cambiar-etapa", label: "Cambiar de etapa", icon: <Milestone size={ICON_SIZE} />, soloAdmin: true },
      { href: "/importar", label: "Importar datos", icon: <FileUp size={ICON_SIZE} /> },
      { href: "/mails", label: "Mails", icon: <Mail size={ICON_SIZE} /> },
      { href: "/ia", label: "Asistente IA", icon: <Sparkles size={ICON_SIZE} /> },
      { href: "/buscar", label: "Buscador", icon: <Search size={ICON_SIZE} /> },
      { href: "/soporte", label: "Ayuda y soporte", icon: <LifeBuoy size={ICON_SIZE} /> },
      { href: "/plataforma", label: "Panel de plataforma", icon: <Building2 size={ICON_SIZE} />, soloPlataforma: true },
    ],
  },
];

/** Roles de gestión que ven "Mi vivienda" sólo si además son socios (tienen ficha). */
// Fase 1D: el socio común ve un menú corto, sólo con lo suyo. Lo demás que su
// rol puede leer sigue accesible por dirección y desde "Más".
const MENU_SOCIO = new Set(["/dashboard", "/mi-vivienda", "/tramites", "/mis-horas", "/reservas", "/notificaciones", "/calendario", "/documentos", "/transparencia", "/mi-trabajo", "/soporte"]);
// Páginas que no tienen un lugar en el menú pero siguen existiendo (para "Más" y accesos).
const RUTAS_FUERA_DEL_MENU: NavItem[] = [{ href: "/trabajo", label: "Trabajo (registro anterior)", icon: <Handshake size={ICON_SIZE} />, mod: "trabajo" }];

// Mejora global del sidebar (28/09, pedido explícito — sección 34): un
// ícono identificable por grupo principal, más chico que los de cada ítem
// (ICON_SIZE=18) para no competir visualmente con ellos — el pedido es
// "reducir ruido visual", no sumar otro nivel de íconos grandes. "Inicio" no
// necesita entrada acá: nunca se pliega, sigue sin acordeón (sección 21).
const GROUP_ICON_SIZE = 14;
const GROUP_ICON: Record<string, ReactNode> = {
  "Socios y vivienda": <Users size={GROUP_ICON_SIZE} />,
  Finanzas: <Wallet size={GROUP_ICON_SIZE} />,
  Obra: <HardHat size={GROUP_ICON_SIZE} />,
  "Comisiones y reuniones": <Compass size={GROUP_ICON_SIZE} />,
  "Asambleas y Consejo": <Landmark size={GROUP_ICON_SIZE} />,
  Documentos: <FileText size={GROUP_ICON_SIZE} />,
  "Control y transparencia": <Eye size={GROUP_ICON_SIZE} />,
  Administración: <Settings size={GROUP_ICON_SIZE} />,
};

const ALL_ITEMS: NavItem[] = [...GROUPS.flatMap((g) => g.items), ...RUTAS_FUERA_DEL_MENU];

/**
 * Decide si un módulo se muestra. El override manual (Configuración →
 * Módulos, o el preset de un plan — ver lib/planes.ts) siempre gana, para
 * CUALQUIERA de los 10 módulos. Si no hay override:
 * - Los 4 que dependen de la etapa (obra/trabajo/seguridad/reclamos) usan el
 *   default de ETAPA_DEFAULT — sólo se muestran en la etapa que corresponde.
 * - Los otros 6 (compras/finanzas/documentos/auditoria/comisiones/socios) no
 *   tienen ningún concepto de etapa — se muestran siempre.
 *
 * Fase 5, Sub-fase 5.3 ("Planes y módulos"): antes de esta sub-fase, esta
 * función devolvía `true` de entrada para cualquier módulo sin entrada en
 * ETAPA_DEFAULT, ignorando el override por completo para esos 6 — un plan
 * (o un ajuste manual desde Configuración) no podía ocultarlos. Se extendió
 * para que el override aplique parejo a los 10, sin cambiar ningún
 * comportamiento existente: mientras nadie fije un override para esos 6
 * módulos, siguen mostrándose siempre, exactamente igual que antes.
 */
function moduloVisible(mod: Module | undefined, etapa: string, overrides: Record<string, string>): boolean {
  if (!mod) return true;
  const forzado = overrides[mod];
  if (forzado === "mostrar") return true;
  if (forzado === "ocultar") return false;
  const etapasDefault = ETAPA_DEFAULT[mod];
  if (!etapasDefault) return true;
  return etapasDefault.includes(etapa);
}

/** Fase 1D: ¿esta persona puede abrir este ítem? (permisos, etapa, módulos, plataforma). */
function itemPermitido(i: NavItem, user: SessionUser, esSocio: boolean): boolean {
  if (!moduloVisible(i.mod, user.etapa, user.modulos_override)) return false;
  if (i.mod && !canRead(user.rol, i.mod)) return false;
  if (i.soloPlataforma && !user.es_platform_admin) return false;
  if (i.etapas && !i.etapas.includes(user.etapa)) return false;
  if (i.soloSocios && !(esSocio || user.rol === "socio")) return false;
  if (i.soloAdmin && user.rol !== "admin") return false;
  if (i.soloHoras && !(canEdit(user.rol, "finanzas") || user.rol === "comision_trabajo")) return false;
  if (i.soloEmisores && !(canEdit(user.rol, "socios") || canEdit(user.rol, "finanzas") || user.rol === "consejo_directivo")) return false;
  return true;
}

/** ¿Va en su menú? El socio común ve un menú corto (MENU_SOCIO). */
function itemVisible(i: NavItem, user: SessionUser, esSocio: boolean): boolean {
  if (!itemPermitido(i, user, esSocio)) return false;
  if (user.rol === "socio" && !MENU_SOCIO.has(i.href)) return false;
  if (RUTAS_FUERA_DEL_MENU.includes(i)) return false;
  return true;
}

function itemsFor(user: SessionUser, esSocio = false) {
  return ALL_ITEMS.filter((i) => itemVisible(i, user, esSocio));
}

/** Para "Más": todo lo que esta persona puede abrir, aunque no esté en su menú corto. */
function itemsAccesibles(user: SessionUser, esSocio = false) {
  return ALL_ITEMS.filter((i) => itemPermitido(i, user, esSocio));
}

function groupsFor(user: SessionUser, esSocio = false): NavGroup[] {
  // Fase 1D: el socio común ve una sola lista corta, sin grupos plegables.
  if (user.rol === "socio") return [{ label: "Inicio", items: itemsFor(user, esSocio) }];
  return GROUPS.map((g) => ({
    label: g.label,
    items: g.items.filter((i) => itemVisible(i, user, esSocio)),
  })).filter((g) => g.items.length > 0);
}

export function Sidebar({ user, esSocio = false }: { user: SessionUser; esSocio?: boolean }) {
  // La Sidebar (barra lateral de escritorio) ya no lista "Alertas" ni
  // "Buscador" como ítems del menú — pedido explícito: que la lista sea más
  // corta. Alertas y Buscar ahora se acceden desde los íconos junto al
  // saludo, arriba de la pantalla de Inicio. Se filtra recién acá (no se
  // saca de GROUPS/ALL_ITEMS) para no tocar el menú "Más" del celular ni la
  // barra inferior (BottomNav), que los siguen mostrando tal cual estaban.
  const OCULTOS_EN_SIDEBAR = ["/alertas", "/buscar"];
  const groups = groupsFor(user, esSocio)
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
          const contenido = (
            <>
              {g.items.map((i) => (
                <NavLink key={i.href} href={i.href} icon={i.icon} label={i.label} accentColor={acento} />
              ))}
            </>
          );
          // Mejora global del sidebar (28/09, pedido explícito — secciones
          // 20-34): "Inicio" queda siempre desplegado, sin acordeón (sección
          // 21, "no modificar su posición ni su funcionamiento"). El resto de
          // los grupos ahora se pliegan/despliegan con NavTopGroup (incluido
          // "Comisiones y reuniones", grupo propio desde el 05/10).
          if (g.label === "Inicio") {
            return (
              <div key={g.label}>
                <div className="px-3 pb-1 text-[10.5px] font-semibold uppercase tracking-wide text-white/40">
                  {g.label}
                </div>
                <div className="space-y-0.5">{contenido}</div>
              </div>
            );
          }
          return (
            <NavTopGroup key={g.label} label={g.label} icon={GROUP_ICON[g.label]} allHrefs={g.items.map((i) => i.href)}>
              {contenido}
            </NavTopGroup>
          );
        })}
      </nav>
      <div className="px-4 py-4 border-t border-white/10">
        {/* Fase 6 (perfil individual de usuario): el saludo + rol, acá abajo
            del todo, es el lugar más natural para llegar a "mi perfil" sin
            sumar un ítem más al menú de arriba. */}
        <Link href={`/usuarios/${user.id}`} className="block hover:underline underline-offset-2">
          <div className="text-xs text-white/60">
            <Saludo nombre={user.nombre.split(" ")[0]} />
          </div>
          <div className="text-[11px] text-white/40">{ROLE_LABELS[user.rol]}</div>
        </Link>
        <form action={logoutAction}>
          <button className="mt-2 text-xs text-white/70 hover:text-white underline underline-offset-2">Cerrar sesión</button>
        </form>
      </div>
    </aside>
  );
}

export function TopBar({ user, miCuenta }: { user: SessionUser; miCuenta: MiCuentaData | null }) {
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
      {/* "Mi cuenta" (rediseño 17/09, reemplaza el punto 13 anterior): en
          celular no hay espacio para el buscador+campana+cuenta juntos como
          en escritorio (ver TopBarDesktop), pero sí para este único acceso
          compacto — mismo Avatar de siempre, ahora abre el modal "Mi cuenta"
          en vez de navegar a otra página. */}
      {miCuenta ? (
        <MiCuenta data={miCuenta} size={30} variant="mobile" />
      ) : (
        <Avatar url={user.avatar_url} nombre={user.nombre} size={30} className="border-white/30" />
      )}
    </header>
  );
}

/**
 * Rediseño "Color secundario + Top Bar" (puntos 7-18 del pedido): barra
 * superior de escritorio, nueva — hasta ahora <TopBar> de arriba sólo
 * existía para celular (`md:hidden`), en escritorio no había ninguna franja
 * superior: la Sidebar ocupaba toda la identidad de marca y el resto de la
 * pantalla era directamente el contenido de cada página. Deliberadamente
 * `hidden md:flex` (sólo escritorio, ver la nota de alcance de esta fase en
 * CHANGELOG.md): en celular ya existen accesos equivalentes (Buscar/Alertas
 * están siempre visibles en BottomNav, y "Mi perfil"/"Cerrar sesión" están
 * en el pie de la Sidebar/menú "Más") — meter buscador+notificaciones+menú
 * de perfil en la franja angosta del celular hubiera significado o bien
 * agrandarla mucho (compite con el pedido de "no hacerla excesivamente
 * alta") o apretar demasiado los toques táctiles.
 *
 * `TopBarClient` (único "use client" de todo esto) recibe sólo datos ya
 * resueltos — nunca queries ni lógica de negocio — y `logoutAction` como
 * Server Action (el único tipo de función que puede cruzar ese límite, ver
 * la nota grande en DashboardCardClient.tsx).
 */
// Mejora quirúrgica del header (26/09): íconos propios para los 3 accesos
// rápidos de navegación, elegidos para esta franja puntual — no tienen que
// coincidir con el ícono que ya usa cada ítem en la Sidebar (ej. Comisiones
// usa Compass en el menú lateral; acá, UsersRound, más asociado a "grupo de
// personas" para un acceso chico de una sola línea). El permiso (si el ítem
// existe o no para este usuario) sigue siendo el mismo de siempre.
const ICONO_ACCESO_RAPIDO: Record<string, ReactNode> = {
  "/mi-trabajo": <BriefcaseBusiness size={16} />,
  "/comisiones": <UsersRound size={16} />,
  "/socios": <UserRound size={16} />,
};
const ORDEN_ACCESOS_RAPIDOS = ["/mi-trabajo", "/comisiones", "/socios"];

export function TopBarDesktop({
  user,
  alertas,
  miCuenta,
}: {
  user: SessionUser;
  alertas: { count: number; hayCriticas: boolean; items: { id: number; titulo: string; severidad: string; fecha: string }[] };
  miCuenta: MiCuentaData | null;
}) {
  // Reutiliza exactamente el mismo filtro de permisos que ya arma la
  // Sidebar/BottomNav (moduloVisible + canRead + soloPlataforma, ver
  // itemsFor arriba) — nunca una lista de visibilidad aparte para el header.
  // Si un rol no ve "Comisiones" en el menú, tampoco lo ve acá.
  const disponibles = itemsFor(user);
  const accesosRapidos: QuickLinkItem[] = ORDEN_ACCESOS_RAPIDOS.map((href) => disponibles.find((i) => i.href === href))
    .filter((i): i is NonNullable<typeof i> => Boolean(i))
    .map((i) => ({ href: i.href, label: i.label, icon: ICONO_ACCESO_RAPIDO[i.href] }));

  return (
    <header className="hidden md:flex items-center justify-end gap-1 sm:gap-2 px-4 sm:px-6 py-2.5 bg-surface border-b border-border">
      {/* Rediseño "Mi cuenta" (17/09): la franja de accesos rápidos de ACCIÓN
          que vivía acá (Nueva solicitud de compra / Registrar movimiento /
          etc.) se había retirado de la cabecera global — esas acciones
          puntuales viven en su propio módulo. La franja de acá abajo es
          distinta: navegación pura (26/09, pedido explícito), no acciones.
          `justify-end` deja todo pegado a la derecha, sin nada más en esta
          franja (el logo/marca vive en la Sidebar, no acá). */}
      <HeaderQuickLinks items={accesosRapidos} />
      <TopBarClient alertas={alertas} miCuenta={miCuenta && <MiCuenta data={miCuenta} />} />
    </header>
  );
}

export function BottomNav({ user, esSocio = false }: { user: SessionUser; esSocio?: boolean }) {
  // Prioriza en celular lo que cada persona usa todos los días. Fase 1D: el
  // socio común tiene su propia barra (Inicio = su portal, sus horas en
  // obra, sus avisos y documentos); el resto, la de siempre.
  const primary =
    user.rol === "socio"
      ? ["/dashboard", user.etapa === "obra" ? "/mis-horas" : "/calendario", "/notificaciones", "/documentos"]
      : ["/dashboard", "/buscar", "/documentos", "/alertas"];
  const disponibles = itemsAccesibles(user, esSocio);
  const items = primary.map((h) => disponibles.find((i) => i.href === h)).filter((i): i is NavItem => Boolean(i));
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

// Rediseño "Mi cuenta" (17/09, pedido explícito): la franja de "Accesos
// rápidos" que vivía acá (accesosRapidosFor/AccesosRapidos/AccesosRapidosInline
// — botones como "Nueva solicitud de compra", "Registrar movimiento", "Subir
// documento") se retiró de la cabecera global. El pedido fue puntual: no
// quiere la cabecera ocupada por botones de acción, sólo el acceso compacto
// "Mi cuenta" (ver MiCuenta.tsx, montado en TopBar/TopBarDesktop). Esas
// mismas acciones siguen disponibles exactamente donde siempre estuvieron
// disponibles además de acá: dentro de cada módulo (compras/page.tsx tiene
// su "+ Nueva solicitud", finanzas/page.tsx su alta de movimiento,
// documentos/page.tsx su "+ Subir documento") — no se perdió ninguna acción,
// sólo se dejó de duplicarla en una franja global.

export { ALL_ITEMS, GROUPS, itemsFor, itemsAccesibles, groupsFor, moduloVisible };
