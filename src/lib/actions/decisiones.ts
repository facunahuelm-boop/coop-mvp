"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { insert, update, get, all, run, audit } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { canEdit } from "@/lib/roles";
import { puedeGestionarComision, ERROR_SIN_PERMISO_COMISION } from "@/lib/comisionAuth";
import { parseForm, zId, zTexto, zTextoOpcional, zFecha, zEnumSeguro } from "@/lib/validation";
import { conEstadoDeAccion, type ActionState } from "@/lib/actionState";
import { crearNotificacionesParaUsuarios } from "@/lib/notificaciones";

// Fase 6 del sistema de gestión de Comisiones (19/09, pedido explícito,
// sección "decisiones/votaciones"): registro formal de decisiones de
// comisión (distinto de una conversación/propuesta suelta) y el mecanismo
// de votación que las resuelve. Ver ARQUITECTURA_COMISIONES.md — tablas
// decisiones_comision/votaciones/voto_respuestas, migración 0029.
//
// Modelo de permisos: mismo doble-capa módulo+instancia que el resto del
// sistema (comisionAuth.ts) — crear/editar/decidir una decisión, y abrir/
// cerrar/votar una votación, exige gestionar la comisión dueña (integrante
// activo de ESA comisión, o un rol de conducción/finanzas).
//
// Alcance deliberado de esta fase: una votación siempre nace DESDE una
// decisión ya creada (decision_id obligatorio en crearVotacionAction, aunque
// la columna admite NULL en la base) — Decisiones es la entidad de primer
// nivel, Votaciones es el mecanismo para resolverla. No se ofrece todavía
// una encuesta suelta sin decisión asociada; si hiciera falta más adelante,
// es una extensión aditiva (la tabla ya lo permite), no un cambio de diseño.

const TIPO_VOTACION = ["encuesta", "votacion", "decision_formal"] as const;

function esOversightComisiones(rol: Parameters<typeof canEdit>[0]): boolean {
  return canEdit(rol, "finanzas");
}

async function asignarNumeroDecision(id: number) {
  const year = new Date().getFullYear();
  await run(`UPDATE decisiones_comision SET numero = ? WHERE id = ?`, [`DEC-${year}-${String(id).padStart(4, "0")}`, id]);
}

async function decisionParaPermiso(id: number) {
  const decision = await get<{ comision_id: number; resultado: string }>(
    `SELECT comision_id, resultado FROM decisiones_comision WHERE id = ?`,
    [id]
  );
  if (!decision) throw new Error("Esa decisión ya no existe.");
  return decision;
}

const crearDecisionSchema = z.object({
  comision_id: zId,
  tema: zTexto(300),
  propuesta: zTextoOpcional(3000),
  fecha: zFecha,
});

export async function crearDecisionAction(formData: FormData) {
  const user = await requireUser();
  if (!canEdit(user.rol, "comisiones")) throw new Error("No autorizado");
  const datos = parseForm(crearDecisionSchema, formData);
  if (!(await puedeGestionarComision(user, datos.comision_id))) throw new Error(ERROR_SIN_PERMISO_COMISION);

  const id = await insert("decisiones_comision", {
    comision_id: datos.comision_id,
    tema: datos.tema,
    propuesta: datos.propuesta,
    fecha: datos.fecha,
    resultado: "pendiente",
  });
  await asignarNumeroDecision(id);
  await audit({ usuario_id: user.id, accion: "crear", entidad: "decisiones_comision", entidad_id: id, valor_nuevo: { tema: datos.tema, comision_id: datos.comision_id } });
  revalidatePath("/decisiones");
}

export async function crearDecisionFormAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  return conEstadoDeAccion(() => crearDecisionAction(formData));
}

const editarDecisionSchema = z.object({ id: zId, tema: zTexto(300), propuesta: zTextoOpcional(3000), fecha: zFecha });

export async function editarDecisionAction(formData: FormData) {
  const user = await requireUser();
  if (!canEdit(user.rol, "comisiones")) throw new Error("No autorizado");
  const datos = parseForm(editarDecisionSchema, formData);
  const decision = await decisionParaPermiso(datos.id);
  if (decision.resultado !== "pendiente") throw new Error("Esta decisión ya fue resuelta — no admite más cambios (podés reabrirla si hace falta corregirla).");
  if (!(await puedeGestionarComision(user, decision.comision_id))) throw new Error(ERROR_SIN_PERMISO_COMISION);

  await update("decisiones_comision", datos.id, { tema: datos.tema, propuesta: datos.propuesta, fecha: datos.fecha });
  revalidatePath("/decisiones");
  revalidatePath(`/decisiones/${datos.id}`);
}

