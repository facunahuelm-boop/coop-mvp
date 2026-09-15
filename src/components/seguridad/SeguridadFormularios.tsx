"use client";

// Fase 4 del rediseño: los 3 formularios de /seguridad (cargar documento,
// registrar incidente/observación, nueva inspección) migrados a
// `useActionState` — mismo criterio que los demás módulos.
// `resolverIncidenteAction` queda sin tocar (cambio de estado).

import { useActionState, useEffect, useRef } from "react";
import {
  crearDocumentoSeguridadFormAction,
  crearIncidenteFormAction,
  crearInspeccionFormAction,
} from "@/lib/actions/seguridad";
import { ESTADO_INICIAL } from "@/lib/actionState";
import { FieldError, FormError, SubmitButton, useToast } from "@/components/ui-client";
import { AddButtonSummary, Card, Label, inputClass } from "@/components/ui";

export function CargarDocumentoSeguridadForm() {
  const [estado, formAction] = useActionState(crearDocumentoSeguridadFormAction, ESTADO_INICIAL);
  const formRef = useRef<HTMLFormElement>(null);
  const detailsRef = useRef<HTMLDetailsElement>(null);
  const { show } = useToast();

  useEffect(() => {
    if (estado.ok) {
      formRef.current?.reset();
      if (detailsRef.current) detailsRef.current.open = false;
      show("Documento cargado.");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [estado]);

  return (
    <details ref={detailsRef} className="mb-8">
      <AddButtonSummary>Cargar documento</AddButtonSummary>
      <Card className="mt-3">
        <form ref={formRef} action={formAction} className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div>
            <Label>Tipo de documento</Label>
            <input name="tipo" required className={inputClass} />
            <FieldError message={estado.fieldErrors?.tipo} />
          </div>
          <div>
            <Label>Descripción</Label>
            <input name="descripcion" className={inputClass} />
            <FieldError message={estado.fieldErrors?.descripcion} />
          </div>
          <div>
            <Label>Fecha de vencimiento</Label>
            <input type="date" name="fecha_vencimiento" className={inputClass} />
            <FieldError message={estado.fieldErrors?.fecha_vencimiento} />
          </div>
          <div className="sm:col-span-3">
            <FormError message={estado.error} />
          </div>
          <div className="sm:col-span-3">
            <SubmitButton variant="add" pendingLabel="Guardando…">Guardar</SubmitButton>
          </div>
        </form>
      </Card>
    </details>
  );
}

export function RegistrarIncidenteForm() {
  const [estado, formAction] = useActionState(crearIncidenteFormAction, ESTADO_INICIAL);
  const formRef = useRef<HTMLFormElement>(null);
  const detailsRef = useRef<HTMLDetailsElement>(null);
  const { show } = useToast();

  useEffect(() => {
    if (estado.ok) {
      formRef.current?.reset();
      if (detailsRef.current) detailsRef.current.open = false;
      show("Incidente registrado.");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [estado]);

  return (
    <details ref={detailsRef} className="mb-8">
      <AddButtonSummary>Registrar incidente / observación</AddButtonSummary>
      <Card className="mt-3">
        <form ref={formRef} action={formAction} className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <Label>Tipo</Label>
            <select name="tipo" className={inputClass} defaultValue="observacion">
              <option value="observacion">Observación</option>
              <option value="incidente">Incidente</option>
              <option value="accidente">Accidente</option>
            </select>
          </div>
          <div>
            <Label>Severidad</Label>
            <select name="severidad" className={inputClass} defaultValue="media">
              <option value="baja">Baja</option>
              <option value="media">Media</option>
              <option value="critica">Crítica</option>
            </select>
          </div>
          <div className="sm:col-span-2">
            <Label>Descripción</Label>
            <textarea name="descripcion" required className={inputClass} rows={2} />
            <FieldError message={estado.fieldErrors?.descripcion} />
          </div>
          <div className="sm:col-span-2">
            <Label>Foto (opcional)</Label>
            <input type="file" name="foto" accept="image/*" className="text-xs" />
          </div>
          <div className="sm:col-span-2">
            <FormError message={estado.error} />
          </div>
          <div className="sm:col-span-2">
            <SubmitButton variant="add" pendingLabel="Registrando…">Registrar</SubmitButton>
          </div>
        </form>
      </Card>
    </details>
  );
}

export function NuevaInspeccionForm({ checklistBase }: { checklistBase: readonly string[] }) {
  const [estado, formAction] = useActionState(crearInspeccionFormAction, ESTADO_INICIAL);
  const formRef = useRef<HTMLFormElement>(null);
  const detailsRef = useRef<HTMLDetailsElement>(null);
  const { show } = useToast();

  useEffect(() => {
    if (estado.ok) {
      formRef.current?.reset();
      if (detailsRef.current) detailsRef.current.open = false;
      show("Inspección guardada.");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [estado]);

  return (
    <details ref={detailsRef}>
      <AddButtonSummary>Nueva inspección</AddButtonSummary>
      <Card className="mt-3">
        <form ref={formRef} action={formAction} className="space-y-2">
          {checklistBase.map((item, i) => (
            <label key={i} className="flex items-center gap-2 text-sm">
              <input type="checkbox" name={`item_${i}`} defaultChecked /> {item}
            </label>
          ))}
          <div>
            <Label>Hallazgos</Label>
            <textarea name="hallazgos" className={inputClass} rows={2} />
            <FieldError message={estado.fieldErrors?.hallazgos} />
          </div>
          <FormError message={estado.error} />
          <SubmitButton variant="add" pendingLabel="Guardando…">Guardar inspección</SubmitButton>
        </form>
      </Card>
    </details>
  );
}
