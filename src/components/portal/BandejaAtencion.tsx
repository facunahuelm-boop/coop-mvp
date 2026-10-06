import Link from "next/link";
import { CheckCircle2 } from "lucide-react";
import type { ItemAtencion } from "@/lib/atencion";

const BORDE: Record<ItemAtencion["tono"], string> = {
  rojo: "border-l-[var(--color-rojo)]",
  amarillo: "border-l-[var(--color-amarillo)]",
  azul: "border-l-[var(--color-brand-800)]",
};

/** Fase 1D — "Lo que necesita tu atención" (arriba de todo en el Inicio). */
export function BandejaAtencion({ items }: { items: ItemAtencion[] }) {
  return (
    <section className="mb-6" aria-labelledby="atencion-titulo">
      <h2 id="atencion-titulo" className="text-lg font-bold text-ink mb-2">Lo que necesita tu atención</h2>
      {items.length === 0 ? (
        <p className="flex items-center gap-2 rounded-2xl border border-border bg-surface px-4 py-3 text-[16px] text-ink">
          <CheckCircle2 size={20} className="text-[var(--color-verde)]" aria-hidden /> Está todo al día. No hay nada pendiente para vos.
        </p>
      ) : (
        <ul className="space-y-2">
          {items.map((i, n) => (
            <li key={n} className={`flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-border border-l-4 ${BORDE[i.tono]} bg-surface px-4 py-3`}>
              <div className="min-w-0">
                <p className="text-[16px] font-semibold text-ink">{i.texto}</p>
                {i.detalle && <p className="text-[15px] text-ink-muted">{i.detalle}</p>}
              </div>
              <Link
                href={i.href}
                className="inline-flex items-center justify-center rounded-xl bg-[var(--color-brand-800)] px-4 py-2.5 text-[15px] font-semibold text-white hover:bg-[var(--color-brand-700)] min-h-[44px]"
              >
                {i.boton}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
