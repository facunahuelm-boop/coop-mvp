"use client";

import { useActionState } from "react";
import Link from "next/link";
import { inputClass, Label } from "@/components/ui";
import { solicitarLinkAccesoAction, usarLinkAccesoAction, verificarSegundoPasoAction } from "@/lib/actions/acceso";

/** Fase 1E — formularios públicos de ingreso (letra grande, un solo botón). */

function Marco({ titulo, children }: { titulo: string; children: React.ReactNode }) {
  return (
    <div className="min-h-full flex-1 flex items-center justify-center bg-[var(--color-page-bg)] px-4 py-10">
      <div className="w-full max-w-sm">
        <h1 className="text-2xl font-bold text-ink text-center mb-4">{titulo}</h1>
        <div className="bg-surface rounded-2xl shadow-sm border border-border p-5 space-y-4 text-[16px]">{children}</div>
        <Link href="/login" className="block text-center text-[15px] text-ink-muted hover:underline mt-4">← Volver al ingreso</Link>
      </div>
    </div>
  );
}

const botonGrande = "w-full rounded-xl bg-[var(--color-brand-800)] text-white py-3 text-[16px] font-semibold disabled:opacity-60 min-h-[48px]";

export function PedirLinkForm() {
  const [estado, accion, pendiente] = useActionState(solicitarLinkAccesoAction, undefined);
  return (
    <Marco titulo="Entrar sin contraseña">
      {estado?.ok ? (
        <p className="text-[16px] text-ink" role="status">{estado.mensaje}</p>
      ) : (
        <form action={accion} className="space-y-4">
          <p className="text-ink">Escribí tu email y te mandamos un link para entrar. No hace falta recordar ninguna contraseña.</p>
          <div>
            <Label>Tu email</Label>
            <input name="email" type="email" required autoComplete="email" className={`${inputClass} !text-[16px] !py-3`} placeholder="tu@email.com" />
          </div>
          {estado?.error && <p className="text-[15px] text-[var(--color-rojo)]">{estado.error}</p>}
          <button className={botonGrande} disabled={pendiente}>{pendiente ? "Enviando…" : "Mandarme el link"}</button>
        </form>
      )}
    </Marco>
  );
}

export function UsarLinkForm({ token }: { token: string }) {
  const [estado, accion, pendiente] = useActionState(usarLinkAccesoAction, undefined);
  return (
    <Marco titulo="Entrar a COOVA">
      <form action={accion} className="space-y-4">
        <input type="hidden" name="token" value={token} />
        <p className="text-ink">Tocá el botón para entrar.</p>
        {estado?.error && (
          <p className="text-[15px] text-[var(--color-rojo)]">
            {estado.error} <Link href="/ingreso-por-email" className="underline">Pedir otro link</Link>
          </p>
        )}
        <button className={botonGrande} disabled={pendiente}>{pendiente ? "Entrando…" : "Entrar"}</button>
      </form>
    </Marco>
  );
}

export function SegundoPasoForm() {
  const [estado, accion, pendiente] = useActionState(verificarSegundoPasoAction, undefined);
  return (
    <Marco titulo="Código de verificación">
      <form action={accion} className="space-y-4">
        <p className="text-ink">Abrí la app de verificación en tu celular y escribí los 6 números que aparecen para COOVA.</p>
        <div>
          <Label>Código</Label>
          <input
            name="codigo"
            inputMode="numeric"
            autoComplete="one-time-code"
            required
            maxLength={9}
            autoFocus
            className={`${inputClass} !text-2xl !py-3 tracking-[0.3em] text-center font-mono`}
            placeholder="123456"
          />
          <p className="text-[14px] text-ink-muted mt-1">¿No tenés el celular? Podés usar uno de tus códigos de respaldo.</p>
        </div>
        {estado?.error && <p className="text-[15px] text-[var(--color-rojo)]">{estado.error}</p>}
        <button className={botonGrande} disabled={pendiente}>{pendiente ? "Verificando…" : "Entrar"}</button>
      </form>
    </Marco>
  );
}
