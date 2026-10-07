"use server";

import { z } from "zod";
import { randomBytes } from "node:crypto";
import { revalidatePath } from "next/cache";
import { all, get, insert, update, audit, withTenantTransaction } from "@/lib/db";
import { requireUser, type SessionUser } from "@/lib/auth";
import { canEdit, canApprove } from "@/lib/roles";
import {
  parseForm,
  zId,
  zIdOpcional,
  zTexto,
  zTextoOpcional,
  zMonto,
  zMontoPositivo,
  zMontoOpcional,
  zFecha,
  zEnumSeguro,
  zCheckbox,
  ValidationError,
} from "@/lib/validation";
import { conEstadoDeAccion, type ActionState } from "@/lib/actionState";
import { saveUploadedFile, TIPOS_DOCUMENTO } from "@/lib/upload";
import { crearNotificacionesParaUsuarios } from "@/lib/notificaciones";
import { registrarFacturaInterna } from "@/lib/facturas";
import {
  puedeCerrarMes,
  estadoDePeriodo,
  resumenDePeriodo,
  verificacionesDeCierre,
  textoPeriodo,
  money,
  type EstadoPeriodo,
} from "@/lib/finanzasLibro";

/**
 * Fase 2A — "Finanzas como un libro": cuentas y fondos, transferencias,
 * contra-movimientos, cierre mensual (tesorería cierra, la Fiscal visa),
 * presupuesto por año, compromisos y facturas a pagar, y el mapeo para el
 * contador. Todo auditado; nada se borra.
 *
 * Quién hace qué (sección 8.4 del plan):
 *  - Administración: registra movimientos y facturas, paga facturas. No configura ni cierra.
 *  - Tesorería / Consejo / admin: además configuran cuentas, fondos y presupuesto.
 *  - Cierre del mes: tesorería y admin. Visado: sólo la Fiscal.
 */

const PERIODO = z.string().regex(/^\d{4}-\d{2}$/, "Mes inválido.");

function revalidarFinanzas() {
  revalidatePath("/finanzas");
  revalidatePath("/finanzas/cierre");
  revalidatePath("/finanzas/cuentas");
  revalidatePath("/dashboard");
}

async function requireRegistrar(): Promise<SessionUser> {
  const user = await requireUser();
  if (!canEdit(user.rol, "finanzas")) throw new Error("No tenés permiso para registrar movimientos de Finanzas.");
  return user;
}
async function requireConfigurar(): Promise<SessionUser> {
  const user = await requireUser();
  if (!canApprove(user.rol, "finanzas")) throw new Error("Sólo tesorería, el Consejo Directivo o un administrador pueden cambiar esto.");
  return user;
}

async function usuariosConRol(roles: string[]): Promise<number[]> {
  const filas = await all<{ id: number }>(`SELECT id FROM users WHERE rol = ANY(?::text[]) AND activo = 1`, [roles]).catch(() => []);
  return filas.map((f) => f.id);
}

async function hayMesesCerrados(): Promise<boolean> {
  const r = await get<{ n: string }>(`SELECT COUNT(*) AS n FROM periodos_financieros WHERE estado <> 'abierto'`).catch(() => undefined);
  return Number(r?.n || 0) > 0;
}

async function verificarCuentaYFondo(cuentaId: number | null, fondoId: number | null) {
  if (cuentaId) {
    const c = await get<{ activa: number }>(`SELECT activa FROM cuentas_financieras WHERE id = ?`, [cuentaId]);
    if (!c) throw new ValidationError("cuenta_id", "Esa cuenta no existe.");
    if (!c.activa) throw new ValidationError("cuenta_id", "Esa cuenta está dada de baja.");
  }
  if (fondoId) {
    const f = await get<{ activo: number }>(`SELECT activo FROM fondos WHERE id = ?`, [fondoId]);
    if (!f) throw new ValidationError("fondo_id", "Ese fondo no existe.");
    if (!f.activo) throw new ValidationError("fondo_id", "Ese fondo está dado de baja.");
  }
}

async function verificarMesAbierto(fecha: string, campo = "fecha") {
  const estado = await estadoDePeriodo(fecha.slice(0, 7));
  if (estado !== "abierto") {
    throw new ValidationError(campo, `El mes de ${textoPeriodo(fecha.slice(0, 7))} ya está cerrado. Elegí una fecha de un mes abierto.`);
  }
}

// =============== Cuentas ===============

const cuentaSchema = z.object({
  nombre: zTexto(80),
  tipo: zEnumSeguro(["banco", "caja"], "banco"),
  banco: zTextoOpcional(80),
  referencia: zTextoOpcional(80),
  saldo_inicial: zMonto(),
  predeterminada: zCheckbox,
  para_efectivo: zCheckbox,
});

async function marcarUnica(tabla: "cuentas_financieras" | "fondos", columna: string, id: number) {
  await withTenantTransaction(async (tx) => {
    await tx.run(`UPDATE ${tabla} SET ${columna} = 0 WHERE ${columna} = 1 AND id <> ?`, [id]);
    await tx.run(`UPDATE ${tabla} SET ${columna} = 1 WHERE id = ?`, [id]);
  });
}

