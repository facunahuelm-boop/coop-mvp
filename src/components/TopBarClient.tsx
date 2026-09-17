"use client";

import { useState, type ReactNode } from "react";
import Link from "next/link";
import { Search, Bell } from "lucide-react";
import { useCommandPalette } from "./ui-client";
import dayjs from "dayjs";

type AlertaItem = { id: number; titulo: string; severidad: string; fecha: string };

/**
 * Rediseño "Color secundario + Top Bar" (puntos 7-18), actualizado por el
 * rediseño "Mi cuenta" (17/09): única pieza interactiva de la nueva Top Bar
 * — buscador (abre el CommandPalette ya existente), campana de
 * notificaciones (popover chico, no una lista gigante en la barra) y "Mi
 * cuenta" (ver MiCuenta.tsx — antes era un menú desplegable con "Mi perfil"/
 * "Configuración"/"Cerrar sesión" que llevaba a otra página; ahora es el
 * mismo botón de avatar pero abre el modal "Mi cuenta", que incluye esas
 * mismas dos acciones en su pie). Todo lo que recibe de props es dato o JSX
 * ya resuelto por el Server Component padre (ver (app)/layout.tsx) — nunca
 * cruza el límite Server→Client una función común, solo Server Actions
 * (permitido; ver la nota en DashboardCardClient.tsx).
 */
export function TopBarClient({
  alertas,
  miCuenta,
}: {
  alertas: { count: number; hayCriticas: boolean; items: AlertaItem[] };
  miCuenta: ReactNode;
}) {
  const { abrir: abrirBuscador } = useCommandPalette();
  const [notifsAbiertas, setNotifsAbiertas] = useState(false);

  return (
    <div className="flex items-center gap-2 sm:gap-3">
      <button
        type="button"
        onClick={abrirBuscador}
        className="hidden sm:flex items-center gap-2 rounded-xl border border-border bg-surface-sunken px-3.5 py-2 text-sm text-ink-faint hover:bg-brand-100 hover:text-ink-muted transition-colors w-48 lg:w-64"
      >
        <Search size={16} aria-hidden />
        <span className="truncate">Buscar…</span>
        <kbd className="ml-auto text-[10px] border border-border rounded px-1 py-0.5 text-ink-faint">Ctrl K</kbd>
      </button>
      {/* Versión compacta para pantallas angostas dentro de md: sólo el ícono. */}
      <button
        type="button"
        onClick={abrirBuscador}
        aria-label="Buscar"
        className="sm:hidden inline-flex items-center justify-center h-10 w-10 rounded-full border border-border bg-surface-sunken text-ink-muted hover:bg-brand-100"
      >
        <Search size={18} />
      </button>

      <div className="relative">
        <button
          type="button"
          onClick={() => setNotifsAbiertas((v) => !v)}
          aria-label={alertas.count > 0 ? `${alertas.count} notificaciones pendientes` : "Notificaciones"}
          className="relative inline-flex items-center justify-center h-10 w-10 rounded-full border border-border bg-surface text-ink-muted hover:bg-[var(--color-secondary-bg)] hover:text-[var(--color-secondary)] transition-colors"
        >
          <Bell size={18} />
          {alertas.count > 0 && (
            <span
              className={`absolute -top-1 -right-1 min-w-[18px] h-[18px] px-1 rounded-full text-[10px] font-bold flex items-center justify-center text-white ${
                alertas.hayCriticas ? "bg-[var(--color-rojo)]" : "bg-[var(--color-amarillo)]"
              }`}
            >
              {alertas.count}
            </span>
          )}
        </button>

        {notifsAbiertas && (
          <>
            <div className="fixed inset-0 z-30" onClick={() => setNotifsAbiertas(false)} />
            <div className="absolute right-0 mt-2 w-80 max-w-[90vw] rounded-2xl border border-border bg-surface shadow-[var(--shadow-lg)] z-40 overflow-hidden">
              <div className="px-4 py-3 border-b border-border">
                <h3 className="text-sm font-bold text-ink">Notificaciones</h3>
              </div>
              {alertas.items.length === 0 ? (
                <p className="px-4 py-6 text-sm text-ink-faint text-center">Sin notificaciones pendientes.</p>
              ) : (
                <ul className="max-h-80 overflow-y-auto divide-y divide-border">
                  {alertas.items.map((a) => (
                    <li key={a.id}>
                      <Link
                        href="/alertas"
                        onClick={() => setNotifsAbiertas(false)}
                        className="flex items-start gap-2.5 px-4 py-2.5 text-sm hover:bg-surface-sunken"
                      >
                        <span
                          className={`mt-1.5 h-1.5 w-1.5 rounded-full shrink-0 ${
                            a.severidad === "critica" ? "bg-[var(--color-rojo)]" : "bg-[var(--color-amarillo)]"
                          }`}
                          aria-hidden
                        />
                        <span className="min-w-0">
                          <span className="block text-ink truncate">{a.titulo}</span>
                          <span className="block text-xs text-ink-faint">{dayjs(a.fecha).format("DD/MM HH:mm")}</span>
                        </span>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
              <div className="px-4 py-2.5 border-t border-border">
                <Link
                  href="/alertas"
                  onClick={() => setNotifsAbiertas(false)}
                  className="text-xs font-semibold text-[var(--color-secondary)] hover:underline underline-offset-2"
                >
                  Ver todas →
                </Link>
              </div>
            </div>
          </>
        )}
      </div>

      {miCuenta}
    </div>
  );
}
