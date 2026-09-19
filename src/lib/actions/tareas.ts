"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { insert, update, get, run, audit } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { canEdit } from "@/lib/roles";
import { puedeGestionarComision, ERROR_SIN_PERMISO_COMISION } from "@/lib/comisionAuth";
import { parseForm, zId, zIdOpcional, zTexto, zTextoOpcional, zFechaOpcional, zEnumSeguro } from "@/lib/validation";
import { conEstadoDeAccion, type ActionState } from "@/lib/actionState";
import { crearNotificacion } from "@/lib/actions/notificaciones";

// Fase 06 del Plan Maestro — tareas genéricas por comisión (no solo Obra o
// Trabajo). El comentario original decía "quien puede editar la comisión
// puede cargarle tareas a SUS PROPIAS comisiones" pero el código solo
// comprobaba el permiso de módulo (canEdit(rol, "comisiones")), que en
// roles.ts es "edit" para CUALQUIER rol de comisión — en los hechos, un
// integrante de la Comisión de Compras podía cargarle o cambiarle el estado
// a una tarea de la Tesorería. Auditoría integral (sección 17): se agrega la
// misma segunda capa por comisión puntual que ya usa Gastos/Compras.
//
// Comisiones como sistema de gestión, Fase 4 (19/09, pedido explícito,
// secciones 12-14): "tareas con checklist/subtareas, dependencias,
// prioridades, estados, etiquetas, colaboradores". La migración 0029 ya
// había agregado las columnas (checklist JSONB, depende_de_id, etiquetas,
// solicitud_id) y la tabla tarea_colaboradores — acá se agrega el código que
// las usa de verdad. Checklist se guarda como un array JSON simple
// ([{texto, hecho}], sin tabla aparte) porque es una lista corta que siempre
// se edita junto con su tarea — el mismo criterio que ya usa
// organizations.modulos_override o mensajes_correo.destinatarios en este
// proyecto (insert()/update() de db.ts ya serializan objetos/arrays a JSON
// solos, ver conversión automática ahí).

/** Mismo criterio de normalización que ya usa documentos.ts para sus
 * etiquetas (CSV prolijo, sin tabla aparte) — se repite acá en vez de
 * importarlo porque esa función no está exportada y cada archivo de
 * acciones de este proyecto es autocontenido. */
function normalizarEtiquetas(raw: FormDataEntryValue | null): string | null {
  const etiquetas = String(raw || "")
    .split(",")
    .map((e) => e.trim().slice(0, 60))
    .filter(Boolean)
    .slice(0, 30);
  return etiquetas.length > 0 ? etiquetas.join(", ") : null;
}

type ItemChecklist = { texto: string; hecho: boolean };

function checklistDe(raw: unknown): ItemChecklist[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((it): it is ItemChecklist => it && typeof it === "object" && typeof (it as ItemChecklist).texto === "string")
    .map((it) => ({ texto: it.texto, hecho: Boolean(it.hecho) }));
}

/** Valida que una dependencia elegida sea de la misma comisión y no arme un
 * ciclo directo (A depende de B que depende de A). No se persigue una
 * detección de ciclos más profunda (A→B→C→A) — alcanza para el caso de uso
 * real (evitar el error de tipeo más común) sin sumar una consulta
 * recursiva a cada guardado de tarea. */
async function validarDependencia(comisionId: number, dependeDeId: number | null, propioId: number | null) {
  if (dependeDeId === null) return;
  if (propioId !== null && dependeDeId === propioId) {
    throw new Error("Una tarea no puede depender de sí misma.");
  }
  const candidata = await get<{ comision_id: number; depende_de_id: number | null }>(
    `SELECT comision_id, depende_de_id FROM tareas WHERE id = ?`,
    [dependeDeId]
  );
  if (!candidata) throw new Error("La tarea de la que depende ya no existe.");
  if (candidata.comision_id !== comisionId) {
    throw new Error("Solo se puede depender de otra tarea de la misma comisión.");
  }
  if (propioId !== null && candidata.depende_de_id === propioId) {
    throw new Error("Esa dependencia formaría un ciclo (las dos tareas dependerían una de la otra).");
  }
}

