"use server";

import { z } from "zod";
import dayjs from "dayjs";
import { revalidatePath } from "next/cache";
import { insert, run, get, audit } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { canEdit } from "@/lib/roles";
import { parseForm, zId, zTexto, zTextoOpcional, zMontoPositivo, zFecha, zEnumSeguro } from "@/lib/validation";
import { conEstadoDeAccion, type ActionState } from "@/lib/actionState";

// Rediseño profundo de Finanzas (pedido explícito, 16/09) — convenios de
// pago: un socio atrasado puede acordar pagar su deuda en cuotas, separadas
// de la cuota mensual normal. Se gatea igual que el resto de la cuenta
// corriente del socio (canEdit "finanzas": administración/tesorería/
// directiva/admin), no el permiso de "socios" — es una operación financiera.
//
// Al crear un convenio se generan de una sola vez TODOS sus cargos
// (movimientos_cuenta_socio con convenio_id), en vez de ir cargando cuota
// por cuota a mano — así "cómo va la cuota" (pedido explícito del usuario)
// se puede ver desde el primer día, no recién cuando alguien se acuerda de
// cargar la próxima.

const crearConvenioSchema = z.object({
  socio_id: zId,
  motivo: zTexto(300),
  monto_cuota: zMontoPositivo(),
  cantidad_cuotas: z.coerce.number().int().min(1, "Al menos 1 cuota.").max(60, "Máximo 60 cuotas."),
  dia_vencimiento: z.coerce.number().int().min(1, "Entre 1 y 28.").max(28, "Entre 1 y 28."),
  fecha_inicio: zFecha,
  notas: zTextoOpcional(1000),
});

export async function crearConvenioAction(formData: FormData) {
  const user = await requireUser();
  if (!canEdit(user.rol, "finanzas")) throw new Error("No autorizado");

  const { socio_id, motivo, monto_cuota, cantidad_cuotas, dia_vencimiento, fecha_inicio, notas } = parseForm(
    crearConvenioSchema,
    formData
  );

  const socio = await get<{ id: number }>(`SELECT id FROM socios WHERE id = ?`, [socio_id]);
  if (!socio) throw new Error("Socio no encontrado.");

  const yaActivo = await get<{ id: number }>(
    `SELECT id FROM convenios_pago WHERE socio_id = ? AND estado = 'activo'`,
    [socio_id]
  );
  if (yaActivo) {
    throw new Error("Este socio ya tiene un convenio activo — cancelalo o marcalo cumplido antes de crear uno nuevo.");
  }

  const montoTotal = Math.round(monto_cuota * cantidad_cuotas * 100) / 100;
  const convenioId = await insert("convenios_pago", {
    socio_id,
    motivo,
    monto_total: montoTotal,
    cantidad_cuotas,
    monto_cuota: Math.abs(monto_cuota),
    dia_vencimiento,
    fecha_inicio,
    estado: "activo",
    notas,
    creado_por_id: user.id,
  });

  const diaTexto = String(dia_vencimiento).padStart(2, "0");
  for (let i = 0; i < cantidad_cuotas; i++) {
    const mes = dayjs(fecha_inicio).add(i, "month").format("YYYY-MM");
    const fechaVencimiento = `${mes}-${diaTexto}`;
    await insert("movimientos_cuenta_socio", {
      socio_id,
      tipo: "cargo",
      concepto: `Convenio: ${motivo} — cuota ${i + 1}/${cantidad_cuotas}`,
      monto: Math.abs(monto_cuota),
      fecha: fechaVencimiento,
      fecha_vencimiento: fechaVencimiento,
      convenio_id: convenioId,
      registrado_por_id: user.id,
    });
  }

  await audit({
    usuario_id: user.id,
    accion: "crear_convenio",
    entidad: "convenios_pago",
    entidad_id: convenioId,
    valor_nuevo: { socio_id, motivo, montoTotal, cantidad_cuotas },
  });
  revalidatePath(`/socios/${socio_id}`);
  revalidatePath("/socios");
  revalidatePath("/finanzas");
}

export async function crearConvenioFormAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  return conEstadoDeAccion(() => crearConvenioAction(formData));
}

