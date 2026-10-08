"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { insert, update, get, audit } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { canEdit } from "@/lib/roles";
import { hoyEnUruguay } from "@/lib/horasObra";
import { parseForm, zId, zTexto, zTextoOpcional, zFecha, ValidationError } from "@/lib/validation";
import { conEstadoDeAccion, type ActionState } from "@/lib/actionState";
import { puedeEscribirDiario } from "@/lib/obraRecursos";

/** Fase 3D — rubros, mediciones de avance, plan mensual y desembolsos del préstamo. */

async function requireObra() {
  const user = await requireUser();
  if (!(await puedeEscribirDiario(user))) throw new Error("No tenés permiso — el avance lo cargan la Comisión de Obra, el técnico y la conducción.");
  return user;
}
async function requireFinanzas() {
  const user = await requireUser();
  if (!canEdit(user.rol, "finanzas")) throw new Error("No tenés permiso — los datos del préstamo los maneja Finanzas (tesorería, administración o el Consejo).");
  return user;
}
const revalidar = () => {
  revalidatePath("/obra", "layout");
  revalidatePath("/finanzas");
};
async function conAviso(fn: () => Promise<string>): Promise<ActionState> {
  let aviso = "";
  const r = await conEstadoDeAccion(async () => {
    aviso = await fn();
  });
  return r.ok ? { ...r, aviso: aviso || undefined } : r;
}
const pct = (msg: string) => z.coerce.number({ message: msg }).min(0, "Entre 0 y 100.").max(100, "Entre 0 y 100.");
const opcional = <T extends z.ZodTypeAny>(s: T) => s.optional().or(z.literal("").transform(() => undefined));

// ---------- Rubros ----------

const rubroSchema = z.object({
  id: opcional(z.coerce.number().int().positive()),
  nombre: zTexto(120),
  peso_pct: pct("Indicá la incidencia (% del total)."),
  monto: opcional(z.coerce.number().min(0, "No puede ser negativo.").max(100_000_000_000, "Revisá el monto.")),
  orden: opcional(z.coerce.number().int().min(0).max(999)),
});

async function guardarRubro(fd: FormData): Promise<string> {
  const user = await requireObra();
  const d = parseForm(rubroSchema, fd);
  const otros = await get<{ total: string | null }>(`SELECT COALESCE(SUM(peso_pct), 0) AS total FROM obra_rubros WHERE activo = 1${d.id ? " AND id <> ?" : ""}`, d.id ? [d.id] : []);
  const total = Number(otros?.total ?? 0) + d.peso_pct;
  if (total > 100.05) throw new ValidationError("peso_pct", `Con este rubro la incidencia total da ${Math.round(total * 10) / 10} %. No puede pasar de 100 %.`);
  const datos = { nombre: d.nombre, peso_pct: d.peso_pct, monto: d.monto ?? 0, orden: d.orden ?? 0 };
  if (d.id) {
    const ant = await get<{ nombre: string; peso_pct: number; monto: number }>(`SELECT nombre, peso_pct, monto FROM obra_rubros WHERE id = ? AND activo = 1`, [d.id]);
    if (!ant) throw new Error("Ese rubro no existe.");
    await update("obra_rubros", d.id, datos);
    await audit({ usuario_id: user.id, accion: "editar", entidad: "obra_rubros", entidad_id: d.id, valor_anterior: ant, valor_nuevo: datos });
  } else {
    const id = await insert("obra_rubros", { ...datos, creado_por_id: user.id });
    await audit({ usuario_id: user.id, accion: "crear", entidad: "obra_rubros", entidad_id: id, valor_nuevo: datos });
  }
  revalidar();
  return total < 99.95 ? `Guardado. Las incidencias suman ${Math.round(total * 10) / 10} % (faltan rubros hasta llegar a 100 %).` : "Guardado.";
}
export async function guardarRubroFormAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  return conAviso(() => guardarRubro(fd));
}

export async function desactivarRubroFormAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  return conAviso(async () => {
    const user = await requireObra();
    const { id } = parseForm(z.object({ id: zId }), fd);
    await update("obra_rubros", id, { activo: 0 });
    await audit({ usuario_id: user.id, accion: "desactivar", entidad: "obra_rubros", entidad_id: id });
    revalidar();
    return "Rubro sacado del cálculo (queda en el historial).";
  });
}

// ---------- Mediciones de avance ----------

const avanceSchema = z.object({ rubro_id: zId, fecha: zFecha, avance_pct: pct("Indicá el avance (%)."), observaciones: zTextoOpcional(500) });

