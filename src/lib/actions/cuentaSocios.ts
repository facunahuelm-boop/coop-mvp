"use server";

import { revalidatePath } from "next/cache";
import { insert, get, audit } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { canEdit } from "@/lib/roles";

// Fase 10 del Plan Maestro — cuenta corriente por socio ("¿cuánto debo?").
// Se gatea por el permiso de Finanzas (no el de Socios): registrar un cargo
// o un pago es una operación financiera, con el mismo criterio que ya usa
// registrarMovimientoAction en finanzas.ts (administración lo hace de forma
// habitual, tesorería lo aprueba).

export async function registrarMovimientoCuentaSocioAction(formData: FormData) {
  const user = await requireUser();
  if (!canEdit(user.rol, "finanzas")) throw new Error("No autorizado");

  const socio_id = Number(formData.get("socio_id"));
  const tipo = String(formData.get("tipo") || "cargo"); // cargo | pago
  const concepto = String(formData.get("concepto") || "").trim();
  const monto = Number(formData.get("monto") || 0);
  const fecha = String(formData.get("fecha") || "");
  const notas = String(formData.get("notas") || "") || null;

  if (!socio_id || !concepto || !monto || !fecha) {
    throw new Error("Faltan datos obligatorios (concepto, monto y fecha)");
  }

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
