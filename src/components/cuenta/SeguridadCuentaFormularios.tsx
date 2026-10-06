"use client";

import { useActionState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { FormError, SubmitButton, useToast } from "@/components/ui-client";
import { inputClass, Label } from "@/components/ui";
import { ESTADO_INICIAL } from "@/lib/actionState";
import {
  prepararDosPasosFormAction,
  confirmarDosPasosFormAction,
  desactivarDosPasosFormAction,
  cerrarOtrasSesionesFormAction,
} from "@/lib/actions/seguridadCuenta";

export function ActivarDosPasosBoton() {
  const [estado, accion] = useActionState(prepararDosPasosFormAction, ESTADO_INICIAL);
  return (
    <form action={accion}>
      <FormError message={estado.error} />
      <SubmitButton pendingLabel="Preparando…">Activar la verificación en dos pasos</SubmitButton>
    </form>
  );
}

export function ConfirmarDosPasosForm() {
  const [estado, accion] = useActionState(confirmarDosPasosFormAction, ESTADO_INICIAL);
  const router = useRouter();
  if (estado.ok && estado.aviso) {
    const codigos = estado.aviso.split(" ");
    return (
      <div className="space-y-3 rounded-2xl border border-[var(--color-verde)]/40 bg-[var(--color-verde-bg)]/40 p-4 text-[16px]">
        <p className="font-bold text-ink">¡Listo! La verificación en dos pasos quedó activada.</p>
        <p className="text-ink">
          Guardá estos <strong>códigos de respaldo</strong> en un lugar seguro (anotalos o imprimilos). Cada uno sirve una sola vez para entrar si perdés el celular.
          No se vuelven a mostrar.
        </p>
        <ul className="grid grid-cols-2 gap-2 font-mono text-lg">
          {codigos.map((c) => (
            <li key={c} className="rounded-lg bg-surface px-3 py-2 text-center border border-border">{c}</li>
          ))}
        </ul>
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={() => window.print()} className="rounded-xl border border-border bg-surface px-4 py-2.5 font-semibold">Imprimir códigos</button>
          <button type="button" onClick={() => router.refresh()} className="rounded-xl bg-[var(--color-brand-800)] text-white px-4 py-2.5 font-semibold">Ya los guardé</button>
        </div>
      </div>
    );
  }
  return (
    <form action={accion} className="space-y-3">
      <label className="block max-w-xs">
        <Label required>Código que muestra la app</Label>
        <input name="codigo" inputMode="numeric" autoComplete="one-time-code" maxLength={6} required className={`${inputClass} !text-2xl tracking-[0.3em] text-center font-mono`} placeholder="123456" />
      </label>
      <FormError message={estado.fieldErrors?.codigo ?? estado.error} />
      <SubmitButton pendingLabel="Verificando…">Confirmar y activar</SubmitButton>
    </form>
  );
}

export function DesactivarDosPasosForm() {
  const [estado, accion] = useActionState(desactivarDosPasosFormAction, ESTADO_INICIAL);
  const { show } = useToast();
  useEffect(() => {
    if (estado.ok) show("Verificación en dos pasos desactivada.");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [estado]);
  return (
    <details>
      <summary className="cursor-pointer text-[15px] text-ink-muted underline">Desactivar la verificación en dos pasos</summary>
      <form action={accion} className="mt-3 space-y-3">
        <label className="block max-w-xs">
          <Label required>Código actual de la app</Label>
          <input name="codigo" inputMode="numeric" maxLength={6} required className={`${inputClass} font-mono text-center`} />
        </label>
        <FormError message={estado.fieldErrors?.codigo ?? estado.error} />
        <SubmitButton variant="danger" pendingLabel="Desactivando…">Desactivar</SubmitButton>
      </form>
    </details>
  );
}

export function CerrarOtrasSesionesBoton() {
  const [estado, accion] = useActionState(cerrarOtrasSesionesFormAction, ESTADO_INICIAL);
  const { show } = useToast();
  useEffect(() => {
    if (estado.ok && estado.aviso) show(estado.aviso);
    if (estado.error) show(estado.error, "error");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [estado]);
  return (
    <form action={accion}>
      <SubmitButton variant="secondary" pendingLabel="Cerrando…">Cerrar sesión en todos los otros dispositivos</SubmitButton>
    </form>
  );
}
