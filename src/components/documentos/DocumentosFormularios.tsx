"use client";

// Fase 4 del rediseño: los 2 formularios de /documentos (subir documento,
// crear categoría nueva) migrados a `useActionState` — mismo criterio que
// los demás módulos.

import { useActionState, useEffect, useRef } from "react";
import { subirDocumentoFormAction, crearCategoriaDocumentoFormAction } from "@/lib/actions/documentos";
import { ESTADO_INICIAL } from "@/lib/actionState";
import { FieldError, FormError, SubmitButton, useToast } from "@/components/ui-client";
import { AddButtonSummary, Card, Label, inputClass } from "@/components/ui";

export function SubirDocumentoForm({ categorias, catLabel }: { categorias: string[]; catLabel: Record<string, string> }) {
  const [estado, formAction] = useActionState(subirDocumentoFormAction, ESTADO_INICIAL);
  const formRef = useRef<HTMLFormElement>(null);
  const detailsRef = useRef<HTMLDetailsElement>(null);
  const { show } = useToast();

  useEffect(() => {
    if (estado.ok) {
      formRef.current?.reset();
      if (detailsRef.current) detailsRef.current.open = false;
      show("Documento subido.");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [estado]);

  return (
    <details ref={detailsRef} className="mt-6">
      <AddButtonSummary>Subir documento</AddButtonSummary>
      <Card className="mt-3">
        <form ref={formRef} action={formAction} className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <Label>Nombre</Label>
            <input name="nombre" required className={inputClass} />
            <FieldError message={estado.fieldErrors?.nombre} />
          </div>
          <div>
            <Label>Categoría</Label>
            <select name="categoria" className={inputClass} defaultValue="informes">
              {categorias.map((c) => (
                <option key={c} value={c}>{catLabel[c]}</option>
              ))}
            </select>
          </div>
          <div className="sm:col-span-2">
            <Label>Descripción</Label>
            <input name="descripcion" className={inputClass} />
            <FieldError message={estado.fieldErrors?.descripcion} />
          </div>
          <div className="sm:col-span-2">
            <Label>Etiquetas (opcional)</Label>
            <input name="etiquetas" placeholder="separadas por coma, ej: obra-etapa-2, urgente" className={inputClass} />
          </div>
          <div className="sm:col-span-2">
            <Label>Archivo</Label>
            <input type="file" name="archivo" className="text-xs" />
          </div>
          <div className="sm:col-span-2">
            <FormError message={estado.error} />
          </div>
          <div className="sm:col-span-2">
            <SubmitButton variant="add" pendingLabel="Subiendo…">Subir</SubmitButton>
          </div>
        </form>
      </Card>
    </details>
  );
}

export function CrearCategoriaDocumentoForm() {
  const [estado, formAction] = useActionState(crearCategoriaDocumentoFormAction, ESTADO_INICIAL);
  const formRef = useRef<HTMLFormElement>(null);
  const detailsRef = useRef<HTMLDetailsElement>(null);
  const { show } = useToast();

  useEffect(() => {
    if (estado.ok) {
      formRef.current?.reset();
      if (detailsRef.current) detailsRef.current.open = false;
      show("Categoría creada.");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [estado]);

  return (
    <details ref={detailsRef} className="mt-3">
      <AddButtonSummary className="text-xs px-3 py-1.5">Crear una categoría nueva</AddButtonSummary>
      <Card className="mt-3">
        <form ref={formRef} action={formAction} className="flex items-end gap-2">
          <div className="flex-1">
            <Label>Nombre de la categoría</Label>
            <input name="nombre" required placeholder="ej: Estatuto, RRHH" className={inputClass} />
            <FieldError message={estado.fieldErrors?.nombre} />
          </div>
          <SubmitButton variant="add" className="text-xs px-3 py-2" pendingLabel="Creando…">Crear</SubmitButton>
        </form>
        <FormError message={estado.error} />
      </Card>
    </details>
  );
}
