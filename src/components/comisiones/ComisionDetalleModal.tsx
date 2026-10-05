"use client";

// Mejora integral, Fase 4 (27/09, pedido explícito): "dashboard ampliado por
// comisión (integrantes/estado/próxima reunión/responsable) + pop-up de
// detalle con integrantes/actividad/documentos, respetando permisos
// existentes". A diferencia de Asambleas/Consejo Directivo (Fases 2 y 3),
// acá NO se reemplaza nada: la tarjeta de cada comisión en
// app/(app)/comisiones/page.tsx ya es un dashboard funcional con gestión
// inline de integrantes y tareas (con su propio TareaDetalleModal, mismo
// patrón que este componente) — convertir eso a un patrón "resumen -> click
// -> pop-up" rompería la edición inline que ya funciona, en contra de "ADD,
// DON'T BREAK". Este modal es sólo una vista de sólo lectura ADICIONAL con
// lo que la tarjeta no mostraba: historial de reuniones de la comisión y
// documentos vinculados (`documentos.comision_id`, migración 0029) — ningún
// dato nuevo, ninguna acción nueva, mismo "REGLA DE ORO" de reusar Modal ya
// existente que ya sigue TareaDetalleModal.

import { useState } from "react";
import Link from "next/link";
import { Modal } from "@/components/ui-client";
import { Badge } from "@/components/ui";
import dayjs from "dayjs";

const ESTADO_REUNION_COLOR: Record<string, "verde" | "amarillo" | "rojo" | "brand" | "gray"> = {
  planificada: "brand",
  realizada: "verde",
  cancelada: "gray",
};
const ESTADO_REUNION_LABEL: Record<string, string> = { planificada: "Planificada", realizada: "Realizada", cancelada: "Cancelada" };
const ROL_MIEMBRO_LABEL: Record<string, string> = { coordinador: "Coordinador/a", integrante: "Integrante", suplente: "Suplente" };

type Integrante = { id: number; user_id: number; user_nombre: string; rol_en_comision: string };
type ReunionResumen = { id: number; titulo: string; fecha: string; estado: string };
type DocumentoResumen = { id: number; nombre: string; archivo_url: string | null };
type TareaResumen = { id: number; titulo: string; estado: string; resultado: string | null; origen: string | null };
type DecisionResumen = { id: number; tema: string; resultado: string };
type ReunionRelacionada = { id: number; titulo: string; tipo: string; fecha: string; punto: string };
const TIPO_REUNION_LABEL: Record<string, string> = { asamblea: "Asamblea", consejo_directivo: "Consejo Directivo", comision: "Comisión" };
const ESTADO_TAREA_LABEL: Record<string, string> = { pendiente: "Pendiente", en_curso: "En curso", completada: "Completada" };
const ESTADO_TAREA_COLOR: Record<string, "amarillo" | "azul" | "verde"> = { pendiente: "amarillo", en_curso: "azul", completada: "verde" };
const DECISION_COLOR: Record<string, "amarillo" | "verde" | "rojo"> = { pendiente: "amarillo", aprobada: "verde", rechazada: "rojo" };

