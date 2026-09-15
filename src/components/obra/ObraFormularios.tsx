"use client";

// Fase 4 del rediseño: los 3 formularios de Obra (crear tarea, agregar
// avance, registrar problema) migrados a `useActionState` — mismo criterio
// que los demás módulos. `cambiarEstadoTareaAction`/`resolverProblemaAction`
// quedan sin tocar (cambios de estado, no altas con campos a validar).

import { useActionState, useEffect, useRef } from "react";
import { crearTareaFormAction, agregarAvanceFormAction, agregarProblemaFormAction } from "@/lib/actions/obra";
import { ESTADO_INICIAL } from "@/lib/actionState";
import { FieldError, FormError, SubmitButton, useToast } from "@/components/ui-client";
import { AddButtonSummary, Card, Label, inputClass } from "@/components/ui";

export function CrearTareaObraForm() {
  const [estado, formAction] = useActionState(crearTareaFormAction, ESTADO_INICIAL);
  const formRef = useRef<HTMLFormElement>(null);
  const detailsRef = useRef<HTMLDetailsElement>(null);
  const { show } = useToast();

  useEffect(() => {
    if (estado.ok) {
      formRef.current?.reset();
      if (detailsRef.current) detailsRef.current.open = false;
      show("Tarea agregada.");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [estado]);

  return (
    <details ref={detailsRef} className="mt-6">
      <AddButtonSummary>Agregar tarea</AddButtonSummary>
      <Card className="mt-3">
        <form ref={formRef} action={formAction} className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <Label>Etapa</Label>
            <input name="etapa" required className={inputClass} placeholder="Ej: Estructura" />
            <FieldError message={estado.fieldErrors?.etapa} />
          </div>
          <div>
            <Label>Nombre de la tarea</Label>
            <input name="nombre" required className={inputClass} />
            <FieldError message={estado.fieldErrors?.nombre} />
          </div>
          <div className="sm:col-span-2">
            <Label>Descripción</Label>
            <textarea name="descripcion" className={inputClass} rows={2} />
            <FieldError message={estado.fieldErrors?.descripcion} />
          </div>
          <div>
            <Label>Fecha de inicio</Label>
            <input type="date" name="fecha_inicio" className={inputClass} />
            <FieldError message={estado.fieldErrors?.fecha_inicio} />
          </div>
          <div>
            <Label>Fecha fin prevista</Label>
            <input type="date" name="fecha_fin_prevista" className={inputClass} />
            <FieldError message={estado.fieldErrors?.fecha_fin_prevista} />
          </div>
          <div>
            <Label>Prioridad</Label>
            <select name="prioridad" className={inputClass} defaultValue="media">
              <option value="baja">Baja</option>
              <option value="media">Media</option>
              <option value="alta">Alta</option>
              <option value="critica">Crítica</option>
            </select>
          </div>
          <div className="sm:col-span-2">
            <FormError message={estado.error} />
          </div>
          <div className="sm:col-span-2">
            <SubmitButton variant="add" pendingLabel="Agregando…">Crear tarea</SubmitButton>
          </div>
        </form>
      </Card>
    </details>
  );
}

export function AgregarAvanceForm({ tareaId }: { tareaId: number }) {
  const [estado, formAction] = useActionState(agregarAvanceFormAction, ESTADO_INICIAL);
  const formRef = useRef<HTMLFormElement>(null);
  const { show } = useToast();

  useEffect(() => {
    if (estado.ok) {
      formRef.current?.reset();
      show("Avance agregado.");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [estado]);

  return (
    <form ref={formRef} action={formAction} className="space-y-2">
      <input type="hidden" name="tarea_id" value={tareaId} />
      <div>
        <textarea name="descripcion" required placeholder="Describí el avance…" className={inputClass} rows={2} />
        <FieldError message={estado.fieldErrors?.descripcion} />
      </div>
      <input type="file" name="foto" accept="image/*" className="text-xs" />
      <FormError message={estado.error} />
      <SubmitButton variant="add" className="text-xs px-3 py-2" pendingLabel="Agregando…">Agregar avance</SubmitButton>
    </form>
  );
}

export function AgregarProblemaForm({ tareaId }: { tareaId: number }) {
  const [estado, formAction] = useActionState(agregarProblemaFormAction, ESTADO_INICIAL);
  const formRef = useRef<HTMLFormElement>(null);
  const { show } = useToast();

  useEffect(() => {
    if (estado.ok) {
      formRef.current?.reset();
      show("Problema registrado.");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [estado]);

  return (
    <form ref={formRef} action={formAction} className="space-y-2">
      <input type="hidden" name="tarea_id" value={tareaId} />
      <div>
        <input name="titulo" required placeholder="Título del problema" className={inputClass} />
        <FieldError message={estado.fieldErrors?.titulo} />
      </div>
      <div>
        <textarea name="descripcion" placeholder="Descripción" className={inputClass} rows={2} />
        <FieldError message={estado.fieldErrors?.descripcion} />
      </div>
      <select name="severidad" className={inputClass} defaultValue="media">
        <option value="baja">Baja</option>
        <option value="media">Media</option>
        <option value="critica">Crítica</option>
      </select>
      <FormError message={estado.error} />
      <SubmitButton variant="add" className="text-xs px-3 py-2" pendingLabel="Registrando…">Registrar problema</SubmitButton>
    </form>
  );
}
