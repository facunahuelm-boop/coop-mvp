"use server";

import { revalidatePath } from "next/cache";
import { insert, audit } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { canEdit } from "@/lib/roles";

export async function registrarMovimientoAction(formData: FormData) {
  const user = await requireUser();
  if (!canEdit(user.rol, "finanzas")) throw new Error("No autorizado");
  const id = await insert("movimientos_financieros", {
    tipo: String(formData.get("tipo") || "egreso"),
    monto: Number(formData.get("monto") || 0),
    categoria: String(formData.get("categoria") || ""),
    etapa_obra: String(formData.get("categoria") || ""),
    descripcion: String(formData.get("descripcion") || "") || null,
    registrado_por_id: user.id,
  });
  await audit({ usuario_id: user.id, accion: "registrar_movimiento", entidad: "movimientos_financieros", entidad_id: id, valor_nuevo: Object.fromEntries(formData) });
  revalidatePath("/finanzas");
  revalidatePath("/dashboard");
}

export async function agregarCompromisoAction(formData: FormData) {
  const user = await requireUser();
  if (!canEdit(user.rol, "finanzas")) throw new Error("No autorizado");
  await insert("compromisos_futuros", {
    descripcion: String(formData.get("descripcion") || ""),
    monto: Number(formData.get("monto") || 0),
    fecha_estimada: String(formData.get("fecha_estimada") || ""),
    origen: String(formData.get("origen") || "") || null,
  });
  revalidatePath("/finanzas");
  revalidatePath("/dashboard");
}