export async function editarDecisionFormAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  return conEstadoDeAccion(() => editarDecisionAction(formData));
}

const decidirDecisionSchema = z.object({ id: zId, resultado: zEnumSeguro(["aprobada", "rechazada"] as const, "aprobada") });

export async function decidirDecisionAction(formData: FormData) {
  const user = await requireUser();
  if (!canEdit(user.rol, "comisiones")) throw new Error("No autorizado");
  const { id, resultado } = parseForm(decidirDecisionSchema, formData);
  const decision = await decisionParaPermiso(id);
  if (decision.resultado !== "pendiente") throw new Error("Esta decisión ya fue resuelta.");
  if (!(await puedeGestionarComision(user, decision.comision_id))) throw new Error(ERROR_SIN_PERMISO_COMISION);

  await update("decisiones_comision", id, { resultado, decidido_por_id: user.id });
  await audit({ usuario_id: user.id, accion: "decidir", entidad: "decisiones_comision", entidad_id: id, valor_nuevo: { resultado } });

  // Fase 7 (notificaciones): avisa a los integrantes activos de la comisión.
  const tema = (await get<{ tema: string }>(`SELECT tema FROM decisiones_comision WHERE id = ?`, [id]))?.tema ?? "";
  const miembros = await all<{ user_id: number }>(
    `SELECT user_id FROM comision_miembros WHERE comision_id = ? AND activo = 1`,
    [decision.comision_id]
  ).catch(() => []);
  await crearNotificacionesParaUsuarios(
    miembros.map((m) => m.user_id).filter((uid) => uid !== user.id),
    { tipo: "decision_publicada", titulo: `Decisión ${resultado === "aprobada" ? "aprobada" : "rechazada"}: ${tema}`, ref_tabla: "decisiones_comision", ref_id: id }
  );

  revalidatePath("/decisiones");
  revalidatePath(`/decisiones/${id}`);
}

export async function decidirDecisionFormAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  return conEstadoDeAccion(() => decidirDecisionAction(formData));
}

// Reabrir (volver a "pendiente") es deliberadamente más restrictivo que el
// resto de las acciones de esta fase — reservado a roles de conducción,
// mismo criterio que reactivarComisionAction: sirve para corregir un error
// de carga, no para reabrir debates ya cerrados a pedido de cualquiera.
export async function reabrirDecisionAction(formData: FormData) {
  const user = await requireUser();
  if (!esOversightComisiones(user.rol)) throw new Error("Reabrir una decisión ya resuelta requiere un rol de conducción (Admin, Consejo Directivo, Tesorería o Administración).");
  const { id } = parseForm(z.object({ id: zId }), formData);
  const decision = await decisionParaPermiso(id);
  if (decision.resultado === "pendiente") return;

  await update("decisiones_comision", id, { resultado: "pendiente", decidido_por_id: null });
  await audit({ usuario_id: user.id, accion: "reabrir", entidad: "decisiones_comision", entidad_id: id });
  revalidatePath("/decisiones");
  revalidatePath(`/decisiones/${id}`);
}

export async function reabrirDecisionFormAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  return conEstadoDeAccion(() => reabrirDecisionAction(formData));
}

// ---------- Votaciones (mecanismo para resolver una decisión) ----------

const crearVotacionSchema = z.object({
  decision_id: zId,
  pregunta: zTexto(300),
  tipo: zEnumSeguro(TIPO_VOTACION, "votacion"),
  opciones: zTexto(2000), // una opción por línea, se parsea abajo
  fecha_cierre: zTextoOpcional(10),
});

function parsearOpciones(texto: string): string[] {
  const vistas = new Set<string>();
  const opciones: string[] = [];
  for (const linea of texto.split("\n")) {
    const limpia = linea.trim().slice(0, 200);
    if (!limpia || vistas.has(limpia)) continue;
    vistas.add(limpia);
    opciones.push(limpia);
    if (opciones.length >= 10) break; // techo razonable
  }
  return opciones;
}

