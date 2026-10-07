import { z } from "zod";
import { get, insert, update, audit } from "@/lib/db";
import type { SessionUser } from "@/lib/auth";
import { parseForm, zIdOpcional, zTextoOpcional, zMontoPositivo, zFechaOpcional, ValidationError } from "@/lib/validation";

/** Fase 2A — facturas de proveedores (no es una Server Action: la llaman acciones que ya validaron permisos). */
const facturaSchema = z.object({
  proveedor_id: zIdOpcional,
  nuevo_proveedor: zTextoOpcional(200),
  solicitud_compra_id: zIdOpcional,
  numero: zTextoOpcional(60),
  fecha_emision: zFechaOpcional,
  fecha_vencimiento: zFechaOpcional,
  monto: zMontoPositivo(),
  categoria: zTextoOpcional(120),
  descripcion: zTextoOpcional(300),
});

/**
 * Registra una factura a pagar (A16). Si viene de una compra aprobada, su
 * compromiso pasa a "facturado" (deja de contarse dos veces).
 */
export async function registrarFacturaInterna(user: SessionUser, formData: FormData, documentoId: number | null = null): Promise<number> {
  const d = parseForm(facturaSchema, formData);
  let proveedorId = d.proveedor_id;
  if (!proveedorId && d.nuevo_proveedor) {
    const existente = await get<{ id: number }>(`SELECT id FROM proveedores WHERE lower(trim(nombre)) = lower(trim(?)) LIMIT 1`, [d.nuevo_proveedor]);
    proveedorId = existente?.id ?? (await insert("proveedores", { nombre: d.nuevo_proveedor, estado: "nuevo", creado_por_id: user.id }));
  }
  let categoria = d.categoria;
  let compromisoId: number | null = null;
  if (d.solicitud_compra_id) {
    const sol = await get<{ id: number; categoria: string | null; material: string }>(`SELECT id, categoria, material FROM solicitudes_compra WHERE id = ?`, [d.solicitud_compra_id]);
    if (!sol) throw new ValidationError("solicitud_compra_id", "Esa compra no existe.");
    categoria = categoria || sol.categoria || null;
    const comp = await get<{ id: number; proveedor_id: number | null }>(
      `SELECT id, proveedor_id FROM compromisos_futuros WHERE solicitud_compra_id = ? AND estado = 'pendiente'`,
      [sol.id]
    ).catch(() => undefined);
    compromisoId = comp?.id ?? null;
    if (!proveedorId && comp?.proveedor_id) proveedorId = comp.proveedor_id;
  }
  if (d.fecha_emision && d.fecha_vencimiento && d.fecha_vencimiento < d.fecha_emision) {
    throw new ValidationError("fecha_vencimiento", "El vencimiento no puede ser antes de la fecha de la factura.");
  }
  const id = await insert("facturas_proveedor", {
    proveedor_id: proveedorId,
    solicitud_compra_id: d.solicitud_compra_id,
    compromiso_id: compromisoId,
    documento_id: documentoId,
    numero: d.numero,
    fecha_emision: d.fecha_emision,
    fecha_vencimiento: d.fecha_vencimiento,
    monto: d.monto,
    categoria: categoria || "Proveedores",
    descripcion: d.descripcion,
    registrado_por_id: user.id,
  });
  if (compromisoId) {
    await update("compromisos_futuros", compromisoId, { estado: "facturado", factura_id: id, cerrado_en: new Date().toISOString(), cerrado_por_id: user.id });
  }
  await audit({ usuario_id: user.id, accion: "registrar_factura", entidad: "facturas_proveedor", entidad_id: id, valor_nuevo: { ...d, proveedorId, compromisoId } });
  return id;
}

