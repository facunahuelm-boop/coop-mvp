"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { Card, Badge, EmptyState } from "./ui";
import type { Contacto, TipoContacto } from "@/lib/contactos";

/**
 * Fase 5 del Plan Maestro (Contactos). Filtro 100% del lado del cliente, a
 * propósito: la cantidad de contactos por cooperativa es chica (padrón +
 * proveedores de una sola cooperativa, no miles de filas), así que no vale
 * la pena un ida-y-vuelta al servidor para escribir en el buscador. Cuando
 * la Fase 8 (paginación/búsqueda/filtros) llegue a este tipo de listados
 * grandes, esta pantalla puede pasar a búsqueda server-side sin cambiar la
 * pinta ni la ubicación del resto del sistema.
 */

const BADGE_POR_TIPO: Record<TipoContacto, "brand" | "verde" | "gray"> = {
  socio: "brand",
  integrante: "gray",
  proveedor: "verde",
};

const LABEL_POR_TIPO: Record<TipoContacto, string> = {
  socio: "Socio/a",
  integrante: "Integrante",
  proveedor: "Proveedor",
};

const FILTROS: { id: TipoContacto | "todos"; label: string }[] = [
  { id: "todos", label: "Todos" },
  { id: "socio", label: "Socios/as" },
  { id: "integrante", label: "Integrantes" },
  { id: "proveedor", label: "Proveedores" },
];

function normalizar(s: string) {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "");
}

export function ContactosLista({ contactos }: { contactos: Contacto[] }) {
  const [busqueda, setBusqueda] = useState("");
  const [filtro, setFiltro] = useState<TipoContacto | "todos">("todos");

  const conteos = useMemo(() => {
    const base: Record<TipoContacto | "todos", number> = { todos: contactos.length, socio: 0, integrante: 0, proveedor: 0 };
    for (const c of contactos) base[c.tipo]++;
    return base;
  }, [contactos]);

  const resultados = useMemo(() => {
    const q = normalizar(busqueda.trim());
    return contactos.filter((c) => {
      if (filtro !== "todos" && c.tipo !== filtro) return false;
      if (!q) return true;
      const texto = normalizar([c.nombre, c.subtitulo, c.email || "", c.telefono || ""].join(" "));
      return texto.includes(q);
    });
  }, [contactos, busqueda, filtro]);

  return (
    <div>
      <div className="mb-4">
        <input
          type="text"
          value={busqueda}
          onChange={(e) => setBusqueda(e.target.value)}
          placeholder="Buscar por nombre, teléfono o email..."
          className="w-full rounded-xl border border-ink/10 px-4 py-3 text-base"
        />
      </div>

      <div className="flex flex-wrap gap-2 mb-5">
        {FILTROS.map((f) => (
          <button
            key={f.id}
            type="button"
            onClick={() => setFiltro(f.id)}
            className={`rounded-full px-4 py-2 text-sm font-medium border transition-colors ${
              filtro === f.id
                ? "bg-[var(--color-brand-800)] text-white border-transparent"
                : "bg-surface text-ink-muted border-ink/10 hover:bg-ink/5"
            }`}
          >
            {f.label} ({conteos[f.id]})
          </button>
        ))}
      </div>

      {resultados.length === 0 ? (
        <EmptyState>
          {busqueda ? `No se encontraron contactos para "${busqueda}".` : "No hay contactos para mostrar."}
        </EmptyState>
      ) : (
        <div className="space-y-2">
          <p className="text-xs text-ink/50">
            {resultados.length} contacto{resultados.length !== 1 ? "s" : ""}
          </p>
          {resultados.map((c) => (
            <Link key={`${c.tipo}-${c.id}`} href={c.href}>
              <Card className="cursor-pointer hover:bg-ink/2">
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <Badge color={BADGE_POR_TIPO[c.tipo]}>{LABEL_POR_TIPO[c.tipo]}</Badge>
                      <p className="text-sm font-semibold truncate">{c.nombre}</p>
                    </div>
                    <p className="text-xs text-ink/50 mt-1">{c.subtitulo}</p>
                  </div>
                  <div className="text-right text-xs text-ink-muted shrink-0">
                    {c.telefono && <p>{c.telefono}</p>}
                    {c.email && <p className="truncate max-w-[200px]">{c.email}</p>}
                    {!c.telefono && !c.email && <p className="text-ink/30">Sin datos de contacto</p>}
                  </div>
                </div>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
