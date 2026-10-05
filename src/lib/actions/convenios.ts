"use server";

import { z } from "zod";
import dayjs from "dayjs";
import { revalidatePath } from "next/cache";
import { insert, run, get, audit } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { canEdit } from "@/lib/roles";
import { hoyEnUruguay, calcularCuotasSocio, cargarMovimientosCuenta } from "@/lib/logic";
import { parseForm, zId, zTexto, zTextoOpcional, zMontoPositivo, zFecha, zEnumSeguro, zCheckbox } from "@/lib/validation";
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
  // Gestión cooperativa integrada (04/10): el convenio refinancia la deuda
  // vencida que el socio ya tiene (en vez de ser una deuda nueva).
  refinancia: zCheckbox,
});

export async function crearConvenioAction(formData: FormData) {
  const user = await requireUser();
  if (!canEdit(user.rol, "finanzas")) throw new Error("No autorizado");

  const { socio_id, motivo, monto_cuota, cantidad_cuotas, dia_vencimiento, fecha_inicio, notas, refinancia } = parseForm(
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
    ...(refinancia ? { refinancia: true } : {}),
  });

  // Refinanciación: las cuotas vencidas que el socio debe hoy pasan a "En
  // convenio" — dejan de sumar como deuda propia (la deuda ahora son las
  // cuotas del convenio) y quedan vinculadas a él. Se guarda cuánto debía
  // cada una en ese momento (monto_refinanciado): lo que ya hubiera pagado
  // antes sigue contando como pagado. Si el convenio después se cancela o se
  // incumple, esas cuotas vuelven a contar como deuda normal.
  let cuotasRefinanciadas: { id: number; pendiente: number }[] = [];
  if (refinancia) {
    const { cuotas } = calcularCuotasSocio(await cargarMovimientosCuenta(socio_id));
    cuotasRefinanciadas = cuotas
      .filter((c) => c.estado === "vencida" && c.montoPendiente > 0)
      .map((c) => ({ id: c.id, pendiente: c.montoPendiente }));
    if (cuotasRefinanciadas.length === 0) {
      await run(`DELETE FROM convenios_pago WHERE id = ?`, [convenioId]);
      throw new Error("Este socio no tiene cuotas vencidas para refinanciar — destildá \"Refinancia la deuda vencida\" si el convenio es por otro motivo.");
    }
    for (const c of cuotasRefinanciadas) {
      await run(`UPDATE movimientos_cuenta_socio SET en_convenio_id = ?, monto_refinanciado = ? WHERE id = ?`, [convenioId, c.pendiente, c.id]);
    }
  }

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
    valor_nuevo: {
      socio: (await get<{ nombre: string }>(`SELECT nombre FROM socios WHERE id = ?`, [socio_id]))?.nombre ?? null,
      socio_id,
      motivo,
      montoTotal,
      cantidad_cuotas,
      ...(refinancia
        ? { refinancia: true, cuotas_refinanciadas: cuotasRefinanciadas.length, deuda_refinanciada: Math.round(cuotasRefinanciadas.reduce((a, c) => a + c.pendiente, 0) * 100) / 100 }
        : {}),
    },
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

  const convenio = await get<{ id: number; socio_id: number; estado: string; refinancia?: boolean }>(
    `SELECT id, socio_id, estado, refinancia FROM convenios_pago WHERE id = ?`,
    [id]
  ).catch(() => get<{ id: number; socio_id: number; estado: string; refinancia?: boolean }>(`SELECT id, socio_id, estado FROM convenios_pago WHERE id = ?`, [id]));
  if (!convenio) throw new Error("Ese convenio ya no existe.");

  await run(`UPDATE convenios_pago SET estado = ? WHERE id = ?`, [estado, id]);

  if ((estado === "cancelado" || estado === "incumplido") && convenio.refinancia) {
    // Convenio que refinanciaba deuda vieja: al caer, las cuotas originales
    // vuelven a contar como deuda (lo resuelve calcularCuotasSocio según el
    // estado del convenio), así que TODAS las cuotas del convenio se anulan
    // — eran la misma deuda expresada de otra forma; dejarlas sería contarla
    // dos veces. Los pagos que se hicieron siguen siendo pagos reales y
    // cubren la deuda original (nada se borra: quedan anuladas, con motivo).
    await run(
      `UPDATE movimientos_cuenta_socio
       SET estado = 'anulado', anulado_en = now(), anulado_por_id = ?, motivo_anulacion = ?
       WHERE convenio_id = ? AND tipo = 'cargo' AND COALESCE(estado, 'activo') != 'anulado'`,
      [user.id, `Convenio ${estado}: la deuda vuelve a sus cuotas originales.`, id]
    );
  } else if (estado === "cancelado" || estado === "incumplido") {
    const hoy = hoyEnUruguay();
    // Un pago adelantado dirigido a una de estas cuotas pasa a cubrir lo
    // más antiguo (si no, la clave foránea de cuota_id frena el borrado).
    await run(
      `UPDATE movimientos_cuenta_socio SET cuota_id = NULL
       WHERE cuota_id IN (SELECT id FROM movimientos_cuenta_socio WHERE convenio_id = ? AND fecha_vencimiento > ?)`,
      [id, hoy]
    ).catch(() => {});
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
    valor_anterior: { socio: (await get<{ nombre: string }>(`SELECT nombre FROM socios WHERE id = ?`, [convenio.socio_id]))?.nombre ?? null, estado: convenio.estado },
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

  const hoy = hoyEnUruguay();
  const cuotaYaVencida = await get<{ id: number }>(
    `SELECT id FROM movimientos_cuenta_socio WHERE convenio_id = ? AND fecha_vencimiento <= ? LIMIT 1`,
    [id, hoy]
  );
  if (cuotaYaVencida) {
    throw new Error('Este convenio ya tiene cuotas vencidas: usá "Cancelar" en su lugar para conservar el historial.');
  }

  // Gestión cooperativa integrada (04/10, migración 0048): antes de borrar,
  // soltar lo que apunta a este convenio — las cuotas que refinanciaba
  // vuelven a ser deuda normal, y un pago dirigido a una cuota del convenio
  // pasa a cubrir lo más antiguo (sin esto, la clave foránea impediría el
  // borrado). `.catch`: base todavía sin esas columnas, nada que soltar.
  await run(`UPDATE movimientos_cuenta_socio SET en_convenio_id = NULL, monto_refinanciado = NULL WHERE en_convenio_id = ?`, [id]).catch(() => {});
  await run(
    `UPDATE movimientos_cuenta_socio SET cuota_id = NULL WHERE cuota_id IN (SELECT id FROM movimientos_cuenta_socio WHERE convenio_id = ?)`,
    [id]
  ).catch(() => {});
  await run(`DELETE FROM movimientos_cuenta_socio WHERE convenio_id = ?`, [id]);
  await run(`DELETE FROM convenios_pago WHERE id = ?`, [id]);

  await audit({
    usuario_id: user.id,
    accion: "eliminar_convenio",
    entidad: "convenios_pago",
    entidad_id: id,
    valor_anterior: { socio: (await get<{ nombre: string }>(`SELECT nombre FROM socios WHERE id = ?`, [convenio.socio_id]))?.nombre ?? null, socio_id: convenio.socio_id },
  });
  revalidatePath(`/socios/${convenio.socio_id}`);
  revalidatePath("/socios");
  revalidatePath("/finanzas");
}

export async function eliminarConvenioFormAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  return conEstadoDeAccion(() => eliminarConvenioAction(formData));
}
