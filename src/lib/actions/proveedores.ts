"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { insert, update, audit } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { canEdit } from "@/lib/roles";
import { parseForm, zId, zTexto, zTextoOpcional, zEmailOpcional, zEnumSeguro } from "@/lib/validation";
import { ESTADO_PROVEEDOR, TIPO_PROVEEDOR } from "@/lib/constants";

// Proveedores fijos vs. nuevos/a presupuestar (pedido explícito): ver
// migrations/0018_proveedores_extendido.sql para el detalle de las columnas
// nuevas. "contacto" (texto libre) se mantiene tal cual estaba para no
// romper proveedores ya cargados; los campos nuevos (telefono, email,
// direccion, persona_contacto) son más específicos y conviven con él.
// ESTADO_PROVEEDOR/TIPO_PROVEEDOR (y sus labels) viven en constants.ts: un
// archivo "use server" solo puede exportar funciones async, no un
// array/objeto.

const datosProveedorSchema = {
  rut: zTextoOpcional(30),
  telefono: zTextoOpcional(50),
  email: zEmailOpcional,
  direccion: zTextoOpcional(300),
  persona_contacto: zTextoOpcional(150),
  rubro: zTextoOpcional(150),
  tipo: zEnumSeguro(TIPO_PROVEEDOR, "empresa"),
  estado: zEnumSeguro(ESTADO_PROVEEDOR, "nuevo"),
  contacto: zTextoOpcional(200),
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
const crearProveedorSchema = z.object({ nombre: zTexto(200), ...datosProveedorSchema });

export async function crearProveedorAction(formData: FormData) {
  const user = await requireUser();
  if (!canEdit(user.rol, "compras")) throw new Error("No autorizado");
  const datos = parseForm(crearProveedorSchema, formData);
  const id = await insert("proveedores", { ...datos, creado_por_id: user.id });
  await audit({ usuario_id: user.id, accion: "crear", entidad: "proveedores", entidad_id: id, valor_nuevo: { nombre: datos.nombre, estado: datos.estado } });
  revalidatePath("/proveedores");
}

/** Edita los datos de un proveedor ya existente (ficha, Fase 08 + extensión). */
const actualizarProveedorSchema = z.object({ id: zId, ...datosProveedorSchema });

export async function actualizarProveedorAction(formData: FormData) {
  const user = await requireUser();
  if (!canEdit(user.rol, "compras")) throw new Error("No autorizado");
  const { id, ...datos } = parseForm(actualizarProveedorSchema, formData);
  await update("proveedores", id, datos);
  await audit({ usuario_id: user.id, accion: "editar", entidad: "proveedores", entidad_id: id, valor_nuevo: datos });
  revalidatePath(`/proveedores/${id}`);
  revalidatePath("/proveedores");
}

/** Cambiar solo el estado (ej: marcar como "habitual" después de varias
 * compras sin abrir el formulario completo de edición). */
const cambiarEstadoSchema = z.object({ id: zId, estado: zEnumSeguro(ESTADO_PROVEEDOR) });

export async function cambiarEstadoProveedorAction(formData: FormData) {
  const user = await requireUser();
  if (!canEdit(user.rol, "compras")) throw new Error("No autorizado");
  const { id, estado } = parseForm(cambiarEstadoSchema, formData);
  await update("proveedores", id, { estado });
  await audit({ usuario_id: user.id, accion: "cambiar_estado", entidad: "proveedores", entidad_id: id, valor_nuevo: { estado } });
  revalidatePath(`/proveedores/${id}`);
  revalidatePath("/proveedores");
}
