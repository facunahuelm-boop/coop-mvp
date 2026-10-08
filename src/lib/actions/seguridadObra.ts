"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { insert, update, get, audit } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { CHECKLIST_BASE } from "@/lib/constants";
import { hoyEnUruguay } from "@/lib/horasObra";
import { parseForm, zId, zTexto, zTextoOpcional, zFecha, ValidationError } from "@/lib/validation";
import { conEstadoDeAccion, type ActionState } from "@/lib/actionState";
import {
  puedeGestionarSeguridad,
  ERROR_SIN_PERMISO_SEGURIDAD,
  buscarPersona,
  crearTareasCorrectivas,
  fallasDe,
  type ItemChecklist,
} from "@/lib/seguridadObra";

/** Fase 3E — checklist diario, EPP e inducción de seguridad. */

async function requireSeguridad() {
  const user = await requireUser();
  if (!(await puedeGestionarSeguridad(user))) throw new Error(ERROR_SIN_PERMISO_SEGURIDAD);
  return user;
}

function revalidar() {
  revalidatePath("/seguridad", "layout");
  revalidatePath("/comisiones", "layout");
}

// ---------- Checklist diario ----------

export async function checklistDiarioAction(formData: FormData): Promise<string> {
  const user = await requireSeguridad();
  const hoy = hoyEnUruguay();
  const ya = await get<{ id: number; autor: string | null }>(
    `SELECT i.id, u.nombre AS autor FROM inspecciones_seguridad i LEFT JOIN users u ON u.id = i.autor_id WHERE i.tipo = 'diaria' AND i.dia = ? LIMIT 1`,
    [hoy]
  );
  if (ya) throw new Error(`El checklist de hoy ya lo hizo ${ya.autor ?? "otra persona"}.`);

  const items: ItemChecklist[] = [];
  const faltan: string[] = [];
  CHECKLIST_BASE.forEach((item, i) => {
    const v = String(formData.get(`item_${i}`) ?? "");
    if (!["ok", "falta", "na"].includes(v)) faltan.push(item);
    const obs = String(formData.get(`obs_${i}`) ?? "").trim().slice(0, 300) || null;
    items.push({ item, ok: v === "ok", na: v === "na" || undefined, obs: v === "falta" ? obs : null });
  });
  if (faltan.length) throw new ValidationError("item_0", `Falta responder: ${faltan.join(", ")}.`);
  const notas = String(formData.get("notas") ?? "").trim().slice(0, 2000) || null;

  const id = await insert("inspecciones_seguridad", {
    tipo: "diaria",
    dia: hoy,
    checklist_json: JSON.stringify(items),
    hallazgos: notas,
    autor_id: user.id,
  });
  const fallas = fallasDe(items);
  await audit({
    usuario_id: user.id,
    accion: "checklist_diario",
    entidad: "inspecciones_seguridad",
    entidad_id: id,
    valor_nuevo: { dia: hoy, a_corregir: fallas.map((f) => f.item), notas },
  });
  const tareas = await crearTareasCorrectivas(id, fallas, "checklist diario", user.id);
  revalidar();
  return tareas
    ? `Checklist guardado. Se ${tareas === 1 ? "creó 1 tarea" : `crearon ${tareas} tareas`} para la Comisión de Seguridad.`
    : "Checklist guardado. Todo en orden en la obra hoy.";
}

export async function checklistDiarioFormAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  let aviso = "";
  const r = await conEstadoDeAccion(async () => {
    aviso = await checklistDiarioAction(fd);
  });
  return r.ok ? { ...r, aviso } : r;
}

// ---------- EPP ----------

const eppSchema = z.object({
  persona: z.string().trim().min(1, "Elegí la persona."),
  elemento: zTexto(100),
  talle: zTextoOpcional(20),
  cantidad: z.coerce.number({ message: "Indicá la cantidad." }).int("Número entero.").min(1, "Mínimo 1.").max(50, "Máximo 50."),
  fecha: zFecha,
  observaciones: zTextoOpcional(500),
});

export async function registrarEppAction(formData: FormData): Promise<string> {
  const user = await requireSeguridad();
  const d = parseForm(eppSchema, formData);
  const p = await buscarPersona(d.persona);
  if (!p) throw new ValidationError("persona", "Elegí una persona de la lista.");
  if (d.fecha > hoyEnUruguay()) throw new ValidationError("fecha", "La fecha no puede ser futura.");
  const id = await insert("epp_entregas", {
    socio_id: p.socio_id,
    integrante_id: p.integrante_id,
    persona_nombre: p.nombre,
    elemento: d.elemento,
    talle: d.talle,
    cantidad: d.cantidad,
    fecha: d.fecha,
    observaciones: d.observaciones,
    entregado_por_id: user.id,
  });
  await audit({
    usuario_id: user.id,
    accion: "entregar_epp",
    entidad: "epp_entregas",
    entidad_id: id,
    valor_nuevo: { persona: p.nombre, elemento: d.elemento, talle: d.talle, cantidad: d.cantidad, fecha: d.fecha },
  });
  revalidar();
  return `Anotado: ${d.cantidad > 1 ? `${d.cantidad} × ` : ""}${d.elemento} para ${p.nombre}.`;
}

