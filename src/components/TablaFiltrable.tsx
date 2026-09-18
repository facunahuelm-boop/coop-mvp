"use client";

import { useMemo, useState, type ReactNode } from "react";
import { Search } from "lucide-react";

/**
 * Rediseño de Contactos/Proveedores/Núcleos (18/09, pedido explícito con
 * referencia visual de un ERP): patrón único de "listado con muchos
 * registros" — barra compacta de búsqueda + filtros arriba (blanca, bordes
 * suaves, sombra sutil, filtros secundarios plegados en "Más filtros") y
 * paginación abajo. Pensado como EL patrón para cualquier módulo futuro con
 * el mismo problema, no solo para estos tres.
 *
 * Mismo criterio que BuscadorFilas (Fase 8) y por la misma razón: las filas
 * llegan ya renderizadas por el Server Component (`children`, un <tr> por
 * registro) — nunca una función cruza el límite servidor→cliente. Lo nuevo
 * acá es que además de `claves` (texto libre) se puede pasar `filtros`:
 * selects de fondo, cada uno con un array paralelo de VALORES (texto plano,
 * no funciones) para decidir qué fila coincide con qué opción. La paginación
 * es 100% client-side sobre el array ya filtrado — mismo criterio que
 * BuscadorFilas: estos padrones son de decenas/cientos de filas, no miles,
 * así que no amerita ida y vuelta al servidor solo para pasar de página.
 */

export type FiltroDef = {
  id: string;
  label: string;
  opciones: { value: string; label: string }[];
  /** Valor de este filtro para cada fila, mismo orden/largo que `children`. */
  valores: (string | null | undefined)[];
  /** true = va plegado dentro de "Más filtros" en vez de la barra principal. */
  secundario?: boolean;
};

function normalizar(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "");
}

/** Evita que un click en un control interactivo DENTRO de la fila (un
 * select de estado, un link, un botón) también dispare la apertura del
 * modal de detalle de esa fila — ver FilaConDetalle.tsx, que usa el mismo
 * criterio para su propio onClick de fila. */
export function esClickEnControl(e: { target: EventTarget | null }): boolean {
  const el = e.target as HTMLElement | null;
  return !!el?.closest?.("select, button, a, input, textarea, [data-no-row-click]");
}

