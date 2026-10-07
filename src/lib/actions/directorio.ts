"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { get, insert, update, audit } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { canEdit } from "@/lib/roles";
import { parseForm, zId, zTexto, zTextoOpcional, zEnumSeguro, zTelefonoOpcional, zEmailOpcional } from "@/lib/validation";
import { conEstadoDeAccion, type ActionState } from "@/lib/actionState";

/** Fase 2F — Directorio: IAT, organismos y profesionales (no se borran: se dan de baja). */

export async function puedeEditarDirectorio(rol: string): Promise<boolean> {
  return canEdit(rol as never, "socios") || canEdit(rol as never, "compras") || rol === "consejo_directivo";
}

const contactoSchema = z.object({
  id: zId.optional(),
  nombre: zTexto(150),
  tipo: zEnumSeguro(["iat", "organismo", "profesional", "otro"], "otro"),
  persona_contacto: zTextoOpcional(120),
  telefono: zTelefonoOpcional,
  email: zEmailOpcional,
  notas: zTextoOpcional(1000),
});

export async function guardarContactoExternoAction(formData: FormData) {
  const user = await requireUser();
  if (!(await puedeEditarDirectorio(user.rol))) throw new Error("No tenés permiso para cambiar el directorio.");
  const { id, ...d } = parseForm(contactoSchema, formData);
  if (id) {
    const antes = await get(`SELECT * FROM contactos_externos WHERE id = ? AND activo = 1`, [id]);
    if (!antes) throw new Error("Ese contacto no existe.");
    await update("contactos_externos", id, d);
    await audit({ usuario_id: user.id, accion: "editar_contacto_externo", entidad: "contactos_externos", entidad_id: id, valor_anterior: antes, valor_nuevo: d });
  } else {
    const nuevo = await insert("contactos_externos", { ...d, creado_por_id: user.id });
    await audit({ usuario_id: user.id, accion: "crear_contacto_externo", entidad: "contactos_externos", entidad_id: nuevo, valor_nuevo: d });
  }
  revalidatePath("/contactos");
}
export async function guardarContactoExternoFormAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  return conEstadoDeAccion(() => guardarContactoExternoAction(fd));
}

export async function bajaContactoExternoAction(formData: FormData) {
  const user = await requireUser();
  if (!(await puedeEditarDirectorio(user.rol))) throw new Error("No tenés permiso para cambiar el directorio.");
  const { id } = parseForm(z.object({ id: zId }), formData);
  await update("contactos_externos", id, { activo: 0 });
  await audit({ usuario_id: user.id, accion: "baja_contacto_externo", entidad: "contactos_externos", entidad_id: id });
  revalidatePath("/contactos");
}
export async function bajaContactoExternoFormAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  return conEstadoDeAccion(() => bajaContactoExternoAction(fd));
}
