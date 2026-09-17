"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { insert, update, run, all, get, audit } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { canEdit } from "@/lib/roles";
import {
  parseForm,
  zId,
  zTexto,
  zTextoOpcional,
  zMontoPositivo,
  zFecha,
  zFechaOpcional,
  zEnumSeguro,
} from "@/lib/validation";
import { conEstadoDeAccion, type ActionState } from "@/lib/actionState";
import { saveUploadedFile, TIPOS_DOCUMENTO } from "@/lib/upload";

// Fase 10 del Plan Maestro — cuenta corriente por socio ("¿cuánto debo?").
// Se gatea por el permiso de Finanzas (no el de Socios): registrar un cargo
// o un pago es una operación financiera, con el mismo criterio que ya usa
// registrarMovimientoAction en finanzas.ts (administración lo hace de forma
// habitual, tesorería lo aprueba).

const registrarMovimientoCuentaSocioSchema = z.object({
  socio_id: zId,
  tipo: zEnumSeguro(["cargo", "pago"], "cargo"),
  concepto: zTexto(300),
  monto: zMontoPositivo(),
  fecha: zFecha,
  fecha_vencimiento: zFechaOpcional,
  notas: zTextoOpcional(1000),
});

export async function registrarMovimientoCuentaSocioAction(formData: FormData) {
  const user = await requireUser();
  if (!canEdit(user.rol, "finanzas")) throw new Error("No autorizado");

  const { socio_id, tipo, concepto, monto, fecha, fecha_vencimiento, notas } = parseForm(
    registrarMovimientoCuentaSocioSchema,
    formData
  );

  const socio = await get<{ id: number }>(`SELECT id FROM socios WHERE id = ?`, [socio_id]);
  if (!socio) throw new Error("Socio no encontrado");

  // Comprobante opcional (mismo patrón que gastos_comision.comprobante_url,
  // vía Supabase Storage — ver src/lib/upload.ts) — típicamente se adjunta
  // en un "pago", pero no hay ninguna razón técnica para prohibirlo en un
  // cargo (ej. una nota de débito recibida de un tercero).
  const comprobanteUrl = await saveUploadedFile(
    formData.get("comprobante") as File | null,
    user.organization_id,
    "cuotas",
    { tiposPermitidos: TIPOS_DOCUMENTO }
  );

  const id = await insert("movimientos_cuenta_socio", {
    socio_id,
    tipo,
    concepto,
    monto: Math.abs(monto),
    fecha,
    fecha_vencimiento: tipo === "cargo" ? fecha_vencimiento || null : null,
    comprobante_url: comprobanteUrl,
    notas,
    registrado_por_id: user.id,
  });
  await audit({
    usuario_id: user.id,
    accion: "registrar_movimiento_cuenta_socio",
    entidad: "movimientos_cuenta_socio",
    entidad_id: id,
    valor_nuevo: { socio_id, tipo, concepto, monto },
  });
  revalidatePath(`/socios/${socio_id}`);
  revalidatePath("/socios");
  revalidatePath("/finanzas");
  revalidatePath("/dashboard");
}

export async function registrarMovimientoCuentaSocioFormAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  return conEstadoDeAccion(() => registrarMovimientoCuentaSocioAction(formData));
}

const editarMovimientoCuentaSocioSchema = z.object({
  id: zId,
  tipo: zEnumSeguro(["cargo", "pago"], "cargo"),
  concepto: zTexto(300),
  monto: zMontoPositivo(),
  fecha: zFecha,
  fecha_vencimiento: zFechaOpcional,
  notas: zTextoOpcional(1000),
});

/**
 * Editar un movimiento ya cargado (pedido explícito: "que todos los
 * ingresos/cuotas se puedan editar y eliminar"). No se puede reasignar a
 * otro socio ni tocar el convenio de origen desde acá — mismo criterio ya
 * usado en editarSolicitudAction (Compras): editar corrige datos, no
 * reestructura vínculos ya creados por otra operación.
 */
export async function editarMovimientoCuentaSocioAction(formData: FormData) {
  const user = await requireUser();
  if (!canEdit(user.rol, "finanzas")) throw new Error("No autorizado");

  const { id, tipo, concepto, monto, fecha, fecha_vencimiento, notas } = parseForm(
    editarMovimientoCuentaSocioSchema,
    formData
  );

  const movimiento = await get<{ id: number; socio_id: number; comprobante_url: string | null }>(
    `SELECT id, socio_id, comprobante_url FROM movimientos_cuenta_socio WHERE id = ?`,
    [id]
  );
  if (!movimiento) throw new Error("Ese movimiento ya no existe.");

  const nuevoComprobante = await saveUploadedFile(
    formData.get("comprobante") as File | null,
    user.organization_id,
    "cuotas",
    { tiposPermitidos: TIPOS_DOCUMENTO }
  );

  await update("movimientos_cuenta_socio", id, {
    tipo,
    concepto,
    monto: Math.abs(monto),
    fecha,
    fecha_vencimiento: tipo === "cargo" ? fecha_vencimiento || null : null,
    comprobante_url: nuevoComprobante || movimiento.comprobante_url,
    notas,
  });
  await audit({
    usuario_id: user.id,
    accion: "editar_movimiento_cuenta_socio",
    entidad: "movimientos_cuenta_socio",
    entidad_id: id,
    valor_nuevo: { tipo, concepto, monto },
  });
  revalidatePath(`/socios/${movimiento.socio_id}`);
  revalidatePath("/socios");
  revalidatePath("/finanzas");
  revalidatePath("/dashboard");
}

export async function editarMovimientoCuentaSocioFormAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  return conEstadoDeAccion(() => editarMovimientoCuentaSocioAction(formData));
}

const eliminarMovimientoCuentaSocioSchema = z.object({ id: zId });

export async function eliminarMovimientoCuentaSocioAction(formData: FormData) {
  const user = await requireUser();
  if (!canEdit(user.rol, "finanzas")) throw new Error("No autorizado");
  const { id } = parseForm(eliminarMovimientoCuentaSocioSchema, formData);

  const movimiento = await get<{ id: number; socio_id: number }>(
    `SELECT id, socio_id FROM movimientos_cuenta_socio WHERE id = ?`,
    [id]
  );
  if (!movimiento) {
    revalidatePath("/socios");
    return; // ya no existe: nada que borrar
  }
  await run(`DELETE FROM movimientos_cuenta_socio WHERE id = ?`, [id]);
  await audit({
    usuario_id: user.id,
    accion: "eliminar_movimiento_cuenta_socio",
    entidad: "movimientos_cuenta_socio",
    entidad_id: id,
    valor_anterior: { socio_id: movimiento.socio_id },
  });
  revalidatePath(`/socios/${movimiento.socio_id}`);
  revalidatePath("/socios");
  revalidatePath("/finanzas");
  revalidatePath("/dashboard");
}

export async function eliminarMovimientoCuentaSocioFormAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  return conEstadoDeAccion(() => eliminarMovimientoCuentaSocioAction(formData));
}

const generarCuotaMensualSchema = z.object({
  concepto: zTexto(200),
  monto: zMontoPositivo(),
  mes: z.string().regex(/^\d{4}-\d{2}$/, "Elegí un mes válido."),
  dia_vencimiento: z.coerce.number().int().min(1, "Entre 1 y 28.").max(28, "Entre 1 y 28."),
});

/**
 * Generar la cuota del mes para todos los socios activos de una sola vez
 * (pedido explícito: "una tabla con todas las cuotas de todos los núcleos").
 * Idempotente por diseño (mismo criterio ya usado para evitar proveedores
 * duplicados en Compras Fase 6): si un socio ya tiene un cargo con ese
 * concepto exacto, se lo saltea en vez de duplicarlo — así se puede tocar el
 * botón de nuevo sin miedo a cobrar la cuota dos veces.
 */
export async function generarCuotaMensualAction(formData: FormData) {
  const user = await requireUser();
  if (!canEdit(user.rol, "finanzas")) throw new Error("No autorizado");
  const { concepto, monto, mes, dia_vencimiento } = parseForm(generarCuotaMensualSchema, formData);

  const socios = await all<{ id: number }>(`SELECT id FROM socios WHERE estado = 'activo'`);
  const fecha = `${mes}-01`;
  const diaTexto = String(dia_vencimiento).padStart(2, "0");
  const fechaVencimiento = `${mes}-${diaTexto}`;
  let generadas = 0;

  for (const s of socios) {
    const yaExiste = await get<{ id: number }>(
      `SELECT id FROM movimientos_cuenta_socio WHERE socio_id = ? AND tipo = 'cargo' AND concepto = ?`,
      [s.id, concepto]
    );
    if (yaExiste) continue;
    await insert("movimientos_cuenta_socio", {
      socio_id: s.id,
      tipo: "cargo",
      concepto,
      monto: Math.abs(monto),
      fecha,
      fecha_vencimiento: fechaVencimiento,
      registrado_por_id: user.id,
    });
    generadas++;
  }

  await audit({
    usuario_id: user.id,
    accion: "generar_cuota_mensual",
    entidad: "movimientos_cuenta_socio",
    entidad_id: 0,
    valor_nuevo: { concepto, monto, mes, generadas, totalSocios: socios.length },
  });
  revalidatePath("/finanzas");
  revalidatePath("/socios");
  revalidatePath("/dashboard");
}

export async function generarCuotaMensualFormAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  return conEstadoDeAccion(() => generarCuotaMensualAction(formData));
}
