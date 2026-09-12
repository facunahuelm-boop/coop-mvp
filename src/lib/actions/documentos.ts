"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { insert, get, run, audit } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { canEdit } from "@/lib/roles";
import { saveUploadedFile, TIPOS_DOCUMENTO } from "@/lib/upload";
import { parseForm, zId, zTexto, zTextoOpcional } from "@/lib/validation";

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

/**
 * AUDITORÍA INTEGRAL (testing E2E real, 12/09): no había ninguna forma de
 * borrar un documento cargado por error o de prueba (mismo hallazgo que en
 * Proveedores y, antes, en Compras) — mismo patrón: solo admin, escribir
 * "ELIMINAR" para confirmar. actas.documento_id referencia documentos(id)
 * (nullable, pero la base igual rechaza el borrado si algo la referencia):
 * si el documento es el PDF de un acta ya registrada, no se borra — se avisa
 * para no dejar un acta con un link roto.
 */
const eliminarDocumentoSchema = z.object({ id: zId, confirmacion: zTexto(50) });

export async function eliminarDocumentoAction(formData: FormData) {
  const user = await requireUser();
  if (user.rol !== "admin") throw new Error("Solo un administrador del sistema puede eliminar un documento.");
  const { id, confirmacion } = parseForm(eliminarDocumentoSchema, formData);
  if (confirmacion.trim().toUpperCase() !== "ELIMINAR") {
    throw new Error('Para eliminar, escribí exactamente "ELIMINAR" en el campo de confirmación.');
  }
  const documento = await get<any>(`SELECT * FROM documentos WHERE id = ?`, [id]);
  if (!documento) {
    revalidatePath("/documentos");
    return; // ya no existe: nada que borrar
  }
  const enUso = await get<any>(`SELECT id FROM actas WHERE documento_id = ? LIMIT 1`, [id]);
  if (enUso) {
    throw new Error("Este documento es el archivo de un acta ya registrada: no se puede eliminar sin dejar esa acta sin archivo. Subí un documento nuevo para reemplazarlo en su lugar.");
  }
  try {
    await run(`DELETE FROM documentos WHERE id = ?`, [id]);
  } catch (err: any) {
    await audit({
      usuario_id: user.id,
      accion: "error_eliminar",
      entidad: "documentos",
      entidad_id: Number(id),
      valor_nuevo: { code: err?.code ?? null, message: String(err?.message ?? err) },
    }).catch(() => {});
    throw err;
  }
  await audit({ usuario_id: user.id, accion: "eliminar", entidad: "documentos", entidad_id: Number(id), valor_anterior: documento });
  revalidatePath("/documentos");
}
