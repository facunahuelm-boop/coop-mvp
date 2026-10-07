"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { all, get, insert, update, audit, run } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { canEdit } from "@/lib/roles";
import { parseForm, zId, zIdOpcional, zTexto, zTextoOpcional, zFechaOpcional, ValidationError } from "@/lib/validation";
import { conEstadoDeAccion, type ActionState } from "@/lib/actionState";
import {
  leerExtracto,
  sugerirColumnas,
  interpretarFilas,
  huellaDe,
  proponerConciliaciones,
  conciliarEnBase,
  type ColumnasExtracto,
} from "@/lib/conciliacion";
import { estadoDePeriodo, textoPeriodo, money } from "@/lib/finanzasLibro";
import { obtenerReglamento } from "@/lib/reglamento";
import { hoyEnUruguay } from "@/lib/horasObra";
import { registrarMovimientoCuentaSocioAction } from "@/lib/actions/cuentaSocios";

/**
 * Fase 2B — conciliación bancaria: importar el extracto (A9), confirmar las
 * propuestas, registrar lo que falta (un pago de cuota, una comisión del
 * banco) o ignorar una línea con motivo. Todo auditado.
 */

async function requireConciliar() {
  const user = await requireUser();
  if (!canEdit(user.rol, "finanzas")) throw new Error("No tenés permiso para conciliar el banco.");
  return user;
}

function revalidar() {
  revalidatePath("/finanzas/conciliacion");
  revalidatePath("/finanzas");
  revalidatePath("/finanzas/cierre");
  revalidatePath("/dashboard");
}

// =============== Importar el extracto ===============

export type EstadoExtracto = ActionState & {
  vista?: {
    encabezados: string[];
    muestra: string[][];
    columnas: ColumnasExtracto;
    leidas: number;
    descartadas: number;
    ejemplo: { fecha: string; descripcion: string; monto: number }[];
    formatoGuardado: boolean;
  };
  resultado?: { nuevas: number; repetidas: number; propuestas: number; automaticas: number };
};

const col = z
  .string()
  .optional()
  .transform((v) => (v === undefined || v === "" ? null : Number(v)))
  .refine((v) => v === null || (Number.isInteger(v) && v >= 0 && v < 200), "Columna inválida.");

const columnasSchema = z.object({
  col_fecha: col,
  col_descripcion: col,
  col_referencia: col,
  col_monto: col,
  col_debito: col,
  col_credito: col,
  col_saldo: col,
});

