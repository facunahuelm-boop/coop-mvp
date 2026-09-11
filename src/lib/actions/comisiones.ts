"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { insert, update, get, audit } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { canEdit } from "@/lib/roles";
import { puedeGestionarComision, ERROR_SIN_PERMISO_COMISION } from "@/lib/comisionAuth";
import { parseForm, zId, zTexto, zTextoOpcional } from "@/lib/validation";

// AUDITORÍA INTEGRAL (hallazgo de seguridad, sección 17): estas cuatro
// acciones solo comprobaban canEdit(rol, "comisiones") — y en la matriz de
// roles (roles.ts), CUALQUIER rol de comisión (Obra, Trabajo, Compras,
// Seguridad) tiene "comisiones: edit". Eso significa que, tal como estaba,
// un integrante de la Comisión de Compras podía archivar la Tesorería, o
// sacar/agregar integrantes de una comisión que no es la suya — el mismo
// problema de fondo que ya se había identificado y corregido para Gastos y
// Compras (ver comisionAuth.ts), pero que acá había quedado sin la segunda
// capa de permiso por comisión puntual.
//
// Crear o archivar una comisión es una decisión estructural de toda la
// cooperativa (agrega/quita un órgano entero), así que queda reservada a los
// mismos roles de conducción/finanzas que ya tienen esa potestad en el resto
// del sistema (Admin, Consejo Directivo, Tesorería, Administración — ver
// puedeGestionarComision). Agregar o quitar un integrante puntual, en
// cambio, sigue permitido también para quien ya integra ESA comisión
// específica — no hace falta ser de conducción para gestionar tu propia
// comisión, solo para tocar una ajena.

function esOversightComisiones(rol: Parameters<typeof canEdit>[0]): boolean {
  return canEdit(rol, "finanzas");
}

const crearComisionSchema = z.object({ nombre: zTexto(200), descripcion: zTextoOpcional(1000) });

export async function crearComisionAction(formData: FormData) {
  const user = await requireUser();
  if (!esOversightComisiones(user.rol)) throw new Error("Crear una comisión nueva requiere un rol de conducción (Admin, Consejo Directivo, Tesorería o Administración).");
  const datos = parseForm(crearComisionSchema, formData);
  const id = await insert("comisiones", datos);
  await audit({ usuario_id: user.id, accion: "crear", entidad: "comisiones", entidad_id: id, valor_nuevo: { nombre: datos.nombre } });
  revalidatePath("/comisiones");
}

export async function archivarComisionAction(formData: FormData) {
  const user = await requireUser();
  if (!esOversightComisiones(user.rol)) throw new Error("Archivar una comisión requiere un rol de conducción (Admin, Consejo Directivo, Tesorería o Administración).");
  const { id } = parseForm(z.object({ id: zId }), formData);
  await update("comisiones", id, { activa: 0 });
  await audit({ usuario_id: user.id, accion: "archivar", entidad: "comisiones", entidad_id: id });
  revalidatePath("/comisiones");
}

const agregarMiembroSchema = z.object({
  comision_id: zId,
  user_id: zId,
  rol_en_comision: zTextoOpcional(100).transform((v) => v || "integrante"),
});

export async function agregarMiembroAction(formData: FormData) {
  const user = await requireUser();
  if (!canEdit(user.rol, "comisiones")) throw new Error("No autorizado");
  const { comision_id, user_id, rol_en_comision } = parseForm(agregarMiembroSchema, formData);
  if (!(await puedeGestionarComision(user, comision_id))) throw new Error(ERROR_SIN_PERMISO_COMISION);

  const yaEsta = await get<{ id: number }>(
    `SELECT id FROM comision_miembros WHERE comision_id = ? AND user_id = ? AND activo = 1`,
    [comision_id, user_id]
  );
  if (yaEsta) return; // ya integra la comisión, no duplicar

  const id = await insert("comision_miembros", { comision_id, user_id, rol_en_comision });
  await audit({ usuario_id: user.id, accion: "agregar_miembro", entidad: "comision_miembros", entidad_id: id, valor_nuevo: { comision_id, user_id, rol_en_comision } });
  revalidatePath("/comisiones");
}

export async function quitarMiembroAction(formData: FormData) {
  const user = await requireUser();
  if (!canEdit(user.rol, "comisiones")) throw new Error("No autorizado");
  const { id } = parseForm(z.object({ id: zId }), formData);
  const miembro = await get<{ comision_id: number }>(`SELECT comision_id FROM comision_miembros WHERE id = ?`, [id]);
  if (!miembro) return; // ya no existe, no hay nada que quitar
  if (!(await puedeGestionarComision(user, miembro.comision_id))) throw new Error(ERROR_SIN_PERMISO_COMISION);
  await update("comision_miembros", id, { activo: 0, hasta: new Date().toISOString() });
  await audit({ usuario_id: user.id, accion: "quitar_miembro", entidad: "comision_miembros", entidad_id: id });
  revalidatePath("/comisiones");
}
