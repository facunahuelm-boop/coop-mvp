"use client";

// Fase 5, Sub-fase 5.4 ("Soporte", sección 22). Mismos patrones ya usados en
// el resto del sistema: Modal + useActionState para el alta (mismo criterio
// que CrearCooperativaForm en plataforma/), ActionForm de un solo campo para
// agregar un mensaje al hilo (mismo criterio que ComentarSolicitudForm en
// solicitudes/), y un botón simple para abrir/cerrar el propio ticket (mismo
// criterio que AlternarActivoCooperativaButton en plataforma/).

import { useActionState, useEffect, useRef, useState } from "react";
import {
  crearTicketFormAction,
  agregarMensajeTicketFormAction,
  cambiarEstadoTicketFormAction,
} from "@/lib/actions/soporte";
import { ESTADO_INICIAL } from "@/lib/actionState";
import { ActionForm, FieldError, FormError, SubmitButton, useToast, Modal } from "@/components/ui-client";
import { AddButton, Label, inputClass } from "@/components/ui";
import { CATEGORIA_TICKET_LABEL } from "@/lib/constants";

export function CrearTicketForm() {
  const [open, setOpen] = useState(false);
  const [estado, formAction] = useActionState(crearTicketFormAction, ESTADO_INICIAL);
  const formRef = useRef<HTMLFormElement>(null);
  const { show } = useToast();

  useEffect(() => {
    if (estado.ok) {
      formRef.current?.reset();
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setOpen(false);
      show("Ticket enviado.");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [estado]);

  return (
    <>
      <AddButton onClick={() => setOpen(true)}>Nuevo ticket</AddButton>
      <Modal open={open} onClose={() => setOpen(false)} title="Contactar a soporte">
        <form ref={formRef} action={formAction} className="grid grid-cols-1 gap-3">
          <div>
            <Label>Asunto</Label>
            <input name="asunto" required placeholder="Resumí el problema o la consulta en una línea" className={inputClass} />
            <FieldError message={estado.fieldErrors?.asunto} />
          </div>
          <div>
            <Label>Categoría</Label>
            <select name="categoria" className={inputClass} defaultValue="consulta">
              {Object.entries(CATEGORIA_TICKET_LABEL).map(([valor, label]) => (
                <option key={valor} value={valor}>{label}</option>
              ))}
            </select>
          </div>
          <div>
            <Label>Contanos con el mayor detalle posible qué pasó</Label>
            <textarea name="mensaje" required rows={4} className={inputClass} />
            <FieldError message={estado.fieldErrors?.mensaje} />
          </div>
          <p className="text-xs text-ink/40">
            Este ticket lo ve el equipo que administra la plataforma (no es visible para el resto de tu cooperativa, salvo el administrador).
          </p>
          <FormError message={estado.error} />
          <SubmitButton pendingLabel="Enviando…">Enviar</SubmitButton>
        </form>
      </Modal>
    </>
  );
}

export function ResponderTicketForm({ id }: { id: number }) {
  const [estado, formAction] = useActionState(agregarMensajeTicketFormAction, ESTADO_INICIAL);
  const formRef = useRef<HTMLFormElement>(null);
  const { show } = useToast();

  useEffect(() => {
    if (estado.ok) {
      formRef.current?.reset();
      show("Mensaje enviado.");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [estado]);

  return (
    <form ref={formRef} action={formAction} className="mt-3 space-y-2">
      <input type="hidden" name="id" value={id} />
      <textarea name="texto" required rows={2} placeholder="Escribí una respuesta…" className={inputClass} />
      <FieldError message={estado.fieldErrors?.texto} />
      <FormError message={estado.error} />
      <SubmitButton pendingLabel="Enviando…">Responder</SubmitButton>
    </form>
  );
}

export function CambiarEstadoTicketButton({ id, estado }: { id: number; estado: string }) {
  const esResuelto = estado === "resuelto";
  return (
    <ActionForm action={cambiarEstadoTicketFormAction}>
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="estado" value={esResuelto ? "abierto" : "resuelto"} />
      <button type="submit" className="text-xs underline text-[var(--color-brand-800)]">
        {esResuelto ? "Reabrir" : "Marcar como resuelto"}
      </button>
    </ActionForm>
  );
}
