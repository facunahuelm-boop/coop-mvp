"use client";

import { useActionState, useEffect, useId, useRef, useState } from "react";
import { ConfirmDialog, Modal, useToast } from "./ui-client";
import { ESTADO_INICIAL, type ActionState } from "@/lib/actionState";

/**
 * Fase 10 del Prompt Maestro (H-11): reemplaza el patrón "escribí ELIMINAR
 * para confirmar" (un <input> de texto libre) por el <ConfirmDialog> que ya
 * estaba construido en ui-client.tsx pero sin usar en ninguna pantalla. Se
 * usa solo en los 3 lugares que hoy hacen un borrado permanente de verdad
 * (documentos, solicitudes de compra, proveedores) — el resto del sistema ya
 * usa `estado`/`activo` (baja lógica, no DELETE), que no necesita esta
 * fricción extra.
 *
 * Se mantiene la misma "Zona de administrador" (<details> colapsado + texto
 * explicativo) de cada pantalla sin tocarla — esto solo reemplaza el widget
 * de confirmación en sí, no el resto de la capa de seguridad ya existente
 * (colapsado por defecto, gateado a admin, con la consecuencia explicada).
 * Escribir un texto exacto no es más seguro que un modal con la descripción
 * de la consecuencia y un botón rojo dedicado — y es más difícil de usar
 * para alguien sin conocimientos técnicos o con dificultad para escribir en
 * el celular, así que el modal es una mejora real, no solo estética.
 *
 * Endurecimiento de errores (pasada posterior a la Fase 4): antes recibía la
 * Server Action cruda — un borrado rechazado (ej. una restricción de base
 * violada porque el registro todavía tiene referencias) reventaba la
 * pantalla entera contra el boundary genérico. Ahora recibe la versión
 * envuelta con `conEstadoDeAccion` y muestra el resultado como toast.
 */
export function ConfirmarEliminar({
  action,
  hiddenFields,
  titulo,
  descripcion,
  textoBoton = "Eliminar definitivamente",
  confirmarLabel = "Sí, eliminar definitivamente",
  className,
  pedirMotivo = false,
  placeholderMotivo = "Ej.: se cargó por error",
}: {
  action: (prevState: ActionState, formData: FormData) => Promise<ActionState>;
  hiddenFields: Record<string, string | number>;
  titulo: string;
  descripcion?: string;
  textoBoton?: string;
  confirmarLabel?: string;
  className?: string;
  /** Fase 1A (nada se borra): pide el motivo, que queda guardado y en la auditoría. */
  pedirMotivo?: boolean;
  placeholderMotivo?: string;
}) {
  const [abierto, setAbierto] = useState(false);
  const [estado, formAction] = useActionState(action, ESTADO_INICIAL);
  const formRef = useRef<HTMLFormElement>(null);
  const formId = useId();
  const [motivo, setMotivo] = useState("");
  const { show } = useToast();

  useEffect(() => {
    if (estado.error) show(estado.error, "error");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [estado]);

  return (
    <>
      <form ref={formRef} id={formId} action={formAction} className="inline">
        {Object.entries(hiddenFields).map(([k, v]) => (
          <input key={k} type="hidden" name={k} value={v} />
        ))}
        {pedirMotivo && <input type="hidden" name="motivo" value={motivo} />}
      </form>
      <button type="button" onClick={() => setAbierto(true)} className={className}>
        {textoBoton}
      </button>
      {pedirMotivo ? (
        <Modal
          open={abierto}
          onClose={() => setAbierto(false)}
          title={titulo}
          footer={
            <>
              <button
                type="button"
                onClick={() => setAbierto(false)}
                className="inline-flex items-center justify-center rounded-xl px-4 py-2.5 text-sm font-semibold text-ink-muted hover:bg-surface-sunken transition-colors"
              >
                Volver
              </button>
              <button
                type="button"
                disabled={motivo.trim().length < 3}
                onClick={() => {
                  setAbierto(false);
                  formRef.current?.requestSubmit();
                }}
                className="inline-flex items-center justify-center rounded-xl px-4 py-2.5 text-sm font-semibold bg-[var(--color-rojo)] text-white disabled:opacity-40"
              >
                {confirmarLabel}
              </button>
            </>
          }
        >
          <div className="space-y-3 text-[15px]">
            {descripcion && <p className="text-ink">{descripcion}</p>}
            <label className="block">
              <span className="block text-sm font-semibold text-ink mb-1">¿Por qué? (queda registrado)</span>
              <textarea
                value={motivo}
                onChange={(e) => setMotivo(e.target.value)}
                rows={3}
                maxLength={300}
                placeholder={placeholderMotivo}
                className="w-full rounded-xl border border-border bg-surface px-3 py-2 text-[15px]"
              />
            </label>
          </div>
        </Modal>
      ) : (
        <ConfirmDialog
          open={abierto}
          title={titulo}
          description={descripcion}
          confirmLabel={confirmarLabel}
          cancelLabel="Cancelar"
          danger
          onConfirm={() => {
            setAbierto(false);
            formRef.current?.requestSubmit();
          }}
          onCancel={() => setAbierto(false)}
        />
      )}
    </>
  );
}
