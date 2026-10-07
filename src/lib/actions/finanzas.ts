"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { insert, update, get, all, audit, esColumnaInexistente, updateConBloqueoOptimista } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { canEdit } from "@/lib/roles";
import { parseForm, zId, zIdOpcional, zTexto, zTextoOpcional, zMontoPositivo, zFecha, zFechaOpcional, zEnumSeguro, ValidationError } from "@/lib/validation";
import { hoyEnUruguay } from "@/lib/horasObra";
import { estadoDePeriodo, textoPeriodo } from "@/lib/finanzasLibro";
import { conEstadoDeAccion, type ActionState } from "@/lib/actionState";

const registrarMovimientoSchema = z.object({
  tipo: zEnumSeguro(["ingreso", "egreso"], "egreso"),
  monto: zMontoPositivo(),
  categoria: zTexto(120),
  descripcion: zTextoOpcional(1000),
  // Fase 2A: fecha (antes siempre "ahora"), cuenta y fondo. Vacíos → hoy y
  // la cuenta/fondo principal (los completa la base, ver migración 0055).
  fecha: zFechaOpcional,
  cuenta_id: zIdOpcional,
  fondo_id: zIdOpcional,
});

/** Fase 2A: cuenta y fondo válidos, y fecha en un mes abierto (aviso claro antes de que lo frene la base). */
async function validarLibro(fecha: string, cuentaId: number | null, fondoId: number | null) {
  if (fecha > hoyEnUruguay()) throw new ValidationError("fecha", "La fecha no puede ser futura. Para algo que todavía no pasó, cargá un compromiso.");
  if ((await estadoDePeriodo(fecha.slice(0, 7))) !== "abierto") {
    throw new ValidationError("fecha", `El mes de ${textoPeriodo(fecha.slice(0, 7))} ya está cerrado. Elegí una fecha de un mes abierto.`);
  }
  if (cuentaId && !(await get(`SELECT id FROM cuentas_financieras WHERE id = ? AND activa = 1`, [cuentaId]).catch(() => ({ id: cuentaId })))) {
    throw new ValidationError("cuenta_id", "Esa cuenta no existe o está dada de baja.");
  }
  if (fondoId && !(await get(`SELECT id FROM fondos WHERE id = ? AND activo = 1`, [fondoId]).catch(() => ({ id: fondoId })))) {
    throw new ValidationError("fondo_id", "Ese fondo no existe o está dado de baja.");
  }
}

export async function registrarMovimientoAction(formData: FormData) {
  const user = await requireUser();
  if (!canEdit(user.rol, "finanzas")) throw new Error("No autorizado");
  const datos = parseForm(registrarMovimientoSchema, formData);
  const fecha = datos.fecha || hoyEnUruguay();
  await validarLibro(fecha, datos.cuenta_id, datos.fondo_id);
  const id = await insert("movimientos_financieros", {
    tipo: datos.tipo,
    monto: datos.monto,
    categoria: datos.categoria,
    etapa_obra: datos.categoria,
    descripcion: datos.descripcion,
    registrado_por_id: user.id,
    fecha,
    ...(datos.cuenta_id ? { cuenta_id: datos.cuenta_id } : {}),
    ...(datos.fondo_id ? { fondo_id: datos.fondo_id } : {}),
  });
  await audit({ usuario_id: user.id, accion: "registrar_movimiento", entidad: "movimientos_financieros", entidad_id: id, valor_nuevo: datos });
  revalidatePath("/finanzas");
  revalidatePath("/dashboard");
}

export async function registrarMovimientoFormAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  return conEstadoDeAccion(() => registrarMovimientoAction(formData));
}

// H-3 (auditoría integral, 27/09, corregido): `version_esperada` es el
// `actualizado_en` que tenía el movimiento cuando se abrió el formulario de
// edición — lo usa updateConBloqueoOptimista() de abajo para detectar una
// edición concurrente en vez de pisarla en silencio (confirmado en vivo:
// antes, dos personas editando el mismo movimiento al mismo tiempo, el monto
// de una se perdía sin aviso y ambas veían "Movimiento actualizado.").
const editarMovimientoSchema = z.object({
  id: zId,
  tipo: zEnumSeguro(["ingreso", "egreso"], "egreso"),
  monto: zMontoPositivo(),
  categoria: zTexto(120),
  descripcion: zTextoOpcional(1000),
  version_esperada: zTexto(100),
  fecha: zFechaOpcional,
  cuenta_id: zIdOpcional,
  fondo_id: zIdOpcional,
});

// Pedido explícito (rediseño de Finanzas, 16/09): "que todos los ingresos
// tengan pop-ups, que se puedan editar y eliminar". registrarMovimientoAction
// (arriba) sólo daba de alta — no había forma de corregir un monto o una
// categoría mal tipeados sin anular y volver a cargar todo de nuevo.
/** Gestión cooperativa integrada (04/10): un ingreso que se generó solo a
 * partir de un pago de cuota (migración 0048) se corrige o anula desde la
 * cuenta del socio — es el mismo dato, y si se tocara desde acá quedarían
 * dos versiones distintas del mismo pago. Mismo criterio que ya usan los
 * egresos generados por un gasto de comisión. */
