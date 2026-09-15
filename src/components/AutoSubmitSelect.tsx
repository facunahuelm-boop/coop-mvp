"use client";

import { useActionState, useEffect, useRef } from "react";
import { ESTADO_INICIAL, type ActionState } from "@/lib/actionState";
import { useToast } from "./ui-client";

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
 *
 * Endurecimiento de errores (pasada posterior a la Fase 4): antes recibía la
 * Server Action cruda — si el cambio de estado se rechazaba (un permiso, una
 * transición inválida), la pantalla entera reventaba contra el boundary
 * genérico de error, y el `<select>` (no controlado, con `defaultValue`)
 * quedaba mostrando la opción recién elegida aunque el cambio nunca se haya
 * guardado. Ahora recibe la versión envuelta con `conEstadoDeAccion`, avisa
 * el error como toast, y hace `reset()` del formulario para que el select
 * vuelva a mostrar el valor real (el que sí quedó guardado).
 */
export function AutoSubmitSelect({
  action,
  hiddenFields,
  name,
  options,
  defaultValue,
  className,
}: {
  action: (prevState: ActionState, formData: FormData) => Promise<ActionState>;
  hiddenFields: Record<string, string | number>;
  name: string;
  options: { value: string | number; label: string }[];
  defaultValue: string | number;
  className?: string;
}) {
  const [estado, formAction] = useActionState(action, ESTADO_INICIAL);
  const formRef = useRef<HTMLFormElement>(null);
  const { show } = useToast();

  useEffect(() => {
    if (estado.error) {
      show(estado.error, "error");
      formRef.current?.reset();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [estado]);

  return (
    <form ref={formRef} action={formAction} className="inline">
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
