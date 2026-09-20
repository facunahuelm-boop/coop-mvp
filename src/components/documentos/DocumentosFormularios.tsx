"use client";

// Fase 4 del rediseño: los 2 formularios de /documentos (subir documento,
// crear categoría nueva) migrados a `useActionState` — mismo criterio que
// los demás módulos.
//
// Fase 8 del sistema de gestión de Comisiones (19/09, "contexto y
// versionado"): se suma el bloque opcional "Vincular a" en SubirDocumentoForm
// (mismo patrón de tipo+select condicional que ya usa CrearComunicacionForm)
// y el formulario chico SubirNuevaVersionForm, en un Modal (mismo criterio
// que CrearComunicacionForm) porque necesita un <input type="file">.

import { useActionState, useEffect, useRef, useState } from "react";
import {
  subirDocumentoFormAction,
  crearCategoriaDocumentoFormAction,
  subirNuevaVersionDocumentoFormAction,
} from "@/lib/actions/documentos";
import { ESTADO_INICIAL } from "@/lib/actionState";
import { FieldError, FormError, SubmitButton, useToast, Modal } from "@/components/ui-client";
import { AddButtonSummary, Card, Label, inputClass } from "@/components/ui";

type Opcion = { id: number; label: string };

type ContextoTipo = "ninguno" | "comision" | "solicitud" | "tarea" | "reunion" | "decision" | "comunicacion";
const CONTEXTO_LABEL: Record<ContextoTipo, string> = {
  ninguno: "Sin vincular",
  comision: "Comisión",
  solicitud: "Solicitud entre comisiones",
  tarea: "Tarea",
  reunion: "Reunión",
  decision: "Decisión",
  comunicacion: "Comunicación",
};

export function SubirDocumentoForm({
  categorias,
  catLabel,
  comisiones,
  solicitudes,
  tareas,
  reuniones,
  decisiones,
  comunicaciones,
}: {
  categorias: string[];
  catLabel: Record<string, string>;
  comisiones: Opcion[];
  solicitudes: Opcion[];
  tareas: Opcion[];
  reuniones: Opcion[];
  decisiones: Opcion[];
  comunicaciones: Opcion[];
}) {
  const [estado, formAction] = useActionState(subirDocumentoFormAction, ESTADO_INICIAL);
  const formRef = useRef<HTMLFormElement>(null);
  const detailsRef = useRef<HTMLDetailsElement>(null);
  const [contextoTipo, setContextoTipo] = useState<ContextoTipo>("ninguno");
  const { show } = useToast();

  const OPCIONES_POR_TIPO: Record<ContextoTipo, Opcion[]> = {
    ninguno: [],
    comision: comisiones,
    solicitud: solicitudes,
    tarea: tareas,
    reunion: reuniones,
    decision: decisiones,
    comunicacion: comunicaciones,
  };

  useEffect(() => {
    if (estado.ok) {
      formRef.current?.reset();
      if (detailsRef.current) detailsRef.current.open = false;
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setContextoTipo("ninguno");
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
          <div>
            <Label>Vincular a (opcional)</Label>
            <select
              name="contexto_tipo"
              className={inputClass}
              value={contextoTipo}
              onChange={(e) => setContextoTipo(e.target.value as ContextoTipo)}
            >
              {(Object.keys(CONTEXTO_LABEL) as ContextoTipo[]).map((t) => (
                <option key={t} value={t}>{CONTEXTO_LABEL[t]}</option>
              ))}
            </select>
          </div>
          {contextoTipo !== "ninguno" && (
            <div>
              <Label>{CONTEXTO_LABEL[contextoTipo]}</Label>
              <select name="contexto_id" required className={inputClass} defaultValue="">
                <option value="" disabled>Elegir…</option>
                {OPCIONES_POR_TIPO[contextoTipo].map((o) => (
                  <option key={o.id} value={o.id}>{o.label}</option>
                ))}
              </select>
              <FieldError message={estado.fieldErrors?.contexto_id} />
            </div>
          )}
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

export function SubirNuevaVersionForm({ documentoId, nombre }: { documentoId: number; nombre: string }) {
  const [open, setOpen] = useState(false);
  const [estado, formAction] = useActionState(subirNuevaVersionDocumentoFormAction, ESTADO_INICIAL);
  const formRef = useRef<HTMLFormElement>(null);
  const { show } = useToast();

  useEffect(() => {
    if (estado.ok) {
      formRef.current?.reset();
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setOpen(false);
      show("Nueva versión subida.");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [estado]);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="text-xs text-[var(--color-brand-800)] underline whitespace-nowrap"
      >
        Nueva versión
      </button>
      <Modal open={open} onClose={() => setOpen(false)} title={`Nueva versión de "${nombre}"`} size="md">
        <form ref={formRef} action={formAction} className="grid grid-cols-1 gap-3">
          <input type="hidden" name="documento_anterior_id" value={documentoId} />
          <div>
            <Label>Archivo nuevo</Label>
            <input type="file" name="archivo" required className="text-xs" />
          </div>
          <div>
            <Label>¿Qué cambió? (opcional)</Label>
            <input name="descripcion" placeholder="Ej: corrige el monto del artículo 4" className={inputClass} />
            <FieldError message={estado.fieldErrors?.descripcion} />
          </div>
          <p className="text-xs text-ink/40">
            El nombre, la categoría, las etiquetas y el vínculo se mantienen igual que en la versión anterior.
          </p>
          <FormError message={estado.error} />
          <SubmitButton variant="add" pendingLabel="Subiendo…">Subir nueva versión</SubmitButton>
        </form>
      </Modal>
    </>
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
