"use client";

// Fase 4 del rediseño: mismos 4 formularios de la ficha de un socio
// (/socios/[id]) migrados a `useActionState` — ver SociosFormularios.tsx
// para el criterio general. `EditarIntegranteForm` recibe el integrante
// como prop porque hay una instancia por fila de la lista (uno por
// integrante del núcleo), cada una con su propio estado independiente.

import { useActionState, useEffect, useRef } from "react";
import {
  actualizarSocioFormAction,
  agregarIntegranteFormAction,
  editarIntegranteFormAction,
} from "@/lib/actions/socios";
import { registrarMovimientoCuentaSocioFormAction } from "@/lib/actions/cuentaSocios";
import { ESTADO_INICIAL } from "@/lib/actionState";
import { FieldError, FormError, SubmitButton, useToast } from "@/components/ui-client";
import { AddButtonSummary, Label, inputClass } from "@/components/ui";
import { RELACION_INTEGRANTE, RELACION_INTEGRANTE_LABEL, TIPO_INTEGRANTE } from "@/lib/constants";

const TIPO_INTEGRANTE_LABEL: Record<(typeof TIPO_INTEGRANTE)[number], string> = { adulto: "Adulto", menor: "Menor de edad" };

type Socio = { id: number; documento?: string | null; email?: string | null; telefono?: string | null; notas?: string | null };

