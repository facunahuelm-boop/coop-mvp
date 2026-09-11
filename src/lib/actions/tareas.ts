"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { insert, update, get, audit } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { canEdit } from "@/lib/roles";
import { puedeGestionarComision, ERROR_SIN_PERMISO_COMISION } from "@/lib/comisionAuth";
import { parseForm, zId, zIdOpcional, zTexto, zTextoOpcional, zFechaOpcional, zEnumSeguro } from "@/lib/validation";

// Fase 06 del Plan Maestro — tareas genéricas por comisión (no solo Obra o
// Trabajo). El comentario original decía "quien puede editar la comisión
// puede cargarle tareas a SUS PROPIAS comisiones" pero el código solo
// comprobaba el permiso de módulo (canEdit(rol, "comisiones")), que en
// roles.ts es "edit" para CUALQUIER rol de comisión — en los hechos, un
// integrante de la Comisión de Compras podía cargarle o cambiarle el estado
// a una tarea de la Tesorería. Auditoría integral (sección 17): se agrega la
// misma segunda capa por comisión puntual que ya usa Gastos/Compras.

const crearTareaSchema = z.object({
  comision_id: zId,
  titulo: zTexto(200),
  descripcion: zTextoOpcional(2000),
  responsable_id: zIdOpcional,
  prioridad: zEnumSeguro(["alta", "media", "baja"], "media"),
  fecha_vencimiento: zFechaOpcional,
});

export async function crearTareaAction(formData: FormData) {
  const user = await requireUser();
  if (!canEdit(user.rol, "comisiones")) throw new Error("No autorizado");
  const datos = parseForm(crearTareaSchema, formData);
  if (!(await puedeGestionarComision(user, datos.comision_id))) throw new Error(ERROR_SIN_PERMISO_COMISION);

  const id = await insert("tareas", { ...datos, creado_por_id: user.id });
  await audit({
    usuario_id: user.id,
    accion: "crear",
    entidad: "tareas",
    entidad_id: id,
    valor_nuevo: { comision_id: datos.comision_id, titulo: datos.titulo, prioridad: datos.prioridad },
  });
  revalidatePath("/comisiones");
}

export async function cambiarEstadoTareaAction(formData: FormData) {
  const user = await requireUser();
  if (!canEdit(user.rol, "comisiones")) throw new Error("No autorizado");
  const { id, estado } = parseForm(z.object({ id: zId, estado: zEnumSeguro(["pendiente", "en_curso", "completada"], "pendiente") }), formData);
  const tarea = await get<{ comision_id: number }>(`SELECT comision_id FROM tareas WHERE id = ?`, [id]);
  if (!tarea) throw new Error("Esa tarea ya no existe.");
  if (!(await puedeGestionarComision(user, tarea.comision_id))) throw new Error(ERROR_SIN_PERMISO_COMISION);
  await update("tareas", id, { estado });
  await audit({ usuario_id: user.id, accion: "cambiar_estado", entidad: "tareas", entidad_id: id, valor_nuevo: { estado } });
  revalidatePath("/comisiones");
}
