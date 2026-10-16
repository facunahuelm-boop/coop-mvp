"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { insert, get, audit } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { puedeGestionarComision, ERROR_SIN_PERMISO_COMISION } from "@/lib/comisionAuth";
import { saveUploadedFile, TIPOS_DOCUMENTO } from "@/lib/upload";
import { parseForm, zId, zTextoOpcional, ValidationError } from "@/lib/validation";
import { conEstadoDeAccion, type ActionState } from "@/lib/actionState";
import { hoyEnUruguay } from "@/lib/horasObra";

/**
 * Carga rápida (15/10): desde el celular, sacar una foto o elegir una imagen y dejarla en la
 * comisión sin pasar por el formulario completo de Documentos. Queda como documento vinculado a
 * la comisión (lo ven todos en su pestaña Documentos). Pueden cargar los integrantes activos de
 * esa comisión y la conducción.
 */
const schema = z.object({ comision_id: zId, nombre: zTextoOpcional(200), descripcion: zTextoOpcional(1000) });

export async function cargaRapidaComisionAction(formData: FormData): Promise<string> {
  const user = await requireUser();
  const d = parseForm(schema, formData);
  const com = await get<{ id: number; nombre: string }>(`SELECT id, nombre FROM comisiones WHERE id = ? AND activa = 1`, [d.comision_id]);
  if (!com) throw new Error("Esa comisión no existe.");
  if (!(await puedeGestionarComision(user, com.id))) throw new Error(ERROR_SIN_PERMISO_COMISION);
  const archivo = formData.get("archivo") as File | null;
  if (!archivo || archivo.size === 0) throw new ValidationError("archivo", "Sacá una foto o elegí un archivo.");
  const url = await saveUploadedFile(archivo, user.organization_id, "documentos", { tiposPermitidos: TIPOS_DOCUMENTO, maxBytes: 20 * 1024 * 1024 });
  const nombre = d.nombre || `Foto de ${com.nombre} · ${hoyEnUruguay().split("-").reverse().join("/")}`;
  const id = await insert("documentos", {
    categoria: "comisiones",
    nombre,
    descripcion: d.descripcion,
    archivo_url: url,
    subido_por_id: user.id,
    comision_id: com.id,
  });
  await audit({ usuario_id: user.id, accion: "subir", entidad: "documentos", entidad_id: id, valor_nuevo: { nombre, comision_id: com.id, via: "carga_rapida" } });
  revalidatePath("/documentos");
  revalidatePath(`/comisiones/${com.id}`);
  revalidatePath("/dashboard");
  return "Cargado en la comisión.";
}

export async function cargaRapidaComisionFormAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  let aviso = "";
  const r = await conEstadoDeAccion(async () => {
    aviso = await cargaRapidaComisionAction(fd);
  });
  return r.ok ? { ...r, aviso } : r;
}
