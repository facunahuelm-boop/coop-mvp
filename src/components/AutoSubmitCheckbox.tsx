"use client";

import { useActionState, useEffect, useRef } from "react";
import { ESTADO_INICIAL, type ActionState } from "@/lib/actionState";
import { useToast } from "./ui-client";

/**
 * Checkbox que envía su propio <form action={...}> apenas cambia, sin botón
 * "Guardar" aparte — mismo patrón que AutoSubmitSelect.tsx (Server Components
 * no pueden tener onChange, por eso este pedacito vive en su propio Client
 * Component). Se usa para tildar ítems de un checklist de tarea (Comisiones
 * como sistema de gestión, Fase 4): el servidor decide el nuevo valor
 * (invierte el actual), así que acá alcanza con reenviar el formulario, sin
 * mandar el valor nuevo.
 */
export function AutoSubmitCheckbox({
  action,
  hiddenFields,
  defaultChecked,
  label,
  className,
}: {
  action: (prevState: ActionState, formData: FormData) => Promise<ActionState>;
  hiddenFields: Record<string, string | number>;
  defaultChecked: boolean;
  label?: string;
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
    <form ref={formRef} action={formAction} className={`inline-flex items-center gap-2 ${className ?? ""}`}>
      {Object.entries(hiddenFields).map(([k, v]) => (
        <input key={k} type="hidden" name={k} value={v} />
      ))}
      <input
        type="checkbox"
        defaultChecked={defaultChecked}
        onChange={() => formRef.current?.requestSubmit()}
        className="h-3.5 w-3.5 rounded border-ink/30 accent-[var(--color-brand-800)]"
      />
      {label && <span>{label}</span>}
    </form>
  );
}