export async function crearCuentaAction(formData: FormData) {
  const user = await requireConfigurar();
  const d = parseForm(cuentaSchema, formData);
  if (d.saldo_inicial > 0 && (await hayMesesCerrados())) {
    throw new ValidationError("saldo_inicial", "Ya hay meses cerrados: una cuenta nueva empieza en 0. Si ya tenía plata, registrá una transferencia o un ingreso.");
  }
  const id = await insert("cuentas_financieras", {
    nombre: d.nombre,
    tipo: d.tipo,
    banco: d.tipo === "banco" ? d.banco : null,
    referencia: d.referencia,
    saldo_inicial: d.saldo_inicial,
    creado_por_id: user.id,
  });
  if (d.predeterminada) await marcarUnica("cuentas_financieras", "predeterminada", id);
  if (d.para_efectivo) await marcarUnica("cuentas_financieras", "para_efectivo", id);
  await audit({ usuario_id: user.id, accion: "crear_cuenta_financiera", entidad: "cuentas_financieras", entidad_id: id, valor_nuevo: d });
  revalidarFinanzas();
}

export async function editarCuentaAction(formData: FormData) {
  const user = await requireConfigurar();
  const { id, ...d } = parseForm(cuentaSchema.extend({ id: zId, activa: zCheckbox }), formData);
  const actual = await get<{ saldo_inicial: string; predeterminada: number; activa: number }>(`SELECT saldo_inicial, predeterminada, activa FROM cuentas_financieras WHERE id = ?`, [id]);
  if (!actual) throw new Error("Esa cuenta no existe.");
  if (Number(actual.saldo_inicial) !== d.saldo_inicial && (await hayMesesCerrados())) {
    throw new ValidationError("saldo_inicial", "Ya hay meses cerrados: el saldo inicial no se puede cambiar. Si hay una diferencia, registrá un ajuste como movimiento.");
  }
  if (!d.activa && (actual.predeterminada || d.predeterminada)) {
    throw new ValidationError("activa", "Es la cuenta principal: antes de darla de baja, marcá otra como principal.");
  }
  await update("cuentas_financieras", id, {
    nombre: d.nombre,
    tipo: d.tipo,
    banco: d.tipo === "banco" ? d.banco : null,
    referencia: d.referencia,
    saldo_inicial: d.saldo_inicial,
    activa: d.activa ? 1 : 0,
    ...(d.para_efectivo ? {} : { para_efectivo: 0 }),
  });
  if (d.predeterminada) await marcarUnica("cuentas_financieras", "predeterminada", id);
  if (d.para_efectivo) await marcarUnica("cuentas_financieras", "para_efectivo", id);
  await audit({ usuario_id: user.id, accion: "editar_cuenta_financiera", entidad: "cuentas_financieras", entidad_id: id, valor_anterior: actual, valor_nuevo: d });
  revalidarFinanzas();
}

// =============== Fondos ===============

const fondoSchema = z.object({
  nombre: zTexto(80),
  tipo: zEnumSeguro(["general", "obra", "social", "reserva", "mantenimiento", "caja_chica", "otro"], "otro"),
  descripcion: zTextoOpcional(300),
  saldo_inicial: zMonto(),
  predeterminado: zCheckbox,
  recibe_cuotas: zCheckbox,
  comision_id: zIdOpcional,
  tope: zMontoOpcional(),
});

export async function crearFondoAction(formData: FormData) {
  const user = await requireConfigurar();
  const d = parseForm(fondoSchema, formData);
  if (d.saldo_inicial > 0 && (await hayMesesCerrados())) {
    throw new ValidationError("saldo_inicial", "Ya hay meses cerrados: un fondo nuevo empieza en 0. Para pasarle plata, usá «Pasar plata entre cuentas o fondos».");
  }
  const id = await insert("fondos", {
    nombre: d.nombre,
    tipo: d.tipo,
    descripcion: d.descripcion,
    saldo_inicial: d.saldo_inicial,
    comision_id: d.tipo === "caja_chica" ? d.comision_id : null,
    tope: d.tipo === "caja_chica" ? d.tope : null,
    creado_por_id: user.id,
  });
  if (d.predeterminado) await marcarUnica("fondos", "predeterminado", id);
  if (d.recibe_cuotas) await marcarUnica("fondos", "recibe_cuotas", id);
  await audit({ usuario_id: user.id, accion: "crear_fondo", entidad: "fondos", entidad_id: id, valor_nuevo: d });
  revalidarFinanzas();
}

