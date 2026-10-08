import { all, get } from "@/lib/db";
import { canEdit } from "@/lib/roles";
import type { SessionUser } from "@/lib/auth";

/**
 * Fase 3C — recepción de materiales, pañol y diario de obra.
 */

async function integraComision(user: SessionUser, funciones: string[]): Promise<boolean> {
  const f = await get<{ id: number }>(
    `SELECT cm.id FROM comision_miembros cm JOIN comisiones c ON c.id = cm.comision_id
      WHERE cm.user_id = ? AND cm.activo = 1 AND c.activa = 1 AND c.funcion = ANY(?::text[]) LIMIT 1`,
    [user.id, funciones]
  ).catch(() => undefined);
  return !!f;
}

/** Diario de obra: quien edita Obra o integra la Comisión de Obra. */
export async function puedeEscribirDiario(user: SessionUser): Promise<boolean> {
  return canEdit(user.rol, "obra") || (await integraComision(user, ["obra"]));
}

/** Pañol: Obra, Trabajo o quien integra las comisiones de Obra, Trabajo o Compras. */
export async function puedeUsarPanol(user: SessionUser): Promise<boolean> {
  return canEdit(user.rol, "obra") || canEdit(user.rol, "trabajo") || (await integraComision(user, ["obra", "trabajo", "compras"]));
}

/** Recepción de materiales: quien gestiona compras, Obra, o integra Compras/Obra. */
export async function puedeRecibirMateriales(user: SessionUser): Promise<boolean> {
  return canEdit(user.rol, "compras") || canEdit(user.rol, "obra") || (await integraComision(user, ["compras", "obra"]));
}

export const ERROR_SIN_PERMISO_PANOL = "No tenés permiso para usar el pañol — lo manejan las comisiones de Obra, Trabajo y Compras y la conducción.";
export const ERROR_SIN_PERMISO_DIARIO = "No tenés permiso para escribir el diario de obra — lo hacen la Comisión de Obra, el técnico y la conducción.";
export const ERROR_SIN_PERMISO_RECEPCION = "No tenés permiso para registrar recepciones — lo hacen las comisiones de Compras y Obra y la conducción.";

export type ItemPanol = {
  id: number;
  nombre: string;
  tipo: "herramienta" | "material";
  unidad: string;
  stock_minimo: number;
  ubicacion: string | null;
  /** Lo que hay en el pañol ahora (sin lo prestado). */
  stock: number;
  prestado: number;
};

/** Stock = entradas + ajustes − salidas − préstamos sin devolver (sin los movimientos anulados). */
export async function itemsPanol(incluirInactivos = false): Promise<ItemPanol[]> {
  const filas = await all<{ id: number; nombre: string; tipo: "herramienta" | "material"; unidad: string; stock_minimo: number; ubicacion: string | null; stock: string | null; prestado: string | null }>(
    `SELECT i.id, i.nombre, i.tipo, i.unidad, i.stock_minimo, i.ubicacion,
            COALESCE(SUM(CASE WHEN m.tipo IN ('entrada', 'ajuste') THEN m.cantidad
                              WHEN m.tipo = 'salida' THEN -m.cantidad
                              WHEN m.tipo = 'prestamo' AND m.devuelto_en IS NULL THEN -m.cantidad
                              ELSE 0 END), 0) AS stock,
            COALESCE(SUM(CASE WHEN m.tipo = 'prestamo' AND m.devuelto_en IS NULL THEN m.cantidad ELSE 0 END), 0) AS prestado
       FROM panol_items i LEFT JOIN panol_movimientos m ON m.item_id = i.id AND m.anulado_en IS NULL
      ${incluirInactivos ? "" : "WHERE i.activo = 1"}
      GROUP BY i.id ORDER BY i.tipo, i.nombre`
  ).catch(() => []);
  return filas.map((f) => ({ ...f, stock_minimo: Number(f.stock_minimo), stock: Math.round(Number(f.stock) * 100) / 100, prestado: Math.round(Number(f.prestado) * 100) / 100 }));
}

export const bajoMinimo = (i: ItemPanol) => i.stock_minimo > 0 && i.stock <= i.stock_minimo;

export const CLIMAS = ["Soleado", "Nublado", "Lluvia", "Viento fuerte", "Frío", "Calor"] as const;

export const numeroTexto = (n: number) => n.toLocaleString("es-UY", { maximumFractionDigits: 2 });
