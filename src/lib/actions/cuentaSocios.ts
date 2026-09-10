"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { insert, get, audit } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { canEdit } from "@/lib/roles";
import { parseForm, zId, zTexto, zTextoOpcional, zMontoPositivo, zFecha, zEnumSeguro } from "@/lib/validation";

// Fase 10 del Plan Maestro — cuenta corriente por socio ("¿cuánto debo?").
// Se gatea por el permiso de Finanzas (no el de Socios): registrar un cargo
// o un pago es una operación financiera, con el mismo criterio que ya usa
// registrarMovimientoAction en finanzas.ts (administración lo hace de forma
// habitual, tesorería lo aprueba).

const registrarMovimientoCuentaSocioSchema = z.object({
  socio_id: zId,
  tipo: zEnumSeguro(["cargo", "pago"], "cargo"),
  concepto: zTexto(300),
  monto: zMontoPositivo(),
  fecha: zFecha,
  notas: zTextoOpcional(1000),
});

export async function registrarMovimientoCuentaSocioAction(formData: FormData) {
  const user = await requireUser();
  if (!canEdit(user.rol, "finanzas")) throw new Error("No autorizado");

  const { socio_id, tipo, concepto, monto, fecha, notas } = parseForm(registrarMovimientoCuentaSocioSchema, formData);

  const socio = await get<{ id: number }>(`SELECT id FROM socios WHERE id = ?`, [socio_id]);
  if (!socio) throw new Error("Socio no encontrado");

  const id = await insert("movimientos_cuenta_socio", {
    socio_id,
    tipo,
    concepto,
    monto: Math.abs(monto),
    fecha,
    notas,
    registrado_por_id: user.id,
  });
  await audit({
    usuario_id: user.id,
    accion: "registrar_movimiento_cuenta_socio",
    entidad: "movimientos_cuenta_socio",
    entidad_id: id,
    valor_nuevo: { socio_id, tipo, concepto, monto },
  });
  revalidatePath(`/socios/${socio_id}`);
  revalidatePath("/socios");
}