export async function extractoFormAction(_prev: EstadoExtracto, formData: FormData): Promise<EstadoExtracto> {
  try {
    const user = await requireConciliar();
    const cuentaId = Number(formData.get("cuenta_id") || 0);
    const cuenta = await get<{ id: number; nombre: string; tipo: string }>(`SELECT id, nombre, tipo FROM cuentas_financieras WHERE id = ? AND activa = 1`, [cuentaId]);
    if (!cuenta) return { ok: false, error: "Elegí la cuenta del banco." };
    const archivo = formData.get("archivo") as File | null;
    if (!archivo || archivo.size === 0) return { ok: false, error: "Elegí el archivo del extracto." };
    if (archivo.size > 5 * 1024 * 1024) return { ok: false, error: "El archivo es muy grande (máximo 5 MB). Exportá un período más corto." };
    const leido = await leerExtracto(archivo);

    const guardado = await get<{ columnas: ColumnasExtracto | string }>(`SELECT columnas FROM formatos_extracto WHERE cuenta_id = ?`, [cuentaId]);
    const formatoGuardado = guardado ? (typeof guardado.columnas === "string" ? (JSON.parse(guardado.columnas) as ColumnasExtracto) : guardado.columnas) : null;
    const paso = String(formData.get("paso") || "ver");

    let columnas: ColumnasExtracto;
    if (paso === "importar" || formData.get("col_fecha") !== null) {
      const c = parseForm(columnasSchema, formData);
      if (c.col_fecha === null) throw new ValidationError("col_fecha", "Indicá qué columna tiene la fecha.");
      if (c.col_monto === null && c.col_debito === null && c.col_credito === null) {
        throw new ValidationError("col_monto", "Indicá la columna del importe (o las de débito y crédito).");
      }
      columnas = { fecha: c.col_fecha, descripcion: c.col_descripcion, referencia: c.col_referencia, monto: c.col_monto, debito: c.col_debito, credito: c.col_credito, saldo: c.col_saldo };
    } else {
      // El formato guardado se usa sólo si el archivo tiene los mismos títulos (el banco puede cambiar el formato).
      const firma = (t: string[]) => t.map((x) => x.trim().toLowerCase()).join("|");
      const coincide = formatoGuardado?.titulos && firma(formatoGuardado.titulos) === firma(leido.encabezados);
      columnas = coincide && formatoGuardado ? formatoGuardado : sugerirColumnas(leido.encabezados);
    }
    const { lineas, descartadas } = interpretarFilas(leido.filas, columnas);

    if (paso !== "importar") {
      return {
        ok: true,
        vista: {
          encabezados: leido.encabezados,
          muestra: leido.filas.slice(0, 6),
          columnas,
          leidas: lineas.length,
          descartadas,
          ejemplo: lineas.slice(0, 5).map((l) => ({ fecha: l.fecha, descripcion: l.descripcion, monto: l.monto })),
          formatoGuardado: !!formatoGuardado?.titulos && columnas === formatoGuardado,
        },
      };
    }
    if (!lineas.length) return { ok: false, error: "Con esas columnas no se pudo leer ninguna línea (fecha e importe). Revisá la elección." };

    // Guardar el formato para la próxima vez.
    const aGuardar = JSON.stringify({ ...columnas, titulos: leido.encabezados });
    if (guardado) await run(`UPDATE formatos_extracto SET columnas = ?::jsonb, actualizado_en = now()::text, actualizado_por_id = ? WHERE cuenta_id = ?`, [aGuardar, user.id, cuentaId]);
    else await insert("formatos_extracto", { cuenta_id: cuentaId, columnas: aGuardar, actualizado_por_id: user.id });

    const fechas = lineas.map((l) => l.fecha).sort();
    const extractoId = await insert("extractos_bancarios", {
      cuenta_id: cuentaId,
      archivo_nombre: archivo.name.slice(0, 200),
      desde: fechas[0],
      hasta: fechas[fechas.length - 1],
      importado_por_id: user.id,
    });
    // Huella: dos líneas idénticas en el mismo archivo (ej. dos depósitos iguales el mismo día) se distinguen por su orden.
    const vistas = new Map<string, number>();
    let nuevas = 0;
    let repetidas = 0;
    for (const l of lineas) {
      const base = huellaDe(l, 0);
      const n = vistas.get(base) ?? 0;
      vistas.set(base, n + 1);
      const huella = n === 0 ? base : huellaDe(l, n);
      const existe = await get<{ id: number }>(`SELECT id FROM extracto_lineas WHERE cuenta_id = ? AND huella = ?`, [cuentaId, huella]);
      if (existe) {
        repetidas++;
        continue;
      }
      await insert("extracto_lineas", {
        extracto_id: extractoId,
        cuenta_id: cuentaId,
        fecha: l.fecha,
        descripcion: l.descripcion || null,
        referencia: l.referencia || null,
        monto: l.monto,
        saldo: l.saldo,
        huella,
      });
      nuevas++;
    }
    await update("extractos_bancarios", extractoId, { lineas: nuevas, repetidas });
    const reglamento = await obtenerReglamento();
    const { propuestas, automaticas } = await proponerConciliaciones(cuentaId, reglamento.finanzas.conciliacionAutomatica);
    await audit({
      usuario_id: user.id,
      accion: "importar_extracto",
      entidad: "extractos_bancarios",
      entidad_id: extractoId,
      valor_nuevo: { cuenta: cuenta.nombre, archivo: archivo.name, nuevas, repetidas, propuestas, automaticas },
    });
    revalidar();
    return { ok: true, resultado: { nuevas, repetidas, propuestas, automaticas } };
  } catch (err) {
    return conEstadoDeAccion(async () => {
      throw err;
    });
  }
}

