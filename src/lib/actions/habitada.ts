"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { insert, update, get, audit } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { canEdit, canApprove } from "@/lib/roles";
import { hoyEnUruguay, sumarDias, esHoraValida, aMinutos } from "@/lib/horasObra";
import { parseForm, zId, zTexto, zTextoOpcional, zFecha, ValidationError } from "@/lib/validation";
import { conEstadoDeAccion, type ActionState } from "@/lib/actionState";
import { crearNotificacion } from "@/lib/notificaciones";
import { puedeMantenimiento, puedeAdministrarEspacios, montoLiquidacion } from "@/lib/habitada";

/** Fase 3H — Etapa Habitada v1. */

async function conAviso(fn: () => Promise<string>): Promise<ActionState> {
  let aviso = "";
  const r = await conEstadoDeAccion(async () => {
    aviso = await fn();
  });
  return r.ok ? { ...r, aviso } : r;
}
const opcional = <T extends z.ZodTypeAny>(s: T) => s.optional().or(z.literal("").transform(() => undefined));
const zMonto = (msg = "Indicá el monto.") => z.coerce.number({ message: msg }).min(0, "No puede ser negativo.").max(100_000_000, "Revisá el monto.");

async function requireFinanzas() {
  const user = await requireUser();
  if (!canEdit(user.rol, "finanzas")) throw new Error("No tenés permiso — esto lo maneja Finanzas (tesorería, administración o el Consejo).");
  return user;
}

// ---------- Conceptos de cuota ----------

const conceptoSchema = z.object({ id: opcional(z.coerce.number().int().positive()), nombre: zTexto(100), monto: zMonto(), orden: opcional(z.coerce.number().int().min(0).max(99)) });

export async function guardarConceptoFormAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  return conAviso(async () => {
    const user = await requireFinanzas();
    const d = parseForm(conceptoSchema, fd);
    const datos = { nombre: d.nombre, monto: d.monto, orden: d.orden ?? 0 };
    if (d.id) {
      const ant = await get<{ nombre: string; monto: number }>(`SELECT nombre, monto FROM conceptos_cuota WHERE id = ? AND activo = 1`, [d.id]);
      if (!ant) throw new Error("Ese concepto no existe.");
      await update("conceptos_cuota", d.id, datos);
      await audit({ usuario_id: user.id, accion: "editar", entidad: "conceptos_cuota", entidad_id: d.id, valor_anterior: ant, valor_nuevo: datos });
    } else {
      const id = await insert("conceptos_cuota", { ...datos, creado_por_id: user.id });
      await audit({ usuario_id: user.id, accion: "crear", entidad: "conceptos_cuota", entidad_id: id, valor_nuevo: datos });
    }
    revalidatePath("/conceptos-cuota");
    return "Guardado. Se va a cobrar a partir de la próxima generación de cuotas.";
  });
}

export async function desactivarConceptoFormAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  return conAviso(async () => {
    const user = await requireFinanzas();
    const { id } = parseForm(z.object({ id: zId }), fd);
    await update("conceptos_cuota", id, { activo: 0 });
    await audit({ usuario_id: user.id, accion: "desactivar", entidad: "conceptos_cuota", entidad_id: id });
    revalidatePath("/conceptos-cuota");
    return "Concepto dado de baja: ya no se va a generar (lo ya generado queda).";
  });
}

// ---------- Mantenimiento preventivo ----------

async function requireMantenimiento() {
  const user = await requireUser();
  if (!(await puedeMantenimiento(user))) throw new Error("No tenés permiso — el mantenimiento lo maneja la Comisión de Mantenimiento o la administración.");
  return user;
}

const preventivoSchema = z.object({
  titulo: zTexto(150),
  descripcion: zTextoOpcional(1000),
  frecuencia_dias: z.coerce.number({ message: "Indicá cada cuántos días." }).int("Número entero.").min(1, "Mínimo 1 día.").max(3650, "Máximo 10 años."),
  proxima_fecha: zFecha,
});

