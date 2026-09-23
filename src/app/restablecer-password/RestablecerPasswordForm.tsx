"use client";

import { useActionState } from "react";
import Link from "next/link";
import { restablecerPasswordAction } from "@/lib/actions/recuperarPassword";
import { inputClass, Label } from "@/components/ui";

type Props = {
  nombre: string;
  colorPrimario: string;
  token: string;
};

export function RestablecerPasswordForm({ nombre, colorPrimario, token }: Props) {
  const [state, formAction, pending] = useActionState(restablecerPasswordAction, undefined);

  return (
    <div className="min-h-full flex-1 flex items-center justify-center bg-[var(--color-page-bg)] px-4 py-10">
      <div className="w-full max-w-sm">
        <div className="flex flex-col items-center mb-6 text-center">
          <p className="text-sm font-semibold text-[var(--color-brand-900)]">{nombre}</p>
          <p className="text-sm text-ink/55 mt-1">Elegí una contraseña nueva</p>
        </div>

        {!token ? (
          <div className="bg-surface rounded-2xl shadow-sm border border-ink/5 p-5 space-y-4">
            <p className="text-sm text-[var(--color-rojo)]">
              Este enlace no es válido. Pedí uno nuevo desde la pantalla de inicio de sesión.
            </p>
            <Link href="/recuperar-password" className="block text-center text-sm font-medium text-[var(--color-brand-800)] hover:underline">
              Pedir un enlace nuevo
            </Link>
          </div>
        ) : (
          <form action={formAction} className="bg-surface rounded-2xl shadow-sm border border-ink/5 p-5 space-y-4">
            <input type="hidden" name="token" value={token} />
            <div>
              <Label>Contraseña nueva</Label>
              <input name="nueva" type="password" required minLength={8} className={inputClass} placeholder="Mínimo 8 caracteres" autoComplete="new-password" />
            </div>
            <div>
              <Label>Confirmar contraseña nueva</Label>
              <input name="confirmar" type="password" required minLength={8} className={inputClass} placeholder="Repetí la contraseña" autoComplete="new-password" />
            </div>
            {state?.error && <p className="text-sm text-[var(--color-rojo)]">{state.error}</p>}
            <button
              type="submit"
              disabled={pending}
              className="w-full rounded-xl text-white py-2.5 text-sm font-semibold disabled:opacity-60"
              style={{ backgroundColor: colorPrimario }}
            >
              {pending ? "Guardando…" : "Guardar contraseña"}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
