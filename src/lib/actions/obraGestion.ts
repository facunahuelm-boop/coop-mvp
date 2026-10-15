"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { insert, update, get, all, audit } from "@/lib/db";
import { requireUser, type SessionUser } from "@/lib/auth";
import { puedePlanificarHorasTrabajo } from "@/lib/comisionAuth";
import { parseForm, zId, zIdOpcional, zTexto, zTextoOpcional, zFecha, ValidationError } from "@/lib/validation";
import { conEstadoDeAccion, type ActionState } from "@/lib/actionState";
import { hoyEnUruguay } from "@/lib/horasObra";
import {
  REPRESENTA_CLAVES,
  ERROR_SIN_PERMISO_OBRA,
  puedeGestionarObra,
  puedeAprobarContratacion,
  esSocioOIntegrante,
} from "@/lib/obraGestion";

/**
 * Comisión de Obra según el Reglamento de UFAMA: integración, planes de
 * trabajo, horario extendido, calidad, personal contratado, licitaciones y
 * guardias. Cada acción valida la regla del reglamento en el servidor y deja
 * auditoría. Nada se borra: se anula o se cambia de estado.
 */

const conAviso =
  (fn: (fd: FormData) => Promise<string>) =>
  async (_prev: ActionState, fd: FormData): Promise<ActionState> => {
    let aviso = "";
    const r = await conEstadoDeAccion(async () => {
      aviso = await fn(fd);
    });
    return r.ok ? { ...r, aviso } : r;
  };

/** La comisión tiene que existir y ser de la función esperada (obra / trabajo). */
async function comisionDe(comisionId: number, funcion: "obra" | "trabajo") {
  const c = await get<{ id: number; funcion: string }>(`SELECT id, funcion FROM comisiones WHERE id = ?`, [comisionId]);
  if (!c || c.funcion !== funcion) throw new Error("Esa comisión no corresponde a esta función.");
}
async function exigirObra(user: SessionUser, comisionId: number) {
  await comisionDe(comisionId, "obra");
  if (!(await puedeGestionarObra(user, comisionId))) throw new Error(ERROR_SIN_PERMISO_OBRA);
}
const refrescar = (comisionId: number) => {
  revalidatePath(`/comisiones/${comisionId}`);
  revalidatePath("/obra/obrador");
};
const aMin = (h: string) => Number(h.slice(0, 2)) * 60 + Number(h.slice(3, 5));
const zHora = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Usá el formato HH:MM.");
const diaSemana = (f: string) => new Date(`${f}T12:00:00Z`).getUTCDay(); // 0 domingo … 6 sábado

// ---------- Integración (Art. 10a) ----------

const representaSchema = z.object({ comision_id: zId, user_id: zId, representa: z.string().optional() });
export async function guardarRepresentaAction(fd: FormData): Promise<string> {
  const user = await requireUser();
  const d = parseForm(representaSchema, fd);
  await exigirObra(user, d.comision_id);
  const r = d.representa || null;
  if (r && !(REPRESENTA_CLAVES as string[]).includes(r)) throw new ValidationError("representa", "Elegí una opción de la lista.");
  const m = await get<{ id: number; representa: string | null }>(`SELECT id, representa FROM comision_miembros WHERE comision_id = ? AND user_id = ? AND activo = 1`, [d.comision_id, d.user_id]);
  if (!m) throw new Error("Esa persona no integra la comisión.");
  await update("comision_miembros", m.id, { representa: r });
  await audit({ usuario_id: user.id, accion: "editar", entidad: "comision_miembros", entidad_id: m.id, valor_anterior: { representa: m.representa }, valor_nuevo: { representa: r } });
  refrescar(d.comision_id);
  return "Representación guardada.";
}
export const guardarRepresentaFormAction = conAviso(guardarRepresentaAction);

// ---------- Plan de trabajo (Art. 11b) ----------

