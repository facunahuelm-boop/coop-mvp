"use client";

// Sub-fase 1.5 ("Panel de Comisión Fiscal"): mismo patrón useActionState +
// <details> colapsable que ya usan Libros Sociales/Reuniones/Consejo
// Directivo. El único campo real es "Observaciones y conclusiones" — el
// sistema arma el resto del PDF con datos que ya existen.

import { useActionState, useEffect, useRef } from "react";
import { generarInformeFiscalFormAction } from "@/lib/actions/informeFiscal";
import { ESTADO_INICIAL } from "@/lib/actionState";
import { FieldError, FormError, SubmitButton, useToast } from "@/components/ui-client";
import { Card, Label, inputClass } from "@/components/ui";

export function InformeFiscalForm() {
  const [estado, formAction] = useActionState(generarInformeFiscalFormAction, ESTADO_INICIAL);
  const formRef = useRef<HTMLFormElement>(null);
  const detailsRef = useRef<HTMLDetailsElement>(null);
  const { show } = useToast();

  useEffect(() => {
    if (estado.ok) {
      formRef.current?.reset();
      if (detailsRef.current) detailsRef.current.open = false;
      show("Informe generado.");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [estado]);

  return (
    <details ref={detailsRef}>
      <summary className="cursor-pointer text-sm font-semibold text-[var(--color-brand-800)]">+ Generar informe</summary>
      <Card className="mt-3">
        <form ref={formRef} action={formAction} className="space-y-3">
          <div>
            <Label>Observaciones y conclusiones de la Comisión Fiscal</Label>
            <textarea
              name="observaciones"
              required
              className={inputClass}
              rows={6}
              placeholder="Qué se revisó, hallazgos, recomendaciones…"
            />
            <p className="text-xs text-ink/40 mt-1">
              El sistema arma el resto del informe (financiero, alertas, actas, documentos vencidos, auditoría) con datos ya
              cargados — esto es lo único que redacta la Comisión Fiscal.
            </p>
            <FieldError message={estado.fieldErrors?.observaciones} />
          </div>
          <FormError message={estado.error} />
          <SubmitButton pendingLabel="Generando…">Generar informe</SubmitButton>
        </form>
      </Card>
    </details>
  );
}
