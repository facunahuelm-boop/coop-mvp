import Link from "next/link";
import { Card, SectionTitle } from "@/components/ui";
import type { KpiPanel, Panel, Tono } from "@/lib/panelesComision";

/** Fase 3B — dibuja el panel propio de una función de comisión (igual para todas). */

const TONO: Record<Tono, string> = {
  verde: "border-l-[var(--color-verde)]",
  amarillo: "border-l-[var(--color-amarillo)]",
  rojo: "border-l-[var(--color-rojo)]",
};
const PUNTO: Record<Tono, string> = { verde: "bg-[var(--color-verde)]", amarillo: "bg-[var(--color-amarillo)]", rojo: "bg-[var(--color-rojo)]" };

export function Kpis({ kpis, titulo }: { kpis: KpiPanel[]; titulo?: string }) {
  if (!kpis.length) return null;
  return (
    <div>
      {titulo && <SectionTitle>{titulo}</SectionTitle>}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {kpis.map((k) => (
          <div key={k.label} className={`rounded-xl border border-border bg-surface px-3 py-2.5 border-l-4 ${k.tono ? TONO[k.tono] : "border-l-border"}`}>
            <p className="text-[12px] text-ink-faint">{k.label}</p>
            <p className="text-lg font-bold text-ink">{k.valor}</p>
            {k.detalle && <p className="text-[12px] text-ink-muted">{k.detalle}</p>}
          </div>
        ))}
      </div>
    </div>
  );
}

export function PanelFuncion({ panel, extra }: { panel: Panel; extra?: React.ReactNode }) {
  return (
    <div className="space-y-5">
      <Kpis kpis={panel.kpis} />
      {panel.accesos.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {panel.accesos.map((a) => (
            <Link key={a.href + a.label} href={a.href} className="inline-flex items-center rounded-xl border border-border bg-surface px-3.5 py-2 text-sm font-semibold text-ink hover:bg-surface-sunken">
              {a.label}
            </Link>
          ))}
        </div>
      )}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {panel.bloques.map((b) => (
          <Card key={b.titulo}>
            <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
              <h3 className="text-[15px] font-bold text-ink">{b.titulo}</h3>
              {b.verTodo && (
                <Link href={b.verTodo.href} className="text-sm font-semibold text-[var(--color-brand-800)] underline underline-offset-2">
                  {b.verTodo.label} →
                </Link>
              )}
            </div>
            {b.items.length ? (
              <ul className="divide-y divide-border">
                {b.items.map((it, i) => {
                  const contenido = (
                    <span className="flex items-start justify-between gap-3 py-2 text-[15px]">
                      <span className="flex items-start gap-2">
                        {it.tono && <span className={`mt-2 inline-block h-2 w-2 shrink-0 rounded-full ${PUNTO[it.tono]}`} aria-hidden />}
                        <span className="first-letter:uppercase">{it.texto}</span>
                      </span>
                      {it.detalle && <span className="text-right text-sm text-ink-muted">{it.detalle}</span>}
                    </span>
                  );
                  return (
                    <li key={i}>
                      {it.href ? (
                        <Link href={it.href} className="block hover:bg-surface-sunken rounded-lg">
                          {contenido}
                        </Link>
                      ) : (
                        contenido
                      )}
                    </li>
                  );
                })}
              </ul>
            ) : (
              <p className="text-[15px] text-ink-muted">{b.vacio}</p>
            )}
          </Card>
        ))}
      </div>
      {extra}
    </div>
  );
}
