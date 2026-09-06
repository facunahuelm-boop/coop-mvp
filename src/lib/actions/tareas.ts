"use server";

import { revalidatePath } from "next/cache";
import { insert, update, audit } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { canEdit } from "@/lib/roles";

// Fase 06 del Plan Maestro — tareas genéricas por comisión (no solo Obra o
// Trabajo). Se gatea por el mismo permiso que el resto de Comisiones: quien
// puede editar la comisión (coordinarla en el día a día) puede cargarle y
// darle seguimiento a sus propias tareas.

export async function crearTareaAction(formData: FormData) {
  const user = await requireUser();
  if (!canEdit(user.rol, "comisiones")) throw new Error("No autorizado");

  const comision_id = Number(formData.get("comision_id"));
  const titulo = String(formData.get("titulo") || "").trim();
  if (!comision_id || !titulo) throw new Error("Falta la comisión o el título de la tarea");

  const descripcion = String(formData.get("descripcion") || "") || null;
  const responsableRaw = String(formData.get("responsable_id") || "");
  const responsable_id = responsableRaw ? Number(responsableRaw) : null;
  const prioridad = String(formData.get("prioridad") || "media");
  const fecha_vencimiento = String(formData.get("fecha_vencimiento") || "") || null;

  const id = await insert("tareas", {
    comision_id,
    titulo,
    descripcion,
    responsable_id,
    prioridad,
    fecha_vencimiento,
    creado_por_id: user.id,
  });
  await audit({
    usuario_id: user.id,
    accion: "crear",
    entidad: "tareas",
    entidad_id: id,
    valor_nuevo: { comision_id, titulo, prioridad },
  });
  revalidatePath("/comisiones");
}

export async function cambiarEstadoTareaAction(formData: FormData) {
  const user = await requireUser();
  if (!canEdit(user.rol, "comisiones")) throw new Error("No autorizado");

  const id = Number(formData.get("id"));
  const estado = String(formData.get("estado") || "pendiente");
  if (!["pendiente", "en_curso", "completada"].includes(estado)) throw new Error("Estado inválido");

  await update("tareas", id, { estado });
  await audit({ usuario_id: user.id, accion: "cambiar_estado", entidad: "tareas", entidad_id: id, valor_nuevo: { estado } });
  revalidatePath("/comisiones");
}
