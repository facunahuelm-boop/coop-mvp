"use server";

import { revalidatePath } from "next/cache";
import { insert, audit } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { canEdit } from "@/lib/roles";
import { saveUploadedFile } from "@/lib/upload";

export async function subirDocumentoAction(formData: FormData) {
  const user = await requireUser();
  if (!canEdit(user.rol, "documentos")) throw new Error("No autorizado");
  const archivoUrl = await saveUploadedFile(formData.get("archivo") as File | null);
  const id = await insert("documentos", {
    categoria: String(formData.get("categoria") || "informes"),
    nombre: String(formData.get("nombre") || ""),
    descripcion: String(formData.get("descripcion") || "") || null,
    archivo_url: archivoUrl,
    subido_por_id: user.id,
  });
  await audit({ usuario_id: user.id, accion: "subir", entidad: "documentos", entidad_id: id });
  revalidatePath("/documentos");
}
