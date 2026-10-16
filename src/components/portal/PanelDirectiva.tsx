import type { ReactNode } from "react";
import Link from "next/link";
import dayjs from "dayjs";
import {
  CalendarClock,
  CheckCircle2,
  ChevronRight,
  FileText,
  Gavel,
  Landmark,
  Megaphone,
  NotebookPen,
  Send,
  ShoppingCart,
  UserCog,
  Wallet,
  Wrench,
} from "lucide-react";
import { get } from "@/lib/db";
import type { SessionUser } from "@/lib/auth";
import { canEdit, canRead } from "@/lib/roles";

// Inicio de la Directiva (16/10, pedido explícito: "pantalla propia de la
// directiva"). Arriba de todo, sólo para Consejo Directivo (y el admin):
//  1) la próxima reunión del Consejo o asamblea,
//  2) «Para decidir»: lo que espera a la directiva, con un toque a dónde se
//     resuelve (sólo lo que tiene algo; si no hay nada, lo dice),
//  3) «Cargar»: botones grandes que abren directo el formulario de cada
//     pantalla (?accion=…, ver components/comisiones/AbrirAlEntrar.tsx).
// Cada consulta tolera una tabla que todavía no existe (cuenta 0).

const n = async (sql: string, params: unknown[] = []) =>
  Number((await get<{ n: string }>(sql, params).catch(() => undefined))?.n ?? 0) || 0;

type Pendiente = { label: string; cantidad: number; href: string; icon: ReactNode };
type Accion = { label: string; href: string; icon: ReactNode; bg: string; fg: string };

export function esDirectivaPanel(user: SessionUser) {
  return user.rol === "consejo_directivo" || user.rol === "admin";
}

