"use client";

import { useState } from "react";
import { Camera } from "lucide-react";
import { FormularioEnModal } from "@/components/FormularioEnModal";
import { Label, inputClass } from "@/components/ui";
import { cargaRapidaComisionFormAction } from "@/lib/actions/cargaRapida";

/** Carga rápida: sacar una foto (cámara trasera) o elegir una imagen, y dejarla en la comisión. */
export function CargaRapida({ comisionId, claseBoton, enLinea = false }: { comisionId: number; claseBoton?: string; enLinea?: boolean }) {
  const [modo, setModo] = useState<"foto" | "galeria">("foto");
  return (
    <FormularioEnModal
      textoBoton={
        <span className="inline-flex items-center gap-1.5">
          <Camera size={14} aria-hidden /> {enLinea ? "Cargar foto o archivo" : "Foto o imagen"}
        </span>
      }
      claseBoton={claseBoton ?? "inline-flex items-center rounded-xl border border-border bg-surface px-3 py-1.5 text-xs font-semibold text-ink hover:bg-surface-sunken"}
      titulo="Carga rápida en la comisión"
      descripcion={<p>Sacá una foto o elegí una imagen del celular: queda guardada en los documentos de la comisión.</p>}
      action={cargaRapidaComisionFormAction}
      ocultos={{ comision_id: comisionId }}
      textoConfirmar="Cargar"
      enLinea={enLinea}
    >
      <fieldset className="flex flex-wrap gap-4 text-sm">
        <legend className="sr-only">Cómo cargar</legend>
        <label className="flex items-center gap-2">
          <input type="radio" name="modo" checked={modo === "foto"} onChange={() => setModo("foto")} /> Sacar una foto
        </label>
        <label className="flex items-center gap-2">
          <input type="radio" name="modo" checked={modo === "galeria"} onChange={() => setModo("galeria")} /> Elegir de la galería o un archivo
        </label>
      </fieldset>
      <div>
        <Label required>{modo === "foto" ? "Foto" : "Imagen o archivo"}</Label>
        <input key={modo} name="archivo" type="file" required accept={modo === "foto" ? "image/*" : "image/*,application/pdf"} {...(modo === "foto" ? { capture: "environment" as const } : {})} className={inputClass} />
      </div>
      <div>
        <Label>Qué es (opcional)</Label>
        <input name="nombre" maxLength={200} className={inputClass} placeholder="Ej.: losa del sector B" />
      </div>
      <div>
        <Label>Comentario (opcional)</Label>
        <textarea name="descripcion" rows={2} maxLength={1000} className={inputClass} />
      </div>
    </FormularioEnModal>
  );
}
