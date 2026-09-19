"use client";

// Fase 7 del sistema de gestión de Comisiones (19/09). Dos formularios chicos
// sin campos que validar (mismo criterio que CerrarVotacionForm/
// ReabrirDecisionForm) — se resuelven acá porque necesitan useActionState.

import { useActionState, useEffect } from "react";
import {
  marcarNotificacionLeidaFormAction,
  marcarTodasNotificacionesLeidasFormAction,
} from "@/lib/actions/notificaciones";
import { ESTADO_INICIAL } from "@/lib/actionState";
import { SubmitButton, useToast } from "@/components/ui-client";

export function MarcarNotificacionLeidaForm({ id }: { id: number }) {
  const [estado, formAction] = useActionState(marcarNotificacionLeidaFormAction, ESTADO_INICIAL);
  const { show } = useToast();

  useEffect(() => {
    if (estado.error) show(estado.error, "error");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [estado]);

  return (
    <form action={formAction} className="inline">
      <input type="hidden" name="id" value={id} />
      <SubmitButton variant="ghost" className="text-xs px-2.5 py-1.5 whitespace-nowrap">Marcar leída</SubmitButton>
    </form>
  );
}

export function MarcarTodasLeidasForm() {
  const [estado, formAction] = useActionState(marcarTodasNotificacionesLeidasFormAction, ESTADO_INICIAL);
  const { show } = useToast();

  useEffect(() => {
    if (estado.ok) show("Notificaciones marcadas como leídas.");
    if (estado.error) show(estado.error, "error");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [estado]);

  return (
    <form action={formAction}>
      <SubmitButton variant="secondary" className="text-sm">Marcar todas como leídas</SubmitButton>
    </form>
  );
}