// =============== Conciliar una línea ===============

type Linea = { id: number; cuenta_id: number; fecha: string; monto: string; descripcion: string | null; referencia: string | null; estado: string };

async function lineaPendiente(id: number): Promise<Linea> {
  const l = await get<Linea>(`SELECT id, cuenta_id, fecha, monto, descripcion, referencia, estado FROM extracto_lineas WHERE id = ?`, [id]);
  if (!l) throw new Error("Esa línea del banco no existe.");
  if (l.estado !== "pendiente") throw new Error("Esa línea ya no está pendiente.");
  return l;
}

/** Confirmar que la línea del banco es este movimiento de COOVA. */
export async function confirmarLineaAction(formData: FormData) {
  const user = await requireConciliar();
  const { linea_id, movimiento_id } = parseForm(z.object({ linea_id: zId, movimiento_id: zId }), formData);
  const l = await lineaPendiente(linea_id);
  const m = await get<{ id: number; tipo: string; monto: number; cuenta_id: number | null; fecha: string; estado: string | null; cuenta: string | null }>(
    `SELECT m.id, m.tipo, m.monto, m.cuenta_id, m.fecha, m.estado, c.nombre AS cuenta FROM movimientos_financieros m LEFT JOIN cuentas_financieras c ON c.id = m.cuenta_id WHERE m.id = ?`,
    [movimiento_id]
  );
  if (!m || m.estado === "anulado") throw new Error("Ese movimiento no existe o está anulado.");
  const monto = Number(l.monto);
  if ((monto > 0 ? "ingreso" : "egreso") !== m.tipo) throw new Error(monto > 0 ? "En el banco es una entrada de plata, y ese movimiento es un egreso." : "En el banco es una salida de plata, y ese movimiento es un ingreso.");
  if (Math.abs(Math.abs(monto) - Number(m.monto)) > 0.005) {
    throw new Error(`Los montos no coinciden: el banco dice ${money(Math.abs(monto))} y COOVA ${money(Number(m.monto))}.`);
  }
  if (m.cuenta_id !== l.cuenta_id) {
    // Se cargó en otra cuenta: si el mes está abierto, se pasa a la cuenta del banco.
    const mes = String(m.fecha).slice(0, 7);
    if ((await estadoDePeriodo(mes)) !== "abierto") {
      throw new Error(`Ese movimiento está en la cuenta «${m.cuenta ?? "otra"}» y su mes (${textoPeriodo(mes)}) ya está cerrado. Hacé un pase entre cuentas en un mes abierto.`);
    }
    await update("movimientos_financieros", m.id, { cuenta_id: l.cuenta_id });
  }
  const propuesta = await get<{ propuesta_tipo: string | null; propuesta_movimiento_id: number | null }>(`SELECT propuesta_tipo, propuesta_movimiento_id FROM extracto_lineas WHERE id = ?`, [l.id]);
  const como = propuesta?.propuesta_movimiento_id === m.id && propuesta.propuesta_tipo ? propuesta.propuesta_tipo : "manual";
  await conciliarEnBase(l.id, m.id, user.id, como);
  await audit({ usuario_id: user.id, accion: "conciliar_linea", entidad: "extracto_lineas", entidad_id: l.id, valor_nuevo: { movimiento: m.id, monto, como } });
  await proponerConciliaciones(l.cuenta_id);
  revalidar();
}

