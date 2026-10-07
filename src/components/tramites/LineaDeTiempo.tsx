import { ESTADO_HITO_LABEL } from "@/lib/tramitesTexto";

/** Fase 2E — «¿En qué estamos?»: línea de tiempo simple para el socio. */
export function LineaDeTiempo({
  hitos,
  hoy,
  compacta = false,
}: {
  hitos: { id: number; titulo: string; estado: string; fecha_estimada: string | null; fecha_real: string | null; nota_para_socios: string | null }[];
  hoy: string;
  compacta?: boolean;
}) {
  const actual = hitos.find((h) => h.estado !== "hecho" && h.estado !== "no_aplica");
  const f = (iso: string | null) => (iso ? iso.slice(0, 10).split("-").reverse().join("/") : "");
  const visibles = hitos.filter((h) => h.estado !== "no_aplica");
  return (
    <ol className="relative ml-3 border-l-2 border-border">
      {visibles.map((h) => {
        const hecho = h.estado === "hecho";
        const esActual = actual?.id === h.id;
        if (compacta && !esActual && !hecho && visibles.indexOf(h) > visibles.indexOf(actual ?? h) + 1) return null;
        return (
          <li key={h.id} className="mb-4 ml-5">
            <span
              aria-hidden
              className={`absolute -left-[11px] flex h-5 w-5 items-center justify-center rounded-full text-[11px] font-bold ${
                hecho ? "bg-[var(--color-verde)] text-white" : esActual ? "bg-[var(--color-brand-800)] text-white" : "bg-surface border-2 border-border"
              }`}
            >
              {hecho ? "✓" : esActual ? "●" : ""}
            </span>
            <p className={`text-[15px] ${esActual ? "font-bold text-ink" : hecho ? "text-ink" : "text-ink-muted"}`}>
              {h.titulo}
              {esActual && <span className="ml-2 rounded-full bg-[var(--color-brand-100)] px-2 py-0.5 text-xs font-semibold text-[var(--color-brand-800)]">Estamos acá</span>}
            </p>
            <p className="text-sm text-ink-muted">
              {hecho
                ? `Hecho${h.fecha_real ? ` el ${f(h.fecha_real)}` : ""}`
                : h.estado === "trabado"
                  ? "Trabado por ahora"
                  : h.fecha_estimada
                    ? `${h.fecha_estimada < hoy ? "Estaba previsto para" : "Previsto para"} ${f(h.fecha_estimada)}`
                    : ESTADO_HITO_LABEL[h.estado]}
            </p>
            {h.nota_para_socios && (esActual || !compacta) && <p className="mt-0.5 text-[15px] text-ink">{h.nota_para_socios}</p>}
          </li>
        );
      })}
    </ol>
  );
}
