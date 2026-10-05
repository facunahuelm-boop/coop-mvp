"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { insert, update, get, all, audit } from "@/lib/db";
import { requireUser, type SessionUser } from "@/lib/auth";
import { canRead } from "@/lib/roles";
import { puedePlanificarHorasTrabajo, ERROR_SIN_PERMISO_HORAS } from "@/lib/comisionAuth";
import { parseForm, zId, zFecha, zTextoOpcional, ValidationError } from "@/lib/validation";
import { conEstadoDeAccion, type ActionState } from "@/lib/actionState";
import { comisionDisponibleEnEtapa, funcionDe } from "@/lib/comisionesFunciones";
import { obtenerHorarioObra } from "@/lib/horasTrabajo";
import {
  calcularTramo,
  seSuperponen,
  lunesDe,
  textoDia,
  textoHoras,
  HORAS_SEMANALES_DEFAULT,
} from "@/lib/horasObra";

/**
 * Comisión de Trabajo (05/10) — organizar las horas semanales de cada
 * núcleo. Todas las reglas se validan acá, en el servidor (el formulario las
 * muestra antes, pero alguien podría armar el pedido a mano):
 *  - permiso: coordinador/a de la comisión, rol Comisión de Trabajo o
 *    conducción (puedePlanificarHorasTrabajo);
 *  - la comisión tiene que ser de función Trabajo y estar disponible en la
 *    etapa actual de la cooperativa;
 *  - dentro del horario de obra, sin empezar ni terminar en el descanso, y
 *    descontando el descanso si lo atraviesa (calcularTramo);
 *  - sin superponerse con otro horario del mismo núcleo ese día (eso también
 *    cubre la asignación duplicada).
 * Pasarse de las horas semanales del núcleo se permite (puede haber una
 * razón válida) pero se avisa claramente.
 */

const zHora = z.string().regex(/^([01]\d|2[0-3]):([0-5]\d)$/, "Elegí una hora válida.");

const asignacionSchema = z.object({
  comision_id: zId,
  nucleo_id: z.coerce.number({ message: "Elegí un núcleo." }).int().positive("Elegí un núcleo."),
  fecha: zFecha,
  hora_inicio: zHora,
  hora_fin: zHora,
  observaciones: zTextoOpcional(500),
});

async function comisionDeTrabajo(user: SessionUser, comisionId: number) {
  if (!canRead(user.rol, "comisiones")) throw new Error("No autorizado");
  const comision = await get<{ id: number; funcion: string | null; etapas: string | null; activa: number }>(
    `SELECT id, funcion, etapas, activa FROM comisiones WHERE id = ?`,
    [comisionId]
  ).catch(() => {
    throw new Error("Falta aplicar la actualización de la base (migración 0050) para organizar horas.");
  });
  if (!comision || !comision.activa) throw new Error("Esa comisión no existe o está archivada.");
  if (funcionDe(comision.funcion) !== "trabajo") throw new Error("Las horas de trabajo se organizan desde la Comisión de Trabajo.");
  if (!comisionDisponibleEnEtapa(comision, user.etapa)) {
    throw new Error("La Comisión de Trabajo no está disponible en la etapa actual de la cooperativa.");
  }
  if (!(await puedePlanificarHorasTrabajo(user, comisionId))) throw new Error(ERROR_SIN_PERMISO_HORAS);
  return comision;
}

type DatosAsignacion = z.infer<typeof asignacionSchema>;