export async function crearVotacionAction(formData: FormData) {
  const user = await requireUser();
  if (!canEdit(user.rol, "comisiones")) throw new Error("No autorizado");
  const datos = parseForm(crearVotacionSchema, formData);
  const decision = await decisionParaPermiso(datos.decision_id);
  if (decision.resultado !== "pendiente") throw new Error("Esta decisión ya fue resuelta — no tiene sentido abrir una votación nueva.");
  if (!(await puedeGestionarComision(user, decision.comision_id))) throw new Error(ERROR_SIN_PERMISO_COMISION);

  const yaAbierta = await get<{ id: number }>(`SELECT id FROM votaciones WHERE decision_id = ? AND estado = 'abierta'`, [datos.decision_id]);
  if (yaAbierta) throw new Error("Ya hay una votación abierta para esta decisión — cerrala antes de abrir otra.");

  const opciones = parsearOpciones(datos.opciones);
  if (opciones.length < 2) throw new Error("Cargá al menos 2 opciones, una por línea.");

  const fechaCierreValida = datos.fecha_cierre && /^\d{4}-\d{2}-\d{2}$/.test(datos.fecha_cierre) ? datos.fecha_cierre : null;

  const id = await insert("votaciones", {
    decision_id: datos.decision_id,
    comision_id: decision.comision_id,
    pregunta: datos.pregunta,
    tipo: datos.tipo,
    opciones,
    fecha_cierre: fechaCierreValida,
    estado: "abierta",
    creado_por_id: user.id,
  });
  await audit({ usuario_id: user.id, accion: "crear", entidad: "votaciones", entidad_id: id, valor_nuevo: { pregunta: datos.pregunta, decision_id: datos.decision_id } });

  // Fase 7 (notificaciones): avisa a los integrantes activos de la comisión
  // — el link apunta directo a la decisión (no a la votación, que no tiene
  // ficha propia), donde ya se puede votar.
  const miembrosVotacion = await all<{ user_id: number }>(
    `SELECT user_id FROM comision_miembros WHERE comision_id = ? AND activo = 1`,
    [decision.comision_id]
  ).catch(() => []);
  await crearNotificacionesParaUsuarios(
    miembrosVotacion.map((m) => m.user_id).filter((uid) => uid !== user.id),
    { tipo: "votacion_abierta", titulo: `Nueva votación: ${datos.pregunta}`, ref_tabla: "decisiones_comision", ref_id: datos.decision_id }
  );

  revalidatePath(`/decisiones/${datos.decision_id}`);
}

export async function crearVotacionFormAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  return conEstadoDeAccion(() => crearVotacionAction(formData));
}

async function votacionParaPermiso(id: number) {
  const votacion = await get<{ comision_id: number; decision_id: number | null; estado: string; opciones: string[] }>(
    `SELECT comision_id, decision_id, estado, opciones FROM votaciones WHERE id = ?`,
    [id]
  );
  if (!votacion) throw new Error("Esa votación ya no existe.");
  return votacion;
}

const votarSchema = z.object({ votacion_id: zId, opcion: zTexto(200) });

export async function votarAction(formData: FormData) {
  const user = await requireUser();
  if (!canEdit(user.rol, "comisiones")) throw new Error("No autorizado");
  const { votacion_id, opcion } = parseForm(votarSchema, formData);
  const votacion = await votacionParaPermiso(votacion_id);
  if (votacion.estado !== "abierta") throw new Error("Esta votación ya está cerrada.");
  if (!votacion.comision_id || !(await puedeGestionarComision(user, votacion.comision_id))) throw new Error(ERROR_SIN_PERMISO_COMISION);
  if (!votacion.opciones.includes(opcion)) throw new Error("Esa opción no es válida para esta votación.");

  // Un voto por persona, pero puede cambiarlo mientras la votación siga
  // abierta (UPDATE si ya había votado) — mismo criterio de "upsert manual"
  // ya usado en registrarAsistenciaAction (reuniones.ts).
  const existente = await get<{ id: number }>(`SELECT id FROM voto_respuestas WHERE votacion_id = ? AND user_id = ?`, [votacion_id, user.id]);
  if (existente) {
    await update("voto_respuestas", existente.id, { opcion });
  } else {
    await insert("voto_respuestas", { votacion_id, user_id: user.id, opcion });
  }
  if (votacion.decision_id) revalidatePath(`/decisiones/${votacion.decision_id}`);
}

export async function votarFormAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  return conEstadoDeAccion(() => votarAction(formData));
}

export async function cerrarVotacionAction(formData: FormData) {
  const user = await requireUser();
  if (!canEdit(user.rol, "comisiones")) throw new Error("No autorizado");
  const { id } = parseForm(z.object({ id: zId }), formData);
  const votacion = await votacionParaPermiso(id);
  if (votacion.estado === "cerrada") return;
  if (!votacion.comision_id || !(await puedeGestionarComision(user, votacion.comision_id))) throw new Error(ERROR_SIN_PERMISO_COMISION);

  await update("votaciones", id, { estado: "cerrada" });
  await audit({ usuario_id: user.id, accion: "cerrar", entidad: "votaciones", entidad_id: id });
  if (votacion.decision_id) revalidatePath(`/decisiones/${votacion.decision_id}`);
}

export async function cerrarVotacionFormAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  return conEstadoDeAccion(() => cerrarVotacionAction(formData));
}
