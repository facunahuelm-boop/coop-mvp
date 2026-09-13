"use client";

import { useRef, useState } from "react";
import { ConfirmDialog } from "./ui-client";

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
  action: (formData: FormData) => void;
  hiddenFields: Record<string, string | number>;
  titulo: string;
  descripcion?: string;
  textoBoton?: string;
  confirmarLabel?: string;
  className?: string;
}) {
  const [abierto, setAbierto] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);

  return (
    <>
      <form ref={formRef} action={action} className="inline">
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