export async function editarFondoAction(formData: FormData) {
  const user = await requireConfigurar();
  const { id, ...d } = parseForm(fondoSchema.extend({ id: zId, activo: zCheckbox }), formData);
  const actual = await get<{ saldo_inicial: string; predeterminado: number }>(`SELECT saldo_inicial, predeterminado FROM fondos WHERE id = ?`, [id]);
  if (!actual) throw new Error("Ese fondo no existe.");
  if (Number(actual.saldo_inicial) !== d.saldo_inicial && (await hayMesesCerrados())) {
    throw new ValidationError("saldo_inicial", "Ya hay meses cerrados: el saldo inicial no se puede cambiar.");
  }
  if (!d.activo && (actual.predeterminado || d.predeterminado)) {
    throw new ValidationError("activo", "Es el fondo principal: antes de darlo de baja, marcá otro como principal.");
  }
  await update("fondos", id, {
    nombre: d.nombre,
    tipo: d.tipo,
    descripcion: d.descripcion,
    saldo_inicial: d.saldo_inicial,
    comision_id: d.tipo === "caja_chica" ? d.comision_id : null,
    tope: d.tipo === "caja_chica" ? d.tope : null,
    activo: d.activo ? 1 : 0,
    ...(d.recibe_cuotas ? {} : { recibe_cuotas: 0 }),
  });
  if (d.predeterminado) await marcarUnica("fondos", "predeterminado", id);
  if (d.recibe_cuotas) await marcarUnica("fondos", "recibe_cuotas", id);
  await audit({ usuario_id: user.id, accion: "editar_fondo", entidad: "fondos", entidad_id: id, valor_anterior: actual, valor_nuevo: d });
  revalidarFinanzas();
}

// =============== Transferencias internas ===============

const transferenciaSchema = z.object({
  monto: zMontoPositivo(),
  fecha: zFecha,
  cuenta_origen_id: zId,
  fondo_origen_id: zId,
  cuenta_destino_id: zId,
  fondo_destino_id: zId,
  descripcion: zTextoOpcional(300),
});

/** Pasar plata de una cuenta o fondo a otro (ej. depositar la caja en el banco, separar plata para la reserva). */
export async function transferirAction(formData: FormData) {
  const user = await requireRegistrar();
  const d = parseForm(transferenciaSchema, formData);
  if (d.cuenta_origen_id === d.cuenta_destino_id && d.fondo_origen_id === d.fondo_destino_id) {
    throw new ValidationError("cuenta_destino_id", "El origen y el destino son iguales: cambiá la cuenta o el fondo de destino.");
  }
  await verificarCuentaYFondo(d.cuenta_origen_id, d.fondo_origen_id);
  await verificarCuentaYFondo(d.cuenta_destino_id, d.fondo_destino_id);
  await verificarMesAbierto(d.fecha);
  const grupo = randomBytes(8).toString("hex");
  const descripcion = d.descripcion || "Pase de plata entre cuentas o fondos";
  const ids = await withTenantTransaction(async (tx) => {
    const salida = await tx.get<{ id: number }>(
      `INSERT INTO movimientos_financieros (organization_id, tipo, monto, categoria, etapa_obra, fecha, descripcion, registrado_por_id, cuenta_id, fondo_id, transferencia_id)
       VALUES (NULLIF(current_setting('app.current_org_id', true), '')::int, 'egreso', ?, 'Transferencia interna', 'Transferencia interna', ?, ?, ?, ?, ?, ?) RETURNING id`,
      [d.monto, d.fecha, descripcion, user.id, d.cuenta_origen_id, d.fondo_origen_id, grupo]
    );
    const entrada = await tx.get<{ id: number }>(
      `INSERT INTO movimientos_financieros (organization_id, tipo, monto, categoria, etapa_obra, fecha, descripcion, registrado_por_id, cuenta_id, fondo_id, transferencia_id)
       VALUES (NULLIF(current_setting('app.current_org_id', true), '')::int, 'ingreso', ?, 'Transferencia interna', 'Transferencia interna', ?, ?, ?, ?, ?, ?) RETURNING id`,
      [d.monto, d.fecha, descripcion, user.id, d.cuenta_destino_id, d.fondo_destino_id, grupo]
    );
    return [salida?.id, entrada?.id];
  });
  await audit({ usuario_id: user.id, accion: "transferencia_interna", entidad: "movimientos_financieros", entidad_id: ids[0] ?? null, valor_nuevo: { ...d, movimientos: ids } });
  revalidarFinanzas();
}

// =============== Contra-movimiento ===============

const contraSchema = z.object({ id: zId, fecha: zFecha, motivo: zTexto(300) });

/**
 * Corrección de un movimiento de un mes cerrado: se registra en un mes
 * abierto el movimiento opuesto (mismo monto, cuenta, fondo y rubro). El
 * original queda tal cual, para que el libro cuente la historia completa.
 */
