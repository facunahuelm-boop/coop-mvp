"use client";

import { FormularioEnModal } from "@/components/FormularioEnModal";
import { Label, inputClass } from "@/components/ui";
import { agregarDocProveedorFormAction, bajaDocProveedorFormAction } from "@/lib/actions/proveedorDocumentos";

/** Fase 2G — formularios de la documentación del proveedor. */

export function AgregarDocProveedorForm({ proveedorId }: { proveedorId: number }) {
  return (
    <FormularioEnModal
      textoBoton="+ Agregar documento"
      titulo="Documento del proveedor"
      descripcion="Certificados, seguro o habilitaciones con su fecha de vencimiento. COOVA avisa 30 días antes y cuando alguien elige a este proveedor con algo vencido."
      action={agregarDocProveedorFormAction}
      ocultos={{ proveedor_id: proveedorId }}
      mensajeExito="Documento agregado."
    >
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <label className="block">
          <Label required>Qué es</Label>
          <select name="tipo" defaultValue="bps" className={inputClass}>
            <option value="bps">Certificado de BPS</option>
            <option value="dgi">Certificado de DGI</option>
            <option value="bse">Seguro del BSE</option>
            <option value="habilitacion">Habilitación</option>
            <option value="otro">Otro</option>
          </select>
        </label>
        <label className="block">
          <Label>Vence el</Label>
          <input name="fecha_vencimiento" type="date" className={inputClass} />
        </label>
      </div>
      <label className="block">
        <Label>Detalle</Label>
        <input name="descripcion" maxLength={200} placeholder="Ej.: N° de certificado, póliza…" className={inputClass} />
      </label>
      <label className="block">
        <Label>Archivo (opcional)</Label>
        <input name="archivo" type="file" accept=".pdf,image/*" className={inputClass} />
      </label>
    </FormularioEnModal>
  );
}

export function BajaDocProveedorForm({ id }: { id: number }) {
  return (
    <FormularioEnModal
      textoBoton="Quitar"
      claseBoton="text-sm font-semibold text-[var(--color-rojo)] underline underline-offset-2"
      titulo="Quitar este documento"
      descripcion="Deja de contar para el proveedor (por ejemplo, porque se reemplazó por uno nuevo). Queda en la auditoría."
      action={bajaDocProveedorFormAction}
      ocultos={{ id }}
      textoConfirmar="Quitar"
      peligro
      mensajeExito="Documento quitado."
    />
  );
}
