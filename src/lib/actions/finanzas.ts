"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { insert, update, get, audit, esColumnaInexistente } from "@/lib/db";
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

  const existente = await get<{ id: number; estado?: string }>(
    `SELECT id, estado FROM movimientos_financieros WHERE id = ?`,
    [id]
  ).catch(async (err) => {
    // Sub-fase 4.4 todavía no migrada en este entorno (columna `estado`
    // inexistente, 42703) — un movimiento nunca puede estar anulado sin esa
    // columna, así que se sigue exactamente igual que antes de esta sub-fase.
    if (!esColumnaInexistente(err)) throw err;
    return get<{ id: number; estado?: string }>(`SELECT id FROM movimientos_financieros WHERE id = ?`, [id]);
  });
  if (!existente) throw new Error("Ese movimiento ya no existe.");
  if (existente.estado === "anulado") {
    throw new Error("Este movimiento está anulado — no se puede editar. Registrá un movimiento nuevo si hace falta corregir el saldo.");
  }

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

const anularMovimientoSchema = z.object({ id: zId, motivo: zTextoOpcional(500) });

/**
 * Sub-fase 4.4 (Eliminación segura de movimientos financieros): reemplaza el
 * DELETE físico que tenía esta acción (eliminarMovimientoAction) por una baja
 * lógica — mismo criterio que ya usa gastos_comision.estado ('anulado', ver
 * anularGastoAction en gastos.ts). Un movimiento anulado sigue apareciendo en
 * el historial de Finanzas (marcado, para trazabilidad) pero queda excluido
 * del saldo — ver el filtro por `estado` en resumenFinanciero() (logic.ts).
 *
 * Dos resguardos que el DELETE de antes no tenía (auditoría previa, ver
 * CHANGELOG): (1) solo admin puede anular — antes podían administración,
 * tesorería y consejo directivo también, sin ninguna fricción extra, la
 * misma restricción que ya usan los otros 3 lugares del sistema que hacen un
 * borrado real (documentos, proveedores, solicitudes de compra); (2) si el
 * movimiento fue generado automáticamente por un gasto de comisión ya pagado
 * (gastos_comision.movimiento_financiero_id), no se puede anular — hay que
 * corregirlo desde el gasto de origen, para no dejar esa cadena
 * inconsistente (mismo motivo por el que anularGastoAction ya rechaza anular
 * un gasto que ya está "pagado").
 */
export async function anularMovimientoAction(formData: FormData) {
  const user = await requireUser();
  if (user.rol !== "admin") throw new Error("Solo un administrador del sistema puede anular un movimiento financiero.");
  const { id, motivo } = parseForm(anularMovimientoSchema, formData);

  // A diferencia de editarMovimientoAction (donde `estado` es un chequeo
  // extra sobre una operación que igual tiene sentido sin él), acá TODA la
  // operación depende de que la columna `estado` exista — update() (db.ts)
  // ignora en silencio cualquier columna que no exista y reintenta sin ella
  // (conFallbackColumnaFaltante, pensado para columnas opcionales), así que
  // si se llamara update() directamente sin este chequeo previo y la
  // migración 0038 no hubiera corrido todavía, las 4 columnas nuevas se
  // descartarían una por una y el UPDATE terminaría sin tocar nada — un
  // "éxito" falso, auditado como si de verdad se hubiera anulado. Por eso acá
  // se chequea ANTES de intentar nada, y si la columna no existe se avisa con
  // un error explícito en vez de dejar que se degrade en silencio.
  let fila: { id: number; estado: string } | undefined;
  try {
    fila = await get<{ id: number; estado: string }>(`SELECT id, estado FROM movimientos_financieros WHERE id = ?`, [id]);
  } catch (err) {
    if (!esColumnaInexistente(err)) throw err;
    throw new Error("Esta función todavía no está habilitada en este entorno: falta aplicar una actualización pendiente de la base de datos.");
  }
  if (!fila) {
    revalidatePath("/finanzas");
    return;
  }
  if (fila.estado === "anulado") return; // ya está anulado, no hay nada que hacer

  // .catch(() => null): gastos_comision es una tabla opcional en entornos
  // viejos (ver MENSAJE_GASTOS_TABLA_FALTANTE en gastos.ts) — si no existe,
  // no puede haber ningún gasto dependiente de este movimiento.
  const gastoDependiente = await get<{ id: number }>(
    `SELECT id FROM gastos_comision WHERE movimiento_financiero_id = ? LIMIT 1`,
    [id]
  ).catch(() => null);
  if (gastoDependiente) {
    throw new Error("Este movimiento lo generó automáticamente un gasto de comisión ya pagado — anulalo o corregilo desde Gastos en su lugar, no desde acá.");
  }

  await update("movimientos_financieros", id, {
    estado: "anulado",
    anulado_en: new Date().toISOString(),
    anulado_por_id: user.id,
    motivo_anulacion: motivo || null,
  });
  await audit({ usuario_id: user.id, accion: "anular_movimiento", entidad: "movimientos_financieros", entidad_id: id, valor_nuevo: { motivo } });
  revalidatePath("/finanzas");
  revalidatePath("/dashboard");
}

export async function anularMovimientoFormAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  return conEstadoDeAccion(() => anularMovimientoAction(formData));
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
