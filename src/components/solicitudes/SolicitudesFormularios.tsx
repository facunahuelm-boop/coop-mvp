"use client";

// Fase 3 del sistema de gestión de Comisiones (19/09). Mismo criterio que
// CrearSolicitudForm de Compras: alta en un Modal (no navega a otra
// pantalla), el resto de las acciones (responder/derivar/comentar/cancelar)
// vive dentro de la ficha /solicitudes/[id] ya existente.

import { useActionState, useEffect, useRef, useState } from "react";
import {
  crearSolicitudComisionFormAction,
  responderSolicitudFormAction,
  derivarSolicitudFormAction,
  comentarSolicitudFormAction,
  cancelarSolicitudFormAction,
} from "@/lib/actions/solicitudes";
import { ESTADO_INICIAL } from "@/lib/actionState";
import { FieldError, FormError, SubmitButton, useToast, Modal } from "@/components/ui-client";
import { AddButton, Label, inputClass } from "@/components/ui";
import { TIPO_SOLICITUD_LABEL } from "./SolicitudStatus";

type Comision = { id: number; nombre: string };
type Usuario = { id: number; nombre: string };

export function CrearSolicitudForm({ comisiones, usuarios }: { comisiones: Comision[]; usuarios: Usuario[] }) {
  const [open, setOpen] = useState(false);
  const [estado, formAction] = useActionState(crearSolicitudComisionFormAction, ESTADO_INICIAL);
  const formRef = useRef<HTMLFormElement>(null);
  const { show } = useToast();

  useEffect(() => {
    if (estado.ok) {
      formRef.current?.reset();
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setOpen(false);
      show("Solicitud enviada.");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [estado]);

  return (
    <>
      <AddButton onClick={() => setOpen(true)}>Nueva solicitud</AddButton>
      <Modal open={open} onClose={() => setOpen(false)} title="Nueva solicitud entre comisiones" size="lg">
        <form ref={formRef} action={formAction} className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-ink">
          <div>
            <Label>Comisión que envía</Label>
            <select name="comision_origen_id" required className={inputClass} defaultValue="">
              <option value="" disabled>Elegir…</option>
              {comisiones.map((c) => (
                <option key={c.id} value={c.id}>{c.nombre}</option>
              ))}
            </select>
            <FieldError message={estado.fieldErrors?.comision_origen_id} />
          </div>
          <div>
            <Label>Comisión destino</Label>
            <select name="comision_destino_id" required className={inputClass} defaultValue="">
              <option value="" disabled>Elegir…</option>
              {comisiones.map((c) => (
                <option key={c.id} value={c.id}>{c.nombre}</option>
              ))}
            </select>
            <FieldError message={estado.fieldErrors?.comision_destino_id} />
          </div>
          <div>
            <Label>Tipo</Label>
            <select name="tipo" className={inputClass} defaultValue="otro">
              {Object.entries(TIPO_SOLICITUD_LABEL).map(([v, l]) => (
                <option key={v} value={v}>{l}</option>
              ))}
            </select>
          </div>
          <div>
            <Label>Prioridad</Label>
            <select name="prioridad" className={inputClass} defaultValue="normal">
              <option value="baja">Baja</option>
              <option value="normal">Normal</option>
              <option value="alta">Alta</option>
              <option value="urgente">Urgente</option>
            </select>
          </div>
          <div className="sm:col-span-2">
            <Label>Título</Label>
            <input name="titulo" required placeholder="Ej: Compra de materiales eléctricos" className={inputClass} />
            <FieldError message={estado.fieldErrors?.titulo} />
          </div>
          <div className="sm:col-span-2">
            <Label>Descripción (opcional)</Label>
            <textarea name="descripcion" rows={3} className={inputClass} />
            <FieldError message={estado.fieldErrors?.descripcion} />
          </div>
          <div>
            <Label>Responsable (opcional)</Label>
            <select name="responsable_id" className={inputClass} defaultValue="">
              <option value="">Sin asignar</option>
              {usuarios.map((u) => (
                <option key={u.id} value={u.id}>{u.nombre}</option>
              ))}
            </select>
          </div>
          <div>
            <Label>Fecha límite (opcional)</Label>
            <input name="fecha_limite" type="date" className={inputClass} />
            <FieldError message={estado.fieldErrors?.fecha_limite} />
          </div>
          <div className="sm:col-span-2">
            <FormError message={estado.error} />
          </div>
          <div className="sm:col-span-2">
            <SubmitButton variant="add" pendingLabel="Enviando…">Enviar solicitud</SubmitButton>
          </div>
        </form>
      </Modal>
    </>
  );
}

export function ResponderSolicitudForm({ id, usuarios }: { id: number; usuarios: Usuario[] }) {
  const [estado, formAction] = useActionState(responderSolicitudFormAction, ESTADO_INICIAL);
  const formRef = useRef<HTMLFormElement>(null);
  const { show } = useToast();

  useEffect(() => {
    if (estado.ok) {
      formRef.current?.reset();
      show("Solicitud actualizada.");
    }
    if (estado.error) show(estado.error, "error");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [estado]);

  return (
    <form ref={formRef} action={formAction} className="flex flex-wrap items-end gap-2">
      <input type="hidden" name="id" value={id} />
      <div>
        <Label>Responder</Label>
        <select name="estado" className={inputClass} defaultValue="en_revision">
          <option value="en_revision">Poner en revisión</option>
          <option value="esperando_informacion">Pedir información</option>
          <option value="en_proceso">Marcar en proceso</option>
          <option value="aprobada">Aprobar</option>
          <option value="rechazada">Rechazar</option>
          <option value="resuelta">Marcar resuelta</option>
        </select>
      </div>
      <div>
        <Label>Asignar a (opcional)</Label>
        <select name="responsable_id" className={inputClass} defaultValue="">
          <option value="">Sin cambiar</option>
          {usuarios.map((u) => (
            <option key={u.id} value={u.id}>{u.nombre}</option>
          ))}
        </select>
      </div>
      <div className="flex-1 min-w-[160px]">
        <Label>Comentario (opcional)</Label>
        <input name="motivo" className={inputClass} placeholder="Motivo o aclaración" />
      </div>
      <SubmitButton variant="primary" className="text-xs px-3 py-2 whitespace-nowrap">Guardar</SubmitButton>
    </form>
  );
}

export function DerivarSolicitudForm({ id, comisiones }: { id: number; comisiones: Comision[] }) {
  const [estado, formAction] = useActionState(derivarSolicitudFormAction, ESTADO_INICIAL);
  const formRef = useRef<HTMLFormElement>(null);
  const { show } = useToast();

  useEffect(() => {
    if (estado.ok) {
      formRef.current?.reset();
      show("Solicitud derivada.");
    }
    if (estado.error) show(estado.error, "error");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [estado]);

  return (
    <form ref={formRef} action={formAction} className="flex flex-wrap items-end gap-2">
      <input type="hidden" name="id" value={id} />
      <div className="flex-1 min-w-[160px]">
        <Label>Derivar a</Label>
        <select name="nueva_comision_destino_id" required className={inputClass} defaultValue="">
          <option value="" disabled>Elegir comisión…</option>
          {comisiones.map((c) => (
            <option key={c.id} value={c.id}>{c.nombre}</option>
          ))}
        </select>
      </div>
      <div className="flex-1 min-w-[160px]">
        <Label>Motivo (opcional)</Label>
        <input name="motivo" className={inputClass} placeholder="Por qué se deriva" />
      </div>
      <SubmitButton variant="secondary" className="text-xs px-3 py-2 whitespace-nowrap">Derivar</SubmitButton>
    </form>
  );
}

export function ComentarSolicitudForm({ id }: { id: number }) {
  const [estado, formAction] = useActionState(comentarSolicitudFormAction, ESTADO_INICIAL);
  const formRef = useRef<HTMLFormElement>(null);
  const { show } = useToast();

  useEffect(() => {
    if (estado.ok) {
      formRef.current?.reset();
      show("Comentario agregado.");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [estado]);

  return (
    <form ref={formRef} action={formAction} className="flex items-end gap-2">
      <input type="hidden" name="id" value={id} />
      <div className="flex-1">
        <textarea name="cuerpo" required rows={2} placeholder="Escribir un comentario o pedir información…" className={inputClass} />
        <FieldError message={estado.fieldErrors?.cuerpo} />
        <FormError message={estado.error} />
      </div>
      <SubmitButton variant="primary" className="text-xs px-3 py-2 whitespace-nowrap">Comentar</SubmitButton>
    </form>
  );
}

export function CancelarSolicitudForm({ id }: { id: number }) {
  const [estado, formAction] = useActionState(cancelarSolicitudFormAction, ESTADO_INICIAL);
  const { show } = useToast();

  useEffect(() => {
    if (estado.error) show(estado.error, "error");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [estado]);

  return (
    <form action={formAction} className="inline">
      <input type="hidden" name="id" value={id} />
      <SubmitButton variant="ghost" className="text-xs text-[var(--color-rojo)]">Cancelar solicitud</SubmitButton>
    </form>
  );
}
