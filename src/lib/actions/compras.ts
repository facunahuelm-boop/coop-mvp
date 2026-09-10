"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { insert, update, get, audit } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { canEdit, canApprove } from "@/lib/roles";
import { CATEGORIA_COMPRA_LABEL } from "@/lib/constants";
import {
  parseForm,
  zId,
  zTexto,
  zTextoOpcional,
  zMonto,
  zMontoOpcional,
  zEnteroOpcional,
  zNumeroOpcionalConDefault,
  zFechaOpcional,
  zEnumSeguro,
  clavesDe,
} from "@/lib/validation";

const PRIORIDAD_COMPRA = ["baja", "media", "alta", "critica"] as const;

const crearSolicitudSchema = z.object({
  comision: zTexto(200),
  categoria: zEnumSeguro(clavesDe(CATEGORIA_COMPRA_LABEL), "obra"),
  material: zTexto(300),
  cantidad: zNumeroOpcionalConDefault(0),
  unidad: zTexto(50),
  especificacion: zTextoOpcional(1000),
  prioridad: zEnumSeguro(PRIORIDAD_COMPRA, "media"),
  etapa_obra: zTextoOpcional(200),
  fecha_necesaria: zFechaOpcional,
  presupuesto_estimado: zMontoOpcional(),
});

export async function crearSolicitudAction(formData: FormData) {
  const user = await requireUser();
  if (!canEdit(user.rol, "compras")) throw new Error("No autorizado");
  const datos = parseForm(crearSolicitudSchema, formData);
  const id = await insert("solicitudes_compra", {
    solicitante_id: user.id,
    ...datos,
    estado: "pendiente_cotizacion",
  });
  await audit({ usuario_id: user.id, accion: "crear", entidad: "solicitudes_compra", entidad_id: id });
  revalidatePath("/compras");
}

const agregarPresupuestoSchema = z.object({
  solicitud_id: zId,
  precio: zMonto(),
  precio_unitario: zMontoOpcional(),
  plazo_entrega_dias: zEnteroOpcional(3650),
  forma_pago: zTextoOpcional(200),
  garantia: zTextoOpcional(300),
  costo_envio: zNumeroOpcionalConDefault(0),
  notas: zTextoOpcional(1000),
});

export async function agregarPresupuestoAction(formData: FormData) {
  const user = await requireUser();
  if (!canEdit(user.rol, "compras")) throw new Error("No autorizado");
  const { solicitud_id: solicitudId, ...datos } = parseForm(agregarPresupuestoSchema, formData);

  // proveedor_id / nuevo_proveedor tienen una lógica de "uno u otro" que no
  // encaja en un campo Zod simple: se elige un proveedor ya cargado, o se
  // escribe el nombre de uno nuevo y se crea acá mismo.
  let proveedorId = Number(formData.get("proveedor_id") || 0);
  const nuevoProveedor = String(formData.get("nuevo_proveedor") || "").trim().slice(0, 200);
  if (!proveedorId && nuevoProveedor) {
    proveedorId = await insert("proveedores", { nombre: nuevoProveedor });
  }
  if (!proveedorId) throw new Error("Falta elegir o crear un proveedor.");

  await insert("presupuestos_proveedor", { solicitud_id: solicitudId, proveedor_id: proveedorId, ...datos });
  await update("solicitudes_compra", solicitudId, { estado: "en_comparacion" });
  revalidatePath(`/compras/${solicitudId}`);
}

export async function decidirCompraAction(formData: FormData) {
  const user = await requireUser();
  if (!canApprove(user.rol, "compras")) throw new Error("No autorizado: esta decisión requiere un rol con permiso de aprobación (Tesorería o Consejo Directivo).");
  const { solicitud_id: solicitudId, presupuesto_id: presupuestoId, motivo } = parseForm(
    z.object({ solicitud_id: zId, presupuesto_id: zId, motivo: zTextoOpcional(1000) }),
    formData
  );
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

/**
 * Fase 08 del Plan Maestro ("estados más granulares"): antes de esto, una
 * solicitud aprobada pasaba directo a "entregada" con un solo botón, sin
 * forma de reflejar que ya se hizo el pedido/pago al proveedor pero todavía
 * no llegó — un estado intermedio real en cualquier compra de obra, donde
 * puede pasar más de una semana entre pedir y recibir. "pedida" cubre ese
 * tramo; se puede marcar como entregada igual directamente si llegó al
 * toque, para no trabar el caso simple.
 */
export async function marcarPedidaAction(formData: FormData) {
  const user = await requireUser();
  if (!canEdit(user.rol, "compras")) throw new Error("No autorizado");
  const { id } = parseForm(z.object({ id: zId }), formData);
  await update("solicitudes_compra", id, { estado: "pedida" });
  revalidatePath("/compras");
  revalidatePath(`/compras/${id}`);
}

export async function marcarEntregadaAction(formData: FormData) {
  const user = await requireUser();
  if (!canEdit(user.rol, "compras")) throw new Error("No autorizado");
  const { id } = parseForm(z.object({ id: zId }), formData);
  await update("solicitudes_compra", id, { estado: "entregada" });
  revalidatePath("/compras");
  revalidatePath(`/compras/${id}`);
}

/**
 * El estado "rechazada" ya estaba previsto en el esquema (columna estado,
 * comentario original en schema.postgres.sql) pero ninguna acción lo dejaba
 * elegir — una solicitud que ya no correspondía (cambió el plan de obra, se
 * consiguió donada, etc.) se quedaba pendiente para siempre o había que
 * "aprobarla" igual solo para sacarla de la lista. Mismo nivel de permiso
 * que aprobar (Tesorería / Consejo Directivo): rechazar una compra es la
 * otra cara de la misma decisión.
 */
export async function rechazarSolicitudAction(formData: FormData) {
  const user = await requireUser();
  if (!canApprove(user.rol, "compras")) throw new Error("No autorizado: esta decisión requiere un rol con permiso de aprobación (Tesorería o Consejo Directivo).");
  const { id, motivo } = parseForm(z.object({ id: zId, motivo: zTextoOpcional(1000) }), formData);
  await update("solicitudes_compra", id, { estado: "rechazada" });
  await audit({ usuario_id: user.id, accion: "rechazar_compra", entidad: "solicitudes_compra", entidad_id: id, valor_nuevo: { motivo } });
  revalidatePath("/compras");
  revalidatePath(`/compras/${id}`);
}
