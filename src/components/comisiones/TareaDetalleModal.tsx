"use client";

// Comisiones como sistema de gestión, Fase 4 (19/09, secciones 12-14 del
// pedido: "checklist/subtareas, dependencias, prioridades, estados,
// etiquetas, colaboradores"). Antes de esta fase cada tarea era una fila
// chica dentro de la tarjeta de su comisión (título + prioridad + select de
// estado) — meterle todo lo nuevo ahí adentro hubiera vuelto la tarjeta de
// Comisiones ilegible (varias comisiones, cada una con varias tareas, cada
// tarea con su propio checklist). Se sigue el mismo criterio que ya usa
// FilaConDetalle en el resto del sistema: la fila queda IGUAL de compacta
// (mismo texto, misma tipografía), y ahora es además un botón que abre un
// modal con el detalle completo — "REGLA DE ORO" del pedido (sección 59):
// reusar Modal/AutoSubmitSelect/ActionForm ya existentes en vez de inventar
// componentes nuevos.

import { useActionState, useEffect, useRef, useState } from "react";
import {
  editarTareaFormAction,
  agregarItemChecklistFormAction,
  alternarItemChecklistFormAction,
  eliminarItemChecklistFormAction,
  agregarColaboradorTareaFormAction,
  quitarColaboradorTareaFormAction,
} from "@/lib/actions/tareas";
import { cambiarEstadoTareaFormAction } from "@/lib/actions/tareas";
import { ESTADO_INICIAL } from "@/lib/actionState";
import { FieldError, FormError, SubmitButton, useToast, Modal, ActionForm } from "@/components/ui-client";
import { Badge, Label, inputClass } from "@/components/ui";
import { AutoSubmitSelect } from "@/components/AutoSubmitSelect";
import { AutoSubmitCheckbox } from "@/components/AutoSubmitCheckbox";
import { UsuarioLink } from "@/components/EntidadLink";
import dayjs from "dayjs";

// Mismos mapas que ya usa app/(app)/comisiones/page.tsx para esta misma
// tarea — se repiten acá (Server Component no puede exportar hacia un
// Client Component sin convertirse él mismo en cliente) en vez de
// compartirlos importando de una página, algo que este proyecto no hace en
// ningún otro lado.
const ESTADO_TAREA_LABEL: Record<string, string> = { pendiente: "Pendiente", en_curso: "En curso", completada: "Completada" };
const PRIORIDAD_LABEL: Record<string, string> = { alta: "🔴 Alta", media: "🟡 Media", baja: "⚪ Baja" };

type Usuario = { id: number; nombre: string };
type TareaResumen = { id: number; titulo: string; estado: string };
type Colaborador = { id: number; user_id: number; nombre: string };

export type TareaDetalle = {
  id: number;
  comision_id: number;
  titulo: string;
  descripcion: string | null;
  prioridad: string;
  estado: string;
  fecha_vencimiento: string | null;
  etiquetas: string | null;
  responsable_id: number | null;
  depende_de_id: number | null;
  checklist: { texto: string; hecho: boolean }[];
};

function etiquetasDe(raw: string | null): string[] {
  return (raw || "").split(",").map((e) => e.trim()).filter(Boolean);
}

