"use client";

// Fase 4 del rediseño: los 2 formularios de /finanzas (agregar compromiso
// futuro, registrar movimiento) migrados a `useActionState` — mismo criterio
// que los demás módulos. Ya usaban `AddButtonSummary`/`SubmitButton
// variant="add"` desde la Fase 3; acá se suma la validación por campo.

import { useActionState, useEffect, useRef } from "react";
import { agregarCompromisoFormAction, registrarMovimientoFormAction } from "@/lib/actions/finanzas";
import { ESTADO_INICIAL } from "@/lib/actionState";
import { FieldError, FormError, SubmitButton, useToast } from "@/components/ui-client";
import { AddButtonSummary, Card, Label, inputClass } from "@/components/ui";

export function AgregarCompromisoForm() {
  const [estado, formAction] = useActionState(agregarCompromisoFormAction, ESTADO_INICIAL);
  const formRef = useRef<HTMLFormElement>(null);
  const detailsRef = useRef<HTMLDetailsElement>(null);
  const { show } = useToast();

  useEffect(() => {
    if (estado.ok) {
      formRef.current?.reset();
      if (detailsRef.current) detailsRef.current.open = false;
      show("Compromiso agregado.");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [estado]);

  return (
    <details ref={detailsRef} className="mb-8">
      <AddButtonSummary>Agregar compromiso futuro</AddButtonSummary>
      <Card className="mt-3">
        <form ref={formRef} action={formAction} className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div className="sm:col-span-2">
            <Label>Descripción</Label>
            <input name="descripcion" required className={inputClass} />
            <FieldError message={estado.fieldErrors?.descripcion} />
          </div>
          <div>
            <Label>Monto</Label>
            <input name="monto" type="number" required className={inputClass} />
            <FieldError message={estado.fieldErrors?.monto} />
          </div>
          <div>
            <Label>Fecha estimada</Label>
            <input type="date" name="fecha_estimada" required className={inputClass} />
            <FieldError message={estado.fieldErrors?.fecha_estimada} />
          </div>
          <div>
            <Label>Origen</Label>
            <input name="origen" className={inputClass} />
            <FieldError message={estado.fieldErrors?.origen} />
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

export function RegistrarMovimientoForm() {
  const [estado, formAction] = useActionState(registrarMovimientoFormAction, ESTADO_INICIAL);
  const formRef = useRef<HTMLFormElement>(null);
  const detailsRef = useRef<HTMLDetailsElement>(null);
  const { show } = useToast();

  useEffect(() => {
    if (estado.ok) {
      formRef.current?.reset();
      if (detailsRef.current) detailsRef.current.open = false;
      show("Movimiento registrado.");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [estado]);

  return (
    <details ref={detailsRef} className="mt-4">
      <AddButtonSummary>Registrar movimiento</AddButtonSummary>
      <Card className="mt-3">
        <form ref={formRef} action={formAction} className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <Label>Tipo</Label>
            <select name="tipo" className={inputClass} defaultValue="egreso">
              <option value="ingreso">Ingreso</option>
              <option value="egreso">Egreso</option>
            </select>
          </div>
          <div>
            <Label>Monto</Label>
            <input name="monto" type="number" required className={inputClass} />
            <FieldError message={estado.fieldErrors?.monto} />
          </div>
          <div>
            <Label>Categoría</Label>
            <input name="categoria" required className={inputClass} placeholder="Estructura, Administración…" />
            <FieldError message={estado.fieldErrors?.categoria} />
          </div>
          <div>
            <Label>Descripción</Label>
            <input name="descripcion" className={inputClass} />
            <FieldError message={estado.fieldErrors?.descripcion} />
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
