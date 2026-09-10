"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { insert, audit } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { canEdit } from "@/lib/roles";
import { saveUploadedFile, TIPOS_DOCUMENTO } from "@/lib/upload";
import { parseForm, zTexto, zTextoOpcional } from "@/lib/validation";

/**
 * Normaliza una lista de etiquetas escritas a mano ("obra, etapa 2 ,,urgente")
 * en un string prolijo separado por coma ("obra, etapa 2, urgente") o null
 * si no se cargó ninguna — mismo criterio simple que el resto del código
 * (texto plano, sin arrays ni JSON) para no introducir un tipo de dato nuevo
 * en la capa de datos.
 */
function normalizarEtiquetas(raw: FormDataEntryValue | null): string | null {
  const etiquetas = String(raw || "")
    .split(",")
    .map((e) => e.trim().slice(0, 60))
    .filter(Boolean)
    .slice(0, 30); // techo razonable de etiquetas por documento
  return etiquetas.length > 0 ? etiquetas.join(", ") : null;
}

// La categoría de un documento no es un enum fijo a propósito: cada
// cooperativa puede crear las suyas (crearCategoriaDocumentoAction, abajo),
// así que acá solo se valida que sea texto razonable, no una lista cerrada.
const subirDocumentoSchema = z.object({
  categoria: zTextoOpcional(100).transform((v) => v || "informes"),
  nombre: zTexto(200),
  descripcion: zTextoOpcional(1000),
});

export async function subirDocumentoAction(formData: FormData) {
  const user = await requireUser();
  if (!canEdit(user.rol, "documentos")) throw new Error("No autorizado");
  const datos = parseForm(subirDocumentoSchema, formData);
  const archivoUrl = await saveUploadedFile(formData.get("archivo") as File | null, user.organization_id, "documentos", {
    tiposPermitidos: TIPOS_DOCUMENTO,
    maxBytes: 20 * 1024 * 1024,
  });
  const id = await insert("documentos", {
    ...datos,
    etiquetas: normalizarEtiquetas(formData.get("etiquetas")),
    archivo_url: archivoUrl,
    subido_por_id: user.id,
  });
  await audit({ usuario_id: user.id, accion: "subir", entidad: "documentos", entidad_id: id });
  revalidatePath("/documentos");
}

/**
 * Fase 07 del Plan Maestro ("carpetas/etiquetas"): antes de esto, la lista de
 * categorías era fija en código (CATEGORIAS en documentos/page.tsx) y ninguna
 * cooperativa podía agregar la suya. Mismo patrón que crearComisionAction:
 * un nombre libre, sin aprobación ni configuración adicional.
 */
export async function crearCategoriaDocumentoAction(formData: FormData) {
  const user = await requireUser();
  if (!canEdit(user.rol, "documentos")) throw new Error("No autorizado");
  const { nombre } = parseForm(z.object({ nombre: zTexto(100) }), formData);
  const id = await insert("documento_categorias", { nombre, creado_por_id: user.id });
  await audit({ usuario_id: user.id, accion: "crear", entidad: "documento_categorias", entidad_id: id, valor_nuevo: { nombre } });
  revalidatePath("/documentos");
}
