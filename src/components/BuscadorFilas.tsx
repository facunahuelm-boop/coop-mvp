"use client";

import { useMemo, useState, type ReactNode } from "react";

/**
 * Fase 8 del Prompt Maestro ("paginación/búsqueda/filtros"): buscador 100%
 * del lado del cliente sobre filas ya renderizadas por el servidor (mismo
 * criterio ya usado en ContactosLista.tsx, Fase 5 — ver el comentario de ese
 * archivo, que ya preveía este momento). Se usa acá y no paginación real
 * porque el padrón de una cooperativa está acotado por su cantidad real de
 * viviendas (decenas, no miles de filas) — no amerita un ida-y-vuelta al
 * servidor por cada letra tecleada.
 *
 * Como Server Components pueden pasar JSX ya renderizado (incluidas <form
 * action={serverAction}>) como prop a un Client Component, cada fila se arma
 * en el servidor (con sus propios Server Actions intactos) y acá solo se
 * decide cuáles mostrar según lo que la persona escribió — este componente
 * nunca ve ni necesita conocer la forma de esas filas.
 */

function normalizar(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "");
}

export function BuscadorFilas({
  filas,
  placeholder = "Buscar...",
  sinResultadosTexto = "No se encontraron resultados para esa búsqueda.",
  children,
}: {
  filas: { clave: string; nodo: ReactNode }[];
  placeholder?: string;
  sinResultadosTexto?: string;
  children: (filasFiltradas: ReactNode[], cantidad: number) => ReactNode;
}) {
  const [busqueda, setBusqueda] = useState("");

  const filtradas = useMemo(() => {
    const q = normalizar(busqueda.trim());
    if (!q) return filas;
    return filas.filter((f) => normalizar(f.clave).includes(q));
  }, [filas, busqueda]);

  return (
    <div>
      <input
        type="text"
        value={busqueda}
        onChange={(e) => setBusqueda(e.target.value)}
        placeholder={placeholder}
        className="w-full rounded-xl border border-ink/10 px-4 py-3 text-base mb-3"
      />
      {filtradas.length === 0 ? (
        <p className="text-sm text-ink-muted text-center py-6">{sinResultadosTexto}</p>
      ) : (
        children(
          filtradas.map((f) => f.nodo),
          filtradas.length
        )
      )}
    </div>
  );
}