export function ActualizarSocioForm({ socio }: { socio: Socio }) {
  const [estado, formAction] = useActionState(actualizarSocioFormAction, ESTADO_INICIAL);
  const detailsRef = useRef<HTMLDetailsElement>(null);
  const { show } = useToast();

  useEffect(() => {
    if (estado.ok) {
      if (detailsRef.current) detailsRef.current.open = false;
      show("Datos de contacto actualizados.");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [estado]);

  return (
    <details ref={detailsRef} className="mt-4">
      <summary className="cursor-pointer text-xs font-semibold text-[var(--color-brand-800)]">Editar datos de contacto</summary>
      <form action={formAction} className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-3">
        <input type="hidden" name="id" value={socio.id} />
        <div>
          <Label>Documento</Label>
          <input name="documento" defaultValue={socio.documento || ""} className={inputClass} />
          <FieldError message={estado.fieldErrors?.documento} />
        </div>
        <div>
          <Label>Email</Label>
          <input name="email" type="email" defaultValue={socio.email || ""} className={inputClass} />
          <FieldError message={estado.fieldErrors?.email} />
        </div>
        <div>
          <Label>Teléfono</Label>
          <input name="telefono" defaultValue={socio.telefono || ""} className={inputClass} />
          <FieldError message={estado.fieldErrors?.telefono} />
        </div>
        <div className="sm:col-span-2">
          <Label>Notas</Label>
          <input name="notas" defaultValue={socio.notas || ""} className={inputClass} />
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

export function AgregarIntegranteForm({ socioId }: { socioId: number }) {
  const [estado, formAction] = useActionState(agregarIntegranteFormAction, ESTADO_INICIAL);
  const formRef = useRef<HTMLFormElement>(null);
  const detailsRef = useRef<HTMLDetailsElement>(null);
  const { show } = useToast();

  useEffect(() => {
    if (estado.ok) {
      formRef.current?.reset();
      if (detailsRef.current) detailsRef.current.open = false;
      show("Integrante agregado.");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [estado]);

  return (
    <details ref={detailsRef} className="mt-4">
      <AddButtonSummary>Agregar integrante</AddButtonSummary>
      <form ref={formRef} action={formAction} className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-3">
        <input type="hidden" name="socio_id" value={socioId} />
        <div>
          <Label>Nombre</Label>
          <input name="nombre" required className={inputClass} />
          <FieldError message={estado.fieldErrors?.nombre} />
        </div>
        <div>
          <Label>Apellido</Label>
          <input name="apellido" className={inputClass} />
          <FieldError message={estado.fieldErrors?.apellido} />
        </div>
        <div>
          <Label>Documento</Label>
          <input name="documento" className={inputClass} />
          <FieldError message={estado.fieldErrors?.documento} />
        </div>
        <div>
          <Label>Fecha de nacimiento</Label>
          <input type="date" name="fecha_nacimiento" className={inputClass} />
          <FieldError message={estado.fieldErrors?.fecha_nacimiento} />
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
          <Label>Relación con el titular</Label>
          <select name="relacion" className={inputClass} defaultValue="pareja">
            {RELACION_INTEGRANTE.filter((r) => r !== "titular").map((r) => (
              <option key={r} value={r}>{RELACION_INTEGRANTE_LABEL[r]}</option>
            ))}
          </select>
        </div>
        <div>
          <Label>Tipo de integrante</Label>
          <select name="tipo_integrante" className={inputClass} defaultValue="adulto">
            {TIPO_INTEGRANTE.map((t) => (
              <option key={t} value={t}>{TIPO_INTEGRANTE_LABEL[t]}</option>
            ))}
          </select>
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
          <SubmitButton variant="add" pendingLabel="Agregando…">Agregar integrante</SubmitButton>
        </div>
      </form>
    </details>
  );
}

type Integrante = {
  id: number;
  nombre: string;
  apellido?: string | null;
  documento?: string | null;
  fecha_nacimiento?: string | null;
  telefono?: string | null;
  email?: string | null;
  relacion: string;
  tipo_integrante: string;
  observaciones?: string | null;
};

export function EditarIntegranteForm({ integrante: i }: { integrante: Integrante }) {
  const [estado, formAction] = useActionState(editarIntegranteFormAction, ESTADO_INICIAL);
  const detailsRef = useRef<HTMLDetailsElement>(null);
  const { show } = useToast();

  useEffect(() => {
    if (estado.ok) {
      if (detailsRef.current) detailsRef.current.open = false;
      show("Integrante actualizado.");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [estado]);

  return (
    <details ref={detailsRef}>
      <summary className="cursor-pointer text-xs text-[var(--color-brand-800)] font-semibold">Editar</summary>
      <form action={formAction} className="mt-2 grid grid-cols-1 sm:grid-cols-2 gap-2 w-64 sm:w-80">
        <input type="hidden" name="id" value={i.id} />
        <div>
          <Label>Nombre</Label>
          <input name="nombre" defaultValue={i.nombre} required className={inputClass} />
          <FieldError message={estado.fieldErrors?.nombre} />
        </div>
        <div>
          <Label>Apellido</Label>
          <input name="apellido" defaultValue={i.apellido || ""} className={inputClass} />
          <FieldError message={estado.fieldErrors?.apellido} />
        </div>
        <div>
          <Label>Documento</Label>
          <input name="documento" defaultValue={i.documento || ""} className={inputClass} />
          <FieldError message={estado.fieldErrors?.documento} />
        </div>
        <div>
          <Label>Fecha de nacimiento</Label>
          <input type="date" name="fecha_nacimiento" defaultValue={i.fecha_nacimiento || ""} className={inputClass} />
          <FieldError message={estado.fieldErrors?.fecha_nacimiento} />
        </div>
        <div>
          <Label>Teléfono</Label>
          <input name="telefono" defaultValue={i.telefono || ""} className={inputClass} />
          <FieldError message={estado.fieldErrors?.telefono} />
        </div>
        <div>
          <Label>Email</Label>
          <input type="email" name="email" defaultValue={i.email || ""} className={inputClass} />
          <FieldError message={estado.fieldErrors?.email} />
        </div>
        <div>
          <Label>Relación</Label>
          <select name="relacion" defaultValue={i.relacion} className={inputClass}>
            {RELACION_INTEGRANTE.map((r) => (
              <option key={r} value={r}>{RELACION_INTEGRANTE_LABEL[r]}</option>
            ))}
          </select>
        </div>
        <div>
          <Label>Tipo</Label>
          <select name="tipo_integrante" defaultValue={i.tipo_integrante} className={inputClass}>
            {TIPO_INTEGRANTE.map((t) => (
              <option key={t} value={t}>{TIPO_INTEGRANTE_LABEL[t]}</option>
            ))}
          </select>
        </div>
        <div className="sm:col-span-2">
          <Label>Observaciones</Label>
          <input name="observaciones" defaultValue={i.observaciones || ""} className={inputClass} />
          <FieldError message={estado.fieldErrors?.observaciones} />
        </div>
        <div className="sm:col-span-2">
          <FormError message={estado.error} />
        </div>
        <div className="sm:col-span-2">
          <SubmitButton className="text-xs px-3 py-1.5" pendingLabel="Guardando…">Guardar</SubmitButton>
        </div>
      </form>
    </details>
  );
}

export function RegistrarMovimientoCuentaForm({ socioId }: { socioId: number }) {
  const [estado, formAction] = useActionState(registrarMovimientoCuentaSocioFormAction, ESTADO_INICIAL);
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

  const hoy = new Date().toISOString().slice(0, 10);

  return (
    <details ref={detailsRef} className="mt-4">
      <AddButtonSummary>Registrar cargo o pago</AddButtonSummary>
      <form ref={formRef} action={formAction} className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-3">
        <input type="hidden" name="socio_id" value={socioId} />
        <div>
          <Label>Tipo</Label>
          <select name="tipo" className={inputClass} defaultValue="cargo">
            <option value="cargo">Cargo (aumenta la deuda, ej: cuota)</option>
            <option value="pago">Pago (la reduce)</option>
          </select>
        </div>
        <div>
          <Label>Monto</Label>
          <input name="monto" type="number" step="0.01" required className={inputClass} />
          <FieldError message={estado.fieldErrors?.monto} />
        </div>
        <div>
          <Label>Concepto</Label>
          <input name="concepto" required placeholder="Cuota setiembre, pago parcial…" className={inputClass} />
          <FieldError message={estado.fieldErrors?.concepto} />
        </div>
        <div>
          <Label>Fecha</Label>
          <input name="fecha" type="date" required className={inputClass} defaultValue={hoy} />
          <FieldError message={estado.fieldErrors?.fecha} />
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
          <SubmitButton variant="add" pendingLabel="Registrando…">Registrar</SubmitButton>
        </div>
      </form>
    </details>
  );
}
