"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { get, insert, update, audit } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { canEdit } from "@/lib/roles";
import { saveUploadedFile, TIPOS_DOCUMENTO } from "@/lib/upload";
import { parseForm, zId, zTextoOpcional, zFechaOpcional, zEnumSeguro, ValidationError } from "@/lib/validation";
import { conEstadoDeAccion, type ActionState } from "@/lib/actionState";
import { TIPO_DOC_PROVEEDOR_LABEL } from "@/lib/proveedoresDocs";

/** Fase 2G — documentación de proveedores con vencimiento (no se borra: se da de baja). */

const docSchema = z.object({
  proveedor_id: zId,
  tipo: zEnumSeguro(["bps", "dgi", "bse", "habilitacion", "otro"], "otro"),
  descripcion: zTextoOpcional(200),
  fecha_vencimiento: zFechaOpcional,
});

export async function agregarDocProveedorAction(formData: FormData) {
  const user = await requireUser();
  if (!canEdit(user.rol, "compras")) throw new Error("No tenés permiso para cargar documentación de proveedores.");
  const d = parseForm(docSchema, formData);
  if (d.tipo === "otro" && !d.descripcion) throw new ValidationError("descripcion", "Escribí qué documento es.");
  const prov = await get<{ nombre: string }>(`SELECT nombre FROM proveedores WHERE id = ?`, [d.proveedor_id]);
  if (!prov) throw new Error("Ese proveedor no existe.");
  let documentoId: number | null = null;
  const archivo = formData.get("archivo") as File | null;
  if (archivo && archivo.size > 0) {
    const url = await saveUploadedFile(archivo, user.organization_id, "documentos", { tiposPermitidos: TIPOS_DOCUMENTO, maxBytes: 20 * 1024 * 1024 });
    if (url) {
      documentoId = await insert("documentos", {
        categoria: "compras",
        nombre: `${TIPO_DOC_PROVEEDOR_LABEL[d.tipo]}${d.descripcion ? ` — ${d.descripcion}` : ""} (${prov.nombre})`,
        archivo_url: url,
        subido_por_id: user.id,
        fecha_vencimiento: d.fecha_vencimiento,
      });
    }
  }
  const id = await insert("proveedor_documentos", { ...d, documento_id: documentoId, creado_por_id: user.id });
  await audit({ usuario_id: user.id, accion: "agregar_doc_proveedor", entidad: "proveedor_documentos", entidad_id: id, valor_nuevo: { proveedor: prov.nombre, ...d } });
  revalidatePath(`/proveedores/${d.proveedor_id}`);
  revalidatePath("/proveedores");
}
export async function agregarDocProveedorFormAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  return conEstadoDeAccion(() => agregarDocProveedorAction(fd));
}

export async function bajaDocProveedorAction(formData: FormData) {
  const user = await requireUser();
  if (!canEdit(user.rol, "compras")) throw new Error("No tenés permiso para cambiar la documentación de proveedores.");
  const { id } = parseForm(z.object({ id: zId }), formData);
  const doc = await get<{ proveedor_id: number; activo: number }>(`SELECT proveedor_id, activo FROM proveedor_documentos WHERE id = ?`, [id]);
  if (!doc || !doc.activo) throw new Error("Ese documento no existe.");
  await update("proveedor_documentos", id, { activo: 0 });
  await audit({ usuario_id: user.id, accion: "baja_doc_proveedor", entidad: "proveedor_documentos", entidad_id: id });
  revalidatePath(`/proveedores/${doc.proveedor_id}`);
  revalidatePath("/proveedores");
}
export async function bajaDocProveedorFormAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  return conEstadoDeAccion(() => bajaDocProveedorAction(fd));
}