export function TablaFiltrable({
  placeholder = "Buscar...",
  claves,
  filtros = [],
  encabezado,
  children,
  porPagina = 20,
  sinResultadosTexto = "No se encontraron resultados para esa búsqueda.",
}: {
  placeholder?: string;
  claves: string[];
  filtros?: FiltroDef[];
  encabezado: ReactNode;
  children: ReactNode[];
  porPagina?: number;
  sinResultadosTexto?: string;
}) {
  const [busqueda, setBusqueda] = useState("");
  const [valoresFiltro, setValoresFiltro] = useState<Record<string, string>>({});
  const [pagina, setPagina] = useState(1);

  const principales = filtros.filter((f) => !f.secundario);
  const secundarios = filtros.filter((f) => f.secundario);
  const hayFiltrosActivos = busqueda.trim() !== "" || Object.values(valoresFiltro).some((v) => v);

  const indicesVisibles = useMemo(() => {
    const q = normalizar(busqueda.trim());
    const indices: number[] = [];
    for (let i = 0; i < children.length; i++) {
      if (q && !normalizar(claves[i] || "").includes(q)) continue;
      let coincide = true;
      for (const f of filtros) {
        const v = valoresFiltro[f.id];
        if (v && (f.valores[i] || "") !== v) {
          coincide = false;
          break;
        }
      }
      if (coincide) indices.push(i);
    }
    return indices;
  }, [children.length, claves, filtros, busqueda, valoresFiltro]);

  const totalPaginas = Math.max(1, Math.ceil(indicesVisibles.length / porPagina));
  const paginaSegura = Math.min(pagina, totalPaginas);
  const inicio = (paginaSegura - 1) * porPagina;
  const visibles = indicesVisibles.slice(inicio, inicio + porPagina).map((i) => children[i]);

  function actualizarFiltro(id: string, value: string) {
    setValoresFiltro((v) => ({ ...v, [id]: value }));
    setPagina(1);
  }

  function limpiar() {
    setBusqueda("");
    setValoresFiltro({});
    setPagina(1);
  }

  const selectClass =
    "rounded-lg border border-border bg-surface px-2.5 py-2 text-sm text-ink-muted focus:outline-none focus:ring-2 focus:ring-[var(--color-focus-ring)]/30 focus:border-[var(--color-focus-ring)]";

  return (
    <div>
      {/* Barra compacta de búsqueda + filtros */}
      <div className="flex flex-wrap items-center gap-2 rounded-xl border border-border bg-surface shadow-[var(--shadow-sm)] px-3 py-2.5 mb-4">
        <div className="relative flex-1 min-w-[180px]">
          <Search size={15} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-ink-faint pointer-events-none" aria-hidden />
          <input
            type="text"
            value={busqueda}
            onChange={(e) => {
              setBusqueda(e.target.value);
              setPagina(1);
            }}
            placeholder={placeholder}
            className="w-full rounded-lg border border-border bg-surface pl-8 pr-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--color-focus-ring)]/30 focus:border-[var(--color-focus-ring)]"
          />
        </div>
        {principales.map((f) => (
          <select
            key={f.id}
            value={valoresFiltro[f.id] || ""}
            onChange={(e) => actualizarFiltro(f.id, e.target.value)}
            className={selectClass}
          >
            <option value="">{f.label}: todos</option>
            {f.opciones.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        ))}
        {secundarios.length > 0 && (
          <details className="relative">
            <summary className="list-none cursor-pointer select-none rounded-lg border border-border px-3 py-2 text-sm text-ink-muted hover:bg-surface-sunken [&::-webkit-details-marker]:hidden">
              Más filtros
            </summary>
            <div className="absolute right-0 z-10 mt-1 w-60 rounded-xl border border-border bg-surface shadow-[var(--shadow-md)] p-3 space-y-2.5">
              {secundarios.map((f) => (
                <div key={f.id}>
                  <label className="block text-xs text-ink-muted mb-1">{f.label}</label>
                  <select
                    value={valoresFiltro[f.id] || ""}
                    onChange={(e) => actualizarFiltro(f.id, e.target.value)}
                    className="w-full rounded-lg border border-border bg-surface px-2 py-1.5 text-sm"
                  >
                    <option value="">Todos</option>
                    {f.opciones.map((o) => (
                      <option key={o.value} value={o.value}>
                        {o.label}
                      </option>
                    ))}
                  </select>
                </div>
              ))}
            </div>
          </details>
        )}
        {hayFiltrosActivos && (
          <button
            type="button"
            onClick={limpiar}
            className="text-xs font-medium text-ink-faint hover:text-ink-muted whitespace-nowrap px-2 py-2"
          >
            × Limpiar
          </button>
        )}
      </div>

      {indicesVisibles.length === 0 ? (
        <p className="text-sm text-ink-muted text-center py-8">{sinResultadosTexto}</p>
      ) : (
        <>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>{encabezado}</thead>
              <tbody>{visibles}</tbody>
            </table>
          </div>
          <div className="flex items-center justify-between gap-3 mt-3 pt-3 border-t border-border flex-wrap">
            <span className="text-xs text-ink-faint whitespace-nowrap">
              Mostrando {inicio + 1}–{Math.min(inicio + porPagina, indicesVisibles.length)} de {indicesVisibles.length}{" "}
              registro{indicesVisibles.length !== 1 ? "s" : ""}
            </span>
            {totalPaginas > 1 && (
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  disabled={paginaSegura <= 1}
                  onClick={() => setPagina((p) => p - 1)}
                  className="text-xs font-semibold rounded-lg px-2.5 py-1.5 text-ink-muted hover:bg-surface-sunken disabled:opacity-30 disabled:pointer-events-none"
                >
                  ← Anterior
                </button>
                <span className="text-xs text-ink-muted px-1">
                  {paginaSegura} / {totalPaginas}
                </span>
                <button
                  type="button"
                  disabled={paginaSegura >= totalPaginas}
                  onClick={() => setPagina((p) => p + 1)}
                  className="text-xs font-semibold rounded-lg px-2.5 py-1.5 text-ink-muted hover:bg-surface-sunken disabled:opacity-30 disabled:pointer-events-none"
                >
                  Siguiente →
                </button>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