export function ComisionDetalleModal({
  nombre,
  integrantes,
  reuniones,
  documentos,
  decisionesCount,
  tareas = [],
  decisiones = [],
  reunionesRelacionadas = [],
}: {
  nombre: string;
  integrantes: Integrante[];
  reuniones: ReunionResumen[];
  documentos: DocumentoResumen[];
  decisionesCount: number;
  /** Gestión cooperativa integrada (04/10): vista completa de la comisión. */
  tareas?: TareaResumen[];
  decisiones?: DecisionResumen[];
  reunionesRelacionadas?: ReunionRelacionada[];
}) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="text-xs text-[var(--color-brand-800)] hover:underline underline-offset-2 whitespace-nowrap"
      >
        Ver detalle completo →
      </button>

      <Modal open={open} onClose={() => setOpen(false)} title={nombre} size="lg">
        <div className="space-y-4 text-left">
          <div>
            <p className="text-xs font-semibold text-ink/60 mb-2">Integrantes</p>
            <div className="space-y-1">
              {integrantes.map((m) => (
                <p key={m.id} className="text-sm flex items-center justify-between gap-2">
                  <Link href={`/usuarios/${m.user_id}`} className="hover:underline underline-offset-2">
                    {m.user_nombre}
                  </Link>
                  <span className="text-xs text-ink/50">{ROL_MIEMBRO_LABEL[m.rol_en_comision] ?? m.rol_en_comision}</span>
                </p>
              ))}
              {integrantes.length === 0 && <p className="text-xs text-ink/40 italic">Sin integrantes todavía.</p>}
            </div>
          </div>

          <div className="pt-3 border-t border-ink/10">
            <p className="text-xs font-semibold text-ink/60 mb-2">Actividad</p>
            <p className="text-sm mb-2">
              Decisiones registradas:{" "}
              {decisionesCount > 0 ? (
                <Link href="/decisiones" className="underline underline-offset-2">
                  {decisionesCount} decisión(es) →
                </Link>
              ) : (
                "Ninguna"
              )}
            </p>
            <p className="text-xs font-semibold text-ink/50 mb-1">Reuniones</p>
            <div className="space-y-1.5">
              {reuniones.map((r) => (
                <div key={r.id} className="flex items-center justify-between gap-2 text-sm">
                  <Link href={`/reuniones/${r.id}`} className="truncate hover:underline underline-offset-2">
                    {r.titulo}
                  </Link>
                  <span className="flex items-center gap-2 shrink-0 text-xs text-ink/50">
                    {dayjs(r.fecha).format("DD/MM/YYYY")}
                    <Badge color={ESTADO_REUNION_COLOR[r.estado] ?? "gray"}>{ESTADO_REUNION_LABEL[r.estado] ?? r.estado}</Badge>
                  </span>
                </div>
              ))}
              {reuniones.length === 0 && <p className="text-xs text-ink/40 italic">Sin reuniones registradas.</p>}
            </div>
          </div>

          <div className="pt-3 border-t border-ink/10">
            <p className="text-xs font-semibold text-ink/60 mb-2">Tareas</p>
            <div className="space-y-1.5">
              {tareas.map((t) => (
                <div key={t.id} className="text-sm">
                  <div className="flex items-center justify-between gap-2">
                    <span className={`truncate ${t.estado === "completada" ? "text-ink/50" : ""}`}>{t.titulo}</span>
                    <Badge color={ESTADO_TAREA_COLOR[t.estado] ?? "gray"}>{ESTADO_TAREA_LABEL[t.estado] ?? t.estado}</Badge>
                  </div>
                  {t.origen && <p className="text-xs text-[var(--accent-blue)]">Sale de: {t.origen}</p>}
                  {t.resultado && <p className="text-xs text-ink/60">Resultado: {t.resultado}</p>}
                </div>
              ))}
              {tareas.length === 0 && <p className="text-xs text-ink/40 italic">Sin tareas.</p>}
            </div>
          </div>

          <div className="pt-3 border-t border-ink/10">
            <p className="text-xs font-semibold text-ink/60 mb-2">Decisiones</p>
            <div className="space-y-1">
              {decisiones.map((d) => (
                <p key={d.id} className="text-sm flex items-center justify-between gap-2">
                  <Link href={`/decisiones/${d.id}`} className="truncate hover:underline underline-offset-2">{d.tema}</Link>
                  <Badge color={DECISION_COLOR[d.resultado] ?? "gray"}>{d.resultado}</Badge>
                </p>
              ))}
              {decisiones.length === 0 && <p className="text-xs text-ink/40 italic">Sin decisiones registradas.</p>}
            </div>
          </div>

          <div className="pt-3 border-t border-ink/10">
            <p className="text-xs font-semibold text-ink/60 mb-2">Asambleas y Consejo relacionados</p>
            <div className="space-y-1">
              {reunionesRelacionadas.map((r) => (
                <div key={r.id} className="text-sm">
                  <Link href={`/reuniones/${r.id}`} className="hover:underline underline-offset-2">
                    {TIPO_REUNION_LABEL[r.tipo] ?? r.tipo}: {r.titulo}
                  </Link>{" "}
                  <span className="text-xs text-ink/50">{dayjs(r.fecha).format("DD/MM/YYYY")} · «{r.punto}»</span>
                </div>
              ))}
              {reunionesRelacionadas.length === 0 && <p className="text-xs text-ink/40 italic">Ninguna resolución de Asamblea o Consejo derivada a esta comisión todavía.</p>}
            </div>
          </div>

          <div className="pt-3 border-t border-ink/10">
            <p className="text-xs font-semibold text-ink/60 mb-2">Documentos</p>
            <div className="space-y-1">
              {documentos.map((d) => (
                <p key={d.id} className="text-sm flex items-center justify-between gap-2">
                  <span className="truncate">{d.nombre}</span>
                  {d.archivo_url ? (
                    <a href={`/api/archivos/documento/${d.id}`} target="_blank" className="text-xs underline underline-offset-2 shrink-0">
                      Descargar
                    </a>
                  ) : (
                    <span className="text-xs text-ink/40 shrink-0">Sin archivo</span>
                  )}
                </p>
              ))}
              {documentos.length === 0 && <p className="text-xs text-ink/40 italic">Sin documentos vinculados.</p>}
            </div>
          </div>
        </div>
      </Modal>
    </>
  );
}