export async function contraMovimientoAction(formData: FormData) {
  const user = await requireRegistrar();
  const { id, fecha, motivo } = parseForm(contraSchema, formData);
  const m = await get<{
    id: number;
    tipo: string;
    monto: number;
    categoria: string;
    fecha: string;
    descripcion: string | null;
    cuenta_id: number | null;
    fondo_id: number | null;
    estado: string | null;
    contra_de_id: number | null;
    transferencia_id: string | null;
  }>(`SELECT id, tipo, monto, categoria, fecha, descripcion, cuenta_id, fondo_id, estado, contra_de_id, transferencia_id FROM movimientos_financieros WHERE id = ?`, [id]);
  if (!m) throw new Error("Ese movimiento no existe.");
  if (m.estado === "anulado") throw new Error("Ese movimiento está anulado: no hace falta corregirlo.");
  if (m.contra_de_id) throw new Error("Este movimiento ya es una corrección de otro.");
  if (m.transferencia_id) throw new Error("Un pase entre cuentas o fondos se corrige haciendo el pase al revés.");
  const ya = await get<{ id: number }>(`SELECT id FROM movimientos_financieros WHERE contra_de_id = ? AND COALESCE(estado, 'activo') <> 'anulado'`, [id]);
  if (ya) throw new Error("Este movimiento ya tiene su corrección registrada.");
  await verificarMesAbierto(fecha);
  const fechaOriginal = String(m.fecha).slice(0, 10).split("-").reverse().join("/");
  const nuevo = await insert("movimientos_financieros", {
    tipo: m.tipo === "ingreso" ? "egreso" : "ingreso",
    monto: Number(m.monto),
    categoria: m.categoria,
    etapa_obra: m.categoria,
    fecha,
    descripcion: `Corrección de «${m.descripcion || m.categoria}» del ${fechaOriginal}: ${motivo}`,
    registrado_por_id: user.id,
    cuenta_id: m.cuenta_id,
    fondo_id: m.fondo_id,
    contra_de_id: id,
  });
  await audit({ usuario_id: user.id, accion: "contra_movimiento", entidad: "movimientos_financieros", entidad_id: nuevo, valor_nuevo: { corrige: id, motivo, fecha } });
  await avisarFiscal(`Se corrigió un movimiento de ${money(Number(m.monto))} (${m.categoria}) del ${fechaOriginal}`, motivo, nuevo);
  revalidarFinanzas();
}

/** A11: la Fiscal se entera de las correcciones y reaperturas. */
async function avisarFiscal(titulo: string, cuerpo: string, refId: number | null) {
  const fiscales = await usuariosConRol(["fiscal"]);
  await crearNotificacionesParaUsuarios(fiscales, { tipo: "cambio_sensible_finanzas", titulo, cuerpo, ref_tabla: "movimientos_financieros", ref_id: refId }).catch(() => {});
}

// =============== Cierre mensual ===============

export async function cerrarMesAction(formData: FormData) {
  const user = await requireUser();
  if (!puedeCerrarMes(user.rol)) throw new Error("Sólo tesorería (o un administrador) cierra el mes.");
  const { periodo } = parseForm(z.object({ periodo: PERIODO }), formData);
  const estado = await estadoDePeriodo(periodo);
  if (estado !== "abierto") throw new Error(`El mes de ${textoPeriodo(periodo)} ya está cerrado.`);
  const verificaciones = await verificacionesDeCierre(periodo);
  const bloqueo = verificaciones.find((v) => v.bloquea);
  if (bloqueo) throw new Error(bloqueo.texto);
  const resumen = await resumenDePeriodo(periodo);
  const ahora = new Date().toISOString();
  const existente = await get<{ id: number }>(`SELECT id FROM periodos_financieros WHERE periodo = ?`, [periodo]);
  const datos = {
    estado: "cerrado",
    resumen: JSON.stringify(resumen),
    cerrado_en: ahora,
    cerrado_por_id: user.id,
    visado_en: null,
    visado_por_id: null,
  };
  const id = existente ? (await update("periodos_financieros", existente.id, datos), existente.id) : await insert("periodos_financieros", { periodo, ...datos });
  await audit({
    usuario_id: user.id,
    accion: "cerrar_mes",
    entidad: "periodos_financieros",
    entidad_id: id,
    valor_nuevo: { periodo, ingresos: resumen.ingresos, egresos: resumen.egresos },
  });
  const fiscales = await usuariosConRol(["fiscal"]);
  await crearNotificacionesParaUsuarios(fiscales, {
    tipo: "cierre_para_visar",
    titulo: `Tesorería cerró ${textoPeriodo(periodo)}: falta tu visto`,
    cuerpo: `Ingresos ${money(resumen.ingresos)} · Egresos ${money(resumen.egresos)}`,
    ref_tabla: "periodos_financieros",
    ref_id: id,
  }).catch(() => {});
  revalidarFinanzas();
}

export async function visarMesAction(formData: FormData) {
  const user = await requireUser();
  if (user.rol !== "fiscal") throw new Error("El visto del cierre lo da la Comisión Fiscal.");
  const { periodo } = parseForm(z.object({ periodo: PERIODO }), formData);
  const p = await get<{ id: number; estado: EstadoPeriodo; cerrado_por_id: number | null }>(`SELECT id, estado, cerrado_por_id FROM periodos_financieros WHERE periodo = ?`, [periodo]);
  if (!p || p.estado !== "cerrado") throw new Error("Ese mes no está esperando el visto (tiene que estar cerrado por tesorería).");
  await update("periodos_financieros", p.id, { estado: "visado", visado_en: new Date().toISOString(), visado_por_id: user.id, observacion_fiscal: null });
  await audit({ usuario_id: user.id, accion: "visar_mes", entidad: "periodos_financieros", entidad_id: p.id, valor_nuevo: { periodo } });
  const tesoreria = await usuariosConRol(["tesoreria"]);
  await crearNotificacionesParaUsuarios(tesoreria, {
    tipo: "cierre_visado",
    titulo: `La Fiscal visó el cierre de ${textoPeriodo(periodo)}`,
    ref_tabla: "periodos_financieros",
    ref_id: p.id,
  }).catch(() => {});
  revalidarFinanzas();
}

