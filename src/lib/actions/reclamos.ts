"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { insert, update, audit } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { canEdit, canApprove } from "@/lib/roles";
import { saveUploadedFile, TIPOS_IMAGEN } from "@/lib/upload";
import { CATEGORIA_RECLAMO_LABEL, PRIORIDAD_RECLAMO_LABEL } from "@/lib/constants";
import { parseForm, zId, zIdOpcional, zTexto, zTextoOpcional, zEnumSeguro, clavesDe } from "@/lib/validation";

const crearReclamoSchema = z.object({
  vivienda_id: zIdOpcional,
  categoria: zEnumSeguro(clavesDe(CATEGORIA_RECLAMO_LABEL), "otros"),
  titulo: zTexto(150),
  descripcion: zTextoOpcional(2000),
  prioridad: zEnumSeguro(clavesDe(PRIORIDAD_RECLAMO_LABEL), "media"),
});

/**
 * Reportar un problema. A diferencia del resto de las acciones de este
 * módulo, acá alcanza con canEdit("reclamos") — que, para "socio", es
 * justamente lo que permite reportar sin depender de ninguna comisión (ver
 * comentario sobre el rol "socio" en src/lib/roles.ts).
 */
export async function crearReclamoAction(formData: FormData) {
  const user = await requireUser();
  if (!canEdit(user.rol, "reclamos")) throw new Error("No autorizado");
  const datos = parseForm(crearReclamoSchema, formData);

  const foto = await saveUploadedFile(formData.get("foto") as File | null, user.organization_id, "reclamos", {
    tiposPermitidos: TIPOS_IMAGEN,
    maxBytes: 8 * 1024 * 1024,
  });

  const id = await insert("reclamos", {
    vivienda_id: datos.vivienda_id,
    categoria: datos.categoria,
    titulo: datos.titulo,
    descripcion: datos.descripcion,
    prioridad: datos.prioridad,
    foto_url: foto,
    estado: "abierto",
    reportado_por_id: user.id,
  });
  await audit({ usuario_id: user.id, accion: "crear", entidad: "reclamos", entidad_id: id, valor_nuevo: { titulo: datos.titulo } });
  revalidatePath("/reclamos");
  revalidatePath("/dashboard");
}

/** Tomar un reclamo: alguien de mantenimiento/seguridad/técnico lo pasa a "en proceso" y se asigna. */
export async function tomarReclamoAction(formData: FormData) {
  const user = await requireUser();
  if (!canEdit(user.rol, "reclamos")) throw new Error("No autorizado");
  const { id } = parseForm(z.object({ id: zId }), formData);
  await update("reclamos", id, { estado: "en_proceso", responsable_id: user.id });
  await audit({ usuario_id: user.id, accion: "tomar", entidad: "reclamos", entidad_id: id });
  revalidatePath("/reclamos");
  revalidatePath("/dashboard");
}

/** Resolver un reclamo, con qué se hizo para solucionarlo. */
export async function resolverReclamoAction(formData: FormData) {
  const user = await requireUser();
  if (!canEdit(user.rol, "reclamos")) throw new Error("No autorizado");
  const { id, resolucion } = parseForm(z.object({ id: zId, resolucion: zTextoOpcional(2000) }), formData);
  await update("reclamos", id, {
    estado: "resuelto",
    resolucion,
    resuelto_en: new Date().toISOString(),
  });
  await audit({ usuario_id: user.id, accion: "resolver", entidad: "reclamos", entidad_id: id });
  revalidatePath("/reclamos");
  revalidatePath("/dashboard");
}

/** Reabrir un reclamo que se había marcado resuelto — consejo directivo aprueba/cierra con más alcance. */
export async function reabrirReclamoAction(formData: FormData) {
  const user = await requireUser();
  if (!canApprove(user.rol, "reclamos")) throw new Error("No autorizado");
  const { id } = parseForm(z.object({ id: zId }), formData);
  await update("reclamos", id, { estado: "en_proceso", resuelto_en: null });
  await audit({ usuario_id: user.id, accion: "reabrir", entidad: "reclamos", entidad_id: id });
  revalidatePath("/reclamos");
  revalidatePath("/dashboard");
}
