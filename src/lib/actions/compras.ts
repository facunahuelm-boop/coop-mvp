"use server";

import { revalidatePath } from "next/cache";
import { insert, update, get, audit } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { canEdit, canApprove } from "@/lib/roles";

export async function crearSolicitudAction(formData: FormData) {
  const user = await requireUser();
  if (!canEdit(user.rol, "compras")) throw new Error("No autorizado");
  const id = await insert("solicitudes_compra", {
    solicitante_id: user.id,
    comision: String(formData.get("comision") || ""),
    material: String(formData.get("material") || ""),
    cantidad: Number(formData.get("cantidad") || 0),
    unidad: String(formData.get("unidad") || ""),
    especificacion: String(formData.get("especificacion") || "") || null,
    prioridad: String(formData.get("prioridad") || "media"),
    etapa_obra: String(formData.get("etapa_obra") || "") || null,
    fecha_necesaria: String(formData.get("fecha_necesaria") || "") || null,
    presupuesto_estimado: Number(formData.get("presupuesto_estimado") || 0) || null,
    estado: "pendiente_cotizacion",
  });
  await audit({ usuario_id: user.id, accion: "crear", entidad: "solicitudes_compra", entidad_id: id });
  revalidatePath("/compras");
}

export async function agregarPresupuestoAction(formData: FormData) {
  const user = await requireUser();
  if (!canEdit(user.rol, "compras")) throw new Error("No autorizado");
  const solicitudId = Number(formData.get("solicitud_id"));

  let proveedorId = Number(formData.get("proveedor_id") || 0);
  const nuevoProveedor = String(formData.get("nuevo_proveedor") || "").trim();
  if (!proveedorId && nuevoProveedor) {
    proveedorId = await insert("proveedores", { nombre: nuevoProveedor });
  }
  if (!proveedorId) throw new Error("Falta elegir o crear un proveedor.");

  await insert("presupuestos_proveedor", {
    solicitud_id: solicitudId,
    proveedor_id: proveedorId,
    precio: Number(formData.get("precio") || 0),
    precio_unitario: Number(formData.get("precio_unitario") || 0) || null,
    plazo_entrega_dias: Number(formData.get("plazo_entrega_dias") || 0) || null,
    forma_pago: String(formData.get("forma_pago") || "") || null,
    garantia: String(formData.get("garantia") || "") || null,
    costo_envio: Number(formData.get("costo_envio") || 0) || 0,
    notas: String(formData.get("notas") || "") || null,
  });
  await update("solicitudes_compra", solicitudId, { estado: "en_comparacion" });
  revalidatePath(`/compras/${solicitudId}`);
}

export async function decidirCompraAction(formData: FormData) {
  const user = await requireUser();
  if (!canApprove(user.rol, "compras")) throw new Error("No autorizado: esta decisión requiere un rol con permiso de aprobación (Tesorería o Consejo Directivo).");
  const solicitudId = Number(formData.get("solicitud_id"));
  const presupuestoId = Number(formData.get("presupuesto_id"));
  const motivo = String(formData.get("motivo") || "");
  const presupuesto = await get<any>(`SELECT * FROM presupuestos_proveedor WHERE id = ?`, [presupuestoId]);

  await insert("decisiones_compra", {
    solicitud_id: solicitudId, presupuesto_id: presupuestoId, decidido_por_id: user.id,
    motivo, monto: presupuesto?.precio ?? null,
  });
  await update("solicitudes_compra", solicitudId, { estado: "aprobada" });
  await audit({ usuario_id: user.id, accion: "aprobar_compra", entidad: "solicitudes_compra", entidad_id: solicitudId, valor_nuevo: { presupuestoId, motivo, monto: presupuesto?.precio } });
  revalidatePath(`/compras/${solicitudId}`);
  revalidatePath("/compras");
}

export async function marcarEntregadaAction(formData: FormData) {
  const user = await requireUser();
  if (!canEdit(user.rol, "compras")) throw new Error("No autorizado");
  const id = Number(formData.get("id"));
  await update("solicitudes_compra", id, { estado: "entregada" });
  revalidatePath("/compras");
  revalidatePath(`/compras/${id}`);
}
