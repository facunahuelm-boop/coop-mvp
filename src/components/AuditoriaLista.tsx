"use client";

import { useState } from "react";
import Link from "next/link";
import dayjs from "dayjs";
import { Modal } from "@/components/ui-client";
import { Badge, EmptyState } from "@/components/ui";
import type { RegistroAuditoriaLegible } from "@/lib/auditoriaTexto";

/**
 * Auditoría legible (04/10): lista de eventos en lenguaje llano ("María
 * modificó los datos del núcleo «Pérez»") — click en uno abre el detalle
 * (quién, qué, cuándo, módulo, registro y la tabla antes → después) en un
 * pop-up, sin salir de la pantalla. Sólo lectura: no hay ninguna acción
 * que modifique o borre un evento (la base además lo impide).
 */
export function AuditoriaLista({
  registros,
  vacioTexto = "Sin movimientos registrados todavía.",
  mostrarModulo = false,
}: {
  registros: RegistroAuditoriaLegible[];
  vacioTexto?: string;
  mostrarModulo?: boolean;
}) {
  const [abierto, setAbierto] = useState<RegistroAuditoriaLegible | null>(null);

  if (registros.length === 0) return <EmptyState>{vacioTexto}</EmptyState>;

  return (
    <>
      <ul className="divide-y divide-ink/5">
        {registros.map((r) => (
          <li key={r.id}>
            <button
              type="button"
              onClick={() => setAbierto(r)}
              className="w-full text-left py-2.5 px-1 -mx-1 rounded-lg hover:bg-page-bg transition-colors"
            >
              <p className="text-sm text-ink">{r.texto}</p>
              <p className="text-xs text-ink/40 mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1">
                <span>{dayjs(r.fecha).format("DD/MM/YYYY HH:mm")}</span>
                {mostrarModulo && <span>· {r.modulo}</span>}
                {r.cambios.some((c) => c.cambio) && r.tieneAnterior && r.tieneNuevo && <span>· ver cambios</span>}
              </p>
            </button>
          </li>
        ))}
      </ul>

      <Modal open={!!abierto} onClose={() => setAbierto(null)} title="Detalle del evento" size="lg">
        {abierto && (
          <div className="space-y-4 text-sm">
            <p className="text-ink font-medium">{abierto.texto}</p>
            <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-2">
              <div>
                <dt className="text-xs text-ink-faint">Quién</dt>
                <dd>
                  {abierto.usuarioId ? (
                    <Link href={`/usuarios/${abierto.usuarioId}`} className="underline underline-offset-2">{abierto.usuarioNombre}</Link>
                  ) : (
                    abierto.usuarioNombre
                  )}
                </dd>
              </div>
              <div>
                <dt className="text-xs text-ink-faint">Cuándo</dt>
                <dd>{dayjs(abierto.fecha).format("DD/MM/YYYY HH:mm:ss")}</dd>
              </div>
              <div>
                <dt className="text-xs text-ink-faint">Qué</dt>
                <dd><Badge color="gray">{abierto.accionLabel}</Badge></dd>
              </div>
              <div>
                <dt className="text-xs text-ink-faint">Módulo</dt>
                <dd>{abierto.modulo}</dd>
              </div>
              <div className="sm:col-span-2">
                <dt className="text-xs text-ink-faint">Registro</dt>
                <dd>
                  {abierto.href ? (
                    <Link href={abierto.href} className="underline underline-offset-2">
                      {abierto.entidadLabel}{abierto.entidadId ? ` #${abierto.entidadId}` : ""} →
                    </Link>
                  ) : (
                    <>{abierto.entidadLabel}{abierto.entidadId ? ` #${abierto.entidadId}` : ""}</>
                  )}
                </dd>
              </div>
            </dl>

            {abierto.cambios.length > 0 && (
              <div>
                <p className="text-xs font-semibold text-ink-muted uppercase tracking-wide mb-1.5">
                  {abierto.tieneAnterior && abierto.tieneNuevo ? "Antes → después" : abierto.tieneAnterior ? "Datos anteriores" : "Datos registrados"}
                </p>
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="text-left text-ink/50 border-b border-ink/10">
                        <th className="py-1.5 pr-3 font-medium">Campo</th>
                        {abierto.tieneAnterior && <th className="py-1.5 pr-3 font-medium">Antes</th>}
                        {abierto.tieneNuevo && <th className="py-1.5 font-medium">{abierto.tieneAnterior ? "Después" : "Valor"}</th>}
                      </tr>
                    </thead>
                    <tbody>
                      {abierto.cambios.map((c, i) => (
                        <tr key={i} className={`border-b border-ink/5 last:border-0 align-top ${c.cambio && abierto.tieneAnterior && abierto.tieneNuevo ? "bg-[var(--color-amarillo-bg)]/50" : ""}`}>
                          <td className="py-1.5 pr-3 text-ink/60 whitespace-nowrap">{c.campo}</td>
                          {abierto.tieneAnterior && <td className="py-1.5 pr-3 break-words">{c.antes}</td>}
                          {abierto.tieneNuevo && <td className="py-1.5 break-words">{c.despues}</td>}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
            <p className="text-[11px] text-ink-faint">Los eventos de auditoría no se pueden modificar ni borrar.</p>
          </div>
        )}
      </Modal>
    </>
  );
}
