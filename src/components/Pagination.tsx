import Link from "next/link";

/**
 * Fase 8 del Prompt Maestro ("paginación/búsqueda/filtros"), hallazgo H-10:
 * varios listados usaban un LIMIT fijo (15/50/200) que dejaba los registros
 * más viejos permanentemente invisibles, sin ninguna forma de llegar a
 * ellos. Este componente es el patrón único y reutilizable para resolverlo
 * en cualquier pantalla: son enlaces puros (<Link>), sin JavaScript ni
 * estado de cliente — funciona igual con JS deshabilitado y, sobre todo, es
 * lo más simple posible para alguien sin conocimientos técnicos: "Anterior
 * / Página X de Y / Siguiente", sin una lista de números para interpretar.
 *
 * Cada página arma la URL de "página siguiente/anterior" preservando el
 * resto de sus propios filtros (querystring) — por eso `searchParams` se
 * recibe tal cual la página lo tenga y esta función solo pisa el parámetro
 * "page".
 */

function construirHref(basePath: string, searchParams: Record<string, string | undefined>, page: number): string {
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(searchParams)) {
    if (k === "page") continue;
    if (v !== undefined && v !== "") params.set(k, v);
  }
  if (page > 1) params.set("page", String(page));
  const qs = params.toString();
  return qs ? `${basePath}?${qs}` : basePath;
}

export function Pagination({
  page,
  totalPages,
  basePath,
  searchParams = {},
}: {
  page: number;
  totalPages: number;
  basePath: string;
  searchParams?: Record<string, string | undefined>;
}) {
  if (totalPages <= 1) return null;

  const anteriorHref = page > 1 ? construirHref(basePath, searchParams, page - 1) : null;
  const siguienteHref = page < totalPages ? construirHref(basePath, searchParams, page + 1) : null;

  const linkClass =
    "inline-flex items-center justify-center rounded-xl px-4 py-2.5 text-sm font-semibold transition-colors bg-brand-100 text-brand-800 hover:bg-brand-100/70";
  const disabledClass =
    "inline-flex items-center justify-center rounded-xl px-4 py-2.5 text-sm font-semibold opacity-40 pointer-events-none bg-ink/5 text-ink-muted";

  return (
    <nav className="flex items-center justify-between gap-3 mt-4" aria-label="Paginación">
      {anteriorHref ? (
        <Link href={anteriorHref} className={linkClass}>← Anterior</Link>
      ) : (
        <span className={disabledClass}>← Anterior</span>
      )}
      <span className="text-sm text-ink-muted whitespace-nowrap">
        Página {page} de {totalPages}
      </span>
      {siguienteHref ? (
        <Link href={siguienteHref} className={linkClass}>Siguiente →</Link>
      ) : (
        <span className={disabledClass}>Siguiente →</span>
      )}
    </nav>
  );
}

/** Lee y normaliza el número de página de un searchParams ya resuelto (después
 * del `await` — ver la nota sobre Promise<searchParams> en documentos/page.tsx).
 * Nunca menor a 1; valores no numéricos caen a 1 en vez de romper la consulta. */
export function paginaDe(searchParams: { page?: string }): number {
  const n = Number(searchParams.page);
  return Number.isFinite(n) && n >= 1 ? Math.floor(n) : 1;
}
