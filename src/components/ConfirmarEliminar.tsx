"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { ConfirmDialog, useToast } from "./ui-client";
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
}: {
  action: (prevState: ActionState, formData: FormData) => Promise<ActionState>;
  hiddenFields: Record<string, string | number>;
  titulo: string;
  descripcion?: string;
  textoBoton?: string;
  confirmarLabel?: string;
  className?: string;
}) {
  const [abierto, setAbierto] = useState(false);
  const [estado, formAction] = useActionState(action, ESTADO_INICIAL);
  const formRef = useRef<HTMLFormElement>(null);
  const { show } = useToast();

  useEffect(() => {
    if (estado.error) show(estado.error, "error");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [estado]);

  return (
    <>
      <form ref={formRef} action={formAction} className="inline">
        {Object.entries(hiddenFields).map(([k, v]) => (
          <input key={k} type="hidden" name={k} value={v} />
        ))}
      </form>
      <button type="button" onClick={() => setAbierto(true)} className={className}>
        {textoBoton}
      </button>
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
    </>
  );
}
