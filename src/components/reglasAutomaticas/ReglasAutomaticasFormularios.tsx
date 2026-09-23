"use client";

// Fase 3, Sub-fase 3.3 ("Motor de reglas evento-condición-acción"). Mismo
// criterio de alta en Modal que ya usan Comunicaciones/Decisiones — no
// navega a otra pantalla. El campo "acción" cambia qué campos adicionales
// se piden (rol+mensaje para notificar, rol+severidad+título para alerta),
// mismo patrón ya usado en CrearComunicacionForm para el campo "tipo".

import { useActionState, useEffect, useRef, useState } from "react";
import { crearReglaAutomaticaFormAction, alternarReglaAutomaticaFormAction } from "@/lib/actions/reglasAutomaticas";
import { ESTADO_INICIAL } from "@/lib/actionState";
import { FieldError, FormError, SubmitButton, useToast, Modal } from "@/components/ui-client";
import { ActionForm } from "@/components/ui-client";
import { AddButton, Label, inputClass, Badge } from "@/components/ui";
import {
  EVENTOS_DISPONIBLES,
  ACCIONES_DISPONIBLES,
  SEVERIDADES_ALERTA,
  ROLES_PARA_REGLAS,
  type AccionTipo,
} from "@/lib/reglasAutomaticasCatalogo";

export function CrearReglaAutomaticaForm() {
  const [open, setOpen] = useState(false);
  const [accionTipo, setAccionTipo] = useState<AccionTipo>("notificar_rol");
  const [estado, formAction] = useActionState(crearReglaAutomaticaFormAction, ESTADO_INICIAL);
  const formRef = useRef<HTMLFormElement>(null);
  const { show } = useToast();

  useEffect(() => {
    if (estado.ok) {
      formRef.current?.reset();
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setAccionTipo("notificar_rol");
      setOpen(false);
      show("Regla creada.");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [estado]);

  return (
    <>
      <AddButton onClick={() => setOpen(true)}>Nueva regla</AddButton>
      <Modal open={open} onClose={() => setOpen(false)} title="Nueva regla automática" size="lg">
        <form ref={formRef} action={formAction} className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-ink">
          <div className="sm:col-span-2">
            <Label>Nombre de la regla</Label>
            <input name="nombre" required placeholder="Ej: Avisar a Tesorería de compras aprobadas" className={inputClass} />
            <FieldError message={estado.fieldErrors?.nombre} />
          </div>

          <div className="sm:col-span-2">
            <Label>Cuando pase este evento…</Label>
            <select name="evento" required className={inputClass} defaultValue="">
              <option value="" disabled>Elegir…</option>
              {EVENTOS_DISPONIBLES.map((e) => (
                <option key={e.value} value={e.value}>{e.label}</option>
              ))}
            </select>
            <FieldError message={estado.fieldErrors?.evento} />
          </div>

          <div className="sm:col-span-2">
            <Label>Hacer esto automáticamente</Label>
            <select
              name="accion_tipo"
              required
              className={inputClass}
              value={accionTipo}
              onChange={(e) => setAccionTipo(e.target.value as AccionTipo)}
            >
              {ACCIONES_DISPONIBLES.map((a) => (
                <option key={a.value} value={a.value}>{a.label}</option>
              ))}
            </select>
            <FieldError message={estado.fieldErrors?.accion_tipo} />
          </div>

          <div>
            <Label>{accionTipo === "notificar_rol" ? "Notificar a" : "Asignar la alerta a"}</Label>
            <select name="rol" required className={inputClass} defaultValue="">
              <option value="" disabled>Elegir rol…</option>
              {ROLES_PARA_REGLAS.map((r) => (
                <option key={r.value} value={r.value}>{r.label}</option>
              ))}
            </select>
            <FieldError message={estado.fieldErrors?.rol} />
          </div>

          {accionTipo === "notificar_rol" ? (
            <div>
              <Label>Mensaje (opcional)</Label>
              <input name="mensaje" placeholder="Si lo dejás vacío, usa el mismo texto del evento" className={inputClass} />
              <FieldError message={estado.fieldErrors?.mensaje} />
            </div>
          ) : (
            <div>
              <Label>Severidad</Label>
              <select name="severidad" required className={inputClass} defaultValue="">
                <option value="" disabled>Elegir…</option>
                {SEVERIDADES_ALERTA.map((s) => (
                  <option key={s.value} value={s.value}>{s.label}</option>
                ))}
              </select>
              <FieldError message={estado.fieldErrors?.severidad} />
            </div>
          )}

          {accionTipo === "crear_alerta" && (
            <div className="sm:col-span-2">
              <Label>Título de la alerta (opcional)</Label>
              <input name="titulo_alerta" placeholder="Si lo dejás vacío, usa el mismo título del evento" className={inputClass} />
              <FieldError message={estado.fieldErrors?.titulo_alerta} />
            </div>
          )}

          <FormError message={estado.error} />
          <div className="sm:col-span-2">
            <SubmitButton pendingLabel="Creando…">Crear regla</SubmitButton>
          </div>
        </form>
      </Modal>
    </>
  );
}

export function AlternarReglaButton({ id, activa }: { id: number; activa: boolean }) {
  return (
    <ActionForm action={alternarReglaAutomaticaFormAction}>
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="activa" value={activa ? "false" : "true"} />
      <button className="text-xs underline text-[var(--color-brand-800)]">
        {activa ? "Desactivar" : "Activar"}
      </button>
    </ActionForm>
  );
}

export function EstadoReglaBadge({ activa }: { activa: boolean }) {
  return <Badge color={activa ? "verde" : "gray"}>{activa ? "Activa" : "Desactivada"}</Badge>;
}
