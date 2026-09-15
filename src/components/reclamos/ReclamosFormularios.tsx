"use client";

// Fase 4 del rediseño: el formulario "Reportar un problema" de /reclamos
// migrado a `useActionState` — mismo criterio que los demás módulos.
// `tomarReclamoAction`/`resolverReclamoAction`/`reabrirReclamoAction` quedan
// sin tocar: son cambios de estado por fila (tomar, marcar resuelto,
// reabrir), no un alta con un conjunto de campos que valga la pena migrar —
// mismo criterio que `registrarAsistenciaAction` en Reuniones.

import { useActionState, useEffect, useRef } from "react";
import { crearReclamoFormAction } from "@/lib/actions/reclamos";
import { ESTADO_INICIAL } from "@/lib/actionState";
import { FieldError, FormError, SubmitButton, useToast } from "@/components/ui-client";
import { Card, Label, inputClass } from "@/components/ui";
import { CATEGORIA_RECLAMO_LABEL, PRIORIDAD_RECLAMO_LABEL } from "@/lib/constants";

type Vivienda = { id: number; numero: string };

export function ReportarReclamoForm({ viviendas }: { viviendas: Vivienda[] }) {
  const [estado, formAction] = useActionState(crearReclamoFormAction, ESTADO_INICIAL);
  const formRef = useRef<HTMLFormElement>(null);
  const detailsRef = useRef<HTMLDetailsElement>(null);
  const { show } = useToast();

  useEffect(() => {
    if (estado.ok) {
      formRef.current?.reset();
      if (detailsRef.current) detailsRef.current.open = false;
      show("Problema reportado.");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [estado]);

  return (
    <details ref={detailsRef} className="mb-8">
      <summary className="cursor-pointer text-sm font-semibold text-[var(--color-brand-800)]">+ Reportar un problema</summary>
      <Card className="mt-3">
        <form ref={formRef} action={formAction} className="grid grid-cols-1 sm:grid-cols-2 gap-3" encType="multipart/form-data">
          <div className="sm:col-span-2">
            <Label>¿Cuál es el problema?</Label>
            <input name="titulo" required className={inputClass} placeholder="ej: Filtración en el techo del pasillo" />
            <FieldError message={estado.fieldErrors?.titulo} />
          </div>
          <div>
            <Label>Categoría</Label>
            <select name="categoria" className={inputClass} defaultValue="otros">
              {Object.entries(CATEGORIA_RECLAMO_LABEL).map(([valor, label]) => (
                <option key={valor} value={valor}>{label}</option>
              ))}
            </select>
          </div>
          <div>
            <Label>Vivienda (opcional — dejalo vacío si es un espacio común)</Label>
            <select name="vivienda_id" className={inputClass} defaultValue="">
              <option value="">Espacio común</option>
              {viviendas.map((v) => (
                <option key={v.id} value={v.id}>{v.numero}</option>
              ))}
            </select>
          </div>
          <div>
            <Label>Prioridad</Label>
            <select name="prioridad" className={inputClass} defaultValue="media">
              {Object.entries(PRIORIDAD_RECLAMO_LABEL).map(([valor, label]) => (
                <option key={valor} value={valor}>{label}</option>
              ))}
            </select>
          </div>
          <div className="sm:col-span-2">
            <Label>Descripción</Label>
            <textarea name="descripcion" className={inputClass} rows={2} />
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
            <SubmitButton pendingLabel="Reportando…">Reportar</SubmitButton>
          </div>
        </form>
      </Card>
    </details>
  );
}
