"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { FieldError, FormError, SubmitButton, useToast } from "@/components/ui-client";
import { Card, Label, Badge, inputClass } from "@/components/ui";
import { FormularioEnModal } from "@/components/FormularioEnModal";
import { ESTADO_INICIAL, type ActionState } from "@/lib/actionState";
import {
  registrarCorrespondenciaFormAction,
  marcarRespondidaFormAction,
  crearEleccionFormAction,
  registrarListaFormAction,
  cambiarEstadoListaFormAction,
} from "@/lib/actions/panelesComision";
import type { FilaCorrespondencia, EleccionConListas } from "@/lib/panelesComision";

/** Fase 3B — formularios propios de los paneles de Administrativa y Electoral. */

const dmy = (f: string | null) => (f ? f.slice(0, 10).split("-").reverse().join("/") : "");
const botonLink = "text-sm font-semibold text-[var(--color-brand-800)] underline underline-offset-2";

function useToastAviso(estado: ActionState, alTerminar?: () => void) {
  const { show } = useToast();
  useEffect(() => {
    if (estado.ok) {
      if (estado.aviso) show(estado.aviso);
      alTerminar?.();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [estado]);
}

export function CorrespondenciaPanel({ comisionId, filas, hoy, puede }: { comisionId: number; filas: FilaCorrespondencia[]; hoy: string; puede: boolean }) {
  const [estado, formAction] = useActionState(registrarCorrespondenciaFormAction, ESTADO_INICIAL);
  const [tipo, setTipo] = useState("entrada");
  const [requiere, setRequiere] = useState(false);
  const ref = useRef<HTMLFormElement>(null);
  useToastAviso(estado, () => {
    ref.current?.reset();
    setRequiere(false);
  });
  const e = estado.fieldErrors ?? {};
  const pendientes = filas.filter((f) => f.tipo === "entrada" && f.requiere_respuesta && !f.respondida_en);
  return (
    <Card>
      <h3 className="text-[15px] font-bold text-ink mb-2">Correspondencia (entrada y salida)</h3>
      {puede && (
        <form ref={ref} action={formAction} className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-[15px] mb-4">
          <input type="hidden" name="comision_id" value={comisionId} />
          <fieldset className="sm:col-span-2 flex flex-wrap gap-4">
            <legend className="sr-only">Tipo</legend>
            <label className="flex items-center gap-2">
              <input type="radio" name="tipo" value="entrada" checked={tipo === "entrada"} onChange={() => setTipo("entrada")} /> Llegó (entrada)
            </label>
            <label className="flex items-center gap-2">
              <input type="radio" name="tipo" value="salida" checked={tipo === "salida"} onChange={() => setTipo("salida")} /> Mandamos (salida)
            </label>
          </fieldset>
          <div>
            <Label required>{tipo === "entrada" ? "De" : "Para"}</Label>
            <input name="contraparte" required maxLength={200} className={inputClass} placeholder="Intendencia, MVOT, FUCVAM…" />
            <FieldError message={e.contraparte} />
          </div>
          <div>
            <Label required>Fecha</Label>
            <input name="fecha" type="date" required max={hoy} defaultValue={hoy} className={inputClass} />
            <FieldError message={e.fecha} />
          </div>
          <div className="sm:col-span-2">
            <Label required>Asunto</Label>
            <input name="asunto" required maxLength={300} className={inputClass} />
            <FieldError message={e.asunto} />
          </div>
          <div>
            <Label>Referencia (expediente, N° de nota)</Label>
            <input name="referencia" maxLength={100} className={inputClass} />
          </div>
          {tipo === "entrada" ? (
            <div>
              <label className="flex items-center gap-2 mt-6">
                <input type="checkbox" name="requiere_respuesta" value="1" checked={requiere} onChange={(ev) => setRequiere(ev.target.checked)} /> Hay que responderla
              </label>
              {requiere && (
                <div className="mt-2">
                  <Label>Responder antes del</Label>
                  <input name="responder_antes" type="date" className={inputClass} />
                </div>
              )}
            </div>
          ) : (
            pendientes.length > 0 && (
              <div>
                <Label>¿Contesta una nota?</Label>
                <select name="responde_a_id" defaultValue="" className={inputClass}>
                  <option value="">No</option>
                  {pendientes.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.contraparte}: {p.asunto}
                    </option>
                  ))}
                </select>
              </div>
            )
          )}
          <div className="sm:col-span-2">
            <FormError message={estado.error} />
            <SubmitButton variant="add" pendingLabel="Guardando…">Registrar</SubmitButton>
          </div>
        </form>
      )}
      <ul className="divide-y divide-border">
        {filas.map((f) => (
          <li key={f.id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-[15px]">
            <span>
              <Badge color={f.tipo === "entrada" ? "gray" : "verde"}>{f.tipo === "entrada" ? "Entrada" : "Salida"}</Badge>{" "}
              {dmy(f.fecha)} · {f.contraparte}: {f.asunto}
              {f.referencia && <span className="text-ink-muted"> ({f.referencia})</span>}
              {f.tipo === "entrada" && f.requiere_respuesta ? (
                <span className="block text-sm text-ink-muted">
                  {f.respondida_en ? `Respondida el ${dmy(f.respondida_en)}` : `Espera respuesta${f.responder_antes ? ` antes del ${dmy(f.responder_antes)}` : ""}`}
                </span>
              ) : null}
            </span>
            {puede && f.tipo === "entrada" && f.requiere_respuesta && !f.respondida_en ? (
              <FormularioEnModal textoBoton="Ya se respondió" claseBoton={botonLink} titulo="Marcar como respondida" action={marcarRespondidaFormAction} ocultos={{ id: f.id, comision_id: comisionId }} textoConfirmar="Marcar respondida" />
            ) : null}
          </li>
        ))}
        {filas.length === 0 && <li className="py-2 text-[15px] text-ink-muted">Todavía no se registró correspondencia.</li>}
      </ul>
    </Card>
  );
}