export async function crearPreventivoFormAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  return conAviso(async () => {
    const user = await requireMantenimiento();
    const d = parseForm(preventivoSchema, fd);
    const id = await insert("mantenimiento_preventivo", { ...d, creado_por_id: user.id });
    await audit({ usuario_id: user.id, accion: "crear", entidad: "mantenimiento_preventivo", entidad_id: id, valor_nuevo: d });
    revalidatePath("/mantenimiento");
    return `«${d.titulo}» quedó en el plan de mantenimiento.`;
  });
}

const hechoSchema = z.object({ id: zId, fecha: zFecha, notas: zTextoOpcional(1000), costo: opcional(zMonto()) });

export async function marcarPreventivoHechoFormAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  return conAviso(async () => {
    const user = await requireMantenimiento();
    const d = parseForm(hechoSchema, fd);
    if (d.fecha > hoyEnUruguay()) throw new ValidationError("fecha", "La fecha no puede ser futura.");
    const p = await get<{ titulo: string; frecuencia_dias: number }>(`SELECT titulo, frecuencia_dias FROM mantenimiento_preventivo WHERE id = ? AND activo = 1`, [d.id]);
    if (!p) throw new Error("Esa tarea de mantenimiento no existe.");
    const proxima = sumarDias(d.fecha, Number(p.frecuencia_dias));
    const regId = await insert("mantenimiento_registros", { preventivo_id: d.id, fecha: d.fecha, notas: d.notas, costo: d.costo ?? null, hecho_por_id: user.id });
    await update("mantenimiento_preventivo", d.id, { ultima_vez: d.fecha, proxima_fecha: proxima });
    await audit({ usuario_id: user.id, accion: "mantenimiento_hecho", entidad: "mantenimiento_preventivo", entidad_id: d.id, valor_nuevo: { titulo: p.titulo, fecha: d.fecha, costo: d.costo, registro: regId } });
    revalidatePath("/mantenimiento");
    return `Anotado. La próxima vez: ${proxima.split("-").reverse().join("/")}.`;
  });
}

export async function desactivarPreventivoFormAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  return conAviso(async () => {
    const user = await requireMantenimiento();
    const { id } = parseForm(z.object({ id: zId }), fd);
    await update("mantenimiento_preventivo", id, { activo: 0 });
    await audit({ usuario_id: user.id, accion: "desactivar", entidad: "mantenimiento_preventivo", entidad_id: id });
    revalidatePath("/mantenimiento");
    return "Sacado del plan (queda en el historial).";
  });
}

// ---------- Espacios comunes y reservas ----------

const espacioSchema = z.object({
  nombre: zTexto(100),
  descripcion: zTextoOpcional(500),
  capacidad: opcional(z.coerce.number().int().min(1).max(5000)),
  requiere_aprobacion: z.string().optional(),
});

export async function crearEspacioFormAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  return conAviso(async () => {
    const user = await requireUser();
    if (!puedeAdministrarEspacios(user)) throw new Error("No tenés permiso para administrar los espacios comunes.");
    const d = parseForm(espacioSchema, fd);
    const id = await insert("espacios_comunes", { nombre: d.nombre, descripcion: d.descripcion, capacidad: d.capacidad ?? null, requiere_aprobacion: d.requiere_aprobacion === "1" ? 1 : 0 });
    await audit({ usuario_id: user.id, accion: "crear", entidad: "espacios_comunes", entidad_id: id, valor_nuevo: d });
    revalidatePath("/reservas");
    return `«${d.nombre}» ya se puede reservar.`;
  });
}

const zHora = z.string().refine((v) => esHoraValida(v), "Elegí una hora válida.");
const reservaSchema = z.object({ espacio_id: zId, fecha: zFecha, hora_inicio: zHora, hora_fin: zHora, motivo: zTextoOpcional(300) });

