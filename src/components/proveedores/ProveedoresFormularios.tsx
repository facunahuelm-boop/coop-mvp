"use client";

// Fase 4 del rediseño: los 2 formularios de datos de Proveedores (alta desde
// /proveedores, edición de ficha desde /proveedores/[id]) migrados a
// `useActionState` — mismo criterio que SociosFormularios.tsx.

import { useActionState, useEffect, useRef } from "react";
import { crearProveedorFormAction, actualizarProveedorFormAction } from "@/lib/actions/proveedores";
import { ESTADO_INICIAL } from "@/lib/actionState";
import { FieldError, FormError, SubmitButton, useToast } from "@/components/ui-client";
import { AddButtonSummary, Label, inputClass } from "@/components/ui";
import { ESTADO_PROVEEDOR, ESTADO_PROVEEDOR_LABEL, TIPO_PROVEEDOR, TIPO_PROVEEDOR_LABEL } from "@/lib/constants";

export function CrearProveedorForm() {
  const [estado, formAction] = useActionState(crearProveedorFormAction, ESTADO_INICIAL);
  const formRef = useRef<HTMLFormElement>(null);
  const detailsRef = useRef<HTMLDetailsElement>(null);
  const { show } = useToast();

  useEffect(() => {
    if (estado.ok) {
      formRef.current?.reset();
      if (detailsRef.current) detailsRef.current.open = false;
      show("Proveedor agregado.");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [estado]);

  return (
    <details ref={detailsRef} className="mt-4">
      <AddButtonSummary>Agregar proveedor</AddButtonSummary>
      <form ref={formRef} action={formAction} className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div>
          <Label>Nombre / razón social</Label>
          <input name="nombre" required className={inputClass} />
          <FieldError message={estado.fieldErrors?.nombre} />
        </div>
        <div>
          <Label>RUT</Label>
          <input name="rut" className={inputClass} />
          <FieldError message={estado.fieldErrors?.rut} />
        </div>
        <div>
          <Label>Rubro</Label>
          <input name="rubro" placeholder="Materiales, ferretería, electricidad…" className={inputClass} />
          <FieldError message={estado.fieldErrors?.rubro} />
        </div>
        <div>
          <Label>Tipo</Label>
          <select name="tipo" className={inputClass} defaultValue="empresa">
            {Object.entries(TIPO_PROVEEDOR_LABEL).map(([v, l]) => (
              <option key={v} value={v}>{l}</option>
            ))}
          </select>
        </div>
        <div>
          <Label>Teléfono</Label>
          <input name="telefono" className={inputClass} />
          <FieldError message={estado.fieldErrors?.telefono} />
        </div>
        <div>
          <Label>Email</Label>
          <input type="email" name="email" className={inputClass} />
          <FieldError message={estado.fieldErrors?.email} />
        </div>
        <div>
          <Label>Dirección</Label>
          <input name="direccion" className={inputClass} />
          <FieldError message={estado.fieldErrors?.direccion} />
        </div>
        <div>
          <Label>Persona de contacto</Label>
          <input name="persona_contacto" className={inputClass} />
          <FieldError message={estado.fieldErrors?.persona_contacto} />
        </div>
        <div>
          <Label>Estado</Label>
          <select name="estado" className={inputClass} defaultValue="nuevo">
            {ESTADO_PROVEEDOR.map((e) => (
              <option key={e} value={e}>{ESTADO_PROVEEDOR_LABEL[e]}</option>
            ))}
          </select>
        </div>
        <div>
          <Label>Contacto (libre)</Label>
          <input name="contacto" placeholder="Teléfono o email, si no encaja arriba" className={inputClass} />
          <FieldError message={estado.fieldErrors?.contacto} />
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
          <SubmitButton variant="add" pendingLabel="Agregando…">Agregar proveedor</SubmitButton>
        </div>
      </form>
    </details>
  );
}

type Proveedor = {
  id: number;
  rut?: string | null;
  rubro?: string | null;
  tipo?: string | null;
  estado?: string | null;
  telefono?: string | null;
  email?: string | null;
  direccion?: string | null;
  persona_contacto?: string | null;
  contacto?: string | null;
  notas?: string | null;
};

export function ActualizarProveedorForm({ proveedor: p }: { proveedor: Proveedor }) {
  const [estado, formAction] = useActionState(actualizarProveedorFormAction, ESTADO_INICIAL);
  const detailsRef = useRef<HTMLDetailsElement>(null);
  const { show } = useToast();

  useEffect(() => {
    if (estado.ok) {
      if (detailsRef.current) detailsRef.current.open = false;
      show("Ficha actualizada.");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [estado]);

  return (
    <details ref={detailsRef} className="mt-4">
      <summary className="cursor-pointer text-xs font-semibold text-[var(--color-brand-800)]">Editar ficha</summary>
      <form action={formAction} className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-3">
        <input type="hidden" name="id" value={p.id} />
        <div>
          <Label>RUT</Label>
          <input name="rut" defaultValue={p.rut || ""} className={inputClass} />
          <FieldError message={estado.fieldErrors?.rut} />
        </div>
        <div>
          <Label>Rubro</Label>
          <input name="rubro" defaultValue={p.rubro || ""} className={inputClass} />
          <FieldError message={estado.fieldErrors?.rubro} />
        </div>
        <div>
          <Label>Tipo</Label>
          <select name="tipo" defaultValue={p.tipo || "empresa"} className={inputClass}>
            {TIPO_PROVEEDOR.map((t) => (
              <option key={t} value={t}>{TIPO_PROVEEDOR_LABEL[t]}</option>
            ))}
          </select>
        </div>
        <div>
          <Label>Estado</Label>
          <select name="estado" defaultValue={p.estado || "nuevo"} className={inputClass}>
            {ESTADO_PROVEEDOR.map((e) => (
              <option key={e} value={e}>{ESTADO_PROVEEDOR_LABEL[e]}</option>
            ))}
          </select>
        </div>
        <div>
          <Label>Teléfono</Label>
          <input name="telefono" defaultValue={p.telefono || ""} className={inputClass} />
          <FieldError message={estado.fieldErrors?.telefono} />
        </div>
        <div>
          <Label>Email</Label>
          <input type="email" name="email" defaultValue={p.email || ""} className={inputClass} />
          <FieldError message={estado.fieldErrors?.email} />
        </div>
        <div>
          <Label>Dirección</Label>
          <input name="direccion" defaultValue={p.direccion || ""} className={inputClass} />
          <FieldError message={estado.fieldErrors?.direccion} />
        </div>
        <div>
          <Label>Persona de contacto</Label>
          <input name="persona_contacto" defaultValue={p.persona_contacto || ""} className={inputClass} />
          <FieldError message={estado.fieldErrors?.persona_contacto} />
        </div>
        <div className="sm:col-span-2">
          <Label>Contacto (libre)</Label>
          <input name="contacto" defaultValue={p.contacto || ""} placeholder="Teléfono o email" className={inputClass} />
          <FieldError message={estado.fieldErrors?.contacto} />
        </div>
        <div className="sm:col-span-2">
          <Label>Notas</Label>
          <input name="notas" defaultValue={p.notas || ""} className={inputClass} />
          <FieldError message={estado.fieldErrors?.notas} />
        </div>
        <div className="sm:col-span-2">
          <FormError message={estado.error} />
        </div>
        <div className="sm:col-span-2">
          <SubmitButton pendingLabel="Guardando…">Guardar</SubmitButton>
        </div>
      </form>
    </details>
  );
}
