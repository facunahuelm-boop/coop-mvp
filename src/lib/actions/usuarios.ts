"use server";

import { z } from "zod";
import { requireUser, verifyPassword, hashPassword } from "@/lib/auth";
import { get, update, audit } from "@/lib/db";
import { saveUploadedFile, TIPOS_IMAGEN } from "@/lib/upload";
import { revalidatePath } from "next/cache";
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

/**
 * Rediseño "Color secundario + Top Bar" (punto 15 del pedido): cambiar la
 * foto de perfil propia. Mismo criterio de seguridad que cambiarPasswordAction
 * de arriba — jamás recibe un id de usuario por formulario, siempre opera
 * sobre requireUser(), así nadie puede armar el POST a mano para cambiarle
 * la foto a otra persona. La imagen se guarda con el mismo mecanismo que el
 * logo de la cooperativa (saveUploadedFile → Supabase Storage, URL pública
 * simple: ver la nota de alcance en migrations/0023_users_avatar.sql sobre
 * por qué un avatar no necesita el patrón de URL firmada que sí usan los
 * documentos sensibles).
 */
export async function cambiarFotoAction(formData: FormData) {
  const user = await requireUser();

  const fotoUrl = await saveUploadedFile(formData.get("foto") as File | null, user.organization_id, "avatares", {
    tiposPermitidos: TIPOS_IMAGEN,
    maxBytes: 3 * 1024 * 1024,
  });
  if (!fotoUrl) {
    throw new ValidationError("foto", "Elegí una imagen para subir.");
  }

  await update("users", user.id, { avatar_url: fotoUrl });
  await audit({ usuario_id: user.id, accion: "cambiar_foto_perfil", entidad: "users", entidad_id: user.id });

  // La Top Bar (todas las páginas) y el propio perfil muestran el avatar —
  // por eso se invalida el layout completo, no sólo /usuarios/[id].
  revalidatePath("/", "layout");
}

export async function cambiarFotoFormAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  return conEstadoDeAccion(() => cambiarFotoAction(formData));
}
