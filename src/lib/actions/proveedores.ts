"use server";

import { revalidatePath } from "next/cache";
import { insert, update, audit } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { canEdit } from "@/lib/roles";

/**
 * Fase 08 del Plan Maestro ("ficha de Proveedores independiente"): hasta acá
 * un proveedor solo podía crearse "al vuelo" con solo un nombre, dentro del
 * formulario de cargar presupuesto en una solicitud de compra
 * (agregarPresupuestoAction, en actions/compras.ts) — contacto, rubro y
 * notas quedaban siempre vacíos porque no había ninguna pantalla para
 * cargarlos. Esta acción permite dar de alta un proveedor completo desde su
 * propia pantalla (/proveedores), sin necesidad de pasar por una solicitud
 * de compra primero.
 */
export async function crearProveedorAction(formData: FormData) {
  const user = await requireUser();
  if (!canEdit(user.rol, "compras")) throw new Error("No autorizado");
  const nombre = String(formData.get("nombre") || "").trim();
  if (!nombre) throw new Error("Falta el nombre del proveedor");
  const id = await insert("proveedores", {
    nombre,
    contacto: String(formData.get("contacto") || "").trim() || null,
    rubro: String(formData.get("rubro") || "").trim() || null,
    notas: String(formData.get("notas") || "").trim() || null,
  });
  await audit({ usuario_id: user.id, accion: "crear", entidad: "proveedores", entidad_id: id, valor_nuevo: { nombre } });
  revalidatePath("/proveedores");
}

/** Edita los datos de contacto de un proveedor ya existente (ficha, Fase 08). */
export async function actualizarProveedorAction(formData: FormData) {
  const user = await requireUser();
  if (!canEdit(user.rol, "compras")) throw new Error("No autorizado");
  const id = Number(formData.get("id"));
  const datos = {
    contacto: String(formData.get("contacto") || "").trim() || null,
    rubro: String(formData.get("rubro") || "").trim() || null,
    notas: String(formData.get("notas") || "").trim() || null,
  };
  await update("proveedores", id, datos);
  await audit({ usuario_id: user.id, accion: "editar", entidad: "proveedores", entidad_id: id, valor_nuevo: datos });
  revalidatePath(`/proveedores/${id}`);
  revalidatePath("/proveedores");
}