const crearTareaSchema = z.object({
  comision_id: zId,
  titulo: zTexto(200),
  descripcion: zTextoOpcional(2000),
  responsable_id: zIdOpcional,
  prioridad: zEnumSeguro(["alta", "media", "baja"], "media"),
  fecha_vencimiento: zFechaOpcional,
  depende_de_id: zIdOpcional,
});

export async function crearTareaAction(formData: FormData) {
  const user = await requireUser();
  if (!canEdit(user.rol, "comisiones")) throw new Error("No autorizado");
  const datos = parseForm(crearTareaSchema, formData);
  if (!(await puedeGestionarComision(user, datos.comision_id))) throw new Error(ERROR_SIN_PERMISO_COMISION);
  await validarDependencia(datos.comision_id, datos.depende_de_id, null);

  const id = await insert("tareas", {
    ...datos,
    etiquetas: normalizarEtiquetas(formData.get("etiquetas")),
    creado_por_id: user.id,
  });
  await audit({
    usuario_id: user.id,
    accion: "crear",
    entidad: "tareas",
    entidad_id: id,
    valor_nuevo: { comision_id: datos.comision_id, titulo: datos.titulo, prioridad: datos.prioridad },
  });

  // Fase 7 (notificaciones): "me asignaron una tarea" es el otro ejemplo
  // textual de la sección 24 del pedido original.
  if (datos.responsable_id && datos.responsable_id !== user.id) {
    await crearNotificacion({
      user_id: datos.responsable_id,
      tipo: "tarea_asignada",
      titulo: `Te asignaron la tarea "${datos.titulo}"`,
      ref_tabla: "tareas",
      ref_id: id,
    });
  }

  revalidatePath("/comisiones");
}

export async function crearTareaFormAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  return conEstadoDeAccion(() => crearTareaAction(formData));
}

const editarTareaSchema = z.object({
  id: zId,
  titulo: zTexto(200),
  descripcion: zTextoOpcional(2000),
  responsable_id: zIdOpcional,
  prioridad: zEnumSeguro(["alta", "media", "baja"], "media"),
  fecha_vencimiento: zFechaOpcional,
  depende_de_id: zIdOpcional,
});

export async function editarTareaAction(formData: FormData) {
  const user = await requireUser();
  if (!canEdit(user.rol, "comisiones")) throw new Error("No autorizado");
  const datos = parseForm(editarTareaSchema, formData);
  const tarea = await get<{ comision_id: number; responsable_id: number | null }>(`SELECT comision_id, responsable_id FROM tareas WHERE id = ?`, [datos.id]);
  if (!tarea) throw new Error("Esa tarea ya no existe.");
  if (!(await puedeGestionarComision(user, tarea.comision_id))) throw new Error(ERROR_SIN_PERMISO_COMISION);
  await validarDependencia(tarea.comision_id, datos.depende_de_id, datos.id);

  const { id, ...cambios } = datos;
  await update("tareas", id, { ...cambios, etiquetas: normalizarEtiquetas(formData.get("etiquetas")) });
  await audit({ usuario_id: user.id, accion: "editar", entidad: "tareas", entidad_id: id, valor_nuevo: { titulo: datos.titulo } });

  // Fase 7 (notificaciones): sólo avisa cuando el responsable CAMBIA a
  // alguien nuevo — evita re-notificar en cada edición si sigue siendo la
  // misma persona.
  if (datos.responsable_id && datos.responsable_id !== tarea.responsable_id && datos.responsable_id !== user.id) {
    await crearNotificacion({
      user_id: datos.responsable_id,
      tipo: "tarea_asignada",
      titulo: `Te asignaron la tarea "${datos.titulo}"`,
      ref_tabla: "tareas",
      ref_id: id,
    });
  }

  revalidatePath("/comisiones");
}

