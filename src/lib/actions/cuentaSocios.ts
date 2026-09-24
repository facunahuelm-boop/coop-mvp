"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { insert, update, all, get, audit, esColumnaInexistente } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { canEdit } from "@/lib/roles";
import {
  parseForm,
  zId,
  zTexto,
  zTextoOpcional,
  zMontoPositivo,
  zFecha,
  zFechaOpcional,
  zEnumSeguro,
} from "@/lib/validation";
import { conEstadoDeAccion, type ActionState } from "@/lib/actionState";
import { saveUploadedFile, TIPOS_DOCUMENTO } from "@/lib/upload";

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
  fecha_vencimiento: zFechaOpcional,
  notas: zTextoOpcional(1000),
});

export async function registrarMovimientoCuentaSocioAction(formData: FormData) {
  const user = await requireUser();
  if (!canEdit(user.rol, "finanzas")) throw new Error("No autorizado");

  const { socio_id, tipo, concepto, monto, fecha, fecha_vencimiento, notas } = parseForm(
    registrarMovimientoCuentaSocioSchema,
    formData
  );

  const socio = await get<{ id: number }>(`SELECT id FROM socios WHERE id = ?`, [socio_id]);
  if (!socio) throw new Error("Socio no encontrado");

  // Comprobante opcional (mismo patrón que gastos_comision.comprobante_url,
  // vía Supabase Storage — ver src/lib/upload.ts) — típicamente se adjunta
  // en un "pago", pero no hay ninguna razón técnica para prohibirlo en un
  // cargo (ej. una nota de débito recibida de un tercero).
  const comprobanteUrl = await saveUploadedFile(
    formData.get("comprobante") as File | null,
    user.organization_id,
    "cuotas",
    { tiposPermitidos: TIPOS_DOCUMENTO }
  );

  const id = await insert("movimientos_cuenta_socio", {
    socio_id,
    tipo,
    concepto,
    monto: Math.abs(monto),
    fecha,
    fecha_vencimiento: tipo === "cargo" ? fecha_vencimiento || null : null,
    comprobante_url: comprobanteUrl,
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
  revalidatePath("/finanzas");
  revalidatePath("/dashboard");
}

export async function registrarMovimientoCuentaSocioFormAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  return conEstadoDeAccion(() => registrarMovimientoCuentaSocioAction(formData));
}

const editarMovimientoCuentaSocioSchema = z.object({
  id: zId,
  tipo: zEnumSeguro(["cargo", "pago"], "cargo"),
  concepto: zTexto(300),
  monto: zMontoPositivo(),
  fecha: zFecha,
  fecha_vencimiento: zFechaOpcional,
  notas: zTextoOpcional(1000),
});

/**
 * Editar un movimiento ya cargado (pedido explícito: "que todos los
 * ingresos/cuotas se puedan editar y eliminar"). No se puede reasignar a
 * otro socio ni tocar el convenio de origen desde acá — mismo criterio ya
 * usado en editarSolicitudAction (Compras): editar corrige datos, no
 * reestructura vínculos ya creados por otra operación.
 */
export async function editarMovimientoCuentaSocioAction(formData: FormData) {
  const user = await requireUser();
  if (!canEdit(user.rol, "finanzas")) throw new Error("No autorizado");

  const { id, tipo, concepto, monto, fecha, fecha_vencimiento, notas } = parseForm(
    editarMovimientoCuentaSocioSchema,
    formData
  );

  const movimiento = await get<{ id: number; socio_id: number; comprobante_url: string | null; estado?: string }>(
    `SELECT id, socio_id, comprobante_url, estado FROM movimientos_cuenta_socio WHERE id = ?`,
    [id]
  ).catch(async (err) => {
    // Sub-fase 4.4 todavía no migrada en este entorno (columna `estado`
    // inexistente, 42703) — sin esa columna un movimiento nunca puede estar
    // anulado, así que se sigue exactamente igual que antes de esta sub-fase.
    if (!esColumnaInexistente(err)) throw err;
    return get<{ id: number; socio_id: number; comprobante_url: string | null; estado?: string }>(
      `SELECT id, socio_id, comprobante_url FROM movimientos_cuenta_socio WHERE id = ?`,
      [id]
    );
  });
  if (!movimiento) throw new Error("Ese movimiento ya no existe.");
  if (movimiento.estado === "anulado") {
    throw new Error("Este movimiento está anulado — no se puede editar. Registrá un movimiento nuevo si hace falta corregir el saldo.");
  }

  const nuevoComprobante = await saveUploadedFile(
    formData.get("comprobante") as File | null,
    user.organization_id,
    "cuotas",
    { tiposPermitidos: TIPOS_DOCUMENTO }
  );

  await update("movimientos_cuenta_socio", id, {
    tipo,
    concepto,
    monto: Math.abs(monto),
    fecha,
    fecha_vencimiento: tipo === "cargo" ? fecha_vencimiento || null : null,
    comprobante_url: nuevoComprobante || movimiento.comprobante_url,
    notas,
  });
  await audit({
    usuario_id: user.id,
    accion: "editar_movimiento_cuenta_socio",
    entidad: "movimientos_cuenta_socio",
    entidad_id: id,
    valor_nuevo: { tipo, concepto, monto },
  });
  revalidatePath(`/socios/${movimiento.socio_id}`);
  revalidatePath("/socios");
  revalidatePath("/finanzas");
  revalidatePath("/dashboard");
}

export async function editarMovimientoCuentaSocioFormAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  return conEstadoDeAccion(() => editarMovimientoCuentaSocioAction(formData));
}

