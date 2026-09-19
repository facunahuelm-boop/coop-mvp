"use client";

// Fase 6 del sistema de gestión de Comisiones (19/09). Mismo criterio que
// SolicitudesFormularios.tsx: alta en un Modal (no navega a otra pantalla),
// el resto de las acciones (editar/decidir/reabrir/votación) vive dentro de
// la ficha /decisiones/[id] ya existente.

import { useActionState, useEffect, useRef, useState } from "react";
import {
  crearDecisionFormAction,
  editarDecisionFormAction,
  decidirDecisionFormAction,
  reabrirDecisionFormAction,
  crearVotacionFormAction,
  votarFormAction,
  cerrarVotacionFormAction,
} from "@/lib/actions/decisiones";
import { ESTADO_INICIAL } from "@/lib/actionState";
import { FieldError, FormError, SubmitButton, useToast, Modal } from "@/components/ui-client";
import { AddButton, Label, inputClass } from "@/components/ui";
import { TIPO_VOTACION_LABEL } from "./DecisionStatus";

type Comision = { id: number; nombre: string };

export function CrearDecisionForm({ comisiones }: { comisiones: Comision[] }) {
  const [open, setOpen] = useState(false);
  const [estado, formAction] = useActionState(crearDecisionFormAction, ESTADO_INICIAL);
  const formRef = useRef<HTMLFormElement>(null);
  const { show } = useToast();

  useEffect(() => {
    if (estado.ok) {
      formRef.current?.reset();
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setOpen(false);
      show("Decisión registrada.");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [estado]);

  return (
    <>
      <AddButton onClick={() => setOpen(true)}>Nueva decisión</AddButton>
      <Modal open={open} onClose={() => setOpen(false)} title="Registrar decisión de comisión" size="lg">
        <form ref={formRef} action={formAction} className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-ink">
          <div>
            <Label>Comisión</Label>
            <select name="comision_id" required className={inputClass} defaultValue="">
              <option value="" disabled>Elegir…</option>
              {comisiones.map((c) => (
                <option key={c.id} value={c.id}>{c.nombre}</option>
              ))}
            </select>
            <FieldError message={estado.fieldErrors?.comision_id} />
          </div>
          <div>
            <Label>Fecha</Label>
            <input name="fecha" type="date" required className={inputClass} />
            <FieldError message={estado.fieldErrors?.fecha} />
          </div>
          <div className="sm:col-span-2">
            <Label>Tema</Label>
            <input name="tema" required placeholder="Ej: Renovación del contrato con el proveedor de limpieza" className={inputClass} />
            <FieldError message={estado.fieldErrors?.tema} />
          </div>
          <div className="sm:col-span-2">
            <Label>Propuesta (opcional)</Label>
            <textarea name="propuesta" rows={3} placeholder="Qué se propone concretamente" className={inputClass} />
            <FieldError message={estado.fieldErrors?.propuesta} />
          </div>
          <div className="sm:col-span-2">
            <FormError message={estado.error} />
          </div>
          <div className="sm:col-span-2">
            <SubmitButton variant="add" pendingLabel="Registrando…">Registrar decisión</SubmitButton>
          </div>
        </form>
      </Modal>
    </>
  );
}

export function EditarDecisionForm({ id, tema, propuesta, fecha }: { id: number; tema: string; propuesta: string | null; fecha: string }) {
  const [estado, formAction] = useActionState(editarDecisionFormAction, ESTADO_INICIAL);
  const { show } = useToast();

  useEffect(() => {
    if (estado.ok) show("Decisión actualizada.");
    if (estado.error) show(estado.error, "error");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [estado]);

  return (
    <details>
      <summary className="cursor-pointer text-xs font-semibold text-[var(--color-brand-800)]">Editar tema/propuesta</summary>
      <form action={formAction} className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-3">
        <input type="hidden" name="id" value={id} />
        <div>
          <Label>Fecha</Label>
          <input name="fecha" type="date" defaultValue={fecha?.slice(0, 10)} required className={inputClass} />
          <FieldError message={estado.fieldErrors?.fecha} />
        </div>
        <div className="sm:col-span-2">
          <Label>Tema</Label>
          <input name="tema" defaultValue={tema} required className={inputClass} />
          <FieldError message={estado.fieldErrors?.tema} />
        </div>
        <div className="sm:col-span-2">
          <Label>Propuesta</Label>
          <textarea name="propuesta" defaultValue={propuesta ?? ""} rows={3} className={inputClass} />
          <FieldError message={estado.fieldErrors?.propuesta} />
        </div>
        <div className="sm:col-span-2">
          <FormError message={estado.error} />
          <SubmitButton pendingLabel="Guardando…">Guardar cambios</SubmitButton>
        </div>
      </form>
    </details>
  );
}

export function DecidirDecisionForm({ id }: { id: number }) {
  const [estado, formAction] = useActionState(decidirDecisionFormAction, ESTADO_INICIAL);
  const { show } = useToast();

  useEffect(() => {
    if (estado.error) show(estado.error, "error");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [estado]);

  return (
    <div className="flex items-center gap-2">
      <form action={formAction}>
        <input type="hidden" name="id" value={id} />
        <input type="hidden" name="resultado" value="aprobada" />
        <SubmitButton variant="primary" className="text-xs px-3 py-2 whitespace-nowrap">✅ Aprobar</SubmitButton>
      </form>
      <form action={formAction}>
        <input type="hidden" name="id" value={id} />
        <input type="hidden" name="resultado" value="rechazada" />
        <SubmitButton variant="secondary" className="text-xs px-3 py-2 whitespace-nowrap">✕ Rechazar</SubmitButton>
      </form>
    </div>
  );
}

export function ReabrirDecisionForm({ id }: { id: number }) {
  const [estado, formAction] = useActionState(reabrirDecisionFormAction, ESTADO_INICIAL);
  const { show } = useToast();

  useEffect(() => {
    if (estado.ok) show("Decisión reabierta.");
    if (estado.error) show(estado.error, "error");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [estado]);

  return (
    <form action={formAction} className="inline">
      <input type="hidden" name="id" value={id} />
      <SubmitButton variant="ghost" className="text-xs text-ink/50">Reabrir (corregir un error de carga)</SubmitButton>
    </form>
  );
}

export function CrearVotacionForm({ decisionId }: { decisionId: number }) {
  const [estado, formAction] = useActionState(crearVotacionFormAction, ESTADO_INICIAL);
  const formRef = useRef<HTMLFormElement>(null);
  const { show } = useToast();

  useEffect(() => {
    if (estado.ok) {
      formRef.current?.reset();
      show("Votación abierta.");
    }
    if (estado.error) show(estado.error, "error");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [estado]);

  return (
    <details>
      <summary className="cursor-pointer text-sm font-semibold text-[var(--color-brand-800)]">+ Abrir votación para esta decisión</summary>
      <form ref={formRef} action={formAction} className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-3">
        <input type="hidden" name="decision_id" value={decisionId} />
        <div className="sm:col-span-2">
          <Label>Pregunta</Label>
          <input name="pregunta" required placeholder="Ej: ¿Aprobamos la propuesta?" className={inputClass} />
          <FieldError message={estado.fieldErrors?.pregunta} />
        </div>
        <div>
          <Label>Tipo</Label>
          <select name="tipo" className={inputClass} defaultValue="votacion">
            {Object.entries(TIPO_VOTACION_LABEL).map(([v, l]) => (
              <option key={v} value={v}>{l}</option>
            ))}
          </select>
        </div>
        <div>
          <Label>Fecha de cierre (opcional)</Label>
          <input name="fecha_cierre" type="date" className={inputClass} />
        </div>
        <div className="sm:col-span-2">
          <Label>Opciones (una por línea, mínimo 2)</Label>
          <textarea name="opciones" required rows={3} placeholder={"Sí\nNo\nAbstención"} className={inputClass} />
          <FieldError message={estado.fieldErrors?.opciones} />
        </div>
        <div className="sm:col-span-2">
          <FormError message={estado.error} />
        </div>
        <div className="sm:col-span-2">
          <SubmitButton variant="add" pendingLabel="Abriendo…">Abrir votación</SubmitButton>
        </div>
      </form>
    </details>
  );
}

export function VotarForm({ votacionId, opciones, votoActual }: { votacionId: number; opciones: string[]; votoActual: string | null }) {
  const [estado, formAction] = useActionState(votarFormAction, ESTADO_INICIAL);
  const { show } = useToast();

  useEffect(() => {
    if (estado.ok) show(votoActual ? "Voto actualizado." : "Voto registrado.");
    if (estado.error) show(estado.error, "error");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [estado]);

  return (
    <form action={formAction} className="flex flex-wrap items-center gap-2">
      <input type="hidden" name="votacion_id" value={votacionId} />
      <select name="opcion" required className={inputClass + " text-xs !py-1.5 max-w-[220px]"} defaultValue={votoActual ?? ""}>
        <option value="" disabled>Elegir opción…</option>
        {opciones.map((o) => (
          <option key={o} value={o}>{o}</option>
        ))}
      </select>
      <SubmitButton variant="primary" className="text-xs px-3 py-1.5 whitespace-nowrap">{votoActual ? "Cambiar voto" : "Votar"}</SubmitButton>
    </form>
  );
}

export function CerrarVotacionForm({ votacionId }: { votacionId: number }) {
  const [estado, formAction] = useActionState(cerrarVotacionFormAction, ESTADO_INICIAL);
  const { show } = useToast();

  useEffect(() => {
    if (estado.ok) show("Votación cerrada.");
    if (estado.error) show(estado.error, "error");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [estado]);

  return (
    <form action={formAction} className="inline">
      <input type="hidden" name="id" value={votacionId} />
      <SubmitButton variant="ghost" className="text-xs text-ink/50">Cerrar votación</SubmitButton>
    </form>
  );
}