/** La Fiscal devuelve el mes con una observación: queda abierto para corregir. */
export async function observarMesAction(formData: FormData) {
  const user = await requireUser();
  if (user.rol !== "fiscal") throw new Error("Sólo la Comisión Fiscal puede devolver un cierre con observaciones.");
  const { periodo, observacion } = parseForm(z.object({ periodo: PERIODO, observacion: zTexto(1000) }), formData);
  const p = await get<{ id: number; estado: EstadoPeriodo }>(`SELECT id, estado FROM periodos_financieros WHERE periodo = ?`, [periodo]);
  if (!p || p.estado !== "cerrado") throw new Error("Sólo se puede devolver un mes cerrado que todavía no tiene el visto.");
  await update("periodos_financieros", p.id, {
    estado: "abierto",
    observacion_fiscal: observacion,
    observado_en: new Date().toISOString(),
    observado_por_id: user.id,
  });
  await audit({ usuario_id: user.id, accion: "observar_mes", entidad: "periodos_financieros", entidad_id: p.id, valor_nuevo: { periodo, observacion } });
  const tesoreria = await usuariosConRol(["tesoreria", "admin"]);
  await crearNotificacionesParaUsuarios(tesoreria, {
    tipo: "cierre_observado",
    titulo: `La Fiscal devolvió ${textoPeriodo(periodo)} con una observación`,
    cuerpo: observacion,
    ref_tabla: "periodos_financieros",
    ref_id: p.id,
  }).catch(() => {});
  revalidarFinanzas();
}

/** Tesorería reabre un mes cerrado que la Fiscal todavía no visó (con motivo; la Fiscal se entera). */
export async function reabrirMesAction(formData: FormData) {
  const user = await requireUser();
  if (!puedeCerrarMes(user.rol)) throw new Error("Sólo tesorería (o un administrador) puede reabrir un mes.");
  const { periodo, motivo } = parseForm(z.object({ periodo: PERIODO, motivo: zTexto(500) }), formData);
  const p = await get<{ id: number; estado: EstadoPeriodo }>(`SELECT id, estado FROM periodos_financieros WHERE periodo = ?`, [periodo]);
  if (!p || p.estado === "abierto") throw new Error("Ese mes ya está abierto.");
  if (p.estado === "visado") {
    throw new Error("Un mes visado por la Fiscal no se reabre. Si hay que corregir algo, hacé un contra-movimiento en un mes abierto.");
  }
  await update("periodos_financieros", p.id, {
    estado: "abierto",
    reabierto_en: new Date().toISOString(),
    reabierto_por_id: user.id,
    motivo_reapertura: motivo,
  });
  await audit({ usuario_id: user.id, accion: "reabrir_mes", entidad: "periodos_financieros", entidad_id: p.id, valor_nuevo: { periodo, motivo } });
  await avisarFiscal(`Tesorería reabrió ${textoPeriodo(periodo)}`, motivo, null);
  revalidarFinanzas();
}

// =============== Presupuesto ===============

const lineaPresupuestoSchema = z.object({
  id: zIdOpcional,
  anio: z.string().regex(/^\d{4}$/, "Año inválido."),
  categoria: zTexto(120),
  monto: zMonto(),
});

export async function guardarLineaPresupuestoAction(formData: FormData) {
  const user = await requireConfigurar();
  const d = parseForm(lineaPresupuestoSchema, formData);
  const repetida = await get<{ id: number }>(
    `SELECT id FROM presupuesto_general WHERE periodo = ? AND lower(trim(categoria)) = lower(trim(?)) AND COALESCE(activo, 1) = 1 AND id <> ?`,
    [d.anio, d.categoria, d.id ?? 0]
  );
  if (repetida) throw new ValidationError("categoria", `El rubro «${d.categoria}» ya está en el presupuesto ${d.anio}. Cambiá su monto en esa línea.`);
  if (d.id) {
    const antes = await get<{ categoria: string; monto_presupuestado: number }>(`SELECT categoria, monto_presupuestado FROM presupuesto_general WHERE id = ?`, [d.id]);
    if (!antes) throw new Error("Esa línea del presupuesto no existe.");
    await update("presupuesto_general", d.id, { categoria: d.categoria, monto_presupuestado: d.monto, periodo: d.anio, actualizado_en: new Date().toISOString() });
    await audit({ usuario_id: user.id, accion: "editar_presupuesto", entidad: "presupuesto_general", entidad_id: d.id, valor_anterior: antes, valor_nuevo: d });
  } else {
    const id = await insert("presupuesto_general", { categoria: d.categoria, monto_presupuestado: d.monto, periodo: d.anio });
    await audit({ usuario_id: user.id, accion: "crear_presupuesto", entidad: "presupuesto_general", entidad_id: id, valor_nuevo: d });
  }
  revalidarFinanzas();
}

export async function quitarLineaPresupuestoAction(formData: FormData) {
  const user = await requireConfigurar();
  const { id } = parseForm(z.object({ id: zId }), formData);
  const antes = await get<{ categoria: string; monto_presupuestado: number; periodo: string }>(`SELECT categoria, monto_presupuestado, periodo FROM presupuesto_general WHERE id = ?`, [id]);
  if (!antes) throw new Error("Esa línea del presupuesto no existe.");
  await update("presupuesto_general", id, { activo: 0, actualizado_en: new Date().toISOString() });
  await audit({ usuario_id: user.id, accion: "quitar_presupuesto", entidad: "presupuesto_general", entidad_id: id, valor_anterior: antes });
  revalidarFinanzas();
}