/** La línea es un pago de cuota que todavía no se registró: se registra (con su recibo) y queda conciliada. */
export async function pagoCuotaDesdeLineaAction(formData: FormData) {
  const user = await requireConciliar();
  const { linea_id, socio_id, cuota_id } = parseForm(z.object({ linea_id: zId, socio_id: zId, cuota_id: zIdOpcional }), formData);
  const l = await lineaPendiente(linea_id);
  const monto = Number(l.monto);
  if (monto <= 0) throw new Error("Sólo una entrada de plata puede ser un pago de cuota.");
  if ((await estadoDePeriodo(l.fecha.slice(0, 7))) !== "abierto") {
    throw new Error(`El mes de ${textoPeriodo(l.fecha.slice(0, 7))} ya está cerrado: registrá el pago desde la ficha del socio con fecha de un mes abierto y después conciliá.`);
  }
  const fd = new FormData();
  fd.set("socio_id", String(socio_id));
  fd.set("tipo", "pago");
  fd.set("concepto", "Pago por transferencia");
  fd.set("monto", String(monto));
  fd.set("fecha", l.fecha);
  fd.set("metodo_pago", "transferencia");
  fd.set("cuenta_id", String(l.cuenta_id));
  fd.set("notas", `Conciliado con el banco: ${[l.descripcion, l.referencia].filter(Boolean).join(" · ")}`.slice(0, 500));
  if (cuota_id) fd.set("cuota_id", String(cuota_id));
  const { ingresoId } = await registrarMovimientoCuentaSocioAction(fd);
  if (!ingresoId) throw new Error("El pago se registró, pero no se pudo vincular con el banco. Conciliálo a mano.");
  await conciliarEnBase(l.id, ingresoId, user.id, "pago_cuota");
  await audit({ usuario_id: user.id, accion: "conciliar_linea", entidad: "extracto_lineas", entidad_id: l.id, valor_nuevo: { movimiento: ingresoId, socio_id, como: "pago_cuota" } });
  await proponerConciliaciones(l.cuenta_id);
  revalidar();
  revalidatePath(`/socios/${socio_id}`);
}

const nuevoSchema = z.object({ linea_id: zId, categoria: zTexto(120), fondo_id: zId, descripcion: zTextoOpcional(300), fecha: zFechaOpcional });

/** La línea no tiene movimiento en COOVA (ej. comisión del banco, intereses): se registra y queda conciliada. */
export async function nuevoMovimientoDesdeLineaAction(formData: FormData) {
  const user = await requireConciliar();
  const d = parseForm(nuevoSchema, formData);
  const l = await lineaPendiente(d.linea_id);
  const fecha = d.fecha || l.fecha;
  if (fecha > hoyEnUruguay()) throw new ValidationError("fecha", "La fecha no puede ser futura.");
  if ((await estadoDePeriodo(fecha.slice(0, 7))) !== "abierto") {
    throw new ValidationError("fecha", `El mes de ${textoPeriodo(fecha.slice(0, 7))} ya está cerrado. Elegí una fecha de un mes abierto.`);
  }
  const monto = Number(l.monto);
  const movId = await insert("movimientos_financieros", {
    tipo: monto > 0 ? "ingreso" : "egreso",
    monto: Math.abs(monto),
    categoria: d.categoria,
    etapa_obra: d.categoria,
    fecha,
    descripcion: d.descripcion || [l.descripcion, l.referencia].filter(Boolean).join(" · ") || "Movimiento del banco",
    registrado_por_id: user.id,
    cuenta_id: l.cuenta_id,
    fondo_id: d.fondo_id,
  });
  await conciliarEnBase(l.id, movId, user.id, "nuevo");
  await audit({ usuario_id: user.id, accion: "conciliar_linea", entidad: "extracto_lineas", entidad_id: l.id, valor_nuevo: { movimiento: movId, como: "nuevo", categoria: d.categoria } });
  revalidar();
}

export async function ignorarLineaAction(formData: FormData) {
  const user = await requireConciliar();
  const { linea_id, motivo } = parseForm(z.object({ linea_id: zId, motivo: zTexto(300) }), formData);
  const l = await lineaPendiente(linea_id);
  await update("extracto_lineas", l.id, { estado: "ignorada", motivo_ignorada: motivo, conciliado_por_id: user.id, conciliado_en: new Date().toISOString(), propuesta_movimiento_id: null });
  await audit({ usuario_id: user.id, accion: "ignorar_linea_banco", entidad: "extracto_lineas", entidad_id: l.id, valor_nuevo: { motivo, monto: Number(l.monto) } });
  await proponerConciliaciones(l.cuenta_id);
  revalidar();
}

