"use client";

import { useActionState, useEffect, useState } from "react";
import { FormError, SubmitButton, useToast } from "@/components/ui-client";
import { inputClass } from "@/components/ui";
import { ESTADO_INICIAL } from "@/lib/actionState";
import { decidirCompraFormAction } from "@/lib/actions/compras";

/**
 * Fase 2G — elegir el proveedor de una compra. Los campos son controlados
 * para que, si el servidor pide algo más (el motivo de la excepción a la
 * regla de montos o confirmar la documentación vencida), no se pierda lo
 * que ya se escribió.
 */
export function DecidirCompraForm({
  solicitudId,
  presupuestoId,
  pedirExcepcion,
  docVencida,
}: {
  solicitudId: number;
  presupuestoId: number;
  pedirExcepcion: boolean;
  docVencida: boolean;
}) {
  const [estado, formAction] = useActionState(decidirCompraFormAction, ESTADO_INICIAL);
  const [motivo, setMotivo] = useState("");
  const [excepcion, setExcepcion] = useState("");
  const [confirmo, setConfirmo] = useState(false);
  const { show } = useToast();
  useEffect(() => {
    if (estado.ok) show("Proveedor elegido.");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [estado]);
  return (
    <form action={formAction} className="mt-3">
      <input type="hidden" name="solicitud_id" value={solicitudId} />
      <input type="hidden" name="presupuesto_id" value={presupuestoId} />
      <FormError message={estado.error} />
      <input name="motivo" value={motivo} onChange={(e) => setMotivo(e.target.value)} placeholder="Motivo (opcional)" className={inputClass + " text-xs mb-2"} />
      {pedirExcepcion && (
        <textarea
          name="excepcion_regla"
          rows={2}
          maxLength={500}
          value={excepcion}
          onChange={(e) => setExcepcion(e.target.value)}
          placeholder="¿Por qué se aprueba con menos presupuestos? (obligatorio)"
          className={inputClass + " text-xs mb-2"}
        />
      )}
      {docVencida && (
        <label className="flex items-start gap-2 text-xs text-ink mb-2">
          <input type="checkbox" name="confirmo_doc_vencida" value="si" checked={confirmo} onChange={(e) => setConfirmo(e.target.checked)} className="mt-0.5 h-4 w-4" />
          Sé que tiene documentación vencida y lo elijo igual.
        </label>
      )}
      <SubmitButton className="w-full text-xs">Seleccionar proveedor</SubmitButton>
    </form>
  );
}