export async function editarTareaFormAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  return conEstadoDeAccion(() => editarTareaAction(formData));
}

export async function cambiarEstadoTareaAction(formData: FormData) {
  const user = await requireUser();
  if (!canEdit(user.rol, "comisiones")) throw new Error("No autorizado");
  const { id, estado } = parseForm(z.object({ id: zId, estado: zEnumSeguro(["pendiente", "en_curso", "completada"], "pendiente") }), formData);
  // `depende_de_id` es de la migración 0029 — cambiar el estado de una tarea
  // es una acción que ya existía y funcionaba antes de esta fase, así que si
  // esa columna todavía no existe en esta base (migración no corrida), el
  // cambio de estado básico se sigue guardando igual, solo sin el chequeo de
  // dependencia (que no puede aplicarse sin la columna de todos modos).
  const tarea = await get<{ comision_id: number; depende_de_id: number | null }>(
    `SELECT comision_id, depende_de_id FROM tareas WHERE id = ?`,
    [id]
  ).catch(async () => {
    const basica = await get<{ comision_id: number }>(`SELECT comision_id FROM tareas WHERE id = ?`, [id]);
    return basica ? { comision_id: basica.comision_id, depende_de_id: null } : undefined;
  });
  if (!tarea) throw new Error("Esa tarea ya no existe.");
  if (!(await puedeGestionarComision(user, tarea.comision_id))) throw new Error(ERROR_SIN_PERMISO_COMISION);

  // Sección 12 del pedido ("dependencias"): no alcanza con mostrarlo en la
  // UI — si de verdad tiene que bloquear el flujo, el servidor lo tiene que
  // rechazar aunque alguien arme el pedido a mano.
  if (estado === "completada" && tarea.depende_de_id) {
    const dependencia = await get<{ titulo: string; estado: string }>(`SELECT titulo, estado FROM tareas WHERE id = ?`, [tarea.depende_de_id]);
    if (dependencia && dependencia.estado !== "completada") {
      throw new Error(`No se puede completar esta tarea todavía — depende de "${dependencia.titulo}", que sigue ${dependencia.estado === "en_curso" ? "en curso" : "pendiente"}.`);
    }
  }

  await update("tareas", id, { estado });
  await audit({ usuario_id: user.id, accion: "cambiar_estado", entidad: "tareas", entidad_id: id, valor_nuevo: { estado } });
  revalidatePath("/comisiones");
}

export async function cambiarEstadoTareaFormAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  return conEstadoDeAccion(() => cambiarEstadoTareaAction(formData));
}

// ---------- Checklist / subtareas (sección 12: "checklist o subtareas") ----------

async function tareaConChecklist(id: number) {
  const tarea = await get<{ comision_id: number; checklist: unknown }>(`SELECT comision_id, checklist FROM tareas WHERE id = ?`, [id]);
  if (!tarea) throw new Error("Esa tarea ya no existe.");
  return { comision_id: tarea.comision_id, checklist: checklistDe(tarea.checklist) };
}

const agregarItemChecklistSchema = z.object({ tarea_id: zId, texto: zTexto(200) });

export async function agregarItemChecklistAction(formData: FormData) {
  const user = await requireUser();
  if (!canEdit(user.rol, "comisiones")) throw new Error("No autorizado");
  const { tarea_id, texto } = parseForm(agregarItemChecklistSchema, formData);
  const { comision_id, checklist } = await tareaConChecklist(tarea_id);
  if (!(await puedeGestionarComision(user, comision_id))) throw new Error(ERROR_SIN_PERMISO_COMISION);
  if (checklist.length >= 50) throw new Error("Esta tarea ya tiene el máximo de 50 ítems en su checklist.");

  checklist.push({ texto, hecho: false });
  await update("tareas", tarea_id, { checklist });
  revalidatePath("/comisiones");
}

export async function agregarItemChecklistFormAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  return conEstadoDeAccion(() => agregarItemChecklistAction(formData));
}

