"use server";

import { revalidatePath } from "next/cache";
import { insert, update, audit } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { canEdit } from "@/lib/roles";
import { saveUploadedFile } from "@/lib/upload";
import { CHECKLIST_BASE } from "@/lib/constants";

export async function crearDocumentoSeguridadAction(formData: FormData) {
  const user = await requireUser();
  if (!canEdit(user.rol, "seguridad")) throw new Error("No autorizado");
  await insert("documentos_seguridad", {
    tipo: String(formData.get("tipo") || ""),
    descripcion: String(formData.get("descripcion") || "") || null,
    fecha_vencimiento: String(formData.get("fecha_vencimiento") || "") || null,
    responsable_id: user.id,
  });
  revalidatePath("/seguridad");
}

export async function crearInspeccionAction(formData: FormData) {
  const user = await requireUser();
  if (!canEdit(user.rol, "seguridad")) throw new Error("No autorizado");
  const checklist = CHECKLIST_BASE.map((item, i) => ({ item, ok: formData.get(`item_${i}`) === "on" }));
  await insert("inspecciones_seguridad", {
    checklist_json: JSON.stringify(checklist),
    hallazgos: String(formData.get("hallazgos") || "") || null,
    autor_id: user.id,
  });
  revalidatePath("/seguridad");
}

export async function crearIncidenteAction(formData: FormData) {
  const user = await requireUser();
  if (!canEdit(user.rol, "seguridad")) throw new Error("No autorizado");
  const foto = await saveUploadedFile(formData.get("foto") as File | null);
  // Asistencia preliminar simulada: si se adjunta foto, la IA deja una observación
  // aclarando siempre que no reemplaza la evaluación del responsable de seguridad.
  const iaObs = foto
    ? "Asistencia preliminar de IA: no se detectaron elementos de protección visibles en la descripción. Esta es una observación automática preliminar, no un diagnóstico definitivo — debe confirmarla el responsable de seguridad, el técnico prevencionista o el IAT."
    : null;
  const id = await insert("incidentes_seguridad", {
    tipo: String(formData.get("tipo") || "observacion"),
    descripcion: String(formData.get("descripcion") || ""),
    severidad: String(formData.get("severidad") || "media"),
    foto_url: foto,
    ia_observacion: iaObs,
    estado: "abierto",
    autor_id: user.id,
  });
  await audit({ usuario_id: user.id, accion: "crear", entidad: "incidentes_seguridad", entidad_id: id, valor_nuevo: { severidad: formData.get("severidad") } });
  revalidatePath("/seguridad");
}

export async function resolverIncidenteAction(formData: FormData) {
  const user = await requireUser();
  if (!canEdit(user.rol, "seguridad")) throw new Error("No autorizado");
  const id = Number(formData.get("id"));
  await update("incidentes_seguridad", id, { estado: "resuelto", medidas: String(formData.get("medidas") || "") });
  await audit({ usuario_id: user.id, accion: "resolver", entidad: "incidentes_seguridad", entidad_id: id });
  revalidatePath("/seguridad");
}