/** Valida el tramo y devuelve lo necesario para guardarlo + el aviso de horas semanales. */
async function validarAsignacion(datos: DatosAsignacion, excluirId: number | null) {
  const nucleo = await get<{ id: number; nombre: string; horas_semanales_objetivo: number | null }>(
    `SELECT id, nombre, horas_semanales_objetivo FROM nucleos_familiares WHERE id = ?`,
    [datos.nucleo_id]
  );
  if (!nucleo) throw new ValidationError("nucleo_id", "Ese núcleo no existe en esta cooperativa.");

  const horario = await obtenerHorarioObra();
  const tramo = calcularTramo(datos.hora_inicio, datos.hora_fin, horario);
  if (tramo.error) throw new ValidationError("hora_fin", tramo.error);

  const mismosDia = await all<{ id: number; hora_inicio: string; hora_fin: string }>(
    `SELECT id, hora_inicio, hora_fin FROM asignaciones_horas WHERE nucleo_id = ? AND fecha = ? AND estado = 'activa'`,
    [datos.nucleo_id, datos.fecha]
  );
  const choque = mismosDia.find((a) => a.id !== excluirId && seSuperponen(a, datos));
  if (choque) {
    const igual = choque.hora_inicio === datos.hora_inicio && choque.hora_fin === datos.hora_fin;
    throw new ValidationError(
      "hora_inicio",
      igual
        ? `Esa asignación ya existe: ${nucleo.nombre} ya tiene ${choque.hora_inicio}–${choque.hora_fin} ese día.`
        : `Se superpone con otro horario de ${nucleo.nombre} ese día (${choque.hora_inicio}–${choque.hora_fin}).`
    );
  }

  const semana = lunesDe(datos.fecha);
  const otras = await get<{ total: string | null }>(
    `SELECT COALESCE(SUM(minutos), 0) AS total FROM asignaciones_horas WHERE nucleo_id = ? AND semana = ? AND estado = 'activa'${excluirId ? " AND id <> ?" : ""}`,
    excluirId ? [datos.nucleo_id, semana, excluirId] : [datos.nucleo_id, semana]
  );
  const objetivoHoras = Number(nucleo.horas_semanales_objetivo) > 0 ? Number(nucleo.horas_semanales_objetivo) : HORAS_SEMANALES_DEFAULT;
  const objetivo = Math.round(objetivoHoras * 60);
  const totalNuevo = Number(otras?.total || 0) + tramo.minutos;
  const aviso =
    totalNuevo > objetivo
      ? `Atención: ${nucleo.nombre} queda con ${textoHoras(totalNuevo)} esta semana — exceso de ${textoHoras(totalNuevo - objetivo)} sobre ${textoHoras(objetivo)}.`
      : undefined;
  return { nucleo, tramo, semana, aviso };
}

const descripcion = (nucleo: string, fecha: string, ini: string, fin: string, minutos: number, observaciones?: string | null) => ({
  nucleo,
  horario: `${textoDia(fecha)} ${ini}–${fin}`,
  horas: textoHoras(minutos),
  ...(observaciones ? { observaciones } : {}),
});

export async function asignarHorasAction(formData: FormData): Promise<string | undefined> {
  const user = await requireUser();
  const datos = parseForm(asignacionSchema, formData);
  await comisionDeTrabajo(user, datos.comision_id);
  const { nucleo, tramo, semana, aviso } = await validarAsignacion(datos, null);

  const id = await insert("asignaciones_horas", {
    comision_id: datos.comision_id,
    nucleo_id: datos.nucleo_id,
    semana,
    fecha: datos.fecha,
    hora_inicio: datos.hora_inicio,
    hora_fin: datos.hora_fin,
    minutos: tramo.minutos,
    observaciones: datos.observaciones,
    creado_por_id: user.id,
  });
  await audit({
    usuario_id: user.id,
    accion: "asignar_horas",
    entidad: "asignaciones_horas",
    entidad_id: id,
    valor_nuevo: descripcion(nucleo.nombre, datos.fecha, datos.hora_inicio, datos.hora_fin, tramo.minutos, datos.observaciones),
  });
  revalidatePath(`/comisiones/${datos.comision_id}`);
  revalidatePath("/comisiones", "layout");
  return aviso;
}

export async function asignarHorasFormAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  let aviso: string | undefined;
  const r = await conEstadoDeAccion(async () => {
    aviso = await asignarHorasAction(formData);
  });
  return r.ok ? { ...r, aviso } : r;
}

const editarSchema = asignacionSchema.extend({ id: zId });