const indiceChecklistSchema = z.object({ tarea_id: zId, indice: z.coerce.number().int().min(0) });

export async function alternarItemChecklistAction(formData: FormData) {
  const user = await requireUser();
  if (!canEdit(user.rol, "comisiones")) throw new Error("No autorizado");
  const { tarea_id, indice } = parseForm(indiceChecklistSchema, formData);
  const { comision_id, checklist } = await tareaConChecklist(tarea_id);
  if (!(await puedeGestionarComision(user, comision_id))) throw new Error(ERROR_SIN_PERMISO_COMISION);
  if (!checklist[indice]) throw new Error("Ese ítem del checklist ya no existe.");

  checklist[indice].hecho = !checklist[indice].hecho;
  await update("tareas", tarea_id, { checklist });
  revalidatePath("/comisiones");
}

export async function alternarItemChecklistFormAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  return conEstadoDeAccion(() => alternarItemChecklistAction(formData));
}

export async function eliminarItemChecklistAction(formData: FormData) {
  const user = await requireUser();
  if (!canEdit(user.rol, "comisiones")) throw new Error("No autorizado");
  const { tarea_id, indice } = parseForm(indiceChecklistSchema, formData);
  const { comision_id, checklist } = await tareaConChecklist(tarea_id);
  if (!(await puedeGestionarComision(user, comision_id))) throw new Error(ERROR_SIN_PERMISO_COMISION);
  if (!checklist[indice]) return; // ya no existe, nada que borrar

  checklist.splice(indice, 1);
  await update("tareas", tarea_id, { checklist });
  revalidatePath("/comisiones");
}

export async function eliminarItemChecklistFormAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  return conEstadoDeAccion(() => eliminarItemChecklistAction(formData));
}

// ---------- Colaboradores (sección 12: "colaboradores" además del único
// responsable que ya existía) ----------

const colaboradorSchema = z.object({ tarea_id: zId, user_id: zId });

export async function agregarColaboradorTareaAction(formData: FormData) {
  const user = await requireUser();
  if (!canEdit(user.rol, "comisiones")) throw new Error("No autorizado");
  const { tarea_id, user_id } = parseForm(colaboradorSchema, formData);
  const tarea = await get<{ comision_id: number }>(`SELECT comision_id FROM tareas WHERE id = ?`, [tarea_id]);
  if (!tarea) throw new Error("Esa tarea ya no existe.");
  if (!(await puedeGestionarComision(user, tarea.comision_id))) throw new Error(ERROR_SIN_PERMISO_COMISION);

  const yaExiste = await get<{ id: number }>(`SELECT id FROM tarea_colaboradores WHERE tarea_id = ? AND user_id = ?`, [tarea_id, user_id]);
  if (yaExiste) return; // ya es colaborador, no hay nada más que hacer

  await insert("tarea_colaboradores", { tarea_id, user_id });
  revalidatePath("/comisiones");
}

export async function agregarColaboradorTareaFormAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  return conEstadoDeAccion(() => agregarColaboradorTareaAction(formData));
}

export async function quitarColaboradorTareaAction(formData: FormData) {
  const user = await requireUser();
  if (!canEdit(user.rol, "comisiones")) throw new Error("No autorizado");
  const { id } = parseForm(z.object({ id: zId }), formData);
  const colaborador = await get<{ comision_id: number }>(
    `SELECT t.comision_id as comision_id FROM tarea_colaboradores tc JOIN tareas t ON t.id = tc.tarea_id WHERE tc.id = ?`,
    [id]
  );
  if (!colaborador) return; // ya no existe
  if (!(await puedeGestionarComision(user, colaborador.comision_id))) throw new Error(ERROR_SIN_PERMISO_COMISION);

  await run(`DELETE FROM tarea_colaboradores WHERE id = ?`, [id]);
  revalidatePath("/comisiones");
}

export async function quitarColaboradorTareaFormAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  return conEstadoDeAccion(() => quitarColaboradorTareaAction(formData));
}