const ESTADO_LISTA: Record<string, { t: string; c: "gray" | "verde" | "amarillo" }> = {
  presentada: { t: "Presentada", c: "gray" },
  aceptada: { t: "Aceptada", c: "verde" },
  observada: { t: "Observada", c: "amarillo" },
};

export function EleccionesPanel({ comisionId, elecciones, hoy, puede }: { comisionId: number; elecciones: EleccionConListas[]; hoy: string; puede: boolean }) {
  return (
    <Card>
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-[15px] font-bold text-ink">Elecciones y listas</h3>
        {puede && (
          <FormularioEnModal textoBoton="+ Nueva elección" claseBoton={botonLink} titulo="Nueva elección" action={crearEleccionFormAction} ocultos={{ comision_id: comisionId }}>
            <label className="block">
              <Label required>Título</Label>
              <input name="titulo" required maxLength={150} className={inputClass} placeholder="Elecciones 2027" />
            </label>
            <label className="block">
              <Label>Órganos que se eligen</Label>
              <input name="organos" maxLength={200} className={inputClass} placeholder="Consejo Directivo, Comisión Fiscal, Electoral" />
            </label>
            <div className="grid grid-cols-2 gap-3">
              <label className="block">
                <Label>Cierre de listas</Label>
                <input name="fecha_cierre_listas" type="date" className={inputClass} />
              </label>
              <label className="block">
                <Label required>Fecha de la elección</Label>
                <input name="fecha_eleccion" type="date" required className={inputClass} />
              </label>
            </div>
          </FormularioEnModal>
        )}
      </div>
      {elecciones.length === 0 && <p className="text-[15px] text-ink-muted">No hay elecciones abiertas.</p>}
      <div className="space-y-4">
        {elecciones.map((el) => (
          <div key={el.id} className="rounded-xl border border-border p-3">
            <p className="font-semibold text-ink">{el.titulo}</p>
            <p className="text-sm text-ink-muted">
              {el.organos ? `${el.organos} · ` : ""}
              {el.fecha_cierre_listas ? `cierre de listas ${dmy(el.fecha_cierre_listas)} · ` : ""}elección {dmy(el.fecha_eleccion)}
            </p>
            <ul className="mt-2 divide-y divide-border">
              {el.listas.map((l) => (
                <li key={l.id} className="flex flex-wrap items-start justify-between gap-2 py-2 text-[15px]">
                  <span>
                    <span className="font-semibold">{l.nombre}</span> <Badge color={ESTADO_LISTA[l.estado]?.c ?? "gray"}>{ESTADO_LISTA[l.estado]?.t ?? l.estado}</Badge>
                    <span className="block text-sm text-ink-muted whitespace-pre-line">{l.integrantes}</span>
                    {l.observaciones && <span className="block text-sm text-ink">Observación: {l.observaciones}</span>}
                  </span>
                  {puede && (
                    <FormularioEnModal textoBoton="Cambiar estado" claseBoton={botonLink} titulo={`Lista «${l.nombre}»`} action={cambiarEstadoListaFormAction} ocultos={{ id: l.id, comision_id: comisionId }}>
                      <label className="block">
                        <Label required>Estado</Label>
                        <select name="estado" defaultValue="aceptada" className={inputClass}>
                          <option value="aceptada">Aceptada</option>
                          <option value="observada">Observada</option>
                          <option value="retirada">Retirada</option>
                        </select>
                      </label>
                      <label className="block">
                        <Label>Observaciones</Label>
                        <textarea name="observaciones" rows={2} maxLength={1000} className={inputClass} />
                      </label>
                    </FormularioEnModal>
                  )}
                </li>
              ))}
              {el.listas.length === 0 && <li className="py-2 text-[15px] text-ink-muted">Todavía no se presentaron listas.</li>}
            </ul>
            {puede && (
              <div className="mt-2">
                <FormularioEnModal textoBoton="+ Registrar una lista" claseBoton={botonLink} titulo={`Lista para ${el.titulo}`} action={registrarListaFormAction} ocultos={{ eleccion_id: el.id, comision_id: comisionId }}>
                  <label className="block">
                    <Label required>Nombre o número de la lista</Label>
                    <input name="nombre" required maxLength={150} className={inputClass} />
                  </label>
                  <label className="block">
                    <Label required>Integrantes (uno por renglón, con el cargo)</Label>
                    <textarea name="integrantes" required rows={4} maxLength={3000} className={inputClass} />
                  </label>
                  <label className="block">
                    <Label required>Fecha de presentación</Label>
                    <input name="presentada_en" type="date" required max={hoy} defaultValue={hoy} className={inputClass} />
                  </label>
                </FormularioEnModal>
              </div>
            )}
          </div>
        ))}
      </div>
    </Card>
  );
}