const planSchema = z.object({
  comision_id: zId,
  tipo: z.enum(["semanal", "mensual"], { message: "Elegí semanal o mensual." }),
  desde: zFecha,
  hasta: zFecha,
  tarea: zTexto(300),
  responsable_id: zIdOpcional,
});
export async function crearPlanAction(fd: FormData): Promise<string> {
  const user = await requireUser();
  const d = parseForm(planSchema, fd);
  await exigirObra(user, d.comision_id);
  if (d.hasta < d.desde) throw new ValidationError("hasta", "«Hasta» no puede ser anterior a «Desde».");
  const dias = (Date.parse(d.hasta) - Date.parse(d.desde)) / 86400000 + 1;
  if (d.tipo === "semanal" && dias > 7) throw new ValidationError("hasta", "Un plan semanal abarca hasta 7 días.");
  if (d.tipo === "mensual" && dias > 31) throw new ValidationError("hasta", "Un plan mensual abarca hasta 31 días.");
  const id = await insert("plan_trabajo_obra", { tipo: d.tipo, desde: d.desde, hasta: d.hasta, tarea: d.tarea, responsable_id: d.responsable_id, creado_por_id: user.id });
  await audit({ usuario_id: user.id, accion: "crear", entidad: "plan_trabajo_obra", entidad_id: id, valor_nuevo: { tipo: d.tipo, tarea: d.tarea } });
  refrescar(d.comision_id);
  return "Tarea agregada al plan.";
}
export const crearPlanFormAction = conAviso(crearPlanAction);

const estadoPlanSchema = z.object({ comision_id: zId, id: zId, estado: z.enum(["pendiente", "en_curso", "hecha", "anulada"]) });
export async function cambiarEstadoPlanAction(fd: FormData): Promise<string> {
  const user = await requireUser();
  const d = parseForm(estadoPlanSchema, fd);
  await exigirObra(user, d.comision_id);
  const fila = await get<{ estado: string }>(`SELECT estado FROM plan_trabajo_obra WHERE id = ? AND anulado_en IS NULL`, [d.id]);
  if (!fila) throw new Error("Esa tarea no existe.");
  if (d.estado === "anulada") await update("plan_trabajo_obra", d.id, { anulado_en: new Date().toISOString() });
  else await update("plan_trabajo_obra", d.id, { estado: d.estado });
  await audit({ usuario_id: user.id, accion: d.estado === "anulada" ? "anular" : "editar", entidad: "plan_trabajo_obra", entidad_id: d.id, valor_anterior: { estado: fila.estado }, valor_nuevo: { estado: d.estado } });
  refrescar(d.comision_id);
  return d.estado === "anulada" ? "Tarea quitada del plan." : "Estado actualizado.";
}
export const cambiarEstadoPlanFormAction = conAviso(cambiarEstadoPlanAction);

// ---------- Horario extendido y sábados (Art. 18 d, f, g) ----------