/** Copia el presupuesto de un año al siguiente (sólo los rubros que el año nuevo todavía no tiene). */
export async function copiarPresupuestoAction(formData: FormData) {
  const user = await requireConfigurar();
  const { desde, hasta } = parseForm(z.object({ desde: z.string().regex(/^\d{4}$/), hasta: z.string().regex(/^\d{4}$/) }), formData);
  const origen = await all<{ categoria: string; monto_presupuestado: number }>(
    `SELECT categoria, monto_presupuestado FROM presupuesto_general WHERE periodo = ? AND COALESCE(activo, 1) = 1`,
    [desde]
  );
  if (!origen.length) throw new Error(`El presupuesto ${desde} está vacío.`);
  const existentes = new Set(
    (await all<{ categoria: string }>(`SELECT categoria FROM presupuesto_general WHERE periodo = ? AND COALESCE(activo, 1) = 1`, [hasta])).map((r) =>
      r.categoria.trim().toLowerCase()
    )
  );
  let n = 0;
  for (const o of origen) {
    if (existentes.has(o.categoria.trim().toLowerCase())) continue;
    await insert("presupuesto_general", { categoria: o.categoria, monto_presupuestado: Number(o.monto_presupuestado), periodo: hasta });
    n++;
  }
  await audit({ usuario_id: user.id, accion: "copiar_presupuesto", entidad: "presupuesto_general", entidad_id: null, valor_nuevo: { desde, hasta, lineas: n } });
  revalidarFinanzas();
  return n;
}

// =============== Compromisos ===============

const compromisoSchema = z.object({
  descripcion: zTexto(300),
  monto: zMontoPositivo(),
  fecha_estimada: zFecha,
  tipo: zEnumSeguro(["egreso", "ingreso"], "egreso"),
  categoria: zTextoOpcional(120),
  origen: zTextoOpcional(300),
});

export async function crearCompromisoAction(formData: FormData) {
  const user = await requireRegistrar();
  const d = parseForm(compromisoSchema, formData);
  const id = await insert("compromisos_futuros", { ...d, origen: d.origen || (d.tipo === "ingreso" ? "Ingreso esperado" : "Cargado a mano"), estado: "pendiente", creado_por_id: user.id });
  await audit({ usuario_id: user.id, accion: "crear", entidad: "compromisos_futuros", entidad_id: id, valor_nuevo: d });
  revalidarFinanzas();
}

export async function cancelarCompromisoAction(formData: FormData) {
  const user = await requireRegistrar();
  const { id, motivo } = parseForm(z.object({ id: zId, motivo: zTexto(300) }), formData);
  const c = await get<{ estado: string; descripcion: string; monto: number }>(`SELECT estado, descripcion, monto FROM compromisos_futuros WHERE id = ?`, [id]);
  if (!c) throw new Error("Ese compromiso no existe.");
  if (c.estado !== "pendiente") throw new Error("Sólo se puede cancelar un compromiso pendiente.");
  await update("compromisos_futuros", id, { estado: "cancelado", cerrado_en: new Date().toISOString(), cerrado_por_id: user.id, motivo_cierre: motivo });
  await audit({ usuario_id: user.id, accion: "cancelar_compromiso", entidad: "compromisos_futuros", entidad_id: id, valor_anterior: c, valor_nuevo: { motivo } });
  revalidarFinanzas();
}

const cumplirCompromisoSchema = z.object({ id: zId, fecha: zFecha, cuenta_id: zId, fondo_id: zId, monto: zMontoPositivo() });

/** "Ya se pagó / ya entró": registra el movimiento real y cierra el compromiso. */
export async function cumplirCompromisoAction(formData: FormData) {
  const user = await requireRegistrar();
  const d = parseForm(cumplirCompromisoSchema, formData);
  const c = await get<{ estado: string; tipo: string; descripcion: string; categoria: string | null; monto: number }>(
    `SELECT estado, tipo, descripcion, categoria, monto FROM compromisos_futuros WHERE id = ?`,
    [d.id]
  );
  if (!c) throw new Error("Ese compromiso no existe.");
  if (c.estado !== "pendiente") throw new Error("Ese compromiso ya no está pendiente.");
  await verificarCuentaYFondo(d.cuenta_id, d.fondo_id);
  await verificarMesAbierto(d.fecha);
  const categoria = c.categoria || (c.tipo === "ingreso" ? "Otros ingresos" : "Otros gastos");
  const movId = await insert("movimientos_financieros", {
    tipo: c.tipo === "ingreso" ? "ingreso" : "egreso",
    monto: d.monto,
    categoria,
    etapa_obra: categoria,
    fecha: d.fecha,
    descripcion: c.descripcion,
    registrado_por_id: user.id,
    cuenta_id: d.cuenta_id,
    fondo_id: d.fondo_id,
  });
  await update("compromisos_futuros", d.id, { estado: "pagado", movimiento_financiero_id: movId, cerrado_en: new Date().toISOString(), cerrado_por_id: user.id });
  await audit({ usuario_id: user.id, accion: "cumplir_compromiso", entidad: "compromisos_futuros", entidad_id: d.id, valor_nuevo: { movimiento: movId, monto: d.monto } });
  revalidarFinanzas();
}

