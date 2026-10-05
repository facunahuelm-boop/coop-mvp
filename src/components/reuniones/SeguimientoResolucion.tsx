"use client";

// Recorrido de decisiones (04/10): desde una resolución (punto del orden del
// día con su resultado) se le da seguimiento SIN duplicar nada — cada cosa
// se crea en su propio módulo con la misma acción de siempre (crear tarea,
// solicitud de compra) o queda referenciada (llevar al Consejo / a otra
// reunión, vincular una decisión de comisión).

import { useActionState, useEffect, useRef, useState } from "react";
import Link from "next/link";
import dayjs from "dayjs";
import { crearTareaFormAction } from "@/lib/actions/tareas";
import { llevarResolucionAReunionFormAction } from "@/lib/actions/reuniones";
import { vincularDecisionAResolucionFormAction } from "@/lib/actions/decisiones";
import { ESTADO_INICIAL } from "@/lib/actionState";
import { FieldError, FormError, SubmitButton, useToast, Modal } from "@/components/ui-client";
import { Badge, Button, Label, inputClass } from "@/components/ui";
import { CrearSolicitudForm } from "@/components/compras/ComprasFormularios";
import type { NodoRecorrido } from "@/lib/trazabilidad";

type Opcion = { id: number; nombre: string };
type Resolucion = { agendaItemId: number; titulo: string; resultado: string | null };

const botonLink = "text-xs font-semibold text-[var(--color-brand-800)] underline underline-offset-2 whitespace-nowrap";

function useCerrarAlGuardar(estado: { ok?: boolean; error?: string }, setOpen: (v: boolean) => void, mensaje: string, formRef: React.RefObject<HTMLFormElement | null>) {
  const { show } = useToast();
  useEffect(() => {
    if (estado.ok) {
      formRef.current?.reset();
      setOpen(false);
      show(mensaje);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [estado]);
}

function CrearTareaDesdeResolucion({ resolucion, comisiones, usuarios }: { resolucion: Resolucion; comisiones: Opcion[]; usuarios: Opcion[] }) {
  const [open, setOpen] = useState(false);
  const [estado, formAction] = useActionState(crearTareaFormAction, ESTADO_INICIAL);
  const formRef = useRef<HTMLFormElement>(null);
  useCerrarAlGuardar(estado, setOpen, "Tarea creada. Ya figura en la comisión.", formRef);

  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className={botonLink}>+ Tarea</button>
      <Modal open={open} onClose={() => setOpen(false)} title="Tarea desde una resolución" size="lg">
        <form ref={formRef} action={formAction} className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-ink">
          <input type="hidden" name="agenda_item_id" value={resolucion.agendaItemId} />
          <p className="sm:col-span-2 rounded-lg bg-[var(--accent-blue-bg)] px-3 py-2 text-xs text-[var(--accent-blue)]">
            Sale de «{resolucion.titulo}»{resolucion.resultado ? `: ${resolucion.resultado}` : ""}. La tarea queda en la comisión elegida, con su origen a la vista.
          </p>
          <div>
            <Label required>Comisión responsable</Label>
            <select name="comision_id" required className={inputClass} defaultValue="">
              <option value="" disabled>Elegir…</option>
              {comisiones.map((c) => (
                <option key={c.id} value={c.id}>{c.nombre}</option>
              ))}
            </select>
            <FieldError message={estado.fieldErrors?.comision_id} />
          </div>
          <div>
            <Label>Responsable</Label>
            <select name="responsable_id" className={inputClass} defaultValue="">
              <option value="">Sin asignar</option>
              {usuarios.map((u) => (
                <option key={u.id} value={u.id}>{u.nombre}</option>
              ))}
            </select>
          </div>
          <div className="sm:col-span-2">
            <Label required>Tarea</Label>
            <input name="titulo" required defaultValue={resolucion.titulo} className={inputClass} />
            <FieldError message={estado.fieldErrors?.titulo} />
          </div>
          <div className="sm:col-span-2">
            <Label>Descripción</Label>
            <textarea name="descripcion" rows={2} defaultValue={resolucion.resultado ?? ""} className={inputClass} />
            <FieldError message={estado.fieldErrors?.descripcion} />
          </div>
          <div>
            <Label>Prioridad</Label>
            <select name="prioridad" className={inputClass} defaultValue="media">
              <option value="alta">Alta</option>
              <option value="media">Media</option>
              <option value="baja">Baja</option>
            </select>
          </div>
          <div>
            <Label>Vence el</Label>
            <input type="date" name="fecha_vencimiento" className={inputClass} />
            <FieldError message={estado.fieldErrors?.fecha_vencimiento} />
          </div>
          <div className="sm:col-span-2"><FormError message={estado.error} /></div>
          <div className="sm:col-span-2 flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={() => setOpen(false)}>Cancelar</Button>
            <SubmitButton pendingLabel="Creando…">Crear tarea</SubmitButton>
          </div>
        </form>
      </Modal>
    </>
  );
}

export type ReunionDestino = { id: number; titulo: string; tipo: string; fecha: string; comision_nombre: string | null };
const TIPO_LABEL: Record<string, string> = { asamblea: "Asamblea", consejo_directivo: "Consejo Directivo", comision: "Comisión" };

function LlevarAReunion({ resolucion, reuniones }: { resolucion: Resolucion; reuniones: ReunionDestino[] }) {
  const [open, setOpen] = useState(false);
  const [estado, formAction] = useActionState(llevarResolucionAReunionFormAction, ESTADO_INICIAL);
  const formRef = useRef<HTMLFormElement>(null);
  useCerrarAlGuardar(estado, setOpen, "Listo: quedó en el orden del día de esa reunión.", formRef);

  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className={botonLink}>Llevar a otra reunión</button>
      <Modal open={open} onClose={() => setOpen(false)} title="Llevar a otra reunión">
        <form ref={formRef} action={formAction} className="space-y-3 text-ink">
          <input type="hidden" name="agenda_item_id" value={resolucion.agendaItemId} />
          <p className="text-xs text-ink-muted">
            «{resolucion.titulo}» pasa a ser un punto del orden del día de la reunión elegida (ej. el Consejo Directivo toma una resolución de la Asamblea). No se copia nada: el punto nuevo muestra de dónde viene.
          </p>
          <div>
            <Label required>Reunión</Label>
            <select name="reunion_destino_id" required className={inputClass} defaultValue="">
              <option value="" disabled>Elegir una reunión planificada…</option>
              {reuniones.map((r) => (
                <option key={r.id} value={r.id}>
                  {TIPO_LABEL[r.tipo] ?? r.tipo}{r.comision_nombre ? ` (${r.comision_nombre})` : ""} — {r.titulo} — {dayjs(r.fecha).format("DD/MM/YYYY")}
                </option>
              ))}
            </select>
            <FieldError message={estado.fieldErrors?.reunion_destino_id} />
          </div>
          <div>
            <Label>Título del punto</Label>
            <input name="titulo" defaultValue={resolucion.titulo} className={inputClass} />
            <FieldError message={estado.fieldErrors?.titulo} />
          </div>
          <FormError message={estado.error} />
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={() => setOpen(false)}>Cancelar</Button>
            <SubmitButton pendingLabel="Guardando…">Llevar</SubmitButton>
          </div>
        </form>
      </Modal>
    </>
  );
}

