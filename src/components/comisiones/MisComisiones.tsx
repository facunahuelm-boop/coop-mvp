import Link from "next/link";
import { UsersRound } from "lucide-react";
import { all } from "@/lib/db";
import type { SessionUser } from "@/lib/auth";
import { comisionDisponibleEnEtapa, funcionDe, FUNCION_COMISION } from "@/lib/comisionesFunciones";
import { CargaRapida } from "@/components/comisiones/CargaRapida";

/** Inicio: las comisiones de las que esta persona es integrante, con carga rápida de fotos. */
export async function MisComisiones({ user }: { user: SessionUser }) {
  const filas = await all<{ id: number; nombre: string; funcion: string | null; etapas: string | null; rol_en_comision: string; pendientes: string }>(
    `SELECT c.id, c.nombre, c.funcion, c.etapas, m.rol_en_comision,
            (SELECT count(*) FROM tareas t WHERE t.comision_id = c.id AND t.estado <> 'completada')::text AS pendientes
       FROM comision_miembros m JOIN comisiones c ON c.id = m.comision_id
      WHERE m.user_id = ? AND m.activo = 1 AND c.activa = 1 ORDER BY c.nombre`,
    [user.id]
  ).catch(() => []);
  const mias = filas.filter((c) => comisionDisponibleEnEtapa(c, user.etapa));
  if (mias.length === 0) return null;
  return (
    <section className="mb-6" data-testid="mis-comisiones">
      <h2 className="mb-2 text-sm font-bold uppercase tracking-wide text-ink-muted">Mis comisiones</h2>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {mias.map((c) => (
          <div key={c.id} className="rounded-2xl border border-border bg-surface p-4 shadow-[var(--shadow-sm)]">
            <div className="flex items-start gap-3">
              <span className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[var(--accent-blue-bg)] text-[var(--accent-blue)]">
                <UsersRound size={18} aria-hidden />
              </span>
              <div className="min-w-0">
                <Link href={`/comisiones/${c.id}`} className="block truncate text-[15px] font-bold text-ink hover:underline">
                  {c.nombre}
                </Link>
                <p className="text-xs text-ink-muted">
                  {FUNCION_COMISION[funcionDe(c.funcion)].label} · {c.rol_en_comision === "coordinador" ? "coordinás" : "integrás"} · {Number(c.pendientes)} tarea{Number(c.pendientes) === 1 ? "" : "s"} pendiente{Number(c.pendientes) === 1 ? "" : "s"}
                </p>
              </div>
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <Link href={`/comisiones/${c.id}`} className="inline-flex items-center rounded-xl bg-[var(--color-brand-800)] px-3 py-1.5 text-xs font-semibold text-white hover:opacity-90">
                Abrir y cargar
              </Link>
              <CargaRapida comisionId={c.id} />
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