export async function reservarFormAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  return conAviso(async () => {
    const user = await requireUser();
    const d = parseForm(reservaSchema, fd);
    if (d.fecha < hoyEnUruguay()) throw new ValidationError("fecha", "Elegí una fecha de hoy en adelante.");
    if (aMinutos(d.hora_fin) <= aMinutos(d.hora_inicio)) throw new ValidationError("hora_fin", "La hora de fin tiene que ser después del inicio.");
    const e = await get<{ nombre: string; requiere_aprobacion: number }>(`SELECT nombre, requiere_aprobacion FROM espacios_comunes WHERE id = ? AND activo = 1`, [d.espacio_id]);
    if (!e) throw new ValidationError("espacio_id", "Elegí un espacio.");
    const choque = await get<{ hora_inicio: string; hora_fin: string }>(
      `SELECT hora_inicio, hora_fin FROM reservas_espacios WHERE espacio_id = ? AND fecha = ? AND estado IN ('pendiente', 'confirmada') AND hora_inicio < ? AND hora_fin > ? LIMIT 1`,
      [d.espacio_id, d.fecha, d.hora_fin, d.hora_inicio]
    );
    if (choque) throw new ValidationError("hora_inicio", `Ese horario ya está reservado (${choque.hora_inicio}–${choque.hora_fin}).`);
    const estado = e.requiere_aprobacion ? "pendiente" : "confirmada";
    const id = await insert("reservas_espacios", { espacio_id: d.espacio_id, fecha: d.fecha, hora_inicio: d.hora_inicio, hora_fin: d.hora_fin, user_id: user.id, motivo: d.motivo, estado });
    await audit({ usuario_id: user.id, accion: "reservar_espacio", entidad: "reservas_espacios", entidad_id: id, valor_nuevo: { espacio: e.nombre, fecha: d.fecha, horario: `${d.hora_inicio}–${d.hora_fin}`, estado } });
    revalidatePath("/reservas");
    return estado === "pendiente" ? `Pedido enviado: la administración tiene que confirmar la reserva del ${e.nombre}.` : `Reservado: ${e.nombre}, ${d.fecha.split("-").reverse().join("/")} de ${d.hora_inicio} a ${d.hora_fin}.`;
  });
}

export async function cancelarReservaFormAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  return conAviso(async () => {
    const user = await requireUser();
    const { id } = parseForm(z.object({ id: zId }), fd);
    const r = await get<{ user_id: number; estado: string }>(`SELECT user_id, estado FROM reservas_espacios WHERE id = ?`, [id]);
    if (!r || !["pendiente", "confirmada"].includes(r.estado)) throw new Error("Esa reserva ya no está vigente.");
    if (r.user_id !== user.id && !puedeAdministrarEspacios(user)) throw new Error("Sólo quien reservó (o la administración) puede cancelarla.");
    await update("reservas_espacios", id, { estado: "cancelada", cancelado_en: new Date().toISOString(), decidido_por_id: user.id });
    await audit({ usuario_id: user.id, accion: "cancelar_reserva", entidad: "reservas_espacios", entidad_id: id });
    revalidatePath("/reservas");
    return "Reserva cancelada.";
  });
}

export async function decidirReservaFormAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  return conAviso(async () => {
    const user = await requireUser();
    if (!puedeAdministrarEspacios(user)) throw new Error("No tenés permiso para confirmar reservas.");
    const { id, decision } = parseForm(z.object({ id: zId, decision: z.enum(["confirmada", "rechazada"]) }), fd);
    const r = await get<{ user_id: number; estado: string; fecha: string; espacio: string }>(
      `SELECT r.user_id, r.estado, r.fecha, e.nombre AS espacio FROM reservas_espacios r JOIN espacios_comunes e ON e.id = r.espacio_id WHERE r.id = ?`,
      [id]
    );
    if (!r || r.estado !== "pendiente") throw new Error("Esa reserva ya fue decidida.");
    await update("reservas_espacios", id, { estado: decision, decidido_por_id: user.id });
    await audit({ usuario_id: user.id, accion: decision === "confirmada" ? "confirmar_reserva" : "rechazar_reserva", entidad: "reservas_espacios", entidad_id: id });
    await crearNotificacion({ user_id: r.user_id, tipo: "reserva", titulo: `Tu reserva del ${r.espacio} (${r.fecha.split("-").reverse().join("/")}) fue ${decision}`, ref_tabla: "reservas_espacios", ref_id: id }).catch(() => {});
    revalidatePath("/reservas");
    return decision === "confirmada" ? "Reserva confirmada." : "Reserva rechazada.";
  });
}

