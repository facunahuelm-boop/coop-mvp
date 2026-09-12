"use client";

import { useActionState, useEffect, useRef } from "react";
import { cambiarPasswordFormAction } from "@/lib/actions/usuarios";
import { ESTADO_INICIAL } from "@/lib/actionState";
import { FieldError, FormError, SubmitButton, useToast } from "./ui-client";
import { Label, inputClass } from "./ui";

/**
 * Fase 6 del Plan Maestro (perfil individual de usuario). Solo aparece en la
 * ficha del propio usuario (ver page.tsx) — la Server Action nunca recibe un
 * id, siempre opera sobre quien está logueado.
 */
export function CambiarPasswordForm() {
  const [estado, formAction] = useActionState(cambiarPasswordFormAction, ESTADO_INICIAL);
  const formRef = useRef<HTMLFormElement>(null);
  const { show } = useToast();

  useEffect(() => {
    if (estado.ok) {
      formRef.current?.reset();
      show("Contraseña actualizada.");
    }
    // Solo interesa reaccionar cuando cambia el resultado de un envío.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [estado]);

  return (
    <form ref={formRef} action={formAction} className="grid grid-cols-1 gap-3 max-w-sm">
      <div>
        <Label>Contraseña actual</Label>
        <input name="actual" type="password" autoComplete="current-password" required className={inputClass} />
        <FieldError message={estado.fieldErrors?.actual} />
      </div>
      <div>
        <Label>Nueva contraseña</Label>
        <input name="nueva" type="password" autoComplete="new-password" required minLength={8} className={inputClass} />
        <FieldError message={estado.fieldErrors?.nueva} />
      </div>
      <div>
        <Label>Confirmar nueva contraseña</Label>
        <input name="confirmar" type="password" autoComplete="new-password" required minLength={8} className={inputClass} />
        <FieldError message={estado.fieldErrors?.confirmar} />
      </div>
      <FormError message={estado.error} />
      <div>
        <SubmitButton pendingLabel="Guardando…">Cambiar contraseña</SubmitButton>
      </div>
    </form>
  );
}
