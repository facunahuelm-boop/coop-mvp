"use client";

import { useActionState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { FormError, SubmitButton, useToast } from "@/components/ui-client";
import { ESTADO_INICIAL } from "@/lib/actionState";
import { ficharFormAction, revisarFichadaFormAction } from "@/lib/actions/fichadas";

/** Fase 3A — botones grandes "Llegué" / "Me voy" para el celular. */
export function FicharBotones({ codigo, siguiente }: { codigo: string; siguiente: "llegada" | "salida" }) {
  const [estado, formAction] = useActionState(ficharFormAction, ESTADO_INICIAL);
  const router = useRouter();
  const { show } = useToast();
  useEffect(() => {
    if (estado.ok && estado.aviso) {
      show(estado.aviso);
      router.refresh();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [estado]);
  return (
    <form action={formAction} className="space-y-3">
      <input type="hidden" name="codigo" value={codigo} />
      <input type="hidden" name="tipo" value={siguiente} />
      <FormError message={estado.error} />
      {estado.ok && estado.aviso && <p className="rounded-xl bg-[var(--color-verde-bg)] px-4 py-3 text-[17px] text-[var(--color-verde)]" role="status">{estado.aviso}</p>}
      <SubmitButton className="w-full py-5 text-xl">{siguiente === "llegada" ? "Llegué a la obra" : "Me voy de la obra"}</SubmitButton>
    </form>
  );
}

export function RevisarFichadaBoton({ id }: { id: number }) {
  const [, formAction] = useActionState(revisarFichadaFormAction, ESTADO_INICIAL);
  return (
    <form action={formAction}>
      <input type="hidden" name="id" value={id} />
      <button className="text-sm font-semibold text-[var(--color-brand-800)] underline underline-offset-2">Marcar revisada</button>
    </form>
  );
}

export function ImprimirBoton() {
  return (
    <button type="button" onClick={() => window.print()} className="inline-flex items-center justify-center rounded-xl border border-border bg-surface px-3.5 py-2 text-sm font-semibold text-ink hover:bg-surface-sunken print:hidden">
      Imprimir el cartel
    </button>
  );
}
