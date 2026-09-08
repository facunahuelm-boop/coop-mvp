"use client";

import { useActionState } from "react";
import { loginAction } from "@/lib/actions/auth";
import { inputClass, Label } from "@/components/ui";

const DEMO_USERS = [
  ["ana@coop.uy", "Socio/a"],
  ["beatriz@coop.uy", "Comisión de Obra"],
  ["carlos@coop.uy", "Comisión de Trabajo"],
  ["diana@coop.uy", "Comisión de Compras"],
  ["eduardo@coop.uy", "Comisión de Seguridad"],
  ["florencia@coop.uy", "Administración"],
  ["gonzalo@coop.uy", "Tesorería"],
  ["helena@coop.uy", "Consejo Directivo"],
  ["ignacio@coop.uy", "Comisión Fiscal"],
  ["julia@coop.uy", "IAT / Dirección técnica"],
  ["admin@coop.uy", "Administrador del sistema"],
];

type Props = {
  nombre: string;
  logoUrl: string;
  colorPrimario: string;
};

export function LoginForm({ nombre, logoUrl, colorPrimario }: Props) {
  const [state, formAction, pending] = useActionState(loginAction, undefined);

  return (
    <div className="min-h-full flex-1 flex items-center justify-center bg-[var(--color-page-bg)] px-4 py-10">
      <div className="w-full max-w-sm">
        <div className="flex flex-col items-center mb-6 text-center">
          <img src={logoUrl} alt={nombre} className="h-24 w-24 mb-3 drop-shadow-sm rounded-full object-cover" />
          <h1 className="text-lg font-bold" style={{ color: colorPrimario }}>
            Sistema de gestión de la cooperativa
          </h1>
          <p className="text-sm text-ink/55 mt-1">Ingresá con tu usuario para continuar</p>
        </div>

        <form action={formAction} className="bg-surface rounded-2xl shadow-sm border border-ink/5 p-5 space-y-4">
          <div>
            <Label>Email</Label>
            <input name="email" type="email" required className={inputClass} placeholder="tu@coop.uy" autoComplete="username" />
          </div>
          <div>
            <Label>Contraseña</Label>
            <input name="password" type="password" required className={inputClass} placeholder="••••••••" autoComplete="current-password" />
          </div>
          {state?.error && <p className="text-sm text-[var(--color-rojo)]">{state.error}</p>}
          <button
            type="submit"
            disabled={pending}
            className="w-full rounded-xl text-white py-2.5 text-sm font-semibold disabled:opacity-60"
            style={{ backgroundColor: colorPrimario }}
          >
            {pending ? "Entrando…" : "Entrar"}
          </button>
        </form>

        <details className="mt-4 bg-surface/60 rounded-xl border border-ink/5 p-3 text-xs text-ink/60">
          <summary className="cursor-pointer font-medium text-[var(--color-brand-800)]">Usuarios de demostración (contraseña: cooperativa2026)</summary>
          <ul className="mt-2 space-y-0.5">
            {DEMO_USERS.map(([email, rol]) => (
              <li key={email}><span className="font-mono">{email}</span> — {rol}</li>
            ))}
          </ul>
        </details>
      </div>
    </div>
  );
}
