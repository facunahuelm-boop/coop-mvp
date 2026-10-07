"use client";

import { FormularioEnModal } from "@/components/FormularioEnModal";
import { Label, inputClass } from "@/components/ui";
import { guardarPlantillaTextoFormAction, bajaPlantillaTextoFormAction } from "@/lib/actions/plantillasTexto";

/** Fase 2H — formularios de plantillas de texto. */

type Plantilla = { id: number; nombre: string; categoria: string; cuerpo: string };
const botonLink = "text-sm font-semibold text-[var(--color-brand-800)] underline underline-offset-2";

export function PlantillaForm({ plantilla, variables }: { plantilla?: Plantilla; variables: { clave: string; texto: string }[] }) {
  return (
    <FormularioEnModal
      textoBoton={plantilla ? "Cambiar" : "+ Nueva plantilla"}
      claseBoton={plantilla ? botonLink : undefined}
      titulo={plantilla ? plantilla.nombre : "Nueva plantilla"}
      action={guardarPlantillaTextoFormAction}
      ocultos={plantilla ? { id: plantilla.id } : {}}
      mensajeExito="Plantilla guardada."
    >
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <label className="block">
          <Label required>Nombre</Label>
          <input name="nombre" required maxLength={150} defaultValue={plantilla?.nombre} className={inputClass} />
        </label>
        <label className="block">
          <Label>Tipo</Label>
          <select name="categoria" defaultValue={plantilla?.categoria ?? "constancia"} className={inputClass}>
            <option value="constancia">Constancia</option>
            <option value="nota">Nota</option>
            <option value="convocatoria">Convocatoria</option>
            <option value="acta">Acta</option>
            <option value="otro">Otro</option>
          </select>
        </label>
      </div>
      <label className="block">
        <Label required>Texto</Label>
        <textarea name="cuerpo" required rows={10} maxLength={8000} defaultValue={plantilla?.cuerpo} className={inputClass} />
      </label>
      <p className="text-sm text-ink-muted">
        Podés usar: {variables.map((v) => `{${v.clave}}`).join(" ")} — se reemplazan solas al generar el PDF.
      </p>
    </FormularioEnModal>
  );
}

export function BajaPlantillaForm({ id }: { id: number }) {
  return (
    <FormularioEnModal
      textoBoton="Quitar"
      claseBoton="text-sm font-semibold text-[var(--color-rojo)] underline underline-offset-2"
      titulo="Quitar esta plantilla"
      descripcion="Deja de aparecer en la lista. Queda en la auditoría."
      action={bajaPlantillaTextoFormAction}
      ocultos={{ id }}
      textoConfirmar="Quitar"
      peligro
      mensajeExito="Plantilla quitada."
    />
  );
}
