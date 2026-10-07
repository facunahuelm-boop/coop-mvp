"use client";

import { FormularioEnModal, BotonAccion } from "@/components/FormularioEnModal";
import { Label, inputClass } from "@/components/ui";
import {
  guardarHitoFormAction,
  cambiarEstadoHitoFormAction,
  moverHitoFormAction,
  quitarHitoFormAction,
  cargarPlantillaHitosFormAction,
} from "@/lib/actions/tramites";
import { ESTADO_HITO_LABEL, CATEGORIA_HITO_LABEL } from "@/lib/tramitesTexto";

/** Fase 2E — formularios de Trámites e hitos. */

type HitoUi = {
  id: number;
  titulo: string;
  descripcion: string | null;
  categoria: string;
  responsable_id: number | null;
  responsable_texto: string | null;
  fecha_estimada: string | null;
  visible_socios: number;
  nota_para_socios: string | null;
  estado: string;
};
const botonLink = "text-sm font-semibold text-[var(--color-brand-800)] underline underline-offset-2";

export function HitoForm({ hito, usuarios }: { hito?: HitoUi; usuarios: { id: number; nombre: string }[] }) {
  return (
    <FormularioEnModal
      textoBoton={hito ? "Cambiar" : "+ Agregar un paso"}
      claseBoton={hito ? botonLink : undefined}
      titulo={hito ? `Paso: ${hito.titulo}` : "Nuevo paso"}
      action={guardarHitoFormAction}
      ocultos={hito ? { id: hito.id } : {}}
      mensajeExito="Guardado."
    >
      <label className="block">
        <Label required>Qué hay que lograr</Label>
        <input name="titulo" required maxLength={200} defaultValue={hito?.titulo} className={inputClass} />
      </label>
      <label className="block">
        <Label>Detalle</Label>
        <textarea name="descripcion" rows={2} maxLength={1000} defaultValue={hito?.descripcion ?? ""} className={inputClass} />
      </label>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <label className="block">
          <Label>Tipo</Label>
          <select name="categoria" defaultValue={hito?.categoria ?? "otro"} className={inputClass}>
            {Object.entries(CATEGORIA_HITO_LABEL).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
        </label>
        <label className="block">
          <Label>Fecha estimada</Label>
          <input type="date" name="fecha_estimada" defaultValue={hito?.fecha_estimada ?? ""} className={inputClass} />
        </label>
        <label className="block">
          <Label>Responsable (persona con usuario)</Label>
          <select name="responsable_id" defaultValue={hito?.responsable_id ?? ""} className={inputClass}>
            <option value="">—</option>
            {usuarios.map((u) => (
              <option key={u.id} value={u.id}>
                {u.nombre}
              </option>
            ))}
          </select>
        </label>
        <label className="block">
          <Label>…o quién se encarga (texto)</Label>
          <input name="responsable_texto" maxLength={120} defaultValue={hito?.responsable_texto ?? ""} placeholder="Ej.: el IAT, la escribana" className={inputClass} />
        </label>
      </div>
      <fieldset className="space-y-1">
        <legend className="font-semibold text-ink mb-1">¿Lo ven los socios en «¿En qué estamos?»?</legend>
        <label className="flex items-center gap-3">
          <input type="radio" name="visible_socios" value="si" defaultChecked={(hito?.visible_socios ?? 1) === 1} className="h-5 w-5" /> Sí
        </label>
        <label className="flex items-center gap-3">
          <input type="radio" name="visible_socios" value="no" defaultChecked={hito?.visible_socios === 0} className="h-5 w-5" /> No (es interno)
        </label>
      </fieldset>
      <label className="block">
        <Label>Mensaje para los socios</Label>
        <input name="nota_para_socios" maxLength={500} defaultValue={hito?.nota_para_socios ?? ""} placeholder="Ej.: estamos esperando la respuesta de la Intendencia" className={inputClass} />
      </label>
    </FormularioEnModal>
  );
}

export function CambiarEstadoHitoForm({ id, actual, hoy }: { id: number; actual: string; hoy: string }) {
  return (
    <FormularioEnModal textoBoton="Cambiar estado" titulo="¿Cómo está este paso?" action={cambiarEstadoHitoFormAction} ocultos={{ id }} mensajeExito="Estado actualizado.">
      <fieldset className="space-y-2">
        {Object.entries(ESTADO_HITO_LABEL)
          .filter(([k]) => k !== actual)
          .map(([k, v], i) => (
            <label key={k} className="flex items-center gap-3 rounded-xl border border-border px-3 py-2.5 has-[:checked]:border-[var(--color-brand-800)]">
              <input type="radio" name="estado" value={k} defaultChecked={i === 0} className="h-5 w-5" /> {v}
            </label>
          ))}
      </fieldset>
      <label className="block">
        <Label>Si se cumplió, ¿cuándo?</Label>
        <input type="date" name="fecha_real" defaultValue={hoy} max={hoy} className={inputClass} />
      </label>
      <label className="block">
        <Label>Mensaje para los socios (opcional)</Label>
        <input name="nota_para_socios" maxLength={500} className={inputClass} />
      </label>
    </FormularioEnModal>
  );
}

export function MoverHito({ id, primero, ultimo }: { id: number; primero: boolean; ultimo: boolean }) {
  return (
    <span className="inline-flex gap-1">
      {!primero && (
        <BotonAccion action={moverHitoFormAction} ocultos={{ id, direccion: "arriba" }} className="!px-2 !py-1 text-xs">
          ↑
        </BotonAccion>
      )}
      {!ultimo && (
        <BotonAccion action={moverHitoFormAction} ocultos={{ id, direccion: "abajo" }} className="!px-2 !py-1 text-xs">
          ↓
        </BotonAccion>
      )}
    </span>
  );
}

export function QuitarHitoForm({ id }: { id: number }) {
  return (
    <FormularioEnModal textoBoton="Quitar" claseBoton="text-sm text-ink-muted underline" titulo="Quitar este paso" descripcion="Queda en el historial." action={quitarHitoFormAction} ocultos={{ id }} textoConfirmar="Quitar" peligro>
      <label className="block">
        <Label required>Motivo</Label>
        <input name="motivo" required maxLength={300} className={inputClass} />
      </label>
    </FormularioEnModal>
  );
}

export function CargarPlantillaBoton() {
  return (
    <BotonAccion action={cargarPlantillaHitosFormAction} ocultos={{}}>
      Cargar los pasos típicos
    </BotonAccion>
  );
}