const turnoSchema = z.object({
  comision_id: zId,
  tipo: z.enum(["extendido", "sabado"], { message: "Elegí el tipo de turno." }),
  fecha: zFecha,
  hora_inicio: zHora,
  hora_fin: zHora,
  tarea: zTexto(300),
  supervision: zTextoOpcional(500),
  encargado_id: zId.refine(() => true),
});
export async function crearTurnoExtendidoAction(fd: FormData): Promise<string> {
  const user = await requireUser();
  const d = parseForm(turnoSchema, fd);
  await exigirObra(user, d.comision_id);
  const dia = diaSemana(d.fecha);
  const [min, max] = d.tipo === "extendido" ? [17 * 60, 22 * 60] : [7 * 60, 12 * 60];
  if (d.tipo === "extendido" && (dia === 0 || dia === 6)) throw new ValidationError("fecha", "El horario extendido es de lunes a viernes.");
  if (d.tipo === "sabado" && dia !== 6) throw new ValidationError("fecha", "El turno de sábado tiene que caer en sábado.");
  if (aMin(d.hora_fin) <= aMin(d.hora_inicio)) throw new ValidationError("hora_fin", "La hora de fin tiene que ser posterior a la de inicio.");
  if (aMin(d.hora_inicio) < min || aMin(d.hora_fin) > max)
    throw new ValidationError("hora_inicio", d.tipo === "extendido" ? "El horario extendido es de 17:00 a 22:00." : "El turno de sábado es de 07:00 a 12:00.");
  const enc = await get<{ id: number }>(`SELECT id FROM users WHERE id = ? AND activo = 1`, [d.encargado_id]);
  if (!enc) throw new ValidationError("encargado_id", "Elegí a la persona encargada del turno.");
  const id = await insert("turnos_extendidos_obra", { fecha: d.fecha, tipo: d.tipo, hora_inicio: d.hora_inicio, hora_fin: d.hora_fin, tarea: d.tarea, supervision: d.supervision, encargado_id: d.encargado_id, creado_por_id: user.id });
  await audit({ usuario_id: user.id, accion: "crear", entidad: "turnos_extendidos_obra", entidad_id: id, valor_nuevo: { fecha: d.fecha, tipo: d.tipo, tarea: d.tarea } });
  refrescar(d.comision_id);
  return "Turno planificado.";
}
export const crearTurnoExtendidoFormAction = conAviso(crearTurnoExtendidoAction);

const estadoTurnoSchema = z.object({ comision_id: zId, id: zId, estado: z.enum(["planificado", "realizado", "cancelado"]) });
export async function cambiarEstadoTurnoAction(fd: FormData): Promise<string> {
  const user = await requireUser();
  const d = parseForm(estadoTurnoSchema, fd);
  await exigirObra(user, d.comision_id);
  await update("turnos_extendidos_obra", d.id, { estado: d.estado });
  await audit({ usuario_id: user.id, accion: "editar", entidad: "turnos_extendidos_obra", entidad_id: d.id, valor_nuevo: { estado: d.estado } });
  refrescar(d.comision_id);
  return "Turno actualizado.";
}
export const cambiarEstadoTurnoFormAction = conAviso(cambiarEstadoTurnoAction);

// ---------- Control de calidad (Art. 11d) ----------

const calidadSchema = z.object({
  comision_id: zId,
  fecha: zFecha,
  actividad: zTexto(300),
  rubro_id: zIdOpcional,
  resultado: z.enum(["conforme", "observado", "rechazado"], { message: "Elegí el resultado." }),
  materiales_ok: z.string().optional(),
  observaciones: zTextoOpcional(1000),
});
export async function crearControlCalidadAction(fd: FormData): Promise<string> {
  const user = await requireUser();
  const d = parseForm(calidadSchema, fd);
  await exigirObra(user, d.comision_id);
  if (d.fecha > hoyEnUruguay()) throw new ValidationError("fecha", "La fecha no puede ser futura.");
  if (d.resultado !== "conforme" && !d.observaciones) throw new ValidationError("observaciones", "Contá qué se observó o por qué se rechazó.");
  const id = await insert("controles_calidad_obra", { fecha: d.fecha, actividad: d.actividad, rubro_id: d.rubro_id, resultado: d.resultado, materiales_ok: d.materiales_ok === "0" ? 0 : 1, observaciones: d.observaciones, evaluado_por_id: user.id });
  await audit({ usuario_id: user.id, accion: "crear", entidad: "controles_calidad_obra", entidad_id: id, valor_nuevo: { actividad: d.actividad, resultado: d.resultado } });
  refrescar(d.comision_id);
  return "Control registrado.";
}
export const crearControlCalidadFormAction = conAviso(crearControlCalidadAction);

// ---------- Personal contratado (Art. 5c) ----------

