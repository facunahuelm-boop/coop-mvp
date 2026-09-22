"use client";

// Sub-fase 1.4 ("Consejo Directivo — vista propia"): mismo patrón de
// useActionState + <details> colapsable ya usado en Reuniones/Documentos.

import { useActionState, useEffect, useRef } from "react";
import {
  asignarCargoConsejoFormAction,
  finalizarCargoConsejoFormAction,
} from "@/lib/actions/consejoDirectivo";
import { CARGOS_CONSEJO, CARGO_LABEL } from "@/lib/consejoDirectivoCargos";
import { ESTADO_INICIAL } from "@/lib/actionState";
import { FieldError, FormError, SubmitButton, useToast } from "@/components/ui-client";
import { Card, Label, inputClass } from "@/components/ui";

type Integrante = { id: number; nombre: string };

export function AsignarCargoForm({ integrantes }: { integrantes: Integrante[] }) {
  const [estado, formAction] = useActionState(asignarCargoConsejoFormAction, ESTADO_INICIAL);
  const formRef = useRef<HTMLFormElement>(null);
  const detailsRef = useRef<HTMLDetailsElement>(null);
  const { show } = useToast();

  useEffect(() => {
    if (estado.ok) {
      formRef.current?.reset();
      if (detailsRef.current) detailsRef.current.open = false;
      show("Cargo asignado.");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [estado]);

  return (
    <details ref={detailsRef}>
      <summary className="cursor-pointer text-sm font-semibold text-[var(--color-brand-800)]">+ Asignar cargo</summary>
      <Card className="mt-3">
        <form ref={formRef} action={formAction} className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div>
            <Label>Persona</Label>
            <select name="user_id" required className={inputClass} defaultValue="">
              <option value="" disabled>Elegir…</option>
              {integrantes.map((i) => (
                <option key={i.id} value={i.id}>{i.nombre}</option>
              ))}
            </select>
            <FieldError message={estado.fieldErrors?.user_id} />
          </div>
          <div>
            <Label>Cargo</Label>
            <select name="cargo" className={inputClass} defaultValue="vocal">
              {CARGOS_CONSEJO.map((c) => (
                <option key={c} value={c}>{CARGO_LABEL[c]}</option>
              ))}
            </select>
          </div>
          <div>
            <Label>Desde</Label>
            <input type="date" name="fecha_inicio" required className={inputClass} />
            <FieldError message={estado.fieldErrors?.fecha_inicio} />
          </div>
          <div className="sm:col-span-3">
            <p className="text-xs text-ink/40">
              Si el cargo elegido (Presidente, Secretario o Tesorero) ya tiene un titular vigente, su mandato se cierra
              automáticamente en esta fecha — queda registrado como un mandato propio en el historial.
            </p>
          </div>
          <div className="sm:col-span-3">
            <FormError message={estado.error} />
          </div>
          <div className="sm:col-span-3">
            <SubmitButton pendingLabel="Asignando…">Asignar cargo</SubmitButton>
          </div>
        </form>
      </Card>
    </details>
  );
}

export function FinalizarCargoForm({ id }: { id: number }) {
  const [estado, formAction] = useActionState(finalizarCargoConsejoFormAction, ESTADO_INICIAL);
  const { show } = useToast();

  useEffect(() => {
    if (estado.ok) show("Mandato finalizado.");
    if (estado.error) show(estado.error, "error");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [estado]);

  return (
    <form action={formAction} className="flex items-center gap-1.5">
      <input type="hidden" name="id" value={id} />
      <input type="date" name="fecha_fin" required className={inputClass + " text-xs !py-1 !w-auto"} />
      <SubmitButton variant="ghost" className="text-xs px-2 py-1 whitespace-nowrap">Finalizar mandato</SubmitButton>
    </form>
  );
}