export type DecisionDisponible = { id: number; tema: string; comision_nombre: string | null };

function VincularDecision({ resolucion, decisiones }: { resolucion: Resolucion; decisiones: DecisionDisponible[] }) {
  const [open, setOpen] = useState(false);
  const [estado, formAction] = useActionState(vincularDecisionAResolucionFormAction, ESTADO_INICIAL);
  const formRef = useRef<HTMLFormElement>(null);
  useCerrarAlGuardar(estado, setOpen, "Decisión vinculada.", formRef);

  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className={botonLink}>Vincular decisión</button>
      <Modal open={open} onClose={() => setOpen(false)} title="Vincular una decisión de comisión">
        <form ref={formRef} action={formAction} className="space-y-3 text-ink">
          <input type="hidden" name="agenda_item_id" value={resolucion.agendaItemId} />
          <p className="text-xs text-ink-muted">La decisión elegida queda marcada como surgida de «{resolucion.titulo}».</p>
          <div>
            <Label required>Decisión</Label>
            <select name="decision_id" required className={inputClass} defaultValue="">
              <option value="" disabled>Elegir…</option>
              {decisiones.map((d) => (
                <option key={d.id} value={d.id}>{d.tema}{d.comision_nombre ? ` — ${d.comision_nombre}` : ""}</option>
              ))}
            </select>
            <FieldError message={estado.fieldErrors?.decision_id} />
          </div>
          <FormError message={estado.error} />
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={() => setOpen(false)}>Cancelar</Button>
            <SubmitButton pendingLabel="Guardando…">Vincular</SubmitButton>
          </div>
        </form>
      </Modal>
    </>
  );
}

