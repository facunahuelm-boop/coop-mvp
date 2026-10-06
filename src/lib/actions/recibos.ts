"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { get } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { canEdit } from "@/lib/roles";
import { parseForm, zId } from "@/lib/validation";
import { conEstadoDeAccion, type ActionState } from "@/lib/actionState";
import { emitirReciboDePago } from "@/lib/recibos";

/** Fase 1C: emitir el recibo de un pago cargado antes de que existieran los recibos. */
export async function emitirReciboAction(formData: FormData) {
  const user = await requireUser();
  if (!canEdit(user.rol, "finanzas")) throw new Error("No tenés permiso para emitir recibos.");
  const { pago_id } = parseForm(z.object({ pago_id: zId }), formData);
  const pago = await get<{ socio_id: number }>(`SELECT socio_id FROM movimientos_cuenta_socio WHERE id = ? AND tipo = 'pago'`, [pago_id]);
  if (!pago) throw new Error("Ese pago no existe.");
  const r = await emitirReciboDePago(pago_id, user.id);
  if (!r) throw new Error("No se pudo emitir el recibo (¿el pago está anulado?).");
  revalidatePath(`/socios/${pago.socio_id}`);
}

export async function emitirReciboFormAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  return conEstadoDeAccion(() => emitirReciboAction(formData));
}