/** Deshacer: la línea vuelve a pendiente y el movimiento queda sin conciliar (no se borra nada). */
export async function deshacerConciliacionAction(formData: FormData) {
  const user = await requireConciliar();
  const { linea_id } = parseForm(z.object({ linea_id: zId }), formData);
  const l = await get<{ id: number; cuenta_id: number; estado: string; movimiento_financiero_id: number | null }>(
    `SELECT id, cuenta_id, estado, movimiento_financiero_id FROM extracto_lineas WHERE id = ?`,
    [linea_id]
  );
  if (!l || l.estado === "pendiente") throw new Error("Esa línea ya está pendiente.");
  if (l.movimiento_financiero_id) {
    await run(`UPDATE movimientos_financieros SET conciliado_linea_id = NULL, conciliado_en = NULL WHERE id = ?`, [l.movimiento_financiero_id]);
  }
  await update("extracto_lineas", l.id, { estado: "pendiente", movimiento_financiero_id: null, conciliada_como: null, conciliado_por_id: null, conciliado_en: null, motivo_ignorada: null });
  await audit({ usuario_id: user.id, accion: "deshacer_conciliacion", entidad: "extracto_lineas", entidad_id: l.id, valor_anterior: { estado: l.estado, movimiento: l.movimiento_financiero_id } });
  await proponerConciliaciones(l.cuenta_id);
  revalidar();
}

/** Candidatos para "Es otro movimiento…": mismo sentido, sin conciliar, ±45 días. */
export async function candidatosParaLinea(lineaId: number) {
  await requireConciliar();
  const l = await get<Linea>(`SELECT id, cuenta_id, fecha, monto, descripcion, referencia, estado FROM extracto_lineas WHERE id = ?`, [lineaId]);
  if (!l) return [];
  const monto = Number(l.monto);
  return all<{ id: number; fecha: string; monto: string; categoria: string; descripcion: string | null; cuenta: string | null }>(
    `SELECT m.id, left(m.fecha, 10) AS fecha, m.monto, m.categoria, m.descripcion, c.nombre AS cuenta
       FROM movimientos_financieros m LEFT JOIN cuentas_financieras c ON c.id = m.cuenta_id
      WHERE m.tipo = ? AND COALESCE(m.estado, 'activo') <> 'anulado' AND m.conciliado_linea_id IS NULL
        AND left(m.fecha, 10) BETWEEN ? AND ?
      ORDER BY abs(m.monto - ?) ASC, abs(left(m.fecha, 10)::date - ?::date) ASC LIMIT 30`,
    [monto > 0 ? "ingreso" : "egreso", addDays(l.fecha, -45), addDays(l.fecha, 45), Math.abs(monto), l.fecha]
  );
}
function addDays(iso: string, n: number) {
  return new Date(Date.parse(iso + "T12:00:00Z") + n * 86400000).toISOString().slice(0, 10);
}

// =============== Envolturas ===============

export async function confirmarLineaFormAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  return conEstadoDeAccion(() => confirmarLineaAction(fd));
}
export async function pagoCuotaDesdeLineaFormAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  const r = await conEstadoDeAccion(() => pagoCuotaDesdeLineaAction(fd));
  return r.ok ? { ...r, aviso: "Pago registrado (con su recibo) y conciliado." } : r;
}
export async function nuevoMovimientoDesdeLineaFormAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  const r = await conEstadoDeAccion(() => nuevoMovimientoDesdeLineaAction(fd));
  return r.ok ? { ...r, aviso: "Registrado en Finanzas y conciliado." } : r;
}
export async function ignorarLineaFormAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  return conEstadoDeAccion(() => ignorarLineaAction(fd));
}
export async function deshacerConciliacionFormAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  return conEstadoDeAccion(() => deshacerConciliacionAction(fd));
}
