"use client";

import { useActionState, useEffect, type ReactNode } from "react";
import { FormError, SubmitButton, useToast } from "@/components/ui-client";
import { ESTADO_INICIAL } from "@/lib/actionState";
import { guardarReglamentoFormAction, generarCuotasAhoraFormAction } from "@/lib/actions/reglamento";

/** Fase 1C: una sección del Reglamento (formulario corto, con su propio botón Guardar). */
export function SeccionReglamentoForm({ seccion, children, editable }: { seccion: string; children: ReactNode; editable: boolean }) {
  const [estado, formAction] = useActionState(guardarReglamentoFormAction, ESTADO_INICIAL);
  const { show } = useToast();
  useEffect(() => {
    if (estado.ok) show("Reglamento guardado.");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [estado]);
  const errores = Object.values(estado.fieldErrors ?? {}).filter(Boolean) as string[];
  return (
    <form action={formAction} className="space-y-4">
      <input type="hidden" name="seccion" value={seccion} />
      <fieldset disabled={!editable} className="space-y-4 disabled:opacity-80">
        {children}
      </fieldset>
      {errores.length > 0 ? (
        <ul className="rounded-xl bg-[var(--color-rojo-bg)] px-4 py-3 text-[15px] text-[var(--color-rojo)] space-y-1" role="alert">
          {errores.map((e, i) => <li key={i}>{e}</li>)}
        </ul>
      ) : (
        <FormError message={estado.error} />
      )}
      {editable && <SubmitButton pendingLabel="Guardando…">Guardar</SubmitButton>}
    </form>
  );
}

export function GenerarCuotasAhoraBoton() {
  const [estado, formAction] = useActionState(generarCuotasAhoraFormAction, ESTADO_INICIAL);
  const { show } = useToast();
  useEffect(() => {
    if (estado.error) show(estado.error, "error");
    else if (estado.ok && estado.aviso) show(estado.aviso);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [estado]);
  return (
    <form action={formAction}>
      <SubmitButton variant="secondary" pendingLabel="Generando…">Generar ahora las cuotas de este mes</SubmitButton>
      {estado.ok && estado.aviso && <p className="mt-2 text-[15px] text-ink">{estado.aviso}</p>}
    </form>
  );
}
