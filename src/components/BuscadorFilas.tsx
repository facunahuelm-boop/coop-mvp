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
 * Las filas se pasan como `children` normales, y el encabezado de la tabla
 * como `encabezado` (ambos: elementos ya armados por el Server Component que
 * llama a este componente, cada fila con su propia `key` — incluidas sus
 * <form action={serverAction}> intactas). Este es el patrón oficial de
 * Next.js para pasar contenido renderizado en el servidor a un Client
 * Component: JSX ya armado (`children` u otra prop) sí puede cruzar ese
 * límite, pero una FUNCIÓN no — por eso acá no hay ningún render-prop (ni
 * `children` como función, ni un `envolver`/`render` aparte): eso es
 * justamente lo que rompía esta pantalla antes de este arreglo ("Functions
 * cannot be passed directly to Client Components..."). `claves` es un array
 * paralelo de texto plano (mismo orden, mismo largo que `children`) que este
 * componente usa para decidir qué filas mostrar — nunca necesita conocer la
 * forma de cada fila, solo el texto por el que se puede buscar.
 */

function normalizar(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "");
}

export function BuscadorFilas({
  claves,
  children,
  encabezado,
  placeholder = "Buscar...",
  sinResultadosTexto = "No se encontraron resultados para esa búsqueda.",
}: {
  claves: string[];
  children: ReactNode[];
  encabezado: ReactNode;
  placeholder?: string;
  sinResultadosTexto?: string;
}) {
  const [busqueda, setBusqueda] = useState("");

  const filasFiltradas = useMemo(() => {
    const q = normalizar(busqueda.trim());
    if (!q) return children;
    return claves
      .map((clave, i) => (normalizar(clave).includes(q) ? children[i] : null))
      .filter((f): f is ReactNode => f !== null);
  }, [claves, children, busqueda]);

  return (
    <div>
      <input
        type="text"
        value={busqueda}
        onChange={(e) => setBusqueda(e.target.value)}
        placeholder={placeholder}
        className="w-full rounded-xl border border-ink/10 px-4 py-3 text-base mb-3"
      />
      {filasFiltradas.length === 0 ? (
        <p className="text-sm text-ink-muted text-center py-6">{sinResultadosTexto}</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>{encabezado}</thead>
            <tbody>{filasFiltradas}</tbody>
          </table>
        </div>
      )}
    </div>
  );
}
