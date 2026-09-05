"use server";

import { revalidatePath } from "next/cache";
import { insert, update, audit } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { canEdit } from "@/lib/roles";
import { saveUploadedFile } from "@/lib/upload";

export async function crearTareaAction(formData: FormData) {
  const user = await requireUser();
  if (!canEdit(user.rol, "obra")) throw new Error("No autorizado");

  const id = await insert("tareas_obra", {
    etapa: String(formData.get("etapa") || ""),
    nombre: String(formData.get("nombre") || ""),
    descripcion: String(formData.get("descripcion") || "") || null,
    fecha_inicio: String(formData.get("fecha_inicio") || "") || null,
    fecha_fin_prevista: String(formData.get("fecha_fin_prevista") || "") || null,
    prioridad: String(formData.get("prioridad") || "media"),
    responsable_id: user.id,
    estado: "pendiente",
  });
  await audit({ usuario_id: user.id, accion: "crear", entidad: "tareas_obra", entidad_id: id, valor_nuevo: { nombre: formData.get("nombre") } });
  revalidatePath("/obra");
}

export async function cambiarEstadoTareaAction(formData: FormData) {
  const user = await requireUser();
  if (!canEdit(user.rol, "obra")) throw new Error("No autorizado");
  const id = Number(formData.get("id"));
  const estado = String(formData.get("estado"));
  await update("tareas_obra", id, { estado });
  await audit({ usuario_id: user.id, accion: "actualizar_estado", entidad: "tareas_obra", entidad_id: id, valor_nuevo: { estado } });
  revalidatePath("/obra");
  revalidatePath(`/obra/${id}`);
}

export async function agregarAvanceAction(formData: FormData) {
  const user = await requireUser();
  if (!canEdit(user.rol, "obra")) throw new Error("No autorizado");
  const tareaId = Number(formData.get("tarea_id"));
  const fotoUrl = await saveUploadedFile(formData.get("foto") as File | null);
  await insert("avances_obra", {
    tarea_id: tareaId,
    autor_id: user.id,
    descripcion: String(formData.get("descripcion") || ""),
    foto_url: fotoUrl,
  });
  revalidatePath(`/obra/${tareaId}`);
}

export async function agregarProblemaAction(formData: FormData) {
  const user = await requireUser();
  if (!canEdit(user.rol, "obra")) throw new Error("No autorizado");
  const tareaId = Number(formData.get("tarea_id")) || null;
  const id = await insert("problemas_obra", {
    tarea_id: tareaId,
    titulo: String(formData.get("titulo") || ""),
    descripcion: String(formData.get("descripcion") || "") || null,
    severidad: String(formData.get("severidad") || "media"),
    autor_id: user.id,
    estado: "abierto",
  });
  await audit({ usuario_id: user.id, accion: "crear", entidad: "problemas_obra", entidad_id: id });
  if (tareaId) revalidatePath(`/obra/${tareaId}`);
  revalidatePath("/obra");
}

export async function resolverProblemaAction(formData: FormData) {
  const user = await requireUser();
  if (!canEdit(user.rol, "obra")) throw new Error("No autorizado");
  const id = Number(formData.get("id"));
  const tareaId = formData.get("tarea_id") ? Number(formData.get("tarea_id")) : null;
  await update("problemas_obra", id, { estado: "resuelto", resolucion: String(formData.get("resolucion") || "") });
  await audit({ usuario_id: user.id, accion: "resolver", entidad: "problemas_obra", entidad_id: id });
  if (tareaId) revalidatePath(`/obra/${tareaId}`);
  revalidatePath("/obra");
}
