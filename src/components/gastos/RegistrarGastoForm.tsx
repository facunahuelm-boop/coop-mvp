"use client";

// Fase 4 del rediseño: el formulario "Registrar gasto" de /gastos migrado a
// `useActionState` — mismo criterio que los demás módulos.
// `marcarGastoPagadoAction`/`anularGastoAction` quedan sin tocar (cambios de
// estado sobre un gasto ya cargado, no altas).

import { useActionState, useEffect, useRef } from "react";
import dayjs from "dayjs";
import { crearGastoFormAction } from "@/lib/actions/gastos";
import { ESTADO_INICIAL } from "@/lib/actionState";
import { FieldError, FormError, SubmitButton, useToast } from "@/components/ui-client";
import { Card, Label, inputClass } from "@/components/ui";
import { CATEGORIA_COMPRA_LABEL } from "@/lib/constants";

type Opcion = { id: number; nombre: string };

export function RegistrarGastoForm({
  comisiones,
  proveedores,
}: {
  comisiones: Opcion[];
  proveedores: Opcion[];
}) {
  const [estado, formAction] = useActionState(crearGastoFormAction, ESTADO_INICIAL);
  const formRef = useRef<HTMLFormElement>(null);
  const detailsRef = useRef<HTMLDetailsElement>(null);
  const { show } = useToast();

  useEffect(() => {
    if (estado.ok) {
      formRef.current?.reset();
      if (detailsRef.current) detailsRef.current.open = false;
      show("Gasto registrado.");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [estado]);

  return (
    <details ref={detailsRef} className="mt-2">
      <summary className="cursor-pointer text-sm font-semibold text-[var(--color-brand-800)]">+ Registrar gasto</summary>
      <Card className="mt-3">
        <form ref={formRef} action={formAction} className="grid grid-cols-1 sm:grid-cols-2 gap-3" encType="multipart/form-data">
          <div>
            <Label>Comisión</Label>
            <select name="comision_id" required className={inputClass} defaultValue="">
              <option value="" disabled>— elegir —</option>
              {comisiones.map((c) => (
                <option key={c.id} value={c.id}>{c.nombre}</option>
              ))}
            </select>
            <FieldError message={estado.fieldErrors?.comision_id} />
          </div>
          <div>
            <Label>Descripción</Label>
            <input name="descripcion" required className={inputClass} />
            <FieldError message={estado.fieldErrors?.descripcion} />
          </div>
          <div>
            <Label>Categoría</Label>
            <select name="categoria" className={inputClass} defaultValue="otros">
              {Object.entries(CATEGORIA_COMPRA_LABEL).map(([v, l]) => (
                <option key={v} value={v}>{l}</option>
              ))}
            </select>
          </div>
          <div>
            <Label>Fecha</Label>
            <input type="date" name="fecha" required defaultValue={dayjs().format("YYYY-MM-DD")} className={inputClass} />
            <FieldError message={estado.fieldErrors?.fecha} />
          </div>
          <div>
            <Label>Importe</Label>
            <input type="number" step="0.01" name="importe" required className={inputClass} />
            <FieldError message={estado.fieldErrors?.importe} />
          </div>
          <div>
            <Label>Forma de pago</Label>
            <input name="forma_pago" className={inputClass} placeholder="efectivo, transferencia…" />
            <FieldError message={estado.fieldErrors?.forma_pago} />
          </div>
          <div>
            <Label>Proveedor existente</Label>
            <select name="proveedor_id" className={inputClass} defaultValue="">
              <option value="">— sin proveedor —</option>
              {proveedores.map((p) => (
                <option key={p.id} value={p.id}>{p.nombre}</option>
              ))}
            </select>
          </div>
          <div>
            <Label>...o proveedor nuevo</Label>
            <input name="nuevo_proveedor" className={inputClass} placeholder="Nombre del proveedor" />
          </div>
          <div>
            <Label>Estado</Label>
            <select name="estado" className={inputClass} defaultValue="pendiente">
              <option value="pendiente">Pendiente</option>
              <option value="pagado">Ya está pagado</option>
            </select>
          </div>
          <div>
            <Label>Comprobante (opcional)</Label>
            <input type="file" name="comprobante" className="text-xs" />
          </div>
          <div className="sm:col-span-2">
            <Label>Observaciones</Label>
            <input name="observaciones" className={inputClass} />
            <FieldError message={estado.fieldErrors?.observaciones} />
          </div>
          <div className="sm:col-span-2">
            <FormError message={estado.error} />
          </div>
          <div className="sm:col-span-2">
            <SubmitButton pendingLabel="Registrando…">Registrar gasto</SubmitButton>
          </div>
        </form>
      </Card>
    </details>
  );
}
