"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { insert, update, audit } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { canEdit } from "@/lib/roles";
import { saveUploadedFile, TIPOS_IMAGEN } from "@/lib/upload";
import { parseForm, zId, zIdOpcional, zTexto, zTextoOpcional, zFechaOpcional, zEnumSeguro } from "@/lib/validation";

const PRIORIDAD_TAREA_OBRA = ["baja", "media", "alta", "critica"] as const;
const ESTADOS_TAREA_OBRA = ["pendiente", "en_curso", "completada"] as const;
const SEVERIDAD_PROBLEMA = ["baja", "media", "critica"] as const;

const crearTareaSchema = z.object({
  etapa: zTexto(100),
  nombre: zTexto(200),
  descripcion: zTextoOpcional(2000),
  fecha_inicio: zFechaOpcional,
  fecha_fin_prevista: zFechaOpcional,
  prioridad: zEnumSeguro(PRIORIDAD_TAREA_OBRA, "media"),
});

export async function crearTareaAction(formData: FormData) {
  const user = await requireUser();
  if (!canEdit(user.rol, "obra")) throw new Error("No autorizado");
  const datos = parseForm(crearTareaSchema, formData);

  const id = await insert("tareas_obra", { ...datos, responsable_id: user.id, estado: "pendiente" });
  await audit({ usuario_id: user.id, accion: "crear", entidad: "tareas_obra", entidad_id: id, valor_nuevo: { nombre: datos.nombre } });
  revalidatePath("/obra");
}

export async function cambiarEstadoTareaAction(formData: FormData) {
  const user = await requireUser();
  if (!canEdit(user.rol, "obra")) throw new Error("No autorizado");
  const { id, estado } = parseForm(z.object({ id: zId, estado: zEnumSeguro(ESTADOS_TAREA_OBRA) }), formData);
  await update("tareas_obra", id, { estado });
  await audit({ usuario_id: user.id, accion: "actualizar_estado", entidad: "tareas_obra", entidad_id: id, valor_nuevo: { estado } });
  revalidatePath("/obra");
  revalidatePath(`/obra/${id}`);
}

export async function agregarAvanceAction(formData: FormData) {
  const user = await requireUser();
  if (!canEdit(user.rol, "obra")) throw new Error("No autorizado");
  const { tarea_id: tareaId, descripcion } = parseForm(z.object({ tarea_id: zId, descripcion: zTexto(2000) }), formData);
  const fotoUrl = await saveUploadedFile(formData.get("foto") as File | null, user.organization_id, "obra", {
    tiposPermitidos: TIPOS_IMAGEN,
    maxBytes: 8 * 1024 * 1024,
  });
  await insert("avances_obra", {
    tarea_id: tareaId,
    autor_id: user.id,
    descripcion,
    foto_url: fotoUrl,
  });
  revalidatePath(`/obra/${tareaId}`);
}

const agregarProblemaSchema = z.object({
  tarea_id: zIdOpcional,
  titulo: zTexto(200),
  descripcion: zTextoOpcional(2000),
  severidad: zEnumSeguro(SEVERIDAD_PROBLEMA, "media"),
});

export async function agregarProblemaAction(formData: FormData) {
  const user = await requireUser();
  if (!canEdit(user.rol, "obra")) throw new Error("No autorizado");
  const { tarea_id: tareaId, ...datos } = parseForm(agregarProblemaSchema, formData);
  const id = await insert("problemas_obra", { tarea_id: tareaId, ...datos, autor_id: user.id, estado: "abierto" });
  await audit({ usuario_id: user.id, accion: "crear", entidad: "problemas_obra", entidad_id: id });
  if (tareaId) revalidatePath(`/obra/${tareaId}`);
  revalidatePath("/obra");
}

export async function resolverProblemaAction(formData: FormData) {
  const user = await requireUser();
  if (!canEdit(user.rol, "obra")) throw new Error("No autorizado");
  const { id, tarea_id: tareaId, resolucion } = parseForm(
    z.object({ id: zId, tarea_id: zIdOpcional, resolucion: zTextoOpcional(2000) }),
    formData
  );
  await update("problemas_obra", id, { estado: "resuelto", resolucion });
  await audit({ usuario_id: user.id, accion: "resolver", entidad: "problemas_obra", entidad_id: id });
  if (tareaId) revalidatePath(`/obra/${tareaId}`);
  revalidatePath("/obra");
}