export async function editarAsignacionHorasAction(formData: FormData): Promise<string | undefined> {
  const user = await requireUser();
  const datos = parseForm(editarSchema, formData);
  await comisionDeTrabajo(user, datos.comision_id);
  const anterior = await get<{ nucleo_id: number; fecha: string; hora_inicio: string; hora_fin: string; minutos: number; observaciones: string | null; estado: string; nucleo_nombre: string }>(
    `SELECT a.nucleo_id, a.fecha, a.hora_inicio, a.hora_fin, a.minutos, a.observaciones, a.estado, n.nombre AS nucleo_nombre
       FROM asignaciones_horas a JOIN nucleos_familiares n ON n.id = a.nucleo_id WHERE a.id = ?`,
    [datos.id]
  );
  if (!anterior || anterior.estado !== "activa") throw new Error("Esa asignación ya no existe o fue cancelada.");
  const { nucleo, tramo, semana, aviso } = await validarAsignacion(datos, datos.id);

  await update("asignaciones_horas", datos.id, {
    nucleo_id: datos.nucleo_id,
    semana,
    fecha: datos.fecha,
    hora_inicio: datos.hora_inicio,
    hora_fin: datos.hora_fin,
    minutos: tramo.minutos,
    observaciones: datos.observaciones,
    actualizado_en: new Date().toISOString(),
  });
  const reprograma = anterior.fecha !== datos.fecha;
  await audit({
    usuario_id: user.id,
    accion: reprograma ? "reprogramar_asignacion_horas" : "editar_asignacion_horas",
    entidad: "asignaciones_horas",
    entidad_id: datos.id,
    valor_anterior: descripcion(anterior.nucleo_nombre, anterior.fecha, anterior.hora_inicio, anterior.hora_fin, Number(anterior.minutos), anterior.observaciones),
    valor_nuevo: descripcion(nucleo.nombre, datos.fecha, datos.hora_inicio, datos.hora_fin, tramo.minutos, datos.observaciones),
  });
  revalidatePath(`/comisiones/${datos.comision_id}`);
  revalidatePath("/comisiones", "layout");
  return aviso;
}

export async function editarAsignacionHorasFormAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  let aviso: string | undefined;
  const r = await conEstadoDeAccion(async () => {
    aviso = await editarAsignacionHorasAction(formData);
  });
  return r.ok ? { ...r, aviso } : r;
}

const cancelarSchema = z.object({ id: zId, comision_id: zId, motivo: zTextoOpcional(300) });

/** Cancelar = baja lógica: deja de contar en las horas de la semana, pero queda en el historial. */
export async function cancelarAsignacionHorasAction(formData: FormData) {
  const user = await requireUser();
  const { id, comision_id, motivo } = parseForm(cancelarSchema, formData);
  await comisionDeTrabajo(user, comision_id);
  const fila = await get<{ fecha: string; hora_inicio: string; hora_fin: string; minutos: number; estado: string; nucleo_nombre: string; observaciones: string | null }>(
    `SELECT a.fecha, a.hora_inicio, a.hora_fin, a.minutos, a.estado, a.observaciones, n.nombre AS nucleo_nombre
       FROM asignaciones_horas a JOIN nucleos_familiares n ON n.id = a.nucleo_id WHERE a.id = ?`,
    [id]
  );
  if (!fila || fila.estado !== "activa") return; // ya cancelada
  await update("asignaciones_horas", id, {
    estado: "cancelada",
    motivo_cancelacion: motivo,
    cancelado_en: new Date().toISOString(),
    cancelado_por_id: user.id,
    actualizado_en: new Date().toISOString(),
  });
  await audit({
    usuario_id: user.id,
    accion: "cancelar_asignacion_horas",
    entidad: "asignaciones_horas",
    entidad_id: id,
    valor_anterior: descripcion(fila.nucleo_nombre, fila.fecha, fila.hora_inicio, fila.hora_fin, Number(fila.minutos), fila.observaciones),
    valor_nuevo: { nucleo: fila.nucleo_nombre, estado: "cancelada", ...(motivo ? { motivo } : {}) },
  });
  revalidatePath(`/comisiones/${comision_id}`);
  revalidatePath("/comisiones", "layout");
}

export async function cancelarAsignacionHorasFormAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  return conEstadoDeAccion(() => cancelarAsignacionHorasAction(formData));
}
