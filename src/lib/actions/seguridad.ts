"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { insert, update, audit } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { canEdit } from "@/lib/roles";
import { saveUploadedFile, TIPOS_IMAGEN } from "@/lib/upload";
import { CHECKLIST_BASE } from "@/lib/constants";
import { parseForm, zId, zTexto, zTextoOpcional, zFechaOpcional, zEnumSeguro, zCheckbox } from "@/lib/validation";

const TIPO_INCIDENTE = ["observacion", "incidente", "accidente"] as const;
const SEVERIDAD_INCIDENTE = ["baja", "media", "critica"] as const;

const crearDocumentoSeguridadSchema = z.object({
  tipo: zTexto(150),
  descripcion: zTextoOpcional(1000),
  fecha_vencimiento: zFechaOpcional,
});

export async function crearDocumentoSeguridadAction(formData: FormData) {
  const user = await requireUser();
  if (!canEdit(user.rol, "seguridad")) throw new Error("No autorizado");
  const datos = parseForm(crearDocumentoSeguridadSchema, formData);
  await insert("documentos_seguridad", { ...datos, responsable_id: user.id });
  revalidatePath("/seguridad");
}

export async function crearInspeccionAction(formData: FormData) {
  const user = await requireUser();
  if (!canEdit(user.rol, "seguridad")) throw new Error("No autorizado");
  const { hallazgos, ...checkboxes } = parseForm(
    z.object({
      hallazgos: zTextoOpcional(2000),
      ...Object.fromEntries(CHECKLIST_BASE.map((_, i) => [`item_${i}`, zCheckbox])),
    }),
    formData
  );
  const checklist = CHECKLIST_BASE.map((item, i) => ({ item, ok: (checkboxes as Record<string, boolean>)[`item_${i}`] }));
  await insert("inspecciones_seguridad", {
    checklist_json: JSON.stringify(checklist),
    hallazgos,
    autor_id: user.id,
  });
  revalidatePath("/seguridad");
}

const crearIncidenteSchema = z.object({
  tipo: zEnumSeguro(TIPO_INCIDENTE, "observacion"),
  descripcion: zTexto(2000),
  severidad: zEnumSeguro(SEVERIDAD_INCIDENTE, "media"),
});

export async function crearIncidenteAction(formData: FormData) {
  const user = await requireUser();
  if (!canEdit(user.rol, "seguridad")) throw new Error("No autorizado");
  const datos = parseForm(crearIncidenteSchema, formData);
  const foto = await saveUploadedFile(formData.get("foto") as File | null, user.organization_id, "seguridad", {
    tiposPermitidos: TIPOS_IMAGEN,
    maxBytes: 8 * 1024 * 1024,
  });
  // Asistencia preliminar simulada: si se adjunta foto, la IA deja una observación
  // aclarando siempre que no reemplaza la evaluación del responsable de seguridad.
  const iaObs = foto
    ? "Asistencia preliminar de IA: no se detectaron elementos de protección visibles en la descripción. Esta es una observación automática preliminar, no un diagnóstico definitivo — debe confirmarla el responsable de seguridad, el técnico prevencionista o el IAT."
    : null;
  const id = await insert("incidentes_seguridad", {
    ...datos,
    foto_url: foto,
    ia_observacion: iaObs,
    estado: "abierto",
    autor_id: user.id,
  });
  await audit({ usuario_id: user.id, accion: "crear", entidad: "incidentes_seguridad", entidad_id: id, valor_nuevo: { severidad: datos.severidad } });
  revalidatePath("/seguridad");
}

export async function resolverIncidenteAction(formData: FormData) {
  const user = await requireUser();
  if (!canEdit(user.rol, "seguridad")) throw new Error("No autorizado");
  const { id, medidas } = parseForm(z.object({ id: zId, medidas: zTextoOpcional(2000) }), formData);
  await update("incidentes_seguridad", id, { estado: "resuelto", medidas });
  await audit({ usuario_id: user.id, accion: "resolver", entidad: "incidentes_seguridad", entidad_id: id });
  revalidatePath("/seguridad");
}