/** Botones de seguimiento de una resolución — cada uno sólo si el rol puede. */
export function AccionesResolucion({
  resolucion,
  comisionesTarea,
  usuarios,
  comisionesCompra,
  reunionesDestino,
  decisiones,
}: {
  resolucion: Resolucion;
  /** Comisiones en las que puede crear tareas (vacío = no puede). */
  comisionesTarea: Opcion[];
  usuarios: Opcion[];
  /** null = no puede crear solicitudes de compra. */
  comisionesCompra: Opcion[] | null;
  reunionesDestino: ReunionDestino[];
  decisiones: DecisionDisponible[];
}) {
  const hayAlgo = comisionesTarea.length > 0 || comisionesCompra !== null || reunionesDestino.length > 0 || decisiones.length > 0;
  if (!hayAlgo) return null;
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-1.5">
      <span className="text-[11px] text-ink-faint">Seguimiento:</span>
      {comisionesTarea.length > 0 && <CrearTareaDesdeResolucion resolucion={resolucion} comisiones={comisionesTarea} usuarios={usuarios} />}
      {comisionesCompra !== null && (
        <CrearSolicitudForm comisiones={comisionesCompra} desdeResolucion={resolucion} />
      )}
      {reunionesDestino.length > 0 && <LlevarAReunion resolucion={resolucion} reuniones={reunionesDestino} />}
      {decisiones.length > 0 && <VincularDecision resolucion={resolucion} decisiones={decisiones} />}
    </div>
  );
}

// ---------- Recorrido completo ----------

const ESTADO_TAREA_LABEL: Record<string, string> = { pendiente: "Pendiente", en_curso: "En curso", completada: "Completada" };
const ESTADO_TAREA_COLOR: Record<string, "amarillo" | "azul" | "verde"> = { pendiente: "amarillo", en_curso: "azul", completada: "verde" };

function Nodo({ nodo, nivel, actualId }: { nodo: NodoRecorrido; nivel: number; actualId: number }) {
  const p = nodo.punto;
  const esActual = p.id === actualId;
  return (
    <div className={nivel > 0 ? "ml-3 pl-3 border-l-2 border-[var(--accent-blue-bg)]" : ""}>
      <div className={`rounded-lg px-3 py-2 ${esActual ? "bg-[var(--accent-blue-bg)]" : "bg-page-bg"}`}>
        <p className="text-[11px] uppercase tracking-wide text-ink-faint">
          {TIPO_LABEL[p.reunion_tipo] ?? p.reunion_tipo}{p.comision_nombre ? ` · ${p.comision_nombre}` : ""} · {dayjs(p.reunion_fecha).format("DD/MM/YYYY")}
          {esActual && " · (esta)"}
        </p>
        <Link href={`/reuniones/${p.reunion_id}`} className="text-sm font-medium hover:underline underline-offset-2">{p.reunion_titulo}</Link>
        <p className="text-sm text-ink/80">
          <span className="font-medium">{p.titulo}</span>
          {p.resultado ? <> → {p.resultado}</> : <span className="text-ink-faint"> → sin resolución registrada</span>}
        </p>
      </div>
      {(nodo.decisiones.length > 0 || nodo.tareas.length > 0 || nodo.compras.length > 0) && (
        <ul className="ml-3 pl-3 border-l-2 border-[var(--accent-blue-bg)] mt-1 space-y-1">
          {nodo.decisiones.map((d) => (
            <li key={`d${d.id}`} className="text-xs">
              ⚖️ Decisión: <Link href={`/decisiones/${d.id}`} className="underline underline-offset-2">{d.tema}</Link>
              {d.comision_nombre ? ` (${d.comision_nombre})` : ""} · {d.resultado}
            </li>
          ))}
          {nodo.tareas.map((t) => (
            <li key={`t${t.id}`} className="text-xs">
              ✅ Tarea: <span className="font-medium">{t.titulo}</span>
              {t.comision_nombre ? ` (${t.comision_nombre})` : ""}
              {t.responsable_nombre ? ` · ${t.responsable_nombre}` : ""}{" "}
              <Badge color={ESTADO_TAREA_COLOR[t.estado] ?? "gray"}>{ESTADO_TAREA_LABEL[t.estado] ?? t.estado}</Badge>
              {t.resultado && <p className="text-ink/70 mt-0.5">Resultado: {t.resultado}</p>}
            </li>
          ))}
          {nodo.compras.map((c) => (
            <li key={`c${c.id}`} className="text-xs">
              🛒 Compra: <Link href={`/compras/${c.id}`} className="underline underline-offset-2">{c.material}</Link> · {c.estado.replace(/_/g, " ")}
            </li>
          ))}
        </ul>
      )}
      {nodo.hijos.length > 0 && (
        <div className="mt-1 space-y-1">
          {nodo.hijos.map((h) => (
            <Nodo key={h.punto.id} nodo={h} nivel={nivel + 1} actualId={actualId} />
          ))}
        </div>
      )}
    </div>
  );
}

export function RecorridoResolucion({ arbol, actualId }: { arbol: NodoRecorrido; actualId: number }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className={botonLink}>Ver recorrido</button>
      <Modal open={open} onClose={() => setOpen(false)} title="Recorrido de la resolución" size="lg">
        <p className="text-xs text-ink-muted mb-3">De dónde viene esta resolución y todo lo que salió de ella: otras reuniones, decisiones, tareas (con su resultado) y compras.</p>
        <Nodo nodo={arbol} nivel={0} actualId={actualId} />
      </Modal>
    </>
  );
}