const cambiarEstadoConvenioSchema = z.object({
  id: zId,
  estado: zEnumSeguro(["cumplido", "incumplido", "cancelado"], "cancelado"),
});

/**
 * Cambiar el estado de un convenio en curso. Al cancelarlo (o marcarlo
 * incumplido), se borran las cuotas del convenio que todavía no vencieron —
 * el socio no sigue "debiendo" cuotas de un convenio que ya no rige — pero
 * las que ya vencieron quedan tal cual (si no se pagaron, siguen como deuda
 * normal; si se pagaron, el pago ya ocurrió de verdad y no hay motivo para
 * tocarlo). Marcarlo "cumplido" no borra nada.
 */
export async function cambiarEstadoConvenioAction(formData: FormData) {
  const user = await requireUser();
  if (!canEdit(user.rol, "finanzas")) throw new Error("No autorizado");
  const { id, estado } = parseForm(cambiarEstadoConvenioSchema, formData);

  const convenio = await get<{ id: number; socio_id: number }>(
    `SELECT id, socio_id FROM convenios_pago WHERE id = ?`,
    [id]
  );
  if (!convenio) throw new Error("Ese convenio ya no existe.");

  await run(`UPDATE convenios_pago SET estado = ? WHERE id = ?`, [estado, id]);

  if (estado === "cancelado" || estado === "incumplido") {
    const hoy = dayjs().format("YYYY-MM-DD");
    await run(
      `DELETE FROM movimientos_cuenta_socio WHERE convenio_id = ? AND fecha_vencimiento > ?`,
      [id, hoy]
    );
  }

  await audit({
    usuario_id: user.id,
    accion: "cambiar_estado_convenio",
    entidad: "convenios_pago",
    entidad_id: id,
    valor_nuevo: { estado },
  });
  revalidatePath(`/socios/${convenio.socio_id}`);
  revalidatePath("/socios");
  revalidatePath("/finanzas");
}

export async function cambiarEstadoConvenioFormAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  return conEstadoDeAccion(() => cambiarEstadoConvenioAction(formData));
}

const eliminarConvenioSchema = z.object({ id: zId });

/**
 * Eliminar directamente un convenio (no solo cancelarlo) — sólo se permite
 * si todavía no venció ninguna de sus cuotas (es decir, si el convenio nunca
 * llegó a tener efecto real todavía). Si ya venció alguna cuota, hay que
 * usar "Cancelar" en su lugar: eso conserva el historial de lo que ya pasó
 * en vez de borrarlo, mismo criterio que ya usa eliminarProveedorAction
 * (bloquear el borrado si ya hay historial real, no forzarlo).
 */
export async function eliminarConvenioAction(formData: FormData) {
  const user = await requireUser();
  if (!canEdit(user.rol, "finanzas")) throw new Error("No autorizado");
  const { id } = parseForm(eliminarConvenioSchema, formData);

  const convenio = await get<{ id: number; socio_id: number }>(
    `SELECT id, socio_id FROM convenios_pago WHERE id = ?`,
    [id]
  );
  if (!convenio) {
    revalidatePath("/socios");
    return;
  }

  const hoy = dayjs().format("YYYY-MM-DD");
  const cuotaYaVencida = await get<{ id: number }>(
    `SELECT id FROM movimientos_cuenta_socio WHERE convenio_id = ? AND fecha_vencimiento <= ? LIMIT 1`,
    [id, hoy]
  );
  if (cuotaYaVencida) {
    throw new Error('Este convenio ya tiene cuotas vencidas: usá "Cancelar" en su lugar para conservar el historial.');
  }

  await run(`DELETE FROM movimientos_cuenta_socio WHERE convenio_id = ?`, [id]);
  await run(`DELETE FROM convenios_pago WHERE id = ?`, [id]);

  await audit({
    usuario_id: user.id,
    accion: "eliminar_convenio",
    entidad: "convenios_pago",
    entidad_id: id,
    valor_anterior: { socio_id: convenio.socio_id },
  });
  revalidatePath(`/socios/${convenio.socio_id}`);
  revalidatePath("/socios");
  revalidatePath("/finanzas");
}

export async function eliminarConvenioFormAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  return conEstadoDeAccion(() => eliminarConvenioAction(formData));
}
