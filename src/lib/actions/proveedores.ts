"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { insert, update, audit } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { canEdit } from "@/lib/roles";
import { parseForm, zId, zTexto, zTextoOpcional } from "@/lib/validation";

const contactoSchema = {
  contacto: zTextoOpcional(200),
  rubro: zTextoOpcional(150),
  notas: zTextoOpcional(1000),
};

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
const crearProveedorSchema = z.object({ nombre: zTexto(200), ...contactoSchema });

export async function crearProveedorAction(formData: FormData) {
  const user = await requireUser();
  if (!canEdit(user.rol, "compras")) throw new Error("No autorizado");
  const datos = parseForm(crearProveedorSchema, formData);
  const id = await insert("proveedores", datos);
  await audit({ usuario_id: user.id, accion: "crear", entidad: "proveedores", entidad_id: id, valor_nuevo: { nombre: datos.nombre } });
  revalidatePath("/proveedores");
}

/** Edita los datos de contacto de un proveedor ya existente (ficha, Fase 08). */
const actualizarProveedorSchema = z.object({ id: zId, ...contactoSchema });

export async function actualizarProveedorAction(formData: FormData) {
  const user = await requireUser();
  if (!canEdit(user.rol, "compras")) throw new Error("No autorizado");
  const { id, ...datos } = parseForm(actualizarProveedorSchema, formData);
  await update("proveedores", id, datos);
  await audit({ usuario_id: user.id, accion: "editar", entidad: "proveedores", entidad_id: id, valor_nuevo: datos });
  revalidatePath(`/proveedores/${id}`);
  revalidatePath("/proveedores");
}
