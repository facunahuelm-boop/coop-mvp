"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { insert, update, get, run } from "@/lib/db";
import { requireUser, type SessionUser } from "@/lib/auth";
import { parseForm, zId, zTexto, zFecha, zEnumSeguro } from "@/lib/validation";

// Notas de calendario personalizadas (pedido explícito): a diferencia del
// resto del calendario (que solo muestra fechas que ya existen en otro
// módulo — reuniones, obra, etc.), esto es texto libre que cualquiera puede
// escribir directo en una fecha, con su propio color, desde el Dashboard o
// desde /calendario — las dos pantallas usan las mismas tres acciones.

const COLORES_NOTA = ["brand", "verde", "amarillo", "rojo", "gray"] as const;

const notaSchema = z.object({
  fecha: zFecha,
  hora: z
    .string()
    .optional()
    .or(z.literal(""))
    .transform((v) => (v ? v : null))
    .refine((v) => v === null || /^\d{2}:\d{2}$/.test(v), "Hora inválida."),
  titulo: zTexto(150),
  color: zEnumSeguro(COLORES_NOTA, "brand"),
});

function puedeModificar(user: SessionUser, autorId: number) {
  return autorId === user.id || user.rol === "admin" || user.rol === "consejo_directivo";
}

export async function crearNotaCalendarioAction(formData: FormData) {
  const user = await requireUser();
  const datos = parseForm(notaSchema, formData);
  await insert("notas_calendario", { ...datos, autor_id: user.id });
  revalidatePath("/calendario");
  revalidatePath("/dashboard");
}

const notaConIdSchema = notaSchema.extend({ id: zId });

export async function editarNotaCalendarioAction(formData: FormData) {
  const user = await requireUser();
  const { id, ...datos } = parseForm(notaConIdSchema, formData);
  const nota = await get<{ autor_id: number }>(`SELECT autor_id FROM notas_calendario WHERE id = ?`, [id]);
  if (!nota) throw new Error("Esa nota ya no existe — puede que alguien ya la haya borrado.");
  if (!puedeModificar(user, nota.autor_id)) throw new Error("No podés editar una nota que no escribiste vos.");
  await update("notas_calendario", id, datos);
  revalidatePath("/calendario");
  revalidatePath("/dashboard");
}

export async function eliminarNotaCalendarioAction(formData: FormData) {
  const user = await requireUser();
  const { id } = parseForm(z.object({ id: zId }), formData);
  const nota = await get<{ autor_id: number }>(`SELECT autor_id FROM notas_calendario WHERE id = ?`, [id]);
  if (!nota) return; // ya no está, no hay nada que borrar
  if (!puedeModificar(user, nota.autor_id)) throw new Error("No podés borrar una nota que no escribiste vos.");
  await run(`DELETE FROM notas_calendario WHERE id = ?`, [id]);
  revalidatePath("/calendario");
  revalidatePath("/dashboard");
}
