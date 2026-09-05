"use server";

import { revalidatePath } from "next/cache";
import { get, update, audit } from "@/lib/db";
import { requireUser } from "@/lib/auth";

export async function resolverAlertaAction(formData: FormData) {
  const user = await requireUser();
  const id = Number(formData.get("id"));
  const alerta = await get<any>(`SELECT * FROM alertas WHERE id = ?`, [id]);
  if (!alerta) throw new Error("Alerta no encontrada");
  const autorizado = user.rol === alerta.asignado_a_rol || ["consejo_directivo", "admin"].includes(user.rol);
  if (!autorizado) throw new Error("No autorizado para resolver esta alerta");
  await update("alertas", id, { estado: "resuelta" });
  await audit({ usuario_id: user.id, accion: "resolver_alerta", entidad: "alertas", entidad_id: id });
  revalidatePath("/alertas");
  revalidatePath("/dashboard");
}
