"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { insert, update, audit } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { canEdit } from "@/lib/roles";
import { parseForm, zId, zIdOpcional, zTexto, zTextoOpcional, zFechaOpcional, zEnumSeguro } from "@/lib/validation";

// Fase 06 del Plan Maestro — tareas genéricas por comisión (no solo Obra o
// Trabajo). Se gatea por el mismo permiso que el resto de Comisiones: quien
// puede editar la comisión (coordinarla en el día a día) puede cargarle y
// darle seguimiento a sus propias tareas.

const crearTareaSchema = z.object({
  comision_id: zId,
  titulo: zTexto(200),
  descripcion: zTextoOpcional(2000),
  responsable_id: zIdOpcional,
  prioridad: zEnumSeguro(["alta", "media", "baja"], "media"),
  fecha_vencimiento: zFechaOpcional,
});

export async function crearTareaAction(formData: FormData) {
  const user = await requireUser();
  if (!canEdit(user.rol, "comisiones")) throw new Error("No autorizado");
  const datos = parseForm(crearTareaSchema, formData);

  const id = await insert("tareas", { ...datos, creado_por_id: user.id });
  await audit({
    usuario_id: user.id,
    accion: "crear",
    entidad: "tareas",
    entidad_id: id,
    valor_nuevo: { comision_id: datos.comision_id, titulo: datos.titulo, prioridad: datos.prioridad },
  });
  revalidatePath("/comisiones");
}

export async function cambiarEstadoTareaAction(formData: FormData) {
  const user = await requireUser();
  if (!canEdit(user.rol, "comisiones")) throw new Error("No autorizado");
  const { id, estado } = parseForm(z.object({ id: zId, estado: zEnumSeguro(["pendiente", "en_curso", "completada"], "pendiente") }), formData);
  await update("tareas", id, { estado });
  await audit({ usuario_id: user.id, accion: "cambiar_estado", entidad: "tareas", entidad_id: id, valor_nuevo: { estado } });
  revalidatePath("/comisiones");
}
