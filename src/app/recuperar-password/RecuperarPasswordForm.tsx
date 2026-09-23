"use client";

import { useActionState } from "react";
import Link from "next/link";
import { solicitarRecuperacionAction } from "@/lib/actions/recuperarPassword";
import { inputClass, Label } from "@/components/ui";

type Props = {
  nombre: string;
  colorPrimario: string;
};

export function RecuperarPasswordForm({ nombre, colorPrimario }: Props) {
  const [state, formAction, pending] = useActionState(solicitarRecuperacionAction, undefined);

  return (
    <div className="min-h-full flex-1 flex items-center justify-center bg-[var(--color-page-bg)] px-4 py-10">
      <div className="w-full max-w-sm">
        <div className="flex flex-col items-center mb-6 text-center">
          <p className="text-sm font-semibold text-[var(--color-brand-900)]">{nombre}</p>
          <p className="text-sm text-ink/55 mt-1">Recuperar contraseña</p>
        </div>

        {state?.ok ? (
          <div className="bg-surface rounded-2xl shadow-sm border border-ink/5 p-5 space-y-4">
            <p className="text-sm text-ink/70">{state.mensaje}</p>
            <Link href="/login" className="block text-center text-sm font-medium text-[var(--color-brand-800)] hover:underline">
              Volver a inicio de sesión
            </Link>
          </div>
        ) : (
          <form action={formAction} className="bg-surface rounded-2xl shadow-sm border border-ink/5 p-5 space-y-4">
            <p className="text-xs text-ink/55">
              Ingresá el email de tu cuenta. Si existe, te mandamos un enlace para elegir una contraseña nueva.
            </p>
            <div>
              <Label>Email</Label>
              <input name="email" type="email" required className={inputClass} placeholder="tu@coop.uy" autoComplete="username" />
            </div>
            {state?.error && <p className="text-sm text-[var(--color-rojo)]">{state.error}</p>}
            <button
              type="submit"
              disabled={pending}
              className="w-full rounded-xl text-white py-2.5 text-sm font-semibold disabled:opacity-60"
              style={{ backgroundColor: colorPrimario }}
            >
              {pending ? "Enviando…" : "Enviar enlace"}
            </button>
            <Link href="/login" className="block text-center text-xs text-ink/50 hover:underline">
              Volver a inicio de sesión
            </Link>
          </form>
        )}
      </div>
    </div>
  );
}