// ---------- Liquidación de egreso ----------

const liquidacionSchema = z.object({
  socio_id: zId,
  fecha: zFecha,
  aportes: zMonto("Indicá el total aportado."),
  porcentaje_reintegro: z.coerce.number({ message: "Indicá el porcentaje." }).min(0, "Entre 0 y 100.").max(100, "Entre 0 y 100."),
  deuda: zMonto("Indicá la deuda."),
  otros_descuentos: opcional(zMonto()),
  detalle_descuentos: zTextoOpcional(1000),
  forma_devolucion: zTextoOpcional(500),
  notas: zTextoOpcional(2000),
});

export async function crearLiquidacionFormAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  return conAviso(async () => {
    const user = await requireFinanzas();
    const d = parseForm(liquidacionSchema, fd);
    const s = await get<{ nombre: string }>(`SELECT nombre FROM socios WHERE id = ?`, [d.socio_id]);
    if (!s) throw new ValidationError("socio_id", "Elegí un socio.");
    const abierta = await get<{ id: number }>(`SELECT id FROM liquidaciones_egreso WHERE socio_id = ? AND estado IN ('borrador', 'aprobada')`, [d.socio_id]);
    if (abierta) throw new ValidationError("socio_id", "Ese socio ya tiene una liquidación en curso.");
    const otros = d.otros_descuentos ?? 0;
    if (otros > 0 && !d.detalle_descuentos) throw new ValidationError("detalle_descuentos", "Contá qué se descuenta.");
    const monto = montoLiquidacion(d.aportes, d.porcentaje_reintegro, d.deuda, otros);
    const id = await insert("liquidaciones_egreso", { ...d, otros_descuentos: otros, monto_final: monto, creado_por_id: user.id });
    await audit({ usuario_id: user.id, accion: "crear", entidad: "liquidaciones_egreso", entidad_id: id, valor_nuevo: { socio: s.nombre, ...d, monto_final: monto } });
    revalidatePath("/liquidaciones");
    return `Borrador de liquidación guardado: ${monto >= 0 ? "a devolver" : "a cobrar"} $ ${Math.abs(monto).toLocaleString("es-UY")}.`;
  });
}

export async function cambiarEstadoLiquidacionFormAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  return conAviso(async () => {
    const user = await requireUser();
    const { id, estado, motivo } = parseForm(z.object({ id: zId, estado: z.enum(["aprobada", "pagada", "anulada"]), motivo: zTextoOpcional(300) }), fd);
    const l = await get<{ estado: string; socio_id: number }>(`SELECT estado, socio_id FROM liquidaciones_egreso WHERE id = ?`, [id]);
    if (!l) throw new Error("Esa liquidación no existe.");
    const paso: Record<string, string[]> = { aprobada: ["borrador"], pagada: ["aprobada"], anulada: ["borrador", "aprobada"] };
    if (!paso[estado].includes(l.estado)) throw new Error("Ese cambio no corresponde al estado actual.");
    // Aprobar la decide el Consejo (o quien aprueba en Finanzas); el resto, Finanzas.
    if (estado === "aprobada" ? !canApprove(user.rol, "finanzas") : !canEdit(user.rol, "finanzas")) throw new Error("No tenés permiso para este paso.");
    if (estado === "anulada" && !motivo) throw new ValidationError("motivo", "Contá por qué se anula.");
    await update("liquidaciones_egreso", id, {
      estado,
      ...(estado === "aprobada" ? { aprobado_por_id: user.id, aprobado_en: new Date().toISOString() } : {}),
      ...(estado === "anulada" ? { motivo_anulacion: motivo } : {}),
    });
    await audit({ usuario_id: user.id, accion: `liquidacion_${estado}`, entidad: "liquidaciones_egreso", entidad_id: id, valor_anterior: { estado: l.estado }, valor_nuevo: { estado, motivo } });
    revalidatePath("/liquidaciones");
    return estado === "aprobada" ? "Liquidación aprobada." : estado === "pagada" ? "Marcada como pagada." : "Liquidación anulada.";
  });
}