const anularMovimientoCuentaSocioSchema = z.object({ id: zId, motivo: zTextoOpcional(500) });

/**
 * Sub-fase 4.4 (Eliminación segura de movimientos financieros): mismo
 * reemplazo de DELETE físico → baja lógica que anularMovimientoAction en
 * finanzas.ts (ver ese comentario para el detalle completo), aplicado acá al
 * libro de cuenta corriente por socio. Un cargo o pago anulado sigue
 * apareciendo en el historial de la ficha del socio (marcado) pero
 * calcularCuotasSocio (logic.ts) lo excluye del saldo — a diferencia de
 * movimientos_financieros, acá no hay ningún otro registro que dependa de
 * este (nada tiene una FK hacia movimientos_cuenta_socio), así que no hace
 * falta un chequeo de dependientes.
 */
export async function anularMovimientoCuentaSocioAction(formData: FormData) {
  const user = await requireUser();
  if (user.rol !== "admin") throw new Error("Solo un administrador del sistema puede anular un movimiento de la cuenta de un socio.");
  const { id, motivo } = parseForm(anularMovimientoCuentaSocioSchema, formData);

  // Ver el comentario equivalente en anularMovimientoAction (finanzas.ts):
  // toda esta operación depende de que `estado` exista, así que se chequea
  // ANTES de llamar a update() en vez de confiar en su fallback silencioso.
  let fila: { id: number; socio_id: number; estado: string } | undefined;
  try {
    fila = await get<{ id: number; socio_id: number; estado: string }>(
      `SELECT id, socio_id, estado FROM movimientos_cuenta_socio WHERE id = ?`,
      [id]
    );
  } catch (err) {
    if (!esColumnaInexistente(err)) throw err;
    throw new Error("Esta función todavía no está habilitada en este entorno: falta aplicar una actualización pendiente de la base de datos.");
  }
  if (!fila) {
    revalidatePath("/socios");
    return;
  }
  if (fila.estado === "anulado") return; // ya está anulado, no hay nada que hacer

  await update("movimientos_cuenta_socio", id, {
    estado: "anulado",
    anulado_en: new Date().toISOString(),
    anulado_por_id: user.id,
    motivo_anulacion: motivo || null,
  });
  await audit({
    usuario_id: user.id,
    accion: "anular_movimiento_cuenta_socio",
    entidad: "movimientos_cuenta_socio",
    entidad_id: id,
    valor_nuevo: { motivo },
  });
  revalidatePath(`/socios/${fila.socio_id}`);
  revalidatePath("/socios");
  revalidatePath("/finanzas");
  revalidatePath("/dashboard");
}

export async function anularMovimientoCuentaSocioFormAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  return conEstadoDeAccion(() => anularMovimientoCuentaSocioAction(formData));
}

const generarCuotaMensualSchema = z.object({
  concepto: zTexto(200),
  monto: zMontoPositivo(),
  mes: z.string().regex(/^\d{4}-\d{2}$/, "Elegí un mes válido."),
  dia_vencimiento: z.coerce.number().int().min(1, "Entre 1 y 28.").max(28, "Entre 1 y 28."),
});

/**
 * Generar la cuota del mes para todos los socios activos de una sola vez
 * (pedido explícito: "una tabla con todas las cuotas de todos los núcleos").
 *
 * Auditoría funcional Finanzas↔Socios (17/09) — la idempotencia original
 * comparaba el `concepto` como texto exacto, un campo que la persona
 * escribe a mano cada vez (el placeholder del formulario ni siquiera
 * sugiere un formato fijo: "Cuota setiembre 2026"). Eso tenía dos fallas
 * reales: (a) tipear el concepto un poco distinto al reintentar (may/mayo,
 * mayúscula/minúscula) generaba la cuota DOS VECES para todos los socios, y
 * (b) reusar el mismo texto en un mes distinto hacía que no se generara
 * NINGUNA cuota nueva, sin ningún aviso — el botón decía "Cuotas
 * generadas." igual, aunque `generadas` fuera 0. Se cambia la idempotencia
 * a lo que realmente identifica "la cuota de este mes" sin depender de lo
 * que la persona haya tipeado: un cargo mensual (no de convenio) cuyo
 * vencimiento cae en el mes elegido. Y si no se generó ninguna cuota nueva,
 * se avisa con un mensaje claro en vez de un "éxito" silencioso.
 */
export async function generarCuotaMensualAction(formData: FormData) {
  const user = await requireUser();
  if (!canEdit(user.rol, "finanzas")) throw new Error("No autorizado");
  const { concepto, monto, mes, dia_vencimiento } = parseForm(generarCuotaMensualSchema, formData);

  const socios = await all<{ id: number }>(`SELECT id FROM socios WHERE estado = 'activo'`);
  const fecha = `${mes}-01`;
  const diaTexto = String(dia_vencimiento).padStart(2, "0");
  const fechaVencimiento = `${mes}-${diaTexto}`;
  let generadas = 0;

  for (const s of socios) {
    const yaExiste = await get<{ id: number }>(
      `SELECT id FROM movimientos_cuenta_socio
       WHERE socio_id = ? AND tipo = 'cargo' AND convenio_id IS NULL
         AND to_char(fecha_vencimiento, 'YYYY-MM') = ?`,
      [s.id, mes]
    );
    if (yaExiste) continue;
    await insert("movimientos_cuenta_socio", {
      socio_id: s.id,
      tipo: "cargo",
      concepto,
      monto: Math.abs(monto),
      fecha,
      fecha_vencimiento: fechaVencimiento,
      registrado_por_id: user.id,
    });
    generadas++;
  }

  await audit({
    usuario_id: user.id,
    accion: "generar_cuota_mensual",
    entidad: "movimientos_cuenta_socio",
    entidad_id: 0,
    valor_nuevo: { concepto, monto, mes, generadas, totalSocios: socios.length },
  });

  if (generadas === 0) {
    throw new Error(
      `Ya existía una cuota de este mes (${mes}) para todos los socios activos — no se generó ninguna nueva.`
    );
  }

  revalidatePath("/finanzas");
  revalidatePath("/socios");
  revalidatePath("/dashboard");
}

export async function generarCuotaMensualFormAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  return conEstadoDeAccion(() => generarCuotaMensualAction(formData));
}