async function registrarAvance(fd: FormData): Promise<string> {
  const user = await requireObra();
  const d = parseForm(avanceSchema, fd);
  if (d.fecha > hoyEnUruguay()) throw new ValidationError("fecha", "La fecha no puede ser futura.");
  const rubro = await get<{ nombre: string }>(`SELECT nombre FROM obra_rubros WHERE id = ? AND activo = 1`, [d.rubro_id]);
  if (!rubro) throw new ValidationError("rubro_id", "Elegí un rubro.");
  const previa = await get<{ avance_pct: number }>(
    `SELECT avance_pct FROM obra_avances_rubro WHERE rubro_id = ? AND anulado_en IS NULL AND fecha <= ? ORDER BY fecha DESC, id DESC LIMIT 1`,
    [d.rubro_id, d.fecha]
  );
  const id = await insert("obra_avances_rubro", { rubro_id: d.rubro_id, fecha: d.fecha, avance_pct: d.avance_pct, observaciones: d.observaciones, registrado_por_id: user.id });
  await audit({ usuario_id: user.id, accion: "medir_avance", entidad: "obra_avances_rubro", entidad_id: id, valor_anterior: previa ? { avance: Number(previa.avance_pct) } : undefined, valor_nuevo: { rubro: rubro.nombre, avance: d.avance_pct, fecha: d.fecha } });
  revalidar();
  const baja = previa && d.avance_pct < Number(previa.avance_pct);
  return baja
    ? `Anotado: ${rubro.nombre} al ${d.avance_pct} %. Ojo: es menos que la medición anterior (${Number(previa!.avance_pct)} %).`
    : `Anotado: ${rubro.nombre} al ${d.avance_pct} %.`;
}
export async function registrarAvanceFormAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  return conAviso(() => registrarAvance(fd));
}

export async function anularAvanceFormAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  return conAviso(async () => {
    const user = await requireObra();
    const { id, motivo } = parseForm(z.object({ id: zId, motivo: zTexto(300) }), fd);
    const a = await get<{ anulado_en: string | null }>(`SELECT anulado_en FROM obra_avances_rubro WHERE id = ?`, [id]);
    if (!a || a.anulado_en) throw new Error("Esa medición no existe o ya estaba anulada.");
    await update("obra_avances_rubro", id, { anulado_en: new Date().toISOString(), anulado_por_id: user.id, motivo_anulacion: motivo });
    await audit({ usuario_id: user.id, accion: "anular", entidad: "obra_avances_rubro", entidad_id: id, valor_nuevo: { motivo } });
    revalidar();
    return "Medición anulada.";
  });
}

// ---------- Plan ----------

const planSchema = z.object({
  mes: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, "Elegí el mes."),
  avance_pct: pct("Indicá el avance planificado (%)."),
});

async function guardarPlan(fd: FormData): Promise<string> {
  const user = await requireObra();
  const d = parseForm(planSchema, fd);
  const ant = await get<{ id: number; avance_pct: number }>(`SELECT id, avance_pct FROM obra_plan_mensual WHERE mes = ?`, [d.mes]);
  const previo = await get<{ avance_pct: number }>(`SELECT avance_pct FROM obra_plan_mensual WHERE mes < ? ORDER BY mes DESC LIMIT 1`, [d.mes]);
  if (previo && d.avance_pct < Number(previo.avance_pct)) {
    throw new ValidationError("avance_pct", `El plan es acumulado: no puede ser menos que el mes anterior (${Number(previo.avance_pct)} %).`);
  }
  if (ant) await update("obra_plan_mensual", ant.id, { avance_pct: d.avance_pct, actualizado_por_id: user.id, actualizado_en: new Date().toISOString() });
  else await insert("obra_plan_mensual", { mes: d.mes, avance_pct: d.avance_pct, actualizado_por_id: user.id });
  await audit({ usuario_id: user.id, accion: "planificar_avance", entidad: "obra_plan_mensual", entidad_id: ant?.id ?? 0, valor_anterior: ant ? { avance: Number(ant.avance_pct) } : undefined, valor_nuevo: { mes: d.mes, avance: d.avance_pct } });
  revalidar();
  return "Plan guardado.";
}
export async function guardarPlanFormAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  return conAviso(() => guardarPlan(fd));
}

// ---------- Préstamo y desembolsos ----------

const configSchema = z.object({
  prestamo_entidad: zTextoOpcional(120),
  prestamo_monto_total: opcional(z.coerce.number().min(0, "No puede ser negativo.").max(100_000_000_000, "Revisá el monto.")),
  avance_financiero_origen: z.enum(["fondo_obra", "todos"], { message: "Elegí qué gastos cuentan." }),
});

async function guardarClave(orgId: number, userId: number, clave: string, valor: string) {
  const f = await get<{ id: number }>(`SELECT id FROM configuracion_reglas WHERE clave = ?`, [clave]);
  if (f) await update("configuracion_reglas", f.id, { valor, actualizado_por_id: userId, actualizado_en: new Date().toISOString() });
  else await insert("configuracion_reglas", { organization_id: orgId, clave, valor, actualizado_por_id: userId });
}

