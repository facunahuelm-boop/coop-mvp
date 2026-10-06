"use server";

import { revalidatePath } from "next/cache";
import { run, audit } from "@/lib/db";
import { requireUser } from "@/lib/auth";

/**
 * Fase 1A (estándar "usable a los 70 años"): preferencia personal "Letra
 * grande". Se guarda en el usuario (no en el navegador) para que se mantenga
 * al entrar desde otro celular o computadora.
 */
export async function cambiarLetraGrandeAction(activar: boolean) {
  const user = await requireUser();
  await run(`UPDATE users SET letra_grande = ? WHERE id = ?`, [activar === true, user.id]);
  await audit({
    usuario_id: user.id,
    accion: "cambiar_preferencia",
    entidad: "users",
    entidad_id: user.id,
    valor_anterior: { letra_grande: user.letra_grande },
    valor_nuevo: { letra_grande: activar === true },
  });
  revalidatePath("/", "layout");
}