const contratadoSchema = z.object({
  comision_id: zId,
  nombre: zTexto(200),
  documento: zTextoOpcional(40),
  oficio: zTexto(120),
  desde: zTextoOpcional(10),
  hasta: zTextoOpcional(10),
  observaciones: zTextoOpcional(500),
});
export async function proponerContratadoAction(fd: FormData): Promise<string> {
  const user = await requireUser();
  const d = parseForm(contratadoSchema, fd);
  await exigirObra(user, d.comision_id);
  if (d.desde && d.hasta && d.hasta < d.desde) throw new ValidationError("hasta", "«Hasta» no puede ser anterior a «Desde».");
  if (await esSocioOIntegrante(d.nombre, d.documento))
    throw new ValidationError("nombre", "No se puede contratar a socios/as de la cooperativa ni a integrantes de un núcleo (Art. 5c del reglamento).");
  const id = await insert("personal_contratado_obra", { nombre: d.nombre, documento: d.documento, oficio: d.oficio, desde: d.desde, hasta: d.hasta, observaciones: d.observaciones, propuesto_por_id: user.id });
  await audit({ usuario_id: user.id, accion: "crear", entidad: "personal_contratado_obra", entidad_id: id, valor_nuevo: { nombre: d.nombre, oficio: d.oficio } });
  refrescar(d.comision_id);
  return "Propuesta cargada. La aprueba el Consejo Directivo.";
}
export const proponerContratadoFormAction = conAviso(proponerContratadoAction);

const resolverSchema = z.object({ comision_id: zId, id: zId, estado: z.enum(["aprobado", "rechazado", "finalizado"]) });
export async function resolverContratacionAction(fd: FormData): Promise<string> {
  const user = await requireUser();
  const d = parseForm(resolverSchema, fd);
  await comisionDe(d.comision_id, "obra");
  if (!puedeAprobarContratacion(user)) throw new Error("La contratación la aprueba el Consejo Directivo.");
  const fila = await get<{ estado: string }>(`SELECT estado FROM personal_contratado_obra WHERE id = ?`, [d.id]);
  if (!fila) throw new Error("Esa persona no está cargada.");
  if (d.estado === "finalizado" ? fila.estado !== "aprobado" : fila.estado !== "propuesto") throw new Error("Ese cambio no corresponde al estado actual.");
  await update("personal_contratado_obra", d.id, { estado: d.estado, resuelto_por_id: user.id, resuelto_en: new Date().toISOString() });
  await audit({ usuario_id: user.id, accion: "editar", entidad: "personal_contratado_obra", entidad_id: d.id, valor_anterior: { estado: fila.estado }, valor_nuevo: { estado: d.estado } });
  refrescar(d.comision_id);
  return d.estado === "aprobado" ? "Contratación aprobada." : d.estado === "rechazado" ? "Contratación rechazada." : "Contrato finalizado.";
}
export const resolverContratacionFormAction = conAviso(resolverContratacionAction);

// ---------- Licitaciones (Art. 5b, 11c) ----------

const licitacionSchema = z.object({ comision_id: zId, titulo: zTexto(200), descripcion: zTextoOpcional(1000) });
export async function crearLicitacionAction(fd: FormData): Promise<string> {
  const user = await requireUser();
  const d = parseForm(licitacionSchema, fd);
  await exigirObra(user, d.comision_id);
  const id = await insert("licitaciones_obra", { titulo: d.titulo, descripcion: d.descripcion, creado_por_id: user.id });
  await audit({ usuario_id: user.id, accion: "crear", entidad: "licitaciones_obra", entidad_id: id, valor_nuevo: { titulo: d.titulo } });
  refrescar(d.comision_id);
  return "Pedido de precios creado.";
}
export const crearLicitacionFormAction = conAviso(crearLicitacionAction);

