"use client";

// Fase 4 del rediseño: los 2 formularios de alta de Compras (nueva solicitud,
// cargar presupuesto) migrados a `useActionState` — mismo criterio que los
// demás módulos. Las acciones de decisión (marcar pedida/entregada, rechazar,
// decidir compra) quedan sin tocar, mismo criterio que en Obra/Seguridad.

import { useActionState, useEffect, useRef } from "react";
import { crearSolicitudFormAction, agregarPresupuestoFormAction } from "@/lib/actions/compras";
import { ESTADO_INICIAL } from "@/lib/actionState";
import { FieldError, FormError, SubmitButton, useToast } from "@/components/ui-client";
import { AddButtonSummary, Card, Label, inputClass } from "@/components/ui";
import { CATEGORIA_COMPRA_LABEL } from "@/lib/constants";

type Opcion = { id: number; nombre: string };

export function CrearSolicitudForm({ comisiones }: { comisiones: Opcion[] }) {
  const [estado, formAction] = useActionState(crearSolicitudFormAction, ESTADO_INICIAL);
  const formRef = useRef<HTMLFormElement>(null);
  const detailsRef = useRef<HTMLDetailsElement>(null);
  const { show } = useToast();

  useEffect(() => {
    if (estado.ok) {
      formRef.current?.reset();
      if (detailsRef.current) detailsRef.current.open = false;
      show("Solicitud creada.");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [estado]);

  return (
    <details ref={detailsRef} className="mt-6">
      <AddButtonSummary>Nueva solicitud de compra</AddButtonSummary>
      <Card className="mt-3">
        <form ref={formRef} action={formAction} className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <Label>Categoría de la compra</Label>
            <select name="categoria" className={inputClass} defaultValue="obra">
              {Object.entries(CATEGORIA_COMPRA_LABEL).map(([valor, label]) => (
                <option key={valor} value={valor}>{label}</option>
              ))}
            </select>
          </div>
          <div>
            <Label>Subcategoría (opcional)</Label>
            <input name="subcategoria" className={inputClass} placeholder="Ej: cemento, guantes, extintores…" />
            <FieldError message={estado.fieldErrors?.subcategoria} />
          </div>
          <div>
            <Label>Comisión solicitante</Label>
            <input name="comision" required className={inputClass} placeholder="Comisión de Obra" />
            <FieldError message={estado.fieldErrors?.comision} />
          </div>
          <div>
            <Label>Vincular a una comisión real (opcional)</Label>
            <select name="comision_id" className={inputClass} defaultValue="">
              <option value="">— sin vincular —</option>
              {comisiones.map((c) => (
                <option key={c.id} value={c.id}>{c.nombre}</option>
              ))}
            </select>
            <p className="text-[11px] text-ink-faint mt-1">Vinculada, la compra suma al gasto de esa comisión en /gastos cuando se apruebe.</p>
          </div>
          <div>
            <Label>Material</Label>
            <input name="material" required className={inputClass} />
            <FieldError message={estado.fieldErrors?.material} />
          </div>
          <div>
            <Label>Cantidad</Label>
            <input name="cantidad" type="number" step="0.01" required className={inputClass} />
            <FieldError message={estado.fieldErrors?.cantidad} />
          </div>
          <div>
            <Label>Unidad</Label>
            <input name="unidad" required className={inputClass} placeholder="kg, unidad, m2…" />
            <FieldError message={estado.fieldErrors?.unidad} />
          </div>
          <div className="sm:col-span-2">
            <Label>Especificación</Label>
            <input name="especificacion" className={inputClass} />
            <FieldError message={estado.fieldErrors?.especificacion} />
          </div>
          <div>
            <Label>Etapa de obra (si corresponde)</Label>
            <input name="etapa_obra" className={inputClass} />
            <FieldError message={estado.fieldErrors?.etapa_obra} />
          </div>
          <div>
            <Label>Fecha necesaria</Label>
            <input type="date" name="fecha_necesaria" className={inputClass} />
            <FieldError message={estado.fieldErrors?.fecha_necesaria} />
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
          <div>
            <Label>Presupuesto estimado</Label>
            <input name="presupuesto_estimado" type="number" className={inputClass} />
            <FieldError message={estado.fieldErrors?.presupuesto_estimado} />
          </div>
          <div className="sm:col-span-2 flex items-center gap-2">
            <input id="recurrente" type="checkbox" name="recurrente" className="h-4 w-4" />
            <label htmlFor="recurrente" className="text-sm text-ink-muted">Esta compra se repite habitualmente (limpieza, papelería, mantenimiento…)</label>
          </div>
          <div className="sm:col-span-2">
            <FormError message={estado.error} />
          </div>
          <div className="sm:col-span-2">
            <SubmitButton variant="add" pendingLabel="Creando…">Crear solicitud</SubmitButton>
          </div>
        </form>
      </Card>
    </details>
  );
}

export function CargarPresupuestoForm({ solicitudId, proveedores, abiertoPorDefecto }: { solicitudId: number; proveedores: Opcion[]; abiertoPorDefecto: boolean }) {
  const [estado, formAction] = useActionState(agregarPresupuestoFormAction, ESTADO_INICIAL);
  const formRef = useRef<HTMLFormElement>(null);
  const detailsRef = useRef<HTMLDetailsElement>(null);
  const { show } = useToast();

  useEffect(() => {
    if (estado.ok) {
      formRef.current?.reset();
      if (detailsRef.current) detailsRef.current.open = false;
      show("Presupuesto cargado.");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [estado]);

  return (
    <details ref={detailsRef} open={abiertoPorDefecto}>
      <summary className="cursor-pointer text-sm font-semibold text-[var(--color-brand-800)]">+ Cargar presupuesto</summary>
      <Card className="mt-3">
        <form ref={formRef} action={formAction} className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <input type="hidden" name="solicitud_id" value={solicitudId} />
          <div>
            <Label>Proveedor existente</Label>
            <select name="proveedor_id" className={inputClass} defaultValue="">
              <option value="">— elegir —</option>
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
            <Label>Precio</Label>
            <input name="precio" type="number" step="0.01" required className={inputClass} />
            <FieldError message={estado.fieldErrors?.precio} />
          </div>
          <div>
            <Label>Precio unitario</Label>
            <input name="precio_unitario" type="number" step="0.01" className={inputClass} />
            <FieldError message={estado.fieldErrors?.precio_unitario} />
          </div>
          <div>
            <Label>Costo de envío</Label>
            <input name="costo_envio" type="number" step="0.01" className={inputClass} />
            <FieldError message={estado.fieldErrors?.costo_envio} />
          </div>
          <div>
            <Label>Plazo de entrega (días)</Label>
            <input name="plazo_entrega_dias" type="number" className={inputClass} />
            <FieldError message={estado.fieldErrors?.plazo_entrega_dias} />
          </div>
          <div>
            <Label>Forma de pago</Label>
            <input name="forma_pago" className={inputClass} placeholder="contado, 30 días…" />
            <FieldError message={estado.fieldErrors?.forma_pago} />
          </div>
          <div>
            <Label>Garantía</Label>
            <input name="garantia" className={inputClass} />
            <FieldError message={estado.fieldErrors?.garantia} />
          </div>
          <div className="sm:col-span-2">
            <Label>Condiciones (calidad, entrega, etc.)</Label>
            <input name="condiciones" className={inputClass} placeholder="Ej: material de primera calidad, entrega en obra incluida" />
            <FieldError message={estado.fieldErrors?.condiciones} />
          </div>
          <div className="sm:col-span-2">
            <Label>Notas</Label>
            <input name="notas" className={inputClass} />
            <FieldError message={estado.fieldErrors?.notas} />
          </div>
          <div className="sm:col-span-2">
            <FormError message={estado.error} />
          </div>
          <div className="sm:col-span-2">
            <SubmitButton pendingLabel="Guardando…">Guardar presupuesto</SubmitButton>
          </div>
        </form>
      </Card>
    </details>
  );
}
