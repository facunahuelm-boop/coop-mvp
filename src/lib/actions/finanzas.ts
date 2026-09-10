"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { insert, audit } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { canEdit } from "@/lib/roles";
import { parseForm, zTexto, zTextoOpcional, zMontoPositivo, zFecha, zEnumSeguro } from "@/lib/validation";

const registrarMovimientoSchema = z.object({
  tipo: zEnumSeguro(["ingreso", "egreso"], "egreso"),
  monto: zMontoPositivo(),
  categoria: zTexto(120),
  descripcion: zTextoOpcional(1000),
});

export async function registrarMovimientoAction(formData: FormData) {
  const user = await requireUser();
  if (!canEdit(user.rol, "finanzas")) throw new Error("No autorizado");
  const datos = parseForm(registrarMovimientoSchema, formData);
  const id = await insert("movimientos_financieros", {
    tipo: datos.tipo,
    monto: datos.monto,
    categoria: datos.categoria,
    etapa_obra: datos.categoria,
    descripcion: datos.descripcion,
    registrado_por_id: user.id,
  });
  await audit({ usuario_id: user.id, accion: "registrar_movimiento", entidad: "movimientos_financieros", entidad_id: id, valor_nuevo: datos });
  revalidatePath("/finanzas");
  revalidatePath("/dashboard");
}

const agregarCompromisoSchema = z.object({
  descripcion: zTexto(300),
  monto: zMontoPositivo(),
  fecha_estimada: zFecha,
  origen: zTextoOpcional(300),
});

export async function agregarCompromisoAction(formData: FormData) {
  const user = await requireUser();
  if (!canEdit(user.rol, "finanzas")) throw new Error("No autorizado");
  const datos = parseForm(agregarCompromisoSchema, formData);
  await insert("compromisos_futuros", datos);
  revalidatePath("/finanzas");
  revalidatePath("/dashboard");
}