const ofertaSchema = z.object({
  comision_id: zId,
  licitacion_id: zId,
  proveedor_id: zIdOpcional,
  proveedor_nombre: zTextoOpcional(200),
  monto: z.coerce.number({ message: "Indicá el monto." }).min(0, "No puede ser negativo.").max(1_000_000_000, "Revisá el monto."),
  plazo: zTextoOpcional(120),
  observaciones: zTextoOpcional(500),
});
export async function agregarOfertaAction(fd: FormData): Promise<string> {
  const user = await requireUser();
  const d = parseForm(ofertaSchema, fd);
  await exigirObra(user, d.comision_id);
  const lic = await get<{ estado: string }>(`SELECT estado FROM licitaciones_obra WHERE id = ?`, [d.licitacion_id]);
  if (!lic) throw new Error("Ese pedido de precios no existe.");
  if (lic.estado !== "abierta") throw new Error("Ese pedido de precios ya está cerrado.");
  let nombre = d.proveedor_nombre;
  if (d.proveedor_id) {
    const p = await get<{ nombre: string }>(`SELECT nombre FROM proveedores WHERE id = ?`, [d.proveedor_id]);
    if (!p) throw new ValidationError("proveedor_id", "Ese proveedor no existe.");
    nombre = nombre || p.nombre;
  }
  if (!nombre) throw new ValidationError("proveedor_nombre", "Elegí un proveedor o escribí el nombre.");
  const dup = await get<{ id: number }>(`SELECT id FROM ofertas_licitacion WHERE licitacion_id = ? AND anulada_en IS NULL AND lower(proveedor_nombre) = lower(?)`, [d.licitacion_id, nombre]);
  if (dup) throw new ValidationError("proveedor_nombre", "Ese proveedor ya presentó una oferta en este pedido.");
  const id = await insert("ofertas_licitacion", { licitacion_id: d.licitacion_id, proveedor_id: d.proveedor_id, proveedor_nombre: nombre, monto: d.monto, plazo: d.plazo, observaciones: d.observaciones });
  await audit({ usuario_id: user.id, accion: "crear", entidad: "ofertas_licitacion", entidad_id: id, valor_nuevo: { licitacion_id: d.licitacion_id, proveedor: nombre, monto: d.monto } });
  refrescar(d.comision_id);
  return "Oferta cargada.";
}
export const agregarOfertaFormAction = conAviso(agregarOfertaAction);

const adjudicarSchema = z.object({ comision_id: zId, licitacion_id: zId, oferta_id: zId, justificacion: zTextoOpcional(500) });
export async function adjudicarLicitacionAction(fd: FormData): Promise<string> {
  const user = await requireUser();
  const d = parseForm(adjudicarSchema, fd);
  await exigirObra(user, d.comision_id);
  const lic = await get<{ estado: string }>(`SELECT estado FROM licitaciones_obra WHERE id = ?`, [d.licitacion_id]);
  if (!lic || lic.estado !== "abierta") throw new Error("Ese pedido de precios ya está cerrado.");
  const ofertas = await all<{ id: number }>(`SELECT id FROM ofertas_licitacion WHERE licitacion_id = ? AND anulada_en IS NULL`, [d.licitacion_id]);
  if (!ofertas.some((o) => o.id === d.oferta_id)) throw new ValidationError("oferta_id", "Elegí una de las ofertas cargadas.");
  // Art. 5b: como mínimo tres ofertas, salvo que se justifique.
  if (ofertas.length < 3 && !d.justificacion) throw new ValidationError("justificacion", `Hay ${ofertas.length} oferta${ofertas.length === 1 ? "" : "s"}: el reglamento pide al menos tres. Explicá por qué se adjudica igual.`);
  await update("licitaciones_obra", d.licitacion_id, { estado: "adjudicada", oferta_elegida_id: d.oferta_id, justificacion: d.justificacion, cerrada_en: new Date().toISOString() });
  await audit({ usuario_id: user.id, accion: "editar", entidad: "licitaciones_obra", entidad_id: d.licitacion_id, valor_nuevo: { estado: "adjudicada", oferta: d.oferta_id, ofertas: ofertas.length } });
  refrescar(d.comision_id);
  return "Pedido de precios adjudicado.";
}
export const adjudicarLicitacionFormAction = conAviso(adjudicarLicitacionAction);