export function TareaDetalleModal({
  tarea,
  usuarios,
  otrasTareas,
  colaboradores,
  dependencia,
  puedeGestionar,
  triggerClassName,
}: {
  tarea: TareaDetalle;
  usuarios: Usuario[];
  otrasTareas: TareaResumen[];
  colaboradores: Colaborador[];
  dependencia: { titulo: string; estado: string } | null;
  puedeGestionar: boolean;
  triggerClassName?: string;
}) {
  const [open, setOpen] = useState(false);
  const checklist = tarea.checklist ?? [];
  const hechos = checklist.filter((it) => it.hecho).length;

  const [estadoEditar, editarAction] = useActionState(editarTareaFormAction, ESTADO_INICIAL);
  const [estadoChecklist, agregarItemAction] = useActionState(agregarItemChecklistFormAction, ESTADO_INICIAL);
  const [estadoColaborador, agregarColabAction] = useActionState(agregarColaboradorTareaFormAction, ESTADO_INICIAL);
  const itemFormRef = useRef<HTMLFormElement>(null);
  const colabFormRef = useRef<HTMLFormElement>(null);
  const { show } = useToast();

  useEffect(() => {
    if (estadoChecklist.ok) itemFormRef.current?.reset();
    if (estadoChecklist.error) show(estadoChecklist.error, "error");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [estadoChecklist]);

  useEffect(() => {
    if (estadoColaborador.ok) colabFormRef.current?.reset();
    if (estadoColaborador.error) show(estadoColaborador.error, "error");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [estadoColaborador]);

  useEffect(() => {
    if (estadoEditar.ok) show("Tarea actualizada.");
    if (estadoEditar.error) show(estadoEditar.error, "error");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [estadoEditar]);

  const colaboradoresDisponibles = usuarios.filter((u) => !colaboradores.some((c) => c.user_id === u.id));

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={triggerClassName ?? `truncate font-medium text-left hover:underline underline-offset-2 ${tarea.estado === "completada" ? "text-ink/40 line-through" : "text-[var(--color-brand-900)]"}`}
      >
        {tarea.titulo}
      </button>

      <Modal open={open} onClose={() => setOpen(false)} title={tarea.titulo} size="lg">
        <div className="space-y-4 text-left">
          <div className="flex flex-wrap items-center gap-2">
            <Badge color="brand">{PRIORIDAD_LABEL[tarea.prioridad] ?? tarea.prioridad}</Badge>
            {puedeGestionar ? (
              <AutoSubmitSelect
                action={cambiarEstadoTareaFormAction}
                hiddenFields={{ id: tarea.id }}
                name="estado"
                defaultValue={tarea.estado}
                options={Object.entries(ESTADO_TAREA_LABEL).map(([value, label]) => ({ value, label }))}
                className="rounded-md border border-ink/10 bg-surface px-1.5 py-1 text-xs"
              />
            ) : (
              <Badge color={tarea.estado === "completada" ? "verde" : tarea.estado === "en_curso" ? "brand" : "amarillo"}>
                {ESTADO_TAREA_LABEL[tarea.estado] ?? tarea.estado}
              </Badge>
            )}
            {tarea.fecha_vencimiento && <span className="text-xs text-ink/50">Vence {dayjs(tarea.fecha_vencimiento).format("DD/MM/YYYY")}</span>}
          </div>

          {tarea.descripcion && <p className="text-sm text-ink/70 whitespace-pre-wrap">{tarea.descripcion}</p>}

          <p className="text-xs text-ink/50">
            Responsable: <UsuarioLink id={tarea.responsable_id} nombre={usuarios.find((u) => u.id === tarea.responsable_id)?.nombre ?? null} fallback="sin asignar" />
          </p>

          {etiquetasDe(tarea.etiquetas).length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {etiquetasDe(tarea.etiquetas).map((e) => (
                <span key={e} className="text-xs rounded-full bg-ink/5 px-2 py-0.5 text-ink/60">{e}</span>
              ))}
            </div>
          )}

          {dependencia && (
            <p className={`text-xs rounded-lg px-2.5 py-1.5 ${dependencia.estado === "completada" ? "bg-[var(--color-verde-bg)] text-[var(--color-verde)]" : "bg-[var(--color-amarillo-bg)] text-[var(--color-amarillo)]"}`}>
              🔗 Depende de &quot;{dependencia.titulo}&quot; — {ESTADO_TAREA_LABEL[dependencia.estado] ?? dependencia.estado}
              {dependencia.estado !== "completada" && " (no se puede marcar completada hasta que esa tarea también lo esté)"}
            </p>
          )}

          <div className="pt-3 border-t border-ink/10">
            <p className="text-xs font-semibold text-ink/60 mb-2">Checklist {checklist.length > 0 && `(${hechos}/${checklist.length})`}</p>
            <div className="space-y-1.5">
              {checklist.map((item, i) => (
                <div key={i} className="flex items-center justify-between gap-2 text-sm">
                  <AutoSubmitCheckbox
                    action={alternarItemChecklistFormAction}
                    hiddenFields={{ tarea_id: tarea.id, indice: i }}
                    defaultChecked={item.hecho}
                    label={item.texto}
                    className={item.hecho ? "text-ink/40 line-through" : "text-ink/80"}
                  />
                  {puedeGestionar && (
                    <ActionForm action={eliminarItemChecklistFormAction} className="inline">
                      <input type="hidden" name="tarea_id" value={tarea.id} />
                      <input type="hidden" name="indice" value={i} />
                      <button className="text-ink/30 hover:text-[var(--color-rojo)]" title="Quitar ítem">✕</button>
                    </ActionForm>
                  )}
                </div>
              ))}
              {checklist.length === 0 && <p className="text-xs text-ink/40 italic">Sin ítems todavía.</p>}
            </div>
            {puedeGestionar && (
              <form ref={itemFormRef} action={agregarItemAction} className="mt-2 flex items-center gap-2">
                <input type="hidden" name="tarea_id" value={tarea.id} />
                <input name="texto" placeholder="Agregar ítem al checklist…" className={inputClass + " text-xs !py-1.5"} />
                <SubmitButton variant="add" className="text-xs px-2.5 py-1.5 whitespace-nowrap">Agregar</SubmitButton>
              </form>
            )}
            <FieldError message={estadoChecklist.fieldErrors?.texto} />
          </div>

          <div className="pt-3 border-t border-ink/10">
            <p className="text-xs font-semibold text-ink/60 mb-2">Colaboradores</p>
            <div className="flex flex-wrap gap-1.5">
              {colaboradores.map((c) => (
                <span key={c.id} className="inline-flex items-center gap-1.5 text-xs rounded-full bg-ink/5 px-2.5 py-1">
                  {c.nombre}
                  {puedeGestionar && (
                    <ActionForm action={quitarColaboradorTareaFormAction} className="inline">
                      <input type="hidden" name="id" value={c.id} />
                      <button className="text-ink/40 hover:text-[var(--color-rojo)]" title="Quitar colaborador">✕</button>
                    </ActionForm>
                  )}
                </span>
              ))}
              {colaboradores.length === 0 && <p className="text-xs text-ink/40 italic">Sin colaboradores además del responsable.</p>}
            </div>
            {puedeGestionar && colaboradoresDisponibles.length > 0 && (
              <form ref={colabFormRef} action={agregarColabAction} className="mt-2 flex items-center gap-2">
                <input type="hidden" name="tarea_id" value={tarea.id} />
                <select name="user_id" className={inputClass + " text-xs !py-1.5"} defaultValue="">
                  <option value="" disabled>Agregar colaborador…</option>
                  {colaboradoresDisponibles.map((u) => (
                    <option key={u.id} value={u.id}>{u.nombre}</option>
                  ))}
                </select>
                <SubmitButton variant="add" className="text-xs px-2.5 py-1.5 whitespace-nowrap">Agregar</SubmitButton>
              </form>
            )}
          </div>

          {puedeGestionar && (
            <details className="pt-3 border-t border-ink/10">
              <summary className="cursor-pointer text-xs font-semibold text-ink/60">Editar tarea</summary>
              <form action={editarAction} className="mt-2 grid grid-cols-1 sm:grid-cols-2 gap-2">
                <input type="hidden" name="id" value={tarea.id} />
                <div className="sm:col-span-2">
                  <Label>Título</Label>
                  <input name="titulo" defaultValue={tarea.titulo} required className={inputClass} />
                  <FieldError message={estadoEditar.fieldErrors?.titulo} />
                </div>
                <div className="sm:col-span-2">
                  <Label>Descripción</Label>
                  <textarea name="descripcion" defaultValue={tarea.descripcion ?? ""} rows={2} className={inputClass} />
                </div>
                <div>
                  <Label>Responsable</Label>
                  <select name="responsable_id" defaultValue={tarea.responsable_id ?? ""} className={inputClass}>
                    <option value="">Sin asignar</option>
                    {usuarios.map((u) => (
                      <option key={u.id} value={u.id}>{u.nombre}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <Label>Prioridad</Label>
                  <select name="prioridad" defaultValue={tarea.prioridad} className={inputClass}>
                    <option value="alta">Alta</option>
                    <option value="media">Media</option>
                    <option value="baja">Baja</option>
                  </select>
                </div>
                <div>
                  <Label>Fecha límite</Label>
                  <input name="fecha_vencimiento" type="date" defaultValue={tarea.fecha_vencimiento ?? ""} className={inputClass} />
                </div>
                <div>
                  <Label>Depende de (opcional)</Label>
                  <select name="depende_de_id" defaultValue={tarea.depende_de_id ?? ""} className={inputClass}>
                    <option value="">Ninguna</option>
                    {otrasTareas.map((t) => (
                      <option key={t.id} value={t.id}>{t.titulo}</option>
                    ))}
                  </select>
                </div>
                <div className="sm:col-span-2">
                  <Label>Etiquetas (separadas por coma)</Label>
                  <input name="etiquetas" defaultValue={tarea.etiquetas ?? ""} placeholder="urgente, obra, etapa 2" className={inputClass} />
                </div>
                <div className="sm:col-span-2">
                  <FormError message={estadoEditar.error} />
                </div>
                <div className="sm:col-span-2">
                  <SubmitButton variant="primary" className="text-xs px-3 py-2">Guardar cambios</SubmitButton>
                </div>
              </form>
            </details>
          )}
        </div>
      </Modal>
    </>
  );
}