export async function registrarEppFormAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  let aviso = "";
  const r = await conEstadoDeAccion(async () => {
    aviso = await registrarEppAction(fd);
  });
  return r.ok ? { ...r, aviso } : r;
}

const anularSchema = z.object({ id: zId, motivo: zTexto(300) });

export async function anularEppAction(formData: FormData) {
  const user = await requireSeguridad();
  const { id, motivo } = parseForm(anularSchema, formData);
  const e = await get<{ id: number; anulado_en: string | null; persona_nombre: string; elemento: string }>(
    `SELECT id, anulado_en, persona_nombre, elemento FROM epp_entregas WHERE id = ?`,
    [id]
  );
  if (!e || e.anulado_en) throw new Error("Esa entrega no existe o ya estaba anulada.");
  await update("epp_entregas", id, { anulado_en: new Date().toISOString(), anulado_por_id: user.id, motivo_anulacion: motivo });
  await audit({ usuario_id: user.id, accion: "anular", entidad: "epp_entregas", entidad_id: id, valor_anterior: { persona: e.persona_nombre, elemento: e.elemento }, valor_nuevo: { motivo } });
  revalidar();
}

export async function anularEppFormAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  return conEstadoDeAccion(() => anularEppAction(fd));
}

// ---------- Inducción ----------

const induccionSchema = z.object({
  fecha: zFecha,
  dictada_por: zTextoOpcional(150),
  temas: zTextoOpcional(1000),
});

/** Registra la inducción de una o varias personas (se suele dar en grupo). */
export async function registrarInduccionAction(formData: FormData): Promise<string> {
  const user = await requireSeguridad();
  const d = parseForm(induccionSchema, formData);
  if (d.fecha > hoyEnUruguay()) throw new ValidationError("fecha", "La fecha no puede ser futura.");
  const claves = [...new Set(formData.getAll("persona").map(String).filter(Boolean))].slice(0, 200);
  if (!claves.length) throw new ValidationError("persona", "Marcá al menos una persona.");
  const nombres: string[] = [];
  for (const c of claves) {
    const p = await buscarPersona(c);
    if (!p) continue;
    const ya = await get<{ id: number }>(
      `SELECT id FROM inducciones_seguridad WHERE anulado_en IS NULL AND socio_id = ? AND ${p.integrante_id ? "integrante_id = ?" : "integrante_id IS NULL"} LIMIT 1`,
      p.integrante_id ? [p.socio_id, p.integrante_id] : [p.socio_id]
    );
    if (ya) continue;
    const id = await insert("inducciones_seguridad", {
      socio_id: p.socio_id,
      integrante_id: p.integrante_id,
      persona_nombre: p.nombre,
      fecha: d.fecha,
      dictada_por: d.dictada_por,
      temas: d.temas,
      registrada_por_id: user.id,
    });
    await audit({ usuario_id: user.id, accion: "registrar_induccion", entidad: "inducciones_seguridad", entidad_id: id, valor_nuevo: { persona: p.nombre, fecha: d.fecha, dictada_por: d.dictada_por } });
    nombres.push(p.nombre);
  }
  revalidar();
  revalidatePath("/comisiones", "layout");
  if (!nombres.length) return "Esas personas ya tenían la inducción registrada.";
  return nombres.length === 1 ? `Inducción registrada para ${nombres[0]}.` : `Inducción registrada para ${nombres.length} personas.`;
}

export async function registrarInduccionFormAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  let aviso = "";
  const r = await conEstadoDeAccion(async () => {
    aviso = await registrarInduccionAction(fd);
  });
  return r.ok ? { ...r, aviso } : r;
}

export async function anularInduccionAction(formData: FormData) {
  const user = await requireSeguridad();
  const { id, motivo } = parseForm(anularSchema, formData);
  const e = await get<{ id: number; anulado_en: string | null; persona_nombre: string }>(`SELECT id, anulado_en, persona_nombre FROM inducciones_seguridad WHERE id = ?`, [id]);
  if (!e || e.anulado_en) throw new Error("Esa inducción no existe o ya estaba anulada.");
  await update("inducciones_seguridad", id, { anulado_en: new Date().toISOString(), anulado_por_id: user.id, motivo_anulacion: motivo });
  await audit({ usuario_id: user.id, accion: "anular", entidad: "inducciones_seguridad", entidad_id: id, valor_anterior: { persona: e.persona_nombre }, valor_nuevo: { motivo } });
  revalidar();
}

export async function anularInduccionFormAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  return conEstadoDeAccion(() => anularInduccionAction(fd));
}