const desiertaSchema = z.object({ comision_id: zId, licitacion_id: zId, justificacion: zTexto(500) });
export async function declararDesiertaAction(fd: FormData): Promise<string> {
  const user = await requireUser();
  const d = parseForm(desiertaSchema, fd);
  await exigirObra(user, d.comision_id);
  const lic = await get<{ estado: string }>(`SELECT estado FROM licitaciones_obra WHERE id = ?`, [d.licitacion_id]);
  if (!lic || lic.estado !== "abierta") throw new Error("Ese pedido de precios ya está cerrado.");
  await update("licitaciones_obra", d.licitacion_id, { estado: "desierta", justificacion: d.justificacion, cerrada_en: new Date().toISOString() });
  await audit({ usuario_id: user.id, accion: "editar", entidad: "licitaciones_obra", entidad_id: d.licitacion_id, valor_nuevo: { estado: "desierta" } });
  refrescar(d.comision_id);
  return "Pedido de precios declarado desierto.";
}
export const declararDesiertaFormAction = conAviso(declararDesiertaAction);

// ---------- Guardias y serenatas (Comisión de Trabajo, Art. 8o, 18h, 34) ----------

async function exigirTrabajo(user: SessionUser, comisionId: number) {
  await comisionDe(comisionId, "trabajo");
  if (!(await puedePlanificarHorasTrabajo(user, comisionId))) throw new Error("Las guardias las organiza la Comisión de Trabajo (coordinación o conducción).");
}
const guardiaSchema = z.object({ comision_id: zId, fecha: zFecha, tipo: z.enum(["guardia", "serenata"], { message: "Elegí guardia o serenata." }), nucleo_id: zId, observaciones: zTextoOpcional(300) });
export async function crearGuardiaAction(fd: FormData): Promise<string> {
  const user = await requireUser();
  const d = parseForm(guardiaSchema, fd);
  await exigirTrabajo(user, d.comision_id);
  const n = await get<{ id: number }>(`SELECT id FROM nucleos_familiares WHERE id = ?`, [d.nucleo_id]);
  if (!n) throw new ValidationError("nucleo_id", "Elegí un núcleo de la lista.");
  const ya = await get<{ id: number }>(`SELECT id FROM guardias_obra WHERE fecha = ? AND tipo = ? AND nucleo_id = ?`, [d.fecha, d.tipo, d.nucleo_id]);
  if (ya) throw new ValidationError("nucleo_id", "Ese núcleo ya tiene asignada esa guardia ese día.");
  const id = await insert("guardias_obra", { fecha: d.fecha, tipo: d.tipo, nucleo_id: d.nucleo_id, observaciones: d.observaciones, creado_por_id: user.id });
  await audit({ usuario_id: user.id, accion: "crear", entidad: "guardias_obra", entidad_id: id, valor_nuevo: { fecha: d.fecha, tipo: d.tipo, nucleo_id: d.nucleo_id } });
  refrescar(d.comision_id);
  return d.tipo === "guardia" ? "Guardia asignada." : "Serenata asignada.";
}
export const crearGuardiaFormAction = conAviso(crearGuardiaAction);

const estadoGuardiaSchema = z.object({ comision_id: zId, id: zId, estado: z.enum(["asignada", "cumplida", "falta_justificada", "falta_injustificada"]) });
export async function cambiarEstadoGuardiaAction(fd: FormData): Promise<string> {
  const user = await requireUser();
  const d = parseForm(estadoGuardiaSchema, fd);
  await exigirTrabajo(user, d.comision_id);
  await update("guardias_obra", d.id, { estado: d.estado });
  await audit({ usuario_id: user.id, accion: "editar", entidad: "guardias_obra", entidad_id: d.id, valor_nuevo: { estado: d.estado } });
  refrescar(d.comision_id);
  return d.estado === "falta_injustificada" ? "Falta registrada: corresponde sanción (Art. 34)." : "Guardia actualizada.";
}
export const cambiarEstadoGuardiaFormAction = conAviso(cambiarEstadoGuardiaAction);
