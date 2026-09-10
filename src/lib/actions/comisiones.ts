"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { insert, update, get, audit } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { canEdit } from "@/lib/roles";
import { parseForm, zId, zTexto, zTextoOpcional } from "@/lib/validation";

const crearComisionSchema = z.object({ nombre: zTexto(200), descripcion: zTextoOpcional(1000) });

export async function crearComisionAction(formData: FormData) {
  const user = await requireUser();
  if (!canEdit(user.rol, "comisiones")) throw new Error("No autorizado");
  const datos = parseForm(crearComisionSchema, formData);
  const id = await insert("comisiones", datos);
  await audit({ usuario_id: user.id, accion: "crear", entidad: "comisiones", entidad_id: id, valor_nuevo: { nombre: datos.nombre } });
  revalidatePath("/comisiones");
}

export async function archivarComisionAction(formData: FormData) {
  const user = await requireUser();
  if (!canEdit(user.rol, "comisiones")) throw new Error("No autorizado");
  const { id } = parseForm(z.object({ id: zId }), formData);
  await update("comisiones", id, { activa: 0 });
  await audit({ usuario_id: user.id, accion: "archivar", entidad: "comisiones", entidad_id: id });
  revalidatePath("/comisiones");
}

const agregarMiembroSchema = z.object({
  comision_id: zId,
  user_id: zId,
  rol_en_comision: zTextoOpcional(100).transform((v) => v || "integrante"),
});

export async function agregarMiembroAction(formData: FormData) {
  const user = await requireUser();
  if (!canEdit(user.rol, "comisiones")) throw new Error("No autorizado");
  const { comision_id, user_id, rol_en_comision } = parseForm(agregarMiembroSchema, formData);

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
  const { id } = parseForm(z.object({ id: zId }), formData);
  await update("comision_miembros", id, { activo: 0, hasta: new Date().toISOString() });
  await audit({ usuario_id: user.id, accion: "quitar_miembro", entidad: "comision_miembros", entidad_id: id });
  revalidatePath("/comisiones");
}
