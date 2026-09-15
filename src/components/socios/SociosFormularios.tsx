"use client";

// Fase 4 del rediseño (validaciones globales + feedback visual): estos 3
// formularios de /socios (crear socio, crear vivienda, agregar aspirante a
// la lista de espera) pasan de `<form action={accionCruda}>` — que si el
// servidor rechaza algo (nombre vacío, un permiso, un error real de base)
// termina en la pantalla genérica de error de Next.js — a `useActionState`
// con `FieldError`/`FormError`, el mismo patrón que ya usan
// CambiarPasswordForm/CambiarFotoForm. Cada uno cierra su propio `<details>`
// y limpia el formulario al guardar con éxito, en vez de dejarlo abierto con
// los datos ya enviados todavía cargados.

import { useActionState, useEffect, useRef } from "react";
import { crearSocioFormAction, crearViviendaFormAction, agregarListaEsperaFormAction } from "@/lib/actions/socios";
import { ESTADO_INICIAL } from "@/lib/actionState";
import { FieldError, FormError, SubmitButton, useToast } from "@/components/ui-client";
import { AddButtonSummary, Label, inputClass } from "@/components/ui";

type Opcion = { id: number; nombre?: string; numero?: string };

export function CrearSocioForm({ viviendas, nucleos }: { viviendas: Opcion[]; nucleos: Opcion[] }) {
  const [estado, formAction] = useActionState(crearSocioFormAction, ESTADO_INICIAL);
  const formRef = useRef<HTMLFormElement>(null);
  const detailsRef = useRef<HTMLDetailsElement>(null);
  const { show } = useToast();

  useEffect(() => {
    if (estado.ok) {
      formRef.current?.reset();
      if (detailsRef.current) detailsRef.current.open = false;
      show("Socio agregado.");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [estado]);

  return (
    <details ref={detailsRef} className="mt-4">
      <AddButtonSummary>Agregar socio</AddButtonSummary>
      <form ref={formRef} action={formAction} className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div>
          <Label>Nombre</Label>
          <input name="nombre" required className={inputClass} />
          <FieldError message={estado.fieldErrors?.nombre} />
        </div>
        <div>
          <Label>Documento</Label>
          <input name="documento" className={inputClass} />
          <FieldError message={estado.fieldErrors?.documento} />
        </div>
        <div>
          <Label>Email</Label>
          <input name="email" type="email" className={inputClass} />
          <FieldError message={estado.fieldErrors?.email} />
        </div>
        <div>
          <Label>Teléfono</Label>
          <input name="telefono" className={inputClass} />
          <FieldError message={estado.fieldErrors?.telefono} />
        </div>
        <div>
          <Label>Vivienda</Label>
          <select name="vivienda_id" className={inputClass} defaultValue="">
            <option value="">Sin asignar</option>
            {viviendas.map((v) => (
              <option key={v.id} value={v.id}>{v.numero}</option>
            ))}
          </select>
        </div>
        <div>
          <Label>Núcleo familiar</Label>
          <select name="nucleo_id" className={inputClass} defaultValue="">
            <option value="">Sin vincular</option>
            {nucleos.map((n) => (
              <option key={n.id} value={n.id}>{n.nombre}</option>
            ))}
          </select>
        </div>
        <div>
          <Label>Fecha de ingreso</Label>
          <input name="fecha_ingreso" type="date" className={inputClass} />
          <FieldError message={estado.fieldErrors?.fecha_ingreso} />
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
          <SubmitButton variant="add" pendingLabel="Agregando…">Agregar socio</SubmitButton>
        </div>
      </form>
    </details>
  );
}

export function CrearViviendaForm({ estados }: { estados: readonly string[] }) {
  const [estado, formAction] = useActionState(crearViviendaFormAction, ESTADO_INICIAL);
  const formRef = useRef<HTMLFormElement>(null);
  const detailsRef = useRef<HTMLDetailsElement>(null);
  const { show } = useToast();

  useEffect(() => {
    if (estado.ok) {
      formRef.current?.reset();
      if (detailsRef.current) detailsRef.current.open = false;
      show("Vivienda agregada.");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [estado]);

  return (
    <details ref={detailsRef} className="mt-4">
      <AddButtonSummary>Agregar vivienda</AddButtonSummary>
      <form ref={formRef} action={formAction} className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div>
          <Label>Número / identificador</Label>
          <input name="numero" required placeholder="Ej: Casa 12" className={inputClass} />
          <FieldError message={estado.fieldErrors?.numero} />
        </div>
        <div>
          <Label>Estado</Label>
          <select name="estado" className={inputClass} defaultValue="en_obra">
            {estados.map((e) => (
              <option key={e} value={e}>{e}</option>
            ))}
          </select>
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
          <SubmitButton variant="add" pendingLabel="Agregando…">Agregar vivienda</SubmitButton>
        </div>
      </form>
    </details>
  );
}

export function AgregarListaEsperaForm() {
  const [estado, formAction] = useActionState(agregarListaEsperaFormAction, ESTADO_INICIAL);
  const formRef = useRef<HTMLFormElement>(null);
  const detailsRef = useRef<HTMLDetailsElement>(null);
  const { show } = useToast();

  useEffect(() => {
    if (estado.ok) {
      formRef.current?.reset();
      if (detailsRef.current) detailsRef.current.open = false;
      show("Aspirante agregado a la lista de espera.");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [estado]);

  return (
    <details ref={detailsRef} className="mt-4">
      <AddButtonSummary>Agregar aspirante</AddButtonSummary>
      <form ref={formRef} action={formAction} className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div>
          <Label>Nombre</Label>
          <input name="nombre" required className={inputClass} />
          <FieldError message={estado.fieldErrors?.nombre} />
        </div>
        <div>
          <Label>Documento</Label>
          <input name="documento" className={inputClass} />
          <FieldError message={estado.fieldErrors?.documento} />
        </div>
        <div>
          <Label>Contacto</Label>
          <input name="contacto" placeholder="Teléfono o email" className={inputClass} />
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
          <SubmitButton variant="add" pendingLabel="Agregando…">Agregar a la lista</SubmitButton>
        </div>
      </form>
    </details>
  );
}