// =============== Facturas a pagar ===============


export async function registrarFacturaAction(formData: FormData) {
  const user = await requireRegistrar();
  const archivo = formData.get("archivo") as File | null;
  let documentoId: number | null = null;
  if (archivo && archivo.size > 0) {
    const url = await saveUploadedFile(archivo, user.organization_id, "documentos", { tiposPermitidos: TIPOS_DOCUMENTO, maxBytes: 20 * 1024 * 1024 });
    if (url) {
      const solicitud = Number(formData.get("solicitud_compra_id") || 0) || null;
      documentoId = await insert("documentos", {
        categoria: "facturas",
        nombre: `Factura ${String(formData.get("numero") || "").trim() || "de proveedor"}`.slice(0, 200),
        archivo_url: url,
        subido_por_id: user.id,
        solicitud_compra_id: solicitud,
      });
    }
  }
  await registrarFacturaInterna(user, formData, documentoId);
  revalidarFinanzas();
}

const pagarFacturaSchema = z.object({ id: zId, fecha: zFecha, cuenta_id: zId, fondo_id: zId });

/** Pagar una factura: genera el egreso, la marca pagada y cierra su compromiso. Si la compra ya tenía un gasto de comisión pendiente, ese gasto queda pagado con este mismo egreso (no se duplica). */
export async function pagarFacturaAction(formData: FormData) {
  const user = await requireRegistrar();
  const d = parseForm(pagarFacturaSchema, formData);
  const f = await get<{
    id: number;
    estado: string;
    monto: string;
    categoria: string | null;
    numero: string | null;
    descripcion: string | null;
    solicitud_compra_id: number | null;
    compromiso_id: number | null;
    proveedor: string | null;
    archivo_url: string | null;
  }>(
    `SELECT f.id, f.estado, f.monto, f.categoria, f.numero, f.descripcion, f.solicitud_compra_id, f.compromiso_id, p.nombre AS proveedor, doc.archivo_url
       FROM facturas_proveedor f LEFT JOIN proveedores p ON p.id = f.proveedor_id LEFT JOIN documentos doc ON doc.id = f.documento_id
      WHERE f.id = ?`,
    [d.id]
  );
  if (!f) throw new Error("Esa factura no existe.");
  if (f.estado !== "a_pagar") throw new Error(f.estado === "pagada" ? "Esa factura ya está pagada." : "Esa factura está anulada.");
  await verificarCuentaYFondo(d.cuenta_id, d.fondo_id);
  await verificarMesAbierto(d.fecha);
  const categoria = f.categoria || "Proveedores";
  const descripcion = [`Factura${f.numero ? ` N° ${f.numero}` : ""}`, f.proveedor, f.descripcion].filter(Boolean).join(" — ");
  const ahora = new Date().toISOString();
  const movId = await withTenantTransaction(async (tx) => {
    const mov = await tx.get<{ id: number }>(
      `INSERT INTO movimientos_financieros (organization_id, tipo, monto, categoria, etapa_obra, fecha, descripcion, comprobante_url, registrado_por_id, cuenta_id, fondo_id, factura_id)
       VALUES (NULLIF(current_setting('app.current_org_id', true), '')::int, 'egreso', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id`,
      [Number(f.monto), categoria, categoria, d.fecha, descripcion, f.archivo_url, user.id, d.cuenta_id, d.fondo_id, f.id]
    );
    const id = mov!.id;
    await tx.run(`UPDATE facturas_proveedor SET estado = 'pagada', pagada_en = ?, pagada_por_id = ?, movimiento_financiero_id = ? WHERE id = ?`, [d.fecha, user.id, id, f.id]);
    if (f.compromiso_id) {
      await tx.run(`UPDATE compromisos_futuros SET estado = 'pagado', movimiento_financiero_id = ?, cerrado_en = ?, cerrado_por_id = ? WHERE id = ? AND estado IN ('pendiente', 'facturado')`, [id, ahora, user.id, f.compromiso_id]);
    }
    if (f.solicitud_compra_id) {
      await tx.run(
        `UPDATE gastos_comision SET estado = 'pagado', movimiento_financiero_id = ? WHERE solicitud_compra_id = ? AND estado = 'pendiente'`,
        [id, f.solicitud_compra_id]
      );
    }
    return id;
  });
  await audit({ usuario_id: user.id, accion: "pagar_factura", entidad: "facturas_proveedor", entidad_id: f.id, valor_nuevo: { movimiento: movId, fecha: d.fecha, monto: Number(f.monto) } });
  revalidarFinanzas();
  revalidatePath("/gastos");
  if (f.solicitud_compra_id) revalidatePath(`/compras/${f.solicitud_compra_id}`);
}

