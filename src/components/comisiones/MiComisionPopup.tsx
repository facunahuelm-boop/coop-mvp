"use client";

// Inicio (16/10, pedido explícito): cada comisión del núcleo es una tarjeta
// mínima — nombre y cuántas tareas tiene pendientes. Al tocarla se abre un
// pop-up con lo justo y tres caminos: agregar lo principal de esa comisión
// (abre su formulario principal en la página de la comisión), cargar una foto
// o archivo ahí mismo, o ir al panel de la comisión con todo el detalle.

import { useState } from "react";
import Link from "next/link";
import { UsersRound } from "lucide-react";
import { Modal } from "@/components/ui-client";
import { CargaRapida } from "@/components/comisiones/CargaRapida";

export type MiComision = {
  id: number;
  nombre: string;
  funcionLabel: string;
  coordina: boolean;
  pendientes: number;
  vencidas: number;
  proxima: { titulo: string; fecha: string | null } | null;
};

const plural = (n: number, s: string) => `${n} ${s}${n === 1 ? "" : "s"}`;
const dm = (f: string) => f.slice(0, 10).split("-").reverse().slice(0, 2).join("/");

export function MiComisionPopup({ c, puedeAgregar }: { c: MiComision; puedeAgregar: boolean }) {
  const [abierto, setAbierto] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={() => setAbierto(true)}
        className="flex w-full items-center gap-3 rounded-2xl border border-border bg-surface p-4 text-left shadow-[var(--shadow-sm)] transition-all hover:border-[var(--color-brand-800)]/40 hover:shadow-[var(--shadow-md)] focus:outline-none focus:ring-2 focus:ring-[var(--color-brand-800)]/30"
      >
        <span className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[var(--accent-blue-bg)] text-[var(--accent-blue)]">
          <UsersRound size={18} aria-hidden />
        </span>
        <span className="min-w-0">
          <span className="block truncate text-[15px] font-bold text-ink">{c.nombre}</span>
          <span className={`block text-xs ${c.vencidas > 0 ? "font-semibold text-[var(--color-rojo)]" : "text-ink-muted"}`}>
            {c.pendientes > 0 ? `${plural(c.pendientes, "tarea")} pendiente${c.pendientes === 1 ? "" : "s"}` : "Sin tareas pendientes"}
          </span>
        </span>
      </button>

      <Modal open={abierto} onClose={() => setAbierto(false)} title={c.nombre}>
        <div className="space-y-4">
          <div className="space-y-1">
            <p className="text-ink-muted">
              Comisión de {c.funcionLabel.toLowerCase()} · {c.coordina ? "la coordinás" : "la integrás"}
            </p>
            <p className="text-ink">
              {c.pendientes > 0 ? `${plural(c.pendientes, "tarea")} pendiente${c.pendientes === 1 ? "" : "s"}` : "No hay tareas pendientes."}
              {c.vencidas > 0 && <span className="font-semibold text-[var(--color-rojo)]"> ({plural(c.vencidas, "vencida")})</span>}
            </p>
            {c.proxima && (
              <p className="text-ink-muted">
                Lo próximo: <span className="font-medium text-ink">{c.proxima.titulo}</span>
                {c.proxima.fecha ? ` · vence ${dm(c.proxima.fecha)}` : ""}
              </p>
            )}
          </div>

          <div className="flex flex-col gap-2">
            {puedeAgregar && (
              <Link
                href={`/comisiones/${c.id}?accion=agregar`}
                className="inline-flex items-center justify-center rounded-xl bg-[var(--color-brand-800)] px-4 py-3 text-[15px] font-semibold text-white hover:opacity-90"
              >
                + Agregar en la comisión
              </Link>
            )}
            <CargaRapida
              comisionId={c.id}
              enLinea
              claseBoton="inline-flex w-full items-center justify-center rounded-xl border border-border bg-surface px-4 py-3 text-[15px] font-semibold text-ink hover:bg-surface-sunken"
            />
            <Link
              href={`/comisiones/${c.id}`}
              className="inline-flex items-center justify-center rounded-xl px-4 py-2.5 text-sm font-semibold text-[var(--color-brand-800)] underline underline-offset-2 hover:bg-surface-sunken"
            >
              Ver más detalle →
            </Link>
          </div>
        </div>
      </Modal>
    </>
  );
}
