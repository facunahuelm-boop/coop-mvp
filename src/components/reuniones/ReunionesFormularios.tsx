"use client";

// Fase 4 del rediseño: los 2 formularios de Reuniones con campos reales
// (agendar reunión, cerrar reunión y generar acta) migrados a
// `useActionState` — mismo criterio que los demás módulos.
// `cancelarReunionAction`/`registrarAsistenciaAction` quedan sin tocar
// (cambios de estado / toggles por fila, no altas con validación real).

import { useActionState, useEffect, useRef, useState } from "react";
import {
  crearReunionFormAction,
  cerrarReunionFormAction,
  agregarAgendaItemFormAction,
  editarResultadoAgendaFormAction,
  agregarInvitadoFormAction,
} from "@/lib/actions/reuniones";
import { ESTADO_INICIAL } from "@/lib/actionState";
import { FieldError, FormError, SubmitButton, useToast } from "@/components/ui-client";
import { Card, Label, inputClass } from "@/components/ui";

type Opcion = { id: number; nombre: string };

export function CrearReunionForm({ comisiones, esOversightReuniones, tipoInicial }: { comisiones: Opcion[]; esOversightReuniones: boolean; tipoInicial?: string }) {
  const [estado, formAction] = useActionState(crearReunionFormAction, ESTADO_INICIAL);
  const formRef = useRef<HTMLFormElement>(null);
  const detailsRef = useRef<HTMLDetailsElement>(null);
  // Sub-fase 1.3 ("Asambleas como módulo propio"): la convocatoria formal
  // (tipo ordinaria/extraordinaria, primera/segunda, fecha de convocatoria)
  // solo tiene sentido para una Asamblea — se muestra nomás cuando se elige
  // ese tipo, mismo criterio condicional que ya usa "Vincular a" en el
  // formulario de Documentos (contextoTipo).
  const [tipo, setTipo] = useState(tipoInicial || "comision");
  const { show } = useToast();

  useEffect(() => {
    if (estado.ok) {
      formRef.current?.reset();
      if (detailsRef.current) detailsRef.current.open = false;
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setTipo(tipoInicial || "comision");
      show("Reunión agendada.");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [estado]);

  return (
    <details ref={detailsRef} open={!!tipoInicial}>
      <summary className="cursor-pointer text-sm font-semibold text-[var(--color-brand-800)]">
        {tipoInicial === "asamblea" ? "+ Convocar asamblea" : "+ Agendar reunión"}
      </summary>
      <Card className="mt-3">
        <form ref={formRef} action={formAction} className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <Label>Tipo</Label>
            <select name="tipo" className={inputClass} value={tipo} onChange={(e) => setTipo(e.target.value)}>
              {esOversightReuniones && <option value="asamblea">Asamblea</option>}
              {esOversightReuniones && <option value="consejo_directivo">Consejo Directivo</option>}
              <option value="comision">Comisión</option>
            </select>
          </div>
          <div>
            <Label>Comisión (si corresponde)</Label>
            <select name="comision_id" className={inputClass} defaultValue="">
              <option value="">—</option>
              {comisiones.map((c) => (
                <option key={c.id} value={c.id}>{c.nombre}</option>
              ))}
            </select>
          </div>
          {tipo === "asamblea" && (
            <>
              <div>
                <Label>Tipo de asamblea</Label>
                <select name="tipo_asamblea" className={inputClass} defaultValue="ordinaria">
                  <option value="ordinaria">Ordinaria</option>
                  <option value="extraordinaria">Extraordinaria</option>
                </select>
              </div>
              <div>
                <Label>Convocatoria</Label>
                <select name="convocatoria" className={inputClass} defaultValue="primera">
                  <option value="primera">Primera</option>
                  <option value="segunda">Segunda</option>
                </select>
              </div>
              <div className="sm:col-span-2">
                <Label>Fecha de convocatoria (opcional)</Label>
                <input type="date" name="fecha_convocatoria" className={inputClass} />
                <p className="text-xs text-ink/40 mt-1">Fecha en que se publicó/envió la convocatoria — solo para mostrar la antelación, informativo.</p>
                <FieldError message={estado.fieldErrors?.fecha_convocatoria} />
              </div>
            </>
          )}
          <div className="sm:col-span-2">
            <Label>Título</Label>
            <input name="titulo" required className={inputClass} />
            <FieldError message={estado.fieldErrors?.titulo} />
          </div>
          <div>
            <Label>Fecha y hora</Label>
            <input type="datetime-local" name="fecha" required className={inputClass} />
            <FieldError message={estado.fieldErrors?.fecha} />
          </div>
          <div>
            <Label>Modalidad</Label>
            <select name="modalidad" className={inputClass} defaultValue="presencial">
              <option value="presencial">Presencial</option>
              <option value="virtual">Virtual</option>
              <option value="hibrida">Híbrida</option>
            </select>
          </div>
          <div>
            <Label>Lugar</Label>
            <input name="lugar" className={inputClass} />
            <FieldError message={estado.fieldErrors?.lugar} />
          </div>
          <div className="sm:col-span-2">
            <Label>Orden del día</Label>
            <textarea name="orden_del_dia" className={inputClass} rows={3} placeholder="Un punto por línea" />
            <FieldError message={estado.fieldErrors?.orden_del_dia} />
          </div>
          <div className="sm:col-span-2">
            <FormError message={estado.error} />
          </div>
          <div className="sm:col-span-2">
            <SubmitButton pendingLabel="Agendando…">{tipo === "asamblea" ? "Convocar asamblea" : "Agendar reunión"}</SubmitButton>
          </div>
        </form>
      </Card>
    </details>
  );
}

export function CerrarReunionForm({ reunionId, usuarios }: { reunionId: number; usuarios: Opcion[] }) {
  const [estado, formAction] = useActionState(cerrarReunionFormAction, ESTADO_INICIAL);
  const { show } = useToast();

  useEffect(() => {
    if (estado.ok) show("Reunión cerrada y acta generada.");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [estado]);

  return (
    <Card>
      <form action={formAction} className="space-y-3">
        <input type="hidden" name="id" value={reunionId} />
        <div>
          <Label>Resumen del acta</Label>
          <textarea name="resumen" required className={inputClass} rows={5} placeholder="Temas tratados, resoluciones, próximos pasos…" />
          <FieldError message={estado.fieldErrors?.resumen} />
        </div>

        <div className="pt-2 border-t border-ink/5">
          <Label>Tareas resultantes (opcional)</Label>
          <p className="text-xs text-ink/40 mb-2">Se cargan directo en Comisiones — no hace falta anotarlas también en el resumen.</p>
          <div className="space-y-3">
            {[0, 1, 2].map((i) => (
              <div key={i} className="space-y-1.5 pb-2 border-b border-ink/5 last:border-0 last:pb-0">
                <input name="tarea_titulo" placeholder={`Título de la tarea ${i + 1} (opcional)`} className={inputClass + " text-xs !py-1.5"} />
                <div className="grid grid-cols-3 gap-1.5">
                  <select name="tarea_responsable_id" defaultValue="" className={inputClass + " text-xs !py-1.5"}>
                    <option value="">Sin asignar</option>
                    {usuarios.map((u) => (
                      <option key={u.id} value={u.id}>{u.nombre}</option>
                    ))}
                  </select>
                  <select name="tarea_prioridad" defaultValue="media" className={inputClass + " text-xs !py-1.5"}>
                    <option value="alta">Alta</option>
                    <option value="media">Media</option>
                    <option value="baja">Baja</option>
                  </select>
                  <input name="tarea_fecha_vencimiento" type="date" className={inputClass + " text-xs !py-1.5"} />
                </div>
              </div>
            ))}
          </div>
        </div>

        <FormError message={estado.error} />
        <SubmitButton pendingLabel="Cerrando…">Cerrar reunión y generar acta</SubmitButton>
      </form>
    </Card>
  );
}

// Comisiones como sistema de gestión, Fase 5 (19/09, sección 15: "agenda
// estructurada"). Se agrega bajo un <details> propio, aparte del bloque de
// "Orden del día" en texto libre que ya existía — no lo reemplaza, es un
// nivel de detalle opcional para quien lo quiera usar.
export function AgregarAgendaItemForm({ reunionId, usuarios }: { reunionId: number; usuarios: Opcion[] }) {
  const [estado, formAction] = useActionState(agregarAgendaItemFormAction, ESTADO_INICIAL);
  const formRef = useRef<HTMLFormElement>(null);
  const { show } = useToast();

  useEffect(() => {
    if (estado.ok) {
      formRef.current?.reset();
      show("Punto de agenda agregado.");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [estado]);

  return (
    <form ref={formRef} action={formAction} className="grid grid-cols-1 sm:grid-cols-2 gap-2 mt-2">
      <input type="hidden" name="reunion_id" value={reunionId} />
      <div className="sm:col-span-2">
        <input name="titulo" required placeholder="Punto a tratar" className={inputClass + " text-xs !py-1.5"} />
        <FieldError message={estado.fieldErrors?.titulo} />
      </div>
      <div>
        <select name="responsable_id" className={inputClass + " text-xs !py-1.5"} defaultValue="">
          <option value="">Sin responsable</option>
          {usuarios.map((u) => (
            <option key={u.id} value={u.id}>{u.nombre}</option>
          ))}
        </select>
      </div>
      <div>
        <SubmitButton variant="add" className="text-xs px-2.5 py-1.5">Agregar punto</SubmitButton>
      </div>
      <div className="sm:col-span-2">
        <FormError message={estado.error} />
      </div>
    </form>
  );
}

export function ResultadoAgendaForm({ id, resultadoActual }: { id: number; resultadoActual: string | null }) {
  const [estado, formAction] = useActionState(editarResultadoAgendaFormAction, ESTADO_INICIAL);
  const { show } = useToast();

  useEffect(() => {
    if (estado.ok) show("Resultado guardado.");
    if (estado.error) show(estado.error, "error");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [estado]);

  return (
    <form action={formAction} className="flex items-center gap-1.5 mt-1">
      <input type="hidden" name="id" value={id} />
      <input name="resultado" defaultValue={resultadoActual ?? ""} placeholder="Resultado de este punto…" className={inputClass + " text-xs !py-1"} />
      <SubmitButton variant="ghost" className="text-xs px-2 py-1 whitespace-nowrap">Guardar</SubmitButton>
    </form>
  );
}

// Sección 15-16: asistencia por persona (reunion_invitados) — complementa,
// sin reemplazar, la asistencia por núcleo que ya existía en la ficha.
export function AgregarInvitadoForm({ reunionId, usuarios }: { reunionId: number; usuarios: Opcion[] }) {
  const [estado, formAction] = useActionState(agregarInvitadoFormAction, ESTADO_INICIAL);
  const formRef = useRef<HTMLFormElement>(null);
  const { show } = useToast();

  useEffect(() => {
    if (estado.ok) {
      formRef.current?.reset();
      show("Invitado agregado.");
    }
    if (estado.error) show(estado.error, "error");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [estado]);

  return (
    <form ref={formRef} action={formAction} className="flex items-center gap-2 mt-2">
      <input type="hidden" name="reunion_id" value={reunionId} />
      <select name="user_id" required className={inputClass + " text-xs !py-1.5"} defaultValue="">
        <option value="" disabled>Invitar a…</option>
        {usuarios.map((u) => (
          <option key={u.id} value={u.id}>{u.nombre}</option>
        ))}
      </select>
      <SubmitButton variant="add" className="text-xs px-2.5 py-1.5 whitespace-nowrap">Invitar</SubmitButton>
    </form>
  );
}
