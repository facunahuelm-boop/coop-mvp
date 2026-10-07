"use client";

import { useState } from "react";
import { FormularioEnModal, BotonAccion } from "@/components/FormularioEnModal";
import { Label, inputClass } from "@/components/ui";
import {
  cambiarEstadoSocioFormAction,
  crearNucleoParaSocioFormAction,
  marcarPasoIngresoFormAction,
  agregarOficioFormAction,
  quitarOficioFormAction,
} from "@/lib/actions/socios";
import { ESTADOS_ELEGIBLES, ESTADO_SOCIO_INFO, ESTADOS_SANCION, type EstadoSocio } from "@/lib/sociosEstados";

/** Fase 2C — ciclo de vida del socio, núcleo, ingreso y oficios. */

const botonLink = "text-sm font-semibold text-[var(--color-brand-800)] underline underline-offset-2";

export function CambiarEstadoSocioForm({ socioId, estadoActual, puedeSancionar, hoy }: { socioId: number; estadoActual: string; puedeSancionar: boolean; hoy: string }) {
  const opciones = ESTADOS_ELEGIBLES.filter((e) => e !== estadoActual && (puedeSancionar || !ESTADOS_SANCION.includes(e)));
  const [elegido, setElegido] = useState<EstadoSocio>(opciones[0] ?? "activo");
  return (
    <FormularioEnModal
      textoBoton="Cambiar estado"
      titulo="Cambiar el estado del socio"
      descripcion="Queda en el historial con la fecha, el motivo y quién lo registró."
      action={cambiarEstadoSocioFormAction}
      ocultos={{ id: socioId }}
      mensajeExito="Estado actualizado."
    >
      <fieldset className="space-y-2">
        <legend className="font-semibold text-ink mb-1">Nuevo estado</legend>
        {opciones.map((e) => (
          <label key={e} className="flex items-start gap-3 rounded-xl border border-border px-3 py-2.5 cursor-pointer has-[:checked]:border-[var(--color-brand-800)] has-[:checked]:bg-[var(--color-brand-100)]/40">
            <input type="radio" name="estado" value={e} checked={elegido === e} onChange={() => setElegido(e)} className="h-5 w-5 mt-0.5" />
            <span>
              <span className="block font-semibold text-ink">{ESTADO_SOCIO_INFO[e].label}</span>
              <span className="block text-[14px] text-ink-muted">{ESTADO_SOCIO_INFO[e].explicacion}</span>
            </span>
          </label>
        ))}
        {!puedeSancionar && <p className="text-[13px] text-ink-muted">Suspender o excluir lo decide el Consejo Directivo.</p>}
      </fieldset>
      <label className="block">
        <Label required>Desde qué fecha</Label>
        <input type="date" name="fecha" defaultValue={hoy} className={inputClass} required />
      </label>
      <label className="block">
        <Label required={elegido !== "activo" && elegido !== "aspirante"}>Motivo</Label>
        <input name="motivo" maxLength={500} placeholder="Ej.: resolución del Consejo del 10/10, carta de renuncia…" className={inputClass} />
      </label>
    </FormularioEnModal>
  );
}

export function CrearNucleoBoton({ socioId }: { socioId: number }) {
  return (
    <BotonAccion action={crearNucleoParaSocioFormAction} ocultos={{ socio_id: socioId }} mensajeExito="Núcleo creado." className="!px-3 !py-1.5 text-sm">
      Crear su núcleo
    </BotonAccion>
  );
}

export function PasoIngresoBoton({ socioId, item, hecho }: { socioId: number; item: string; hecho: boolean }) {
  return (
    <BotonAccion action={marcarPasoIngresoFormAction} ocultos={{ socio_id: socioId, item, hecho: hecho ? "no" : "si" }} className="!px-2.5 !py-1 text-sm">
      {hecho ? "Desmarcar" : "Marcar hecho"}
    </BotonAccion>
  );
}

export function AgregarOficioForm({ socioId, nombreSocio }: { socioId: number; nombreSocio: string }) {
  return (
    <FormularioEnModal
      textoBoton="+ Agregar oficio"
      claseBoton={botonLink}
      titulo="¿Qué sabe hacer alguien de este núcleo?"
      descripcion="Sirve para que la Comisión de Trabajo sepa a quién llamar (albañilería, electricidad, sanitaria, pintura, cocina…)."
      action={agregarOficioFormAction}
      ocultos={{ socio_id: socioId }}
      mensajeExito="Oficio agregado."
    >
      <label className="block">
        <Label required>Oficio o habilidad</Label>
        <input name="oficio" required maxLength={80} list="oficios-comunes" className={inputClass} />
        <datalist id="oficios-comunes">
          {["Albañilería", "Electricidad", "Sanitaria", "Carpintería", "Herrería", "Pintura", "Yesería", "Soldadura", "Cocina", "Contabilidad", "Informática", "Primeros auxilios"].map((o) => (
            <option key={o} value={o} />
          ))}
        </datalist>
      </label>
      <label className="block">
        <Label>Quién</Label>
        <input name="persona" maxLength={120} defaultValue={nombreSocio} className={inputClass} />
      </label>
      <label className="block">
        <Label>Nota</Label>
        <input name="nota" maxLength={300} placeholder="Ej.: tiene herramientas propias" className={inputClass} />
      </label>
    </FormularioEnModal>
  );
}

export function QuitarOficioBoton({ id, socioId }: { id: number; socioId: number }) {
  return (
    <BotonAccion action={quitarOficioFormAction} ocultos={{ id, socio_id: socioId }} mensajeExito="Oficio quitado." className="!px-2 !py-0.5 text-xs">
      Quitar
    </BotonAccion>
  );
}
