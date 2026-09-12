"use server";

import { z } from "zod";
import { requireUser, verifyPassword, hashPassword } from "@/lib/auth";
import { get, update, audit } from "@/lib/db";
import { parseForm, ValidationError } from "@/lib/validation";
import { conEstadoDeAccion, type ActionState } from "@/lib/actionState";

/**
 * Fase 6 del Plan Maestro ("Perfil individual de usuario"), hallazgo H-13:
 * hoy no existe ninguna forma de que una persona cambie su propia
 * contraseña — se creó junto con la página de perfil (src/app/(app)/usuarios/[id])
 * porque es el lugar natural donde alguien esperaría encontrar esa opción,
 * no porque el Plan Maestro lo pidiera explícitamente por su nombre. Es una
 * acción estrictamente sobre uno mismo: no recibe ningún id de usuario por
 * formulario, siempre opera sobre `requireUser()` — así no hay forma de que
 * alguien intente cambiarle la contraseña a otra persona armando el POST a
 * mano.
 */

const cambiarPasswordSchema = z.object({
  actual: z.string().min(1, "Ingresá tu contraseña actual."),
  nueva: z
    .string()
    .min(8, "Tiene que tener al menos 8 caracteres.")
    .max(200, "Máximo 200 caracteres."),
  confirmar: z.string(),
});

export async function cambiarPasswordAction(formData: FormData) {
  const user = await requireUser();
  const datos = parseForm(cambiarPasswordSchema, formData);

  if (datos.nueva !== datos.confirmar) {
    throw new ValidationError("confirmar", "Las contraseñas nuevas no coinciden.");
  }

  const row = await get<{ password_hash: string }>(`SELECT password_hash FROM users WHERE id = ?`, [user.id]);
  const actualOk = row ? await verifyPassword(datos.actual, row.password_hash) : false;
  if (!actualOk) {
    throw new ValidationError("actual", "La contraseña actual no es correcta.");
  }

  const nuevoHash = await hashPassword(datos.nueva);
  await update("users", user.id, { password_hash: nuevoHash });

  // Sin valor_anterior/valor_nuevo a propósito: la auditoría registra que la
  // contraseña cambió, nunca su contenido (ni el hash viejo ni el nuevo).
  await audit({ usuario_id: user.id, accion: "cambiar_password", entidad: "users", entidad_id: user.id });
}

export async function cambiarPasswordFormAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  return conEstadoDeAccion(() => cambiarPasswordAction(formData));
}
