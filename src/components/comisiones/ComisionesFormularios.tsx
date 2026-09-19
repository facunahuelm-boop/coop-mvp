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
  editarComisionFormAction,
} from "@/lib/actions/comisiones";
import { crearTareaFormAction } from "@/lib/actions/tareas";
import { ESTADO_INICIAL } from "@/lib/actionState";
import { FieldError, FormError, SubmitButton, useToast } from "@/components/ui-client";
import { AddButtonSummary, Card, Label, inputClass } from "@/components/ui";

type Usuario = { id: number; nombre: string };
type Comision = { id: number; nombre: string };

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
          <option value="suplente">Suplente</option>
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

// Campos compartidos por Crear/Editar: tipo (permanente/temporal),
// objetivo, vigencia y subcomisión — mismo criterio en ambos formularios
// para no tener dos lenguajes distintos de "qué es una comisión".
function CamposComision({
  estado,
  comisiones,
  excluirId,
  tipoInicial,
  objetivoInicial,
  fechaInicioInicial,
  fechaFinInicial,
  padreInicial,
}: {
  estado: { fieldErrors?: Record<string, string> };
  comisiones?: Comision[];
  excluirId?: number;
  tipoInicial?: string;
  objetivoInicial?: string;
  fechaInicioInicial?: string;
  fechaFinInicial?: string;
  padreInicial?: number | null;
}) {
  return (
    <>
      <div>
        <Label>Tipo</Label>
        <select name="tipo" className={inputClass} defaultValue={tipoInicial ?? "permanente"}>
          <option value="permanente">Permanente</option>
          <option value="temporal">Temporal</option>
        </select>
        <FieldError message={estado.fieldErrors?.tipo} />
      </div>
      {comisiones && comisiones.length > 0 && (
        <div>
          <Label>Subcomisión de (opcional)</Label>
          <select name="comision_padre_id" className={inputClass} defaultValue={padreInicial ?? ""}>
            <option value="">Ninguna — comisión de primer nivel</option>
            {comisiones.filter((c) => c.id !== excluirId).map((c) => (
              <option key={c.id} value={c.id}>{c.nombre}</option>
            ))}
          </select>
          <FieldError message={estado.fieldErrors?.comision_padre_id} />
        </div>
      )}
      <div className="sm:col-span-2">
        <Label>Objetivo (opcional)</Label>
        <input name="objetivo" defaultValue={objetivoInicial} placeholder="Para qué existe esta comisión" className={inputClass} />
        <FieldError message={estado.fieldErrors?.objetivo} />
      </div>
      <div>
        <Label>Inicio (opcional)</Label>
        <input name="fecha_inicio" type="date" defaultValue={fechaInicioInicial} className={inputClass} />
        <FieldError message={estado.fieldErrors?.fecha_inicio} />
      </div>
      <div>
        <Label>Finalización (obligatoria si es temporal)</Label>
        <input name="fecha_fin" type="date" defaultValue={fechaFinInicial} className={inputClass} />
        <FieldError message={estado.fieldErrors?.fecha_fin} />
      </div>
    </>
  );
}

export function CrearComisionForm({ comisiones }: { comisiones?: Comision[] }) {
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
          <CamposComision estado={estado} comisiones={comisiones} />
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

export function EditarComisionForm({
  comision,
  comisiones,
}: {
  comision: {
    id: number; nombre: string; descripcion?: string | null; tipo?: string | null;
    objetivo?: string | null; fecha_inicio?: string | null; fecha_fin?: string | null;
    comision_padre_id?: number | null;
  };
  comisiones: Comision[];
}) {
  const [estado, formAction] = useActionState(editarComisionFormAction, ESTADO_INICIAL);
  const detailsRef = useRef<HTMLDetailsElement>(null);
  const { show } = useToast();

  useEffect(() => {
    if (estado.ok) {
      if (detailsRef.current) detailsRef.current.open = false;
      show("Comisión actualizada.");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [estado]);

  return (
    <details ref={detailsRef} className="mt-2">
      <summary className="text-xs text-ink/40 hover:text-[var(--color-brand-800)] underline underline-offset-2 cursor-pointer select-none">Editar</summary>
      <Card className="mt-2">
        <form action={formAction} className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <input type="hidden" name="id" value={comision.id} />
          <div>
            <Label>Nombre</Label>
            <input name="nombre" required defaultValue={comision.nombre} className={inputClass} />
            <FieldError message={estado.fieldErrors?.nombre} />
          </div>
          <div>
            <Label>Descripción</Label>
            <input name="descripcion" defaultValue={comision.descripcion ?? ""} className={inputClass} />
            <FieldError message={estado.fieldErrors?.descripcion} />
          </div>
          <CamposComision
            estado={estado}
            comisiones={comisiones}
            excluirId={comision.id}
            tipoInicial={comision.tipo ?? "permanente"}
            objetivoInicial={comision.objetivo ?? ""}
            fechaInicioInicial={comision.fecha_inicio ?? ""}
            fechaFinInicial={comision.fecha_fin ?? ""}
            padreInicial={comision.comision_padre_id ?? null}
          />
          <div className="sm:col-span-2">
            <FormError message={estado.error} />
          </div>
          <div className="sm:col-span-2">
            <SubmitButton variant="secondary" pendingLabel="Guardando…">Guardar cambios</SubmitButton>
          </div>
        </form>
      </Card>
    </details>
  );
}
