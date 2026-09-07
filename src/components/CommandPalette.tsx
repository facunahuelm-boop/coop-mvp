"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

type Resultado = {
  tipo: string;
  id: number;
  titulo: string;
  modulo: string;
  estado: string | null;
  href: string;
};

/**
 * Fase 11 del Plan Maestro — atajo Ctrl+K para el buscador global. Se monta
 * una sola vez en (app)/layout.tsx, así que está disponible en cualquier
 * pantalla sin tener que ir primero a /buscar. Ctrl+K (o Cmd+K en Mac) abre
 * un cuadro de búsqueda flotante; escribe, ↑/↓ para moverse entre
 * resultados, Enter para ir, Escape para cerrar.
 */
export function CommandPalette() {
  const [abierto, setAbierto] = useState(false);
  const [q, setQ] = useState("");
  const [resultados, setResultados] = useState<Resultado[]>([]);
  const [cargando, setCargando] = useState(false);
  const [activo, setActivo] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const router = useRouter();

  const cerrar = useCallback(() => {
    setAbierto(false);
    setQ("");
    setResultados([]);
    setActivo(0);
  }, []);

  // Atajo global: Ctrl+K / Cmd+K abre, Escape cierra. Vive en un solo
  // listener a nivel de documento en vez de en cada página.
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setAbierto((prev) => !prev);
      } else if (e.key === "Escape") {
        setAbierto(false);
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  useEffect(() => {
    if (abierto) {
      // Pequeño delay: el input recién se monta este mismo tick.
      const t = setTimeout(() => inputRef.current?.focus(), 10);
      return () => clearTimeout(t);
    }
  }, [abierto]);

  // Búsqueda con debounce contra /api/buscar (ver ese archivo) — comparte
  // fuentes y permisos con /buscar, así que nunca muestra algo que la
  // pantalla de búsqueda completa no mostraría.
  useEffect(() => {
    if (!abierto || q.trim().length < 2) {
      setResultados([]);
      return;
    }
    setCargando(true);
    const t = setTimeout(() => {
      fetch(`/api/buscar?q=${encodeURIComponent(q.trim())}`)
        .then((r) => r.json())
        .then((data) => {
          setResultados(data.resultados || []);
          setActivo(0);
        })
        .finally(() => setCargando(false));
    }, 200);
    return () => clearTimeout(t);
  }, [q, abierto]);

  function irA(r: Resultado) {
    cerrar();
    router.push(r.href);
  }

  function onInputKeyDown(e: React.KeyboardEvent) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActivo((a) => Math.min(a + 1, resultados.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActivo((a) => Math.max(a - 1, 0));
    } else if (e.key === "Enter" && resultados[activo]) {
      e.preventDefault();
      irA(resultados[activo]);
    }
  }

  if (!abierto) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 px-4 pt-[12vh]"
      onClick={cerrar}
    >
      <div
        className="w-full max-w-lg rounded-2xl bg-white shadow-xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2 border-b border-black/10 px-4 py-3">
          <span className="text-black/40">🔍</span>
          <input
            ref={inputRef}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={onInputKeyDown}
            placeholder="Buscar en toda la cooperativa…"
            className="flex-1 text-sm outline-none"
          />
          <kbd className="text-[10px] text-black/30 border border-black/10 rounded px-1.5 py-0.5">Esc</kbd>
        </div>

        {q.trim().length >= 2 && (
          <div className="max-h-80 overflow-y-auto py-1">
            {cargando && <p className="px-4 py-3 text-xs text-black/40">Buscando…</p>}
            {!cargando && resultados.length === 0 && (
              <p className="px-4 py-3 text-xs text-black/40">Sin resultados para &quot;{q}&quot;.</p>
            )}
            {!cargando &&
              resultados.map((r, i) => (
                <button
                  key={`${r.tipo}-${r.id}`}
                  onMouseEnter={() => setActivo(i)}
                  onClick={() => irA(r)}
                  className={`w-full flex items-center justify-between gap-3 px-4 py-2 text-left text-sm ${
                    i === activo ? "bg-[#f2f5f6]" : ""
                  }`}
                >
                  <span className="truncate">{r.titulo}</span>
                  <span className="shrink-0 text-[11px] text-black/40">{r.modulo}</span>
                </button>
              ))}
          </div>
        )}

        {q.trim().length < 2 && (
          <p className="px-4 py-3 text-xs text-black/40">Escribí al menos 2 caracteres para buscar.</p>
        )}
      </div>
    </div>
  );
}
