"use client";

// Fase 4 del rediseño (validaciones globales + feedback visual): los 3
// formularios de /comisiones (agregar integrante a una comisión, agregar
// tarea a una comisión, crear una comisión nueva) migrados a
// `useActionState` — mismo criterio que SociosFormularios.tsx /
// ProveedoresFormularios.tsx. "Agregar integrante" no vive dentro de un
// <details> en el diseño original (queda siempre visible junto a la lista de
// integrantes), así que ese formulario solo se resetea al guardar con éxito,
// sin colapsar nada.

import { useActionState, useEffect, useRef } from "react";
import {
  agregarMiembroFormAction,
  crearComisionFormAction,
} from "@/lib/actions/comisiones";
import { crearTareaFormAction } from "@/lib/actions/tareas";
import { ESTADO_INICIAL } from "@/lib/actionState";
import { FieldError, FormError, SubmitButton, useToast } from "@/components/ui-client";
import { AddButtonSummary, Card, Label, inputClass } from "@/components/ui";

type Usuario = { id: number; nombre: string };

export function AgregarMiembroForm({ comisionId, usuarios }: { comisionId: number; usuarios: Usuario[] }) {
  const [estado, formAction] = useActionState(agregarMiembroFormAction, ESTADO_INICIAL);
  const formRef = useRef<HTMLFormElement>(null);
  const { show } = useToast();

  useEffect(() => {
    if (estado.ok) {
      formRef.current?.reset();
      show("Integrante agregado.");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [estado]);

  return (
    <form ref={formRef} action={formAction} className="mt-3 flex flex-wrap items-end gap-2">
      <input type="hidden" name="comision_id" value={comisionId} />
      <div className="flex-1 min-w-[140px]">
        <Label>Agregar integrante</Label>
        <select name="user_id" required className={inputClass}>
          {usuarios.map((u) => (
            <option key={u.id} value={u.id}>{u.nombre}</option>
          ))}
        </select>
        <FieldError message={estado.fieldErrors?.user_id} />
      </div>
      <div>
        <Label>Rol</Label>
        <select name="rol_en_comision" className={inputClass} defaultValue="integrante">
          <option value="integrante">Integrante</option>
          <option value="coordinador">Coordinador/a</option>
        </select>
        <FieldError message={estado.fieldErrors?.rol_en_comision} />
      </div>
      <SubmitButton variant="add" className="text-xs px-3 py-2 whitespace-nowrap">Agregar</SubmitButton>
      <div className="w-full">
        <FormError message={estado.error} />
      </div>
    </form>
  );
}

export function CrearTareaForm({ comisionId, usuarios }: { comisionId: number; usuarios: Usuario[] }) {
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
    <details ref={detailsRef} className="mt-2">
      <AddButtonSummary className="text-xs px-3 py-1.5">Agregar tarea</AddButtonSummary>
      <form ref={formRef} action={formAction} className="mt-2 grid grid-cols-1 gap-2">
        <input type="hidden" name="comision_id" value={comisionId} />
        <div>
          <input name="titulo" required placeholder="Título de la tarea" className={inputClass} />
          <FieldError message={estado.fieldErrors?.titulo} />
        </div>
        <div className="grid grid-cols-2 gap-2">
          <div>
            <select name="responsable_id" className={inputClass} defaultValue="">
              <option value="">Sin asignar</option>
              {usuarios.map((u) => (
                <option key={u.id} value={u.id}>{u.nombre}</option>
              ))}
            </select>
            <FieldError message={estado.fieldErrors?.responsable_id} />
          </div>
          <div>
            <select name="prioridad" className={inputClass} defaultValue="media">
              <option value="alta">Alta</option>
              <option value="media">Media</option>
              <option value="baja">Baja</option>
            </select>
          </div>
        </div>
        <div>
          <input name="fecha_vencimiento" type="date" className={inputClass} />
          <FieldError message={estado.fieldErrors?.fecha_vencimiento} />
        </div>
        <FormError message={estado.error} />
        <SubmitButton variant="add" className="text-xs px-3 py-2">Agregar tarea</SubmitButton>
      </form>
    </details>
  );
}

export function CrearComisionForm() {
  const [estado, formAction] = useActionState(crearComisionFormAction, ESTADO_INICIAL);
  const formRef = useRef<HTMLFormElement>(null);
  const detailsRef = useRef<HTMLDetailsElement>(null);
  const { show } = useToast();

  useEffect(() => {
    if (estado.ok) {
      formRef.current?.reset();
      if (detailsRef.current) detailsRef.current.open = false;
      show("Comisión creada.");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [estado]);

  return (
    <details ref={detailsRef} className="mt-6">
      <AddButtonSummary>Crear comisión</AddButtonSummary>
      <Card className="mt-3">
        <form ref={formRef} action={formAction} className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <Label>Nombre</Label>
            <input name="nombre" required placeholder="Ej: Comisión de Educación" className={inputClass} />
            <FieldError message={estado.fieldErrors?.nombre} />
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
            <SubmitButton variant="add" pendingLabel="Creando…">Crear comisión</SubmitButton>
          </div>
        </form>
      </Card>
    </details>
  );
}
