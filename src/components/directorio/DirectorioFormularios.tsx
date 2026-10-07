"use client";

import { FormularioEnModal } from "@/components/FormularioEnModal";
import { Label, inputClass } from "@/components/ui";
import { guardarContactoExternoFormAction, bajaContactoExternoFormAction } from "@/lib/actions/directorio";

/** Fase 2F — formularios del Directorio (contactos externos). */

type Externo = { id: number; nombre: string; tipo: string; persona_contacto: string | null; telefono: string | null; email: string | null; notas: string | null };
const botonLink = "text-sm font-semibold text-[var(--color-brand-800)] underline underline-offset-2";

export function ContactoExternoForm({ contacto }: { contacto?: Externo }) {
  return (
    <FormularioEnModal
      textoBoton={contacto ? "Cambiar" : "+ Agregar organismo o profesional"}
      claseBoton={contacto ? botonLink : undefined}
      titulo={contacto ? contacto.nombre : "Nuevo contacto"}
      action={guardarContactoExternoFormAction}
      ocultos={contacto ? { id: contacto.id } : {}}
      mensajeExito="Guardado."
    >
      <label className="block">
        <Label required>Nombre</Label>
        <input name="nombre" required maxLength={150} defaultValue={contacto?.nombre} placeholder="Ej.: MVOT, Intendencia, IAT…" className={inputClass} />
      </label>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <label className="block">
          <Label>Tipo</Label>
          <select name="tipo" defaultValue={contacto?.tipo ?? "organismo"} className={inputClass}>
            <option value="iat">Instituto técnico (IAT)</option>
            <option value="organismo">Organismo público</option>
            <option value="profesional">Profesional</option>
            <option value="otro">Otro</option>
          </select>
        </label>
        <label className="block">
          <Label>Persona de contacto</Label>
          <input name="persona_contacto" maxLength={120} defaultValue={contacto?.persona_contacto ?? ""} className={inputClass} />
        </label>
        <label className="block">
          <Label>Teléfono</Label>
          <input name="telefono" maxLength={30} defaultValue={contacto?.telefono ?? ""} className={inputClass} />
        </label>
        <label className="block">
          <Label>Email</Label>
          <input name="email" type="email" maxLength={150} defaultValue={contacto?.email ?? ""} className={inputClass} />
        </label>
      </div>
      <label className="block">
        <Label>Notas</Label>
        <textarea name="notas" rows={2} maxLength={1000} defaultValue={contacto?.notas ?? ""} placeholder="Horario, para qué se lo llama, número de expediente…" className={inputClass} />
      </label>
    </FormularioEnModal>
  );
}

export function BajaContactoExternoForm({ id, nombre }: { id: number; nombre: string }) {
  return (
    <FormularioEnModal
      textoBoton="Quitar"
      claseBoton="text-sm font-semibold text-[var(--color-rojo)] underline underline-offset-2"
      titulo={`Quitar a ${nombre} del directorio`}
      descripcion="Deja de aparecer en el directorio. Queda registrado en la auditoría."
      action={bajaContactoExternoFormAction}
      ocultos={{ id }}
      textoConfirmar="Quitar"
      peligro
      mensajeExito="Quitado del directorio."
    />
  );
}
