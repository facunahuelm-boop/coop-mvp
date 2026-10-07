"use client";

import { useActionState, useEffect, useRef } from "react";
import { FormularioEnModal } from "@/components/FormularioEnModal";
import { FormError, SubmitButton, useToast } from "@/components/ui-client";
import { Label, inputClass } from "@/components/ui";
import { ESTADO_INICIAL } from "@/lib/actionState";
import { guardarDatosAltaFormAction, crearComisionesSugeridasFormAction, invitarUsuarioFormAction, completarAltaFormAction } from "@/lib/actions/alta";
import { CopiarTexto } from "@/components/CopiarTexto";

/** Fase 2H — formularios del asistente de alta. */

export function DatosAltaForm({ nombre, plantillaActual, plantillas }: { nombre: string; plantillaActual: string; plantillas: { clave: string; nombre: string; descripcion: string }[] }) {
  const [estado, formAction] = useActionState(guardarDatosAltaFormAction, ESTADO_INICIAL);
  const { show } = useToast();
  useEffect(() => {
    if (estado.ok && estado.aviso) show(estado.aviso);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [estado]);
  return (
    <form action={formAction} className="space-y-4 text-[15px]" id="alta-datos">
      <FormError message={estado.error} />
      <label className="block">
        <Label required>Nombre de la cooperativa</Label>
        <input name="nombre" required maxLength={150} defaultValue={nombre} className={inputClass} />
      </label>
      <fieldset className="space-y-2">
        <legend className="mb-1 font-semibold text-ink">¿Qué tipo de cooperativa es y en qué etapa está?</legend>
        {plantillas.map((p) => (
          <label key={p.clave} className="flex cursor-pointer items-start gap-3 rounded-xl border border-border px-3 py-3 has-[:checked]:border-[var(--color-brand-800)] has-[:checked]:bg-[var(--color-brand-100)]/40">
            <input type="radio" name="plantilla" value={p.clave} defaultChecked={p.clave === plantillaActual} className="mt-0.5 h-5 w-5" />
            <span>
              <span className="block font-semibold text-ink">{p.nombre}</span>
              <span className="block text-ink-muted">{p.descripcion}</span>
            </span>
          </label>
        ))}
      </fieldset>
      <p className="text-sm text-ink-muted">Se cargan las comisiones sugeridas, las plantillas de texto y (en Pre-obra) los pasos típicos de los trámites. Todo se puede cambiar después.</p>
      <div className="flex justify-end">
        <SubmitButton>Guardar y seguir</SubmitButton>
      </div>
    </form>
  );
}

export function ComisionesSugeridasBoton() {
  return (
    <FormularioEnModal
      textoBoton="Crear las comisiones sugeridas"
      titulo="Comisiones sugeridas"
      descripcion="Se crean las comisiones típicas para la etapa de la cooperativa (las que ya existen con ese nombre no se repiten). Después les agregás los integrantes."
      action={crearComisionesSugeridasFormAction}
      textoConfirmar="Crear"
    />
  );
}

export function InvitarUsuarioForm({ roles }: { roles: { valor: string; nombre: string }[] }) {
  const [estado, formAction] = useActionState(invitarUsuarioFormAction, ESTADO_INICIAL);
  const formRef = useRef<HTMLFormElement>(null);
  const { show } = useToast();
  const linkManual = estado.ok && estado.aviso?.includes("http") ? estado.aviso.slice(estado.aviso.indexOf("http")) : null;
  useEffect(() => {
    if (estado.ok && estado.aviso && !linkManual) {
      show(estado.aviso);
      formRef.current?.reset();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [estado]);
  return (
    <div>
      <form ref={formRef} action={formAction} className="grid grid-cols-1 gap-3 text-[15px] sm:grid-cols-4 sm:items-end" id="alta-invitar">
        <div className="sm:col-span-4">
          <FormError message={estado.error} />
        </div>
        <label className="block">
          <Label required>Nombre</Label>
          <input name="nombre" required maxLength={200} className={inputClass} />
        </label>
        <label className="block">
          <Label required>Email</Label>
          <input name="email" type="email" required maxLength={200} className={inputClass} />
        </label>
        <label className="block">
          <Label required>Rol</Label>
          <select name="rol" defaultValue="tesoreria" className={inputClass}>
            {roles.map((r) => (
              <option key={r.valor} value={r.valor}>
                {r.nombre}
              </option>
            ))}
          </select>
        </label>
        <SubmitButton>Invitar</SubmitButton>
      </form>
      {linkManual && (
        <div className="mt-3 rounded-xl bg-[var(--color-amarillo-bg)] p-3 text-sm text-ink">
          <p className="mb-2">{estado.aviso?.slice(0, estado.aviso.indexOf("http")).trim()}</p>
          <CopiarTexto texto={linkManual} />
        </div>
      )}
    </div>
  );
}

export function CompletarAltaBoton({ listo }: { listo: boolean }) {
  return (
    <FormularioEnModal
      textoBoton="¡Mi cooperativa está lista!"
      claseBoton="inline-flex items-center justify-center rounded-xl bg-[var(--color-brand-800)] px-4 py-2.5 text-sm font-semibold text-white"
      titulo="Terminar el alta"
      descripcion={listo ? "Todo listo. El asistente deja de aparecer en el Inicio (lo podés volver a abrir desde Administración)." : "Todavía hay pasos sin hacer. Podés terminar igual y completarlos después."}
      action={completarAltaFormAction}
      textoConfirmar="Terminar"
    />
  );
}