export async function configurarPrestamoFormAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  return conAviso(async () => {
    const user = await requireFinanzas();
    const d = parseForm(configSchema, fd);
    await guardarClave(user.organization_id, user.id, "prestamo_entidad", d.prestamo_entidad ?? "");
    await guardarClave(user.organization_id, user.id, "prestamo_monto_total", String(d.prestamo_monto_total ?? 0));
    await guardarClave(user.organization_id, user.id, "avance_financiero_origen", d.avance_financiero_origen);
    await audit({ usuario_id: user.id, accion: "configurar_prestamo", entidad: "configuracion_reglas", entidad_id: user.organization_id, valor_nuevo: d });
    revalidar();
    return "Datos del préstamo guardados.";
  });
}

const desembolsoSchema = z.object({
  descripcion: zTextoOpcional(200),
  monto_previsto: z.coerce.number({ message: "Indicá el monto." }).positive("Tiene que ser mayor que 0.").max(100_000_000_000, "Revisá el monto."),
  fecha_prevista: zFecha,
  avance_requerido_pct: opcional(pct("Entre 0 y 100.")),
});

async function crearDesembolso(fd: FormData): Promise<string> {
  const user = await requireFinanzas();
  const d = parseForm(desembolsoSchema, fd);
  const n = await get<{ n: string | null }>(`SELECT MAX(numero) AS n FROM prestamo_desembolsos`);
  const numero = Number(n?.n ?? 0) + 1;
  const descripcion = `Desembolso ${numero} del préstamo${d.descripcion ? ` — ${d.descripcion}` : ""}`;
  // Se carga como ingreso esperado: así entra en el flujo de caja, y al registrar que entró queda cobrado.
  const compromisoId = await insert("compromisos_futuros", {
    descripcion,
    monto: d.monto_previsto,
    fecha_estimada: d.fecha_prevista,
    origen: "Préstamo",
    tipo: "ingreso",
    categoria: "Préstamo",
    estado: "pendiente",
    creado_por_id: user.id,
  });
  const id = await insert("prestamo_desembolsos", {
    numero,
    descripcion: d.descripcion,
    monto_previsto: d.monto_previsto,
    fecha_prevista: d.fecha_prevista,
    avance_requerido_pct: d.avance_requerido_pct ?? null,
    compromiso_id: compromisoId,
    registrado_por_id: user.id,
  });
  await audit({ usuario_id: user.id, accion: "crear", entidad: "prestamo_desembolsos", entidad_id: id, valor_nuevo: { numero, ...d } });
  revalidar();
  return `Desembolso ${numero} cargado. Ya aparece en el flujo de caja como ingreso esperado.`;
}
export async function crearDesembolsoFormAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  return conAviso(() => crearDesembolso(fd));
}

export async function marcarSolicitadoFormAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  return conAviso(async () => {
    const user = await requireFinanzas();
    const { id, fecha } = parseForm(z.object({ id: zId, fecha: zFecha }), fd);
    if (fecha > hoyEnUruguay()) throw new ValidationError("fecha", "La fecha no puede ser futura.");
    const d = await get<{ estado: string; numero: number }>(`SELECT estado, numero FROM prestamo_desembolsos WHERE id = ?`, [id]);
    if (!d || d.estado !== "previsto") throw new Error("Ese desembolso ya fue pedido o no existe.");
    await update("prestamo_desembolsos", id, { estado: "solicitado", fecha_solicitud: fecha, actualizado_en: new Date().toISOString() });
    await audit({ usuario_id: user.id, accion: "pedir_desembolso", entidad: "prestamo_desembolsos", entidad_id: id, valor_nuevo: { numero: d.numero, fecha } });
    revalidar();
    return `Desembolso ${d.numero}: queda como pedido.`;
  });
}

export async function anularDesembolsoFormAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  return conAviso(async () => {
    const user = await requireFinanzas();
    const { id, motivo } = parseForm(z.object({ id: zId, motivo: zTexto(300) }), fd);
    const d = await get<{ estado: string; numero: number; compromiso_id: number | null }>(`SELECT estado, numero, compromiso_id FROM prestamo_desembolsos WHERE id = ?`, [id]);
    if (!d || d.estado === "anulado") throw new Error("Ese desembolso no existe o ya estaba anulado.");
    if (d.compromiso_id) {
      const c = await get<{ estado: string }>(`SELECT estado FROM compromisos_futuros WHERE id = ?`, [d.compromiso_id]);
      if (c?.estado === "pagado") throw new Error("Ese desembolso ya se cobró: para corregirlo, anulá el ingreso en Finanzas.");
      if (c?.estado === "pendiente") {
        await update("compromisos_futuros", d.compromiso_id, { estado: "cancelado", cerrado_en: new Date().toISOString(), cerrado_por_id: user.id, motivo_cierre: `Se anuló el desembolso: ${motivo}` });
      }
    }
    await update("prestamo_desembolsos", id, { estado: "anulado", motivo_anulacion: motivo, actualizado_en: new Date().toISOString() });
    await audit({ usuario_id: user.id, accion: "anular", entidad: "prestamo_desembolsos", entidad_id: id, valor_nuevo: { numero: d.numero, motivo } });
    revalidar();
    return `Desembolso ${d.numero} anulado.`;
  });
}