export async function PanelDirectiva({ user, comprasADecidir }: { user: SessionUser; comprasADecidir: number }) {
  const [solicitudes, decisiones, actasPorCargar, reclamos, proxima] = await Promise.all([
    n(`SELECT COUNT(*) AS n FROM solicitudes_comision WHERE estado IN ('pendiente', 'en_revision', 'esperando_informacion')`),
    n(`SELECT COUNT(*) AS n FROM decisiones_comision WHERE resultado = 'pendiente'`),
    n(`SELECT COUNT(*) AS n FROM reuniones WHERE tipo IN ('asamblea', 'consejo_directivo') AND estado = 'realizada' AND acta_id IS NULL`),
    canRead(user.rol, "reclamos") ? n(`SELECT COUNT(*) AS n FROM reclamos WHERE estado IN ('abierto', 'en_proceso')`) : Promise.resolve(0),
    get<{ id: number; tipo: string; titulo: string; fecha: string }>(
      `SELECT id, tipo, titulo, fecha FROM reuniones
        WHERE tipo IN ('asamblea', 'consejo_directivo') AND estado = 'planificada' AND fecha >= ?
        ORDER BY fecha ASC LIMIT 1`,
      [dayjs().format("YYYY-MM-DD")]
    ).catch(() => undefined),
  ]);

  const pendientes: Pendiente[] = [
    { label: "Compras para decidir", cantidad: comprasADecidir, href: "/compras", icon: <ShoppingCart size={18} /> },
    { label: "Decisiones por resolver", cantidad: decisiones, href: "/decisiones", icon: <Gavel size={18} /> },
    { label: "Solicitudes abiertas", cantidad: solicitudes, href: "/solicitudes", icon: <Send size={18} /> },
    { label: "Actas por cargar", cantidad: actasPorCargar, href: "/reuniones", icon: <NotebookPen size={18} /> },
    { label: "Reclamos sin resolver", cantidad: reclamos, href: "/reclamos", icon: <Wrench size={18} /> },
  ].filter((p) => p.cantidad > 0);

  const acciones: Accion[] = [
    ...(canEdit(user.rol, "finanzas")
      ? [{ label: "Registrar movimiento", href: "/finanzas?accion=movimiento", icon: <Wallet size={20} />, bg: "var(--accent-amber-bg)", fg: "var(--accent-amber)" }]
      : []),
    { label: "Reunión del Consejo", href: "/consejo-directivo?accion=reunion", icon: <UserCog size={20} />, bg: "var(--accent-blue-bg)", fg: "var(--accent-blue)" },
    { label: "Convocar asamblea", href: "/asambleas?accion=convocar", icon: <Landmark size={20} />, bg: "var(--accent-violet-bg)", fg: "var(--accent-violet)" },
    { label: "Registrar decisión", href: "/decisiones?accion=nueva", icon: <Gavel size={20} />, bg: "var(--accent-teal-bg)", fg: "var(--accent-teal)" },
    { label: "Mandar un aviso", href: "/avisos#nuevo-aviso", icon: <Megaphone size={20} />, bg: "var(--accent-blue-bg)", fg: "var(--accent-blue)" },
    { label: "Subir documento", href: "/documentos", icon: <FileText size={20} />, bg: "var(--accent-teal-bg)", fg: "var(--accent-teal)" },
  ];

  return (
    <section className="mb-6" data-testid="panel-directiva">
      <h2 className="mb-2 text-sm font-bold uppercase tracking-wide text-ink-muted">Directiva</h2>

      {proxima && (
        <Link
          href={proxima.tipo === "asamblea" ? `/asambleas/${proxima.id}` : `/reuniones/${proxima.id}`}
          className="mb-3 flex items-center gap-3 rounded-2xl bg-[var(--color-brand-800)] px-4 py-3 text-white shadow-[var(--shadow-sm)] active:scale-[.99]"
        >
          <CalendarClock size={22} className="shrink-0 opacity-90" aria-hidden />
          <span className="min-w-0 flex-1">
            <span className="block text-xs uppercase tracking-wide text-white/70">
              Próxima {proxima.tipo === "asamblea" ? "asamblea" : "reunión del Consejo"}
            </span>
            <span className="block truncate text-[15px] font-semibold">
              {proxima.titulo} · {dayjs(proxima.fecha).format(String(proxima.fecha).length > 10 ? "DD/MM HH:mm" : "DD/MM")}
            </span>
          </span>
          <ChevronRight size={18} className="shrink-0 opacity-80" aria-hidden />
        </Link>
      )}

      <div className="grid gap-3 lg:grid-cols-2">
        <div className="rounded-2xl border border-border bg-surface shadow-[var(--shadow-sm)]">
          <p className="px-4 pt-3 pb-1 text-[13px] font-semibold text-ink-muted">Para decidir</p>
          {pendientes.length === 0 ? (
            <p className="flex items-center gap-2 px-4 pb-3.5 pt-1 text-[15px] text-ink">
              <CheckCircle2 size={18} className="text-[var(--color-verde)]" aria-hidden /> Nada pendiente para la directiva.
            </p>
          ) : (
            <ul className="divide-y divide-border">
              {pendientes.map((p) => (
                <li key={p.label}>
                  <Link href={p.href} className="flex items-center gap-3 px-4 py-3 active:bg-surface-sunken hover:bg-surface-sunken/60">
                    <span className="shrink-0 text-ink-muted">{p.icon}</span>
                    <span className="flex-1 text-[15px] text-ink">{p.label}</span>
                    <span className="inline-flex min-w-7 items-center justify-center rounded-full bg-[var(--color-amarillo-bg)] px-2 py-0.5 text-sm font-bold text-[var(--color-amarillo)]">
                      {p.cantidad}
                    </span>
                    <ChevronRight size={16} className="shrink-0 text-ink-faint" aria-hidden />
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div>
          <p className="mb-2 text-[13px] font-semibold text-ink-muted lg:hidden">Cargar</p>
          <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3">
            {acciones.map((a) => (
              <Link
                key={a.href}
                href={a.href}
                className="flex flex-col items-start gap-2 rounded-2xl border border-border bg-surface p-3.5 shadow-[var(--shadow-sm)] active:scale-[.98] hover:border-[var(--color-brand-700)]/30"
              >
                <span className="inline-flex h-9 w-9 items-center justify-center rounded-xl" style={{ background: a.bg, color: a.fg }} aria-hidden>
                  {a.icon}
                </span>
                <span className="text-[14px] font-semibold leading-tight text-ink">{a.label}</span>
              </Link>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
