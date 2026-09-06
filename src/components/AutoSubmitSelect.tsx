"use client";

import { useRef } from "react";

/**
 * <select> que envía su propio <form action={...}> apenas cambia el valor,
 * sin botón "Guardar" aparte. Server Components no pueden tener manejadores
 * de eventos (onChange) directamente — por eso este pedacito puntual de
 * interactividad vive en su propio Client Component, y el resto de cada
 * página que lo usa sigue siendo un Server Component normal.
 *
 * Antes vivía solo en app/(app)/socios/ (donde se usó por primera vez, para
 * cambiar el estado de un socio/vivienda/lista de espera sin recargar la
 * fila); se promovió acá porque Fase 06 (tareas por comisión) necesita el
 * mismo patrón para cambiar el estado de una tarea sin un botón aparte.
 */
export function AutoSubmitSelect({
  action,
  hiddenFields,
  name,
  options,
  defaultValue,
  className,
}: {
  action: (formData: FormData) => void;
  hiddenFields: Record<string, string | number>;
  name: string;
  options: { value: string | number; label: string }[];
  defaultValue: string | number;
  className?: string;
}) {
  const formRef = useRef<HTMLFormElement>(null);
  return (
    <form ref={formRef} action={action} className="inline">
      {Object.entries(hiddenFields).map(([k, v]) => (
        <input key={k} type="hidden" name={k} value={v} />
      ))}
      <select
        name={name}
        defaultValue={defaultValue}
        onChange={() => formRef.current?.requestSubmit()}
        className={className}
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </form>
  );
}
