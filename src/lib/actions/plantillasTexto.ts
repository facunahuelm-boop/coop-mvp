"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { get, insert, update, audit } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { canEdit } from "@/lib/roles";
import { parseForm, zId, zTexto, zEnumSeguro } from "@/lib/validation";
import { conEstadoDeAccion, type ActionState } from "@/lib/actionState";

/** Fase 2H — plantillas de texto con variables (constancias, notas, convocatorias). */

export async function puedeUsarPlantillas(rol: string): Promise<boolean> {
  return canEdit(rol as never, "socios") || canEdit(rol as never, "finanzas") || rol === "consejo_directivo" || rol === "admin";
}

const schema = z.object({
  id: zId.optional(),
  nombre: zTexto(150),
  categoria: zEnumSeguro(["constancia", "nota", "convocatoria", "acta", "otro"], "otro"),
  cuerpo: zTexto(8000),
});

export async function guardarPlantillaTextoAction(formData: FormData) {
  const user = await requireUser();
  if (!(await puedeUsarPlantillas(user.rol))) throw new Error("No tenés permiso para cambiar las plantillas.");
  const { id, ...d } = parseForm(schema, formData);
  if (id) {
    const antes = await get(`SELECT nombre, cuerpo FROM plantillas_texto WHERE id = ? AND activo = 1`, [id]);
    if (!antes) throw new Error("Esa plantilla no existe.");
    await update("plantillas_texto", id, { ...d, actualizado_en: new Date().toISOString() });
    await audit({ usuario_id: user.id, accion: "editar_plantilla_texto", entidad: "plantillas_texto", entidad_id: id, valor_anterior: antes, valor_nuevo: d });
  } else {
    const nuevo = await insert("plantillas_texto", { ...d, creado_por_id: user.id });
    await audit({ usuario_id: user.id, accion: "crear_plantilla_texto", entidad: "plantillas_texto", entidad_id: nuevo, valor_nuevo: { nombre: d.nombre } });
  }
  revalidatePath("/plantillas");
}
export async function guardarPlantillaTextoFormAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  return conEstadoDeAccion(() => guardarPlantillaTextoAction(fd));
}

export async function bajaPlantillaTextoAction(formData: FormData) {
  const user = await requireUser();
  if (!(await puedeUsarPlantillas(user.rol))) throw new Error("No tenés permiso para cambiar las plantillas.");
  const { id } = parseForm(z.object({ id: zId }), formData);
  await update("plantillas_texto", id, { activo: 0 });
  await audit({ usuario_id: user.id, accion: "baja_plantilla_texto", entidad: "plantillas_texto", entidad_id: id });
  revalidatePath("/plantillas");
}
export async function bajaPlantillaTextoFormAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  return conEstadoDeAccion(() => bajaPlantillaTextoAction(fd));
}
