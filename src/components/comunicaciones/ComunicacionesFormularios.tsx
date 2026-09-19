"use client";

// Fase 7 del sistema de gestión de Comisiones (19/09). Mismo criterio que
// DecisionesFormularios.tsx: alta en un Modal (no navega a otra pantalla).
// A diferencia de Decisiones, no hay más formularios de acción sobre una
// comunicación ya enviada que "marcar como leída" (ver la nota de alcance
// en actions/comunicaciones.ts).

import { useActionState, useEffect, useRef, useState } from "react";
import { crearComunicacionFormAction, marcarLeidaComunicacionFormAction } from "@/lib/actions/comunicaciones";
import { ESTADO_INICIAL } from "@/lib/actionState";
import { FieldError, FormError, SubmitButton, useToast, Modal } from "@/components/ui-client";
import { AddButton, Label, inputClass } from "@/components/ui";
import { TIPO_COMUNICACION_LABEL, type TipoComunicacion } from "./ComunicacionStatus";

type Opcion = { id: number; nombre: string };

export function CrearComunicacionForm({
  comisiones,
  usuarios,
  tiposDisponibles,
}: {
  comisiones: Opcion[];
  usuarios: Opcion[];
  tiposDisponibles: TipoComunicacion[];
}) {
  const [open, setOpen] = useState(false);
  const [tipo, setTipo] = useState<TipoComunicacion>(tiposDisponibles[0] ?? "entre_comision");
  const [estado, formAction] = useActionState(crearComunicacionFormAction, ESTADO_INICIAL);
  const formRef = useRef<HTMLFormElement>(null);
  const { show } = useToast();

  useEffect(() => {
    if (estado.ok) {
      formRef.current?.reset();
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setTipo(tiposDisponibles[0] ?? "entre_comision");
      setOpen(false);
      show("Comunicación enviada.");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [estado]);

  return (
    <>
      <AddButton onClick={() => setOpen(true)}>Nueva comunicación</AddButton>
      <Modal open={open} onClose={() => setOpen(false)} title="Enviar comunicación" size="lg">
        <form ref={formRef} action={formAction} className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-ink">
          <div className="sm:col-span-2">
            <Label>Tipo</Label>
            <select
              name="tipo"
              required
              className={inputClass}
              value={tipo}
              onChange={(e) => setTipo(e.target.value as TipoComunicacion)}
            >
              {tiposDisponibles.map((t) => (
                <option key={t} value={t}>{TIPO_COMUNICACION_LABEL[t]}</option>
              ))}
            </select>
          </div>
          {tipo === "entre_comision" && (
            <div className="sm:col-span-2">
              <Label>Comisión</Label>
              <select name="comision_id" required className={inputClass} defaultValue="">
                <option value="" disabled>Elegir…</option>
                {comisiones.map((c) => (
                  <option key={c.id} value={c.id}>{c.nombre}</option>
                ))}
              </select>
              <FieldError message={estado.fieldErrors?.comision_id} />
            </div>
          )}
          {tipo === "privada" && (
            <div className="sm:col-span-2">
              <Label>Para</Label>
              <select name="destinatario_id" required className={inputClass} defaultValue="">
                <option value="" disabled>Elegir…</option>
                {usuarios.map((u) => (
                  <option key={u.id} value={u.id}>{u.nombre}</option>
                ))}
              </select>
              <FieldError message={estado.fieldErrors?.destinatario_id} />
            </div>
          )}
          <div className="sm:col-span-2">
            <Label>Asunto</Label>
            <input name="asunto" required placeholder="Ej: Cambio de horario de la próxima reunión" className={inputClass} />
            <FieldError message={estado.fieldErrors?.asunto} />
          </div>
          <div className="sm:col-span-2">
            <Label>Mensaje</Label>
            <textarea name="cuerpo" required rows={4} className={inputClass} />
            <FieldError message={estado.fieldErrors?.cuerpo} />
          </div>
          <div className="sm:col-span-2">
            <FormError message={estado.error} />
          </div>
          <div className="sm:col-span-2">
            <SubmitButton variant="add" pendingLabel="Enviando…">Enviar</SubmitButton>
          </div>
        </form>
      </Modal>
    </>
  );
}

export function MarcarLeidaComunicacionForm({ id }: { id: number }) {
  const [estado, formAction] = useActionState(marcarLeidaComunicacionFormAction, ESTADO_INICIAL);
  const { show } = useToast();

  useEffect(() => {
    if (estado.error) show(estado.error, "error");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [estado]);

  return (
    <form action={formAction} className="inline">
      <input type="hidden" name="id" value={id} />
      <SubmitButton variant="ghost" className="text-xs px-2.5 py-1.5 whitespace-nowrap">Marcar como leída</SubmitButton>
    </form>
  );
}