export async function anularFacturaAction(formData: FormData) {
  const user = await requireRegistrar();
  const { id, motivo } = parseForm(z.object({ id: zId, motivo: zTexto(300) }), formData);
  const f = await get<{ estado: string; compromiso_id: number | null; monto: string }>(`SELECT estado, compromiso_id, monto FROM facturas_proveedor WHERE id = ?`, [id]);
  if (!f) throw new Error("Esa factura no existe.");
  if (f.estado !== "a_pagar") throw new Error("Sólo se puede anular una factura que todavía no se pagó. Si ya se pagó, corregí el pago con un contra-movimiento.");
  await update("facturas_proveedor", id, { estado: "anulada", anulada_en: new Date().toISOString(), anulada_por_id: user.id, motivo_anulacion: motivo });
  if (f.compromiso_id) {
    await update("compromisos_futuros", f.compromiso_id, { estado: "pendiente", factura_id: null, cerrado_en: null, cerrado_por_id: null });
  }
  await audit({ usuario_id: user.id, accion: "anular_factura", entidad: "facturas_proveedor", entidad_id: id, valor_nuevo: { motivo } });
  await avisarFiscal(`Se anuló una factura a pagar de ${money(Number(f.monto))}`, motivo, null);
  revalidarFinanzas();
}

// =============== Para el contador ===============

const mapeoSchema = z.object({ categoria: zTexto(120), codigo: zTextoOpcional(30), nombre_contable: zTextoOpcional(120) });

export async function guardarMapeoContableAction(formData: FormData) {
  const user = await requireConfigurar();
  const d = parseForm(mapeoSchema, formData);
  const existente = await get<{ id: number }>(`SELECT id FROM mapeo_contable WHERE categoria = ?`, [d.categoria]);
  if (existente) await update("mapeo_contable", existente.id, { codigo: d.codigo, nombre_contable: d.nombre_contable, actualizado_en: new Date().toISOString() });
  else await insert("mapeo_contable", d);
  await audit({ usuario_id: user.id, accion: "mapeo_contable", entidad: "mapeo_contable", entidad_id: existente?.id ?? null, valor_nuevo: d });
  revalidatePath("/finanzas/cuentas");
}

// =============== Envolturas para formularios ===============

export async function crearCuentaFormAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  return conEstadoDeAccion(() => crearCuentaAction(fd));
}
export async function editarCuentaFormAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  return conEstadoDeAccion(() => editarCuentaAction(fd));
}
export async function crearFondoFormAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  return conEstadoDeAccion(() => crearFondoAction(fd));
}
export async function editarFondoFormAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  return conEstadoDeAccion(() => editarFondoAction(fd));
}
export async function transferirFormAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  return conEstadoDeAccion(() => transferirAction(fd));
}
export async function contraMovimientoFormAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  const r = await conEstadoDeAccion(() => contraMovimientoAction(fd));
  return r.ok ? { ...r, aviso: "Listo: la corrección quedó registrada en el mes abierto. El movimiento original no se tocó." } : r;
}
export async function cerrarMesFormAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  const r = await conEstadoDeAccion(() => cerrarMesAction(fd));
  return r.ok ? { ...r, aviso: "Mes cerrado. Ya no se pueden cambiar sus movimientos. La Fiscal recibió el aviso para darle el visto." } : r;
}
export async function visarMesFormAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  const r = await conEstadoDeAccion(() => visarMesAction(fd));
  return r.ok ? { ...r, aviso: "Listo: el mes quedó visado." } : r;
}
export async function observarMesFormAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  const r = await conEstadoDeAccion(() => observarMesAction(fd));
  return r.ok ? { ...r, aviso: "Le devolviste el mes a tesorería con tu observación." } : r;
}
export async function reabrirMesFormAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  const r = await conEstadoDeAccion(() => reabrirMesAction(fd));
  return r.ok ? { ...r, aviso: "El mes quedó abierto otra vez. La Fiscal recibió el aviso." } : r;
}
export async function guardarLineaPresupuestoFormAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  return conEstadoDeAccion(() => guardarLineaPresupuestoAction(fd));
}
export async function quitarLineaPresupuestoFormAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  return conEstadoDeAccion(() => quitarLineaPresupuestoAction(fd));
}
export async function copiarPresupuestoFormAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  let n = 0;
  const r = await conEstadoDeAccion(async () => {
    n = await copiarPresupuestoAction(fd);
  });
  return r.ok ? { ...r, aviso: n ? `Se copiaron ${n} rubro(s).` : "El año nuevo ya tenía todos esos rubros." } : r;
}
export async function crearCompromisoFormAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  return conEstadoDeAccion(() => crearCompromisoAction(fd));
}
export async function cancelarCompromisoFormAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  return conEstadoDeAccion(() => cancelarCompromisoAction(fd));
}
export async function cumplirCompromisoFormAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  return conEstadoDeAccion(() => cumplirCompromisoAction(fd));
}
export async function registrarFacturaFormAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  return conEstadoDeAccion(() => registrarFacturaAction(fd));
}
export async function pagarFacturaFormAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  return conEstadoDeAccion(() => pagarFacturaAction(fd));
}
export async function anularFacturaFormAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  return conEstadoDeAccion(() => anularFacturaAction(fd));
}
export async function guardarMapeoContableFormAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  return conEstadoDeAccion(() => guardarMapeoContableAction(fd));
}
