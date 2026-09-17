"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { insert, update, run, get, audit } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { canEdit } from "@/lib/roles";
import { parseForm, zId, zTexto, zTextoOpcional, zMontoPositivo, zFecha, zEnumSeguro } from "@/lib/validation";
import { conEstadoDeAccion, type ActionState } from "@/lib/actionState";

const registrarMovimientoSchema = z.object({
  tipo: zEnumSeguro(["ingreso", "egreso"], "egreso"),
  monto: zMontoPositivo(),
  categoria: zTexto(120),
  descripcion: zTextoOpcional(1000),
});

export async function registrarMovimientoAction(formData: FormData) {
  const user = await requireUser();
  if (!canEdit(user.rol, "finanzas")) throw new Error("No autorizado");
  const datos = parseForm(registrarMovimientoSchema, formData);
  const id = await insert("movimientos_financieros", {
    tipo: datos.tipo,
    monto: datos.monto,
    categoria: datos.categoria,
    etapa_obra: datos.categoria,
    descripcion: datos.descripcion,
    registrado_por_id: user.id,
  });
  await audit({ usuario_id: user.id, accion: "registrar_movimiento", entidad: "movimientos_financieros", entidad_id: id, valor_nuevo: datos });
  revalidatePath("/finanzas");
  revalidatePath("/dashboard");
}

export async function registrarMovimientoFormAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  return conEstadoDeAccion(() => registrarMovimientoAction(formData));
}

const editarMovimientoSchema = z.object({
  id: zId,
  tipo: zEnumSeguro(["ingreso", "egreso"], "egreso"),
  monto: zMontoPositivo(),
  categoria: zTexto(120),
  descripcion: zTextoOpcional(1000),
});

// Pedido explícito (rediseño de Finanzas, 16/09): "que todos los ingresos
// tengan pop-ups, que se puedan editar y eliminar". registrarMovimientoAction
// (arriba) sólo daba de alta — no había forma de corregir un monto o una
// categoría mal tipeados sin anular y volver a cargar todo de nuevo.
export async function editarMovimientoAction(formData: FormData) {
  const user = await requireUser();
  if (!canEdit(user.rol, "finanzas")) throw new Error("No autorizado");
  const { id, tipo, monto, categoria, descripcion } = parseForm(editarMovimientoSchema, formData);

  const existente = await get<{ id: number }>(`SELECT id FROM movimientos_financieros WHERE id = ?`, [id]);
  if (!existente) throw new Error("Ese movimiento ya no existe.");

  await update("movimientos_financieros", id, {
    tipo,
    monto,
    categoria,
    etapa_obra: categoria,
    descripcion,
  });
  await audit({ usuario_id: user.id, accion: "editar_movimiento", entidad: "movimientos_financieros", entidad_id: id, valor_nuevo: { tipo, monto, categoria } });
  revalidatePath("/finanzas");
  revalidatePath("/dashboard");
}

export async function editarMovimientoFormAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  return conEstadoDeAccion(() => editarMovimientoAction(formData));
}

const eliminarMovimientoSchema = z.object({ id: zId });

export async function eliminarMovimientoAction(formData: FormData) {
  const user = await requireUser();
  if (!canEdit(user.rol, "finanzas")) throw new Error("No autorizado");
  const { id } = parseForm(eliminarMovimientoSchema, formData);

  const existente = await get<{ id: number }>(`SELECT id FROM movimientos_financieros WHERE id = ?`, [id]);
  if (!existente) {
    revalidatePath("/finanzas");
    return;
  }
  await run(`DELETE FROM movimientos_financieros WHERE id = ?`, [id]);
  await audit({ usuario_id: user.id, accion: "eliminar_movimiento", entidad: "movimientos_financieros", entidad_id: id });
  revalidatePath("/finanzas");
  revalidatePath("/dashboard");
}

export async function eliminarMovimientoFormAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  return conEstadoDeAccion(() => eliminarMovimientoAction(formData));
}

const agregarCompromisoSchema = z.object({
  descripcion: zTexto(300),
  monto: zMontoPositivo(),
  fecha_estimada: zFecha,
  origen: zTextoOpcional(300),
});

export async function agregarCompromisoAction(formData: FormData) {
  const user = await requireUser();
  if (!canEdit(user.rol, "finanzas")) throw new Error("No autorizado");
  const datos = parseForm(agregarCompromisoSchema, formData);
  await insert("compromisos_futuros", datos);
  revalidatePath("/finanzas");
  revalidatePath("/dashboard");
}

export async function agregarCompromisoFormAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  return conEstadoDeAccion(() => agregarCompromisoAction(formData));
}
