"use server";

import { revalidatePath } from "next/cache";
import { insert, update, audit } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { canEdit, canApprove } from "@/lib/roles";
import { saveUploadedFile } from "@/lib/upload";

/**
 * Reportar un problema. A diferencia del resto de las acciones de este
 * módulo, acá alcanza con canEdit("reclamos") — que, para "socio", es
 * justamente lo que permite reportar sin depender de ninguna comisión (ver
 * comentario sobre el rol "socio" en src/lib/roles.ts).
 */
export async function crearReclamoAction(formData: FormData) {
  const user = await requireUser();
  if (!canEdit(user.rol, "reclamos")) throw new Error("No autorizado");

  const foto = await saveUploadedFile(formData.get("foto") as File | null, user.organization_id, "reclamos");
  const viviendaId = String(formData.get("vivienda_id") || "");

  const id = await insert("reclamos", {
    vivienda_id: viviendaId ? Number(viviendaId) : null,
    categoria: String(formData.get("categoria") || "otros"),
    titulo: String(formData.get("titulo") || ""),
    descripcion: String(formData.get("descripcion") || "") || null,
    prioridad: String(formData.get("prioridad") || "media"),
    foto_url: foto,
    estado: "abierto",
    reportado_por_id: user.id,
  });
  await audit({ usuario_id: user.id, accion: "crear", entidad: "reclamos", entidad_id: id, valor_nuevo: { titulo: formData.get("titulo") } });
  revalidatePath("/reclamos");
  revalidatePath("/dashboard");
}

/** Tomar un reclamo: alguien de mantenimiento/seguridad/técnico lo pasa a "en proceso" y se asigna. */
export async function tomarReclamoAction(formData: FormData) {
  const user = await requireUser();
  if (!canEdit(user.rol, "reclamos")) throw new Error("No autorizado");
  const id = Number(formData.get("id"));
  await update("reclamos", id, { estado: "en_proceso", responsable_id: user.id });
  await audit({ usuario_id: user.id, accion: "tomar", entidad: "reclamos", entidad_id: id });
  revalidatePath("/reclamos");
  revalidatePath("/dashboard");
}

/** Resolver un reclamo, con qué se hizo para solucionarlo. */
export async function resolverReclamoAction(formData: FormData) {
  const user = await requireUser();
  if (!canEdit(user.rol, "reclamos")) throw new Error("No autorizado");
  const id = Number(formData.get("id"));
  await update("reclamos", id, {
    estado: "resuelto",
    resolucion: String(formData.get("resolucion") || ""),
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
  const id = Number(formData.get("id"));
  await update("reclamos", id, { estado: "en_proceso", resuelto_en: null });
  await audit({ usuario_id: user.id, accion: "reabrir", entidad: "reclamos", entidad_id: id });
  revalidatePath("/reclamos");
  revalidatePath("/dashboard");
}
