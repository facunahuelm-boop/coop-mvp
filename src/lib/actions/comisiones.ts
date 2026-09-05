"use server";

import { revalidatePath } from "next/cache";
import { insert, update, get, audit } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { canEdit } from "@/lib/roles";

export async function crearComisionAction(formData: FormData) {
  const user = await requireUser();
  if (!canEdit(user.rol, "comisiones")) throw new Error("No autorizado");
  const nombre = String(formData.get("nombre") || "").trim();
  if (!nombre) throw new Error("Falta el nombre de la comisión");
  const id = await insert("comisiones", {
    nombre,
    descripcion: String(formData.get("descripcion") || "") || null,
  });
  await audit({ usuario_id: user.id, accion: "crear", entidad: "comisiones", entidad_id: id, valor_nuevo: { nombre } });
  revalidatePath("/comisiones");
}

export async function archivarComisionAction(formData: FormData) {
  const user = await requireUser();
  if (!canEdit(user.rol, "comisiones")) throw new Error("No autorizado");
  const id = Number(formData.get("id"));
  await update("comisiones", id, { activa: 0 });
  await audit({ usuario_id: user.id, accion: "archivar", entidad: "comisiones", entidad_id: id });
  revalidatePath("/comisiones");
}

export async function agregarMiembroAction(formData: FormData) {
  const user = await requireUser();
  if (!canEdit(user.rol, "comisiones")) throw new Error("No autorizado");
  const comision_id = Number(formData.get("comision_id"));
  const user_id = Number(formData.get("user_id"));
  const rol_en_comision = String(formData.get("rol_en_comision") || "integrante");

  const yaEsta = await get<{ id: number }>(
    `SELECT id FROM comision_miembros WHERE comision_id = ? AND user_id = ? AND activo = 1`,
    [comision_id, user_id]
  );
  if (yaEsta) return; // ya integra la comisión, no duplicar

  const id = await insert("comision_miembros", { comision_id, user_id, rol_en_comision });
  await audit({ usuario_id: user.id, accion: "agregar_miembro", entidad: "comision_miembros", entidad_id: id, valor_nuevo: { comision_id, user_id, rol_en_comision } });
  revalidatePath("/comisiones");
}

export async function quitarMiembroAction(formData: FormData) {
  const user = await requireUser();
  if (!canEdit(user.rol, "comisiones")) throw new Error("No autorizado");
  const id = Number(formData.get("id"));
  await update("comision_miembros", id, { activo: 0, hasta: new Date().toISOString() });
  await audit({ usuario_id: user.id, accion: "quitar_miembro", entidad: "comision_miembros", entidad_id: id });
  revalidatePath("/comisiones");
}
