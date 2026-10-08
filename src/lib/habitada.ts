import { all, get } from "@/lib/db";
import { canEdit } from "@/lib/roles";
import type { SessionUser } from "@/lib/auth";
import { calcularCuotasSocio, cargarMovimientosCuenta } from "@/lib/logic";

/**
 * Fase 3H — Etapa Habitada v1: conceptos de cuota, mantenimiento preventivo,
 * reservas de espacios comunes y liquidación de egreso.
 */

export type Concepto = { id: number; nombre: string; monto: number; orden: number };
export async function conceptosCuota(): Promise<Concepto[]> {
  const f = await all<Concepto>(`SELECT id, nombre, monto, orden FROM conceptos_cuota WHERE activo = 1 ORDER BY orden, id`).catch(() => []);
  return f.map((c) => ({ ...c, monto: Number(c.monto) }));
}

/** Mantenimiento: quien maneja Reclamos o integra una comisión de Mantenimiento. */
export async function puedeMantenimiento(user: SessionUser): Promise<boolean> {
  if (canEdit(user.rol, "reclamos")) return true;
  const m = await get<{ id: number }>(
    `SELECT cm.id FROM comision_miembros cm JOIN comisiones c ON c.id = cm.comision_id WHERE cm.user_id = ? AND cm.activo = 1 AND c.activa = 1 AND c.funcion = 'mantenimiento' LIMIT 1`,
    [user.id]
  ).catch(() => undefined);
  return !!m;
}

export type Preventivo = { id: number; titulo: string; descripcion: string | null; frecuencia_dias: number; ultima_vez: string | null; proxima_fecha: string };
export async function preventivos(): Promise<Preventivo[]> {
  return all<Preventivo>(
    `SELECT id, titulo, descripcion, frecuencia_dias, ultima_vez, proxima_fecha FROM mantenimiento_preventivo WHERE activo = 1 ORDER BY proxima_fecha, id`
  ).catch(() => []);
}

/** Espacios y reservas: los administra quien gestiona Reclamos/Mantenimiento o Socios. */
export function puedeAdministrarEspacios(user: SessionUser): boolean {
  return canEdit(user.rol, "reclamos") || canEdit(user.rol, "socios");
}

export type Espacio = { id: number; nombre: string; descripcion: string | null; capacidad: number | null; requiere_aprobacion: number };
export async function espaciosComunes(): Promise<Espacio[]> {
  return all<Espacio>(`SELECT id, nombre, descripcion, capacidad, requiere_aprobacion FROM espacios_comunes WHERE activo = 1 ORDER BY nombre`).catch(() => []);
}

export type Reserva = { id: number; espacio_id: number; espacio: string; fecha: string; hora_inicio: string; hora_fin: string; user_id: number; persona: string; motivo: string | null; estado: string };
export async function reservasDesde(desde: string): Promise<Reserva[]> {
  return all<Reserva>(
    `SELECT r.id, r.espacio_id, e.nombre AS espacio, r.fecha, r.hora_inicio, r.hora_fin, r.user_id, u.nombre AS persona, r.motivo, r.estado
       FROM reservas_espacios r JOIN espacios_comunes e ON e.id = r.espacio_id JOIN users u ON u.id = r.user_id
      WHERE r.fecha >= ? AND r.estado IN ('pendiente', 'confirmada') ORDER BY r.fecha, r.hora_inicio`,
    [desde]
  ).catch(() => []);
}

/** Lo que el sistema puede calcular para una liquidación de egreso (todo se puede corregir a mano). */
export async function datosParaLiquidacion(socioId: number): Promise<{ aportes: number; deuda: number }> {
  const movs = await cargarMovimientosCuenta(socioId);
  const pagos = movs.filter((m) => m.tipo === "pago" && m.estado !== "anulado").reduce((a, m) => a + Number(m.monto), 0);
  const { saldo } = calcularCuotasSocio(movs);
  return { aportes: Math.round(pagos * 100) / 100, deuda: Math.max(0, Math.round(saldo * 100) / 100) };
}

export function montoLiquidacion(aportes: number, porcentaje: number, deuda: number, otros: number): number {
  return Math.round((aportes * (porcentaje / 100) - deuda - otros) * 100) / 100;
}
