"use client";

import { useActionState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { FormError, SubmitButton, useToast } from "@/components/ui-client";
import { ESTADO_INICIAL } from "@/lib/actionState";
import { cambiarEtapaAsistenteFormAction } from "@/lib/actions/configuracion";

/** Fase 3H — confirmación del asistente «Cambiar de etapa». */
export function CambiarEtapaForm({ hacia, textoHacia, sugeridas, ofrecerFondo }: { hacia: string; textoHacia: string; sugeridas: string[]; ofrecerFondo: boolean }) {
  const [estado, formAction] = useActionState(cambiarEtapaAsistenteFormAction, ESTADO_INICIAL);
  const { show } = useToast();
  const router = useRouter();
  useEffect(() => {
    if (estado.ok) {
      if (estado.aviso) show(estado.aviso);
      router.push("/dashboard");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [estado]);
  return (
    <form action={formAction} className="space-y-3 text-[16px]">
      <input type="hidden" name="etapa" value={hacia} />
      {sugeridas.length > 0 && (
        <label className="flex items-start gap-2">
          <input type="checkbox" name="crear_comisiones" value="1" defaultChecked className="mt-1 h-5 w-5" />
          <span>Crear las comisiones que se suelen usar en esta etapa: {sugeridas.join(", ")}</span>
        </label>
      )}
      {ofrecerFondo && (
        <label className="flex items-start gap-2">
          <input type="checkbox" name="crear_fondo_mantenimiento" value="1" defaultChecked className="mt-1 h-5 w-5" />
          <span>Crear el fondo de mantenimiento en Finanzas</span>
        </label>
      )}
      <label className="flex items-start gap-2">
        <input type="checkbox" name="revisado" value="1" required className="mt-1 h-5 w-5" />
        <span>Revisé lo pendiente y queremos pasar a la etapa {textoHacia}</span>
      </label>
      <FormError message={estado.error} />
      <SubmitButton pendingLabel="Cambiando…">Pasar a {textoHacia}</SubmitButton>
    </form>
  );
}
