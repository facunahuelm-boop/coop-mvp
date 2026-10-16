"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { insert, audit } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { canEdit } from "@/lib/roles";
import { saveUploadedFile, TIPOS_DOCUMENTO } from "@/lib/upload";
import { parseForm, zTexto, zTextoOpcional, zFechaOpcional, zCheckbox, ValidationError } from "@/lib/validation";
import { conEstadoDeAccion, type ActionState } from "@/lib/actionState";

/**
 * Subir documento desde el Inicio de la Directiva (16/10, pedido explícito):
 * un solo pop-up para sacar una foto o elegir un archivo, decir qué es y, si
 * tiene una fecha importante (vencimiento, asamblea, plazo), anotarla en el
 * calendario en el mismo paso. Mismo permiso que Documentos (canEdit).
 */
const schema = z.object({
  nombre: zTexto(200),
  categoria: zTextoOpcional(100).transform((v) => v || "informes"),
  descripcion: zTextoOpcional(1000),
  fecha: zFechaOpcional,
  al_calendario: zCheckbox,
});

export async function subirDocumentoRapidoAction(formData: FormData): Promise<string> {
  const user = await requireUser();
  if (!canEdit(user.rol, "documentos")) throw new Error("No tenés permiso para subir documentos.");
  const d = parseForm(schema, formData);
  const archivo = formData.get("archivo") as File | null;
  if (!archivo || archivo.size === 0) throw new ValidationError("archivo", "Sacá una foto o elegí un archivo.");
  const url = await saveUploadedFile(archivo, user.organization_id, "documentos", { tiposPermitidos: TIPOS_DOCUMENTO, maxBytes: 20 * 1024 * 1024 });
  const id = await insert("documentos", {
    categoria: d.categoria,
    nombre: d.nombre,
    descripcion: d.descripcion,
    fecha_vencimiento: d.fecha,
    archivo_url: url,
    subido_por_id: user.id,
  });
  await audit({ usuario_id: user.id, accion: "subir", entidad: "documentos", entidad_id: id, valor_nuevo: { nombre: d.nombre, categoria: d.categoria, via: "inicio_directiva" } });

  let enCalendario = false;
  if (d.fecha && d.al_calendario) {
    // Si la tabla de actividades todavía no existe, el documento queda guardado igual.
    const notaId = await insert("notas_calendario", { fecha: d.fecha, hora: null, todo_el_dia: 1, titulo: d.nombre.slice(0, 150), autor_id: user.id, serie_id: null }).catch(() => null);
    if (notaId) {
      enCalendario = true;
      await audit({ usuario_id: user.id, accion: "crear", entidad: "notas_calendario", entidad_id: notaId, valor_nuevo: { titulo: d.nombre, fecha: d.fecha, documento_id: id } });
      revalidatePath("/calendario");
    }
  }
  revalidatePath("/documentos");
  revalidatePath("/dashboard");
  return enCalendario ? "Documento guardado y anotado en el calendario." : "Documento guardado.";
}

export async function subirDocumentoRapidoFormAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  let aviso = "";
  const r = await conEstadoDeAccion(async () => {
    aviso = await subirDocumentoRapidoAction(fd);
  });
  return r.ok ? { ...r, aviso } : r;
}