async function verificarNoEsPagoDeCuota(id: number) {
  const fila = await get<{ movimiento_cuenta_socio_id: number | null; socio_id: number | null; socio_nombre: string | null }>(
    `SELECT mf.movimiento_cuenta_socio_id, m.socio_id, s.nombre AS socio_nombre
     FROM movimientos_financieros mf
     LEFT JOIN movimientos_cuenta_socio m ON m.id = mf.movimiento_cuenta_socio_id
     LEFT JOIN socios s ON s.id = m.socio_id
     WHERE mf.id = ?`,
    [id]
  ).catch(() => null);
  if (fila?.movimiento_cuenta_socio_id) {
    throw new Error(
      `Este ingreso se generó solo, a partir de un pago de cuota${fila.socio_nombre ? ` de ${fila.socio_nombre}` : ""}. Corregilo o anulalo desde la cuenta de ese socio (Socios → su ficha → Finanzas) para que no queden dos versiones del mismo pago.`
    );
  }
}

export async function editarMovimientoAction(formData: FormData) {
  const user = await requireUser();
  if (!canEdit(user.rol, "finanzas")) throw new Error("No autorizado");
  const { id, tipo, monto, categoria, descripcion, version_esperada, fecha, cuenta_id, fondo_id } = parseForm(editarMovimientoSchema, formData);
  await verificarNoEsPagoDeCuota(id);

  const existente = await get<{ id: number; estado?: string; fecha?: string; transferencia_id?: string | null; factura_id?: number | null }>(
    `SELECT id, estado, fecha, transferencia_id, factura_id FROM movimientos_financieros WHERE id = ?`,
    [id]
  ).catch(async (err) => {
    // Sub-fase 4.4 todavía no migrada en este entorno (columna `estado`
    // inexistente, 42703) — un movimiento nunca puede estar anulado sin esa
    // columna, así que se sigue exactamente igual que antes de esta sub-fase.
    if (!esColumnaInexistente(err)) throw err;
    return get<{ id: number; estado?: string; fecha?: string; transferencia_id?: string | null; factura_id?: number | null }>(
      `SELECT id, estado, fecha FROM movimientos_financieros WHERE id = ?`,
      [id]
    );
  });
  if (!existente) throw new Error("Ese movimiento ya no existe.");
  if (existente.estado === "anulado") {
    throw new Error("Este movimiento está anulado — no se puede editar. Registrá un movimiento nuevo si hace falta corregir el saldo.");
  }
  if (existente.transferencia_id) throw new Error("Un pase entre cuentas o fondos no se edita: anulalo y hacelo de nuevo.");
  if (existente.factura_id) throw new Error("Este egreso es el pago de una factura: se corrige con un contra-movimiento.");
  if (existente.fecha && (await estadoDePeriodo(String(existente.fecha).slice(0, 7))) !== "abierto") {
    throw new Error(`El mes de ${textoPeriodo(String(existente.fecha).slice(0, 7))} ya está cerrado: este movimiento no se puede editar. Usá «Corregir» para hacer un contra-movimiento.`);
  }
  const nuevaFecha = fecha || (existente.fecha ? String(existente.fecha).slice(0, 10) : hoyEnUruguay());
  await validarLibro(nuevaFecha, cuenta_id, fondo_id);

  await updateConBloqueoOptimista(
    "movimientos_financieros",
    id,
    {
      tipo,
      monto,
      categoria,
      etapa_obra: categoria,
      descripcion,
      ...(fecha ? { fecha } : {}),
      ...(cuenta_id ? { cuenta_id } : {}),
      ...(fondo_id ? { fondo_id } : {}),
    },
    version_esperada
  );
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
  await verificarNoEsPagoDeCuota(id);

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
  const libro = await get<{ fecha: string; transferencia_id: string | null; factura_id: number | null }>(
    `SELECT fecha, transferencia_id, factura_id FROM movimientos_financieros WHERE id = ?`,
    [id]
  ).catch(() => undefined);
  if (libro && (await estadoDePeriodo(String(libro.fecha).slice(0, 7))) !== "abierto") {
    throw new Error(`El mes de ${textoPeriodo(String(libro.fecha).slice(0, 7))} ya está cerrado: este movimiento no se puede anular. Usá «Corregir» para hacer un contra-movimiento.`);
  }
  if (libro?.factura_id) throw new Error("Este egreso es el pago de una factura: se corrige con un contra-movimiento.");

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

  const anulacion = {
    estado: "anulado",
    anulado_en: new Date().toISOString(),
    anulado_por_id: user.id,
    motivo_anulacion: motivo || null,
  };
  await update("movimientos_financieros", id, anulacion);
  // Un pase entre cuentas o fondos son dos movimientos: se anulan juntos.
  if (libro?.transferencia_id) {
    const par = await all<{ id: number }>(`SELECT id FROM movimientos_financieros WHERE transferencia_id = ? AND id <> ? AND COALESCE(estado, 'activo') <> 'anulado'`, [libro.transferencia_id, id]);
    for (const p of par) await update("movimientos_financieros", p.id, anulacion);
  }
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
  const id = await insert("compromisos_futuros", datos);
  await audit({ usuario_id: user.id, accion: "crear", entidad: "compromisos_futuros", entidad_id: id, valor_nuevo: datos });
  revalidatePath("/finanzas");
  revalidatePath("/dashboard");
}

export async function agregarCompromisoFormAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  return conEstadoDeAccion(() => agregarCompromisoAction(formData));
}
