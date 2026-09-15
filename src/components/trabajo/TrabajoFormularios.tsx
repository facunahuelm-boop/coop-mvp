"use client";

// Fase 4 del rediseño: el formulario "Planificar nueva jornada" de /trabajo
// migrado a `useActionState` — mismo criterio que los demás módulos.
// `proponerDistribucionAction`, `confirmarAsignacionAction`, `anotarmeAction`
// y `marcarJornadaRealizadaAction` quedan sin tocar (botones de un solo clic,
// sin campos que valga la pena validar); `registrarAsistenciaAction`
// (en /trabajo/[id]) tampoco — mismo criterio que la asistencia de Reuniones,
// es un toggle por fila, no un alta.

import { useActionState, useEffect, useRef } from "react";
import { crearJornadaFormAction } from "@/lib/actions/trabajo";
import { ESTADO_INICIAL } from "@/lib/actionState";
import { FieldError, FormError, SubmitButton, useToast } from "@/components/ui-client";
import { AddButtonSummary, Card, Label, inputClass } from "@/components/ui";

export function PlanificarJornadaForm() {
  const [estado, formAction] = useActionState(crearJornadaFormAction, ESTADO_INICIAL);
  const formRef = useRef<HTMLFormElement>(null);
  const detailsRef = useRef<HTMLDetailsElement>(null);
  const { show } = useToast();

  useEffect(() => {
    if (estado.ok) {
      formRef.current?.reset();
      if (detailsRef.current) detailsRef.current.open = false;
      show("Jornada creada.");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [estado]);

  return (
    <details ref={detailsRef} className="mt-6">
      <AddButtonSummary>Planificar nueva jornada</AddButtonSummary>
      <Card className="mt-3">
        <form ref={formRef} action={formAction} className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <Label>Fecha</Label>
            <input type="date" name="fecha" required className={inputClass} />
            <FieldError message={estado.fieldErrors?.fecha} />
          </div>
          <div>
            <Label>Herramientas necesarias</Label>
            <input name="herramientas_necesarias" className={inputClass} />
            <FieldError message={estado.fieldErrors?.herramientas_necesarias} />
          </div>
          <div className="sm:col-span-2">
            <Label>Descripción</Label>
            <input name="descripcion" className={inputClass} />
            <FieldError message={estado.fieldErrors?.descripcion} />
          </div>
          <div className="sm:col-span-2">
            <Label>Tareas de la jornada (una por línea)</Label>
            <textarea name="tareas" className={inputClass} rows={3} placeholder={"Encofrado de columnas\nOrden y limpieza"} />
            <FieldError message={estado.fieldErrors?.tareas} />
          </div>
          <div className="sm:col-span-2">
            <FormError message={estado.error} />
          </div>
          <div className="sm:col-span-2">
            <SubmitButton variant="add" pendingLabel="Creando…">Crear jornada</SubmitButton>
          </div>
        </form>
      </Card>
    </details>
  );
}
