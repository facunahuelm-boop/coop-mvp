"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { insert, update, get, all, audit } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { comisionDeTrabajo } from "@/lib/comisionTrabajo";
import { crearNotificacionesParaUsuarios, crearNotificacion } from "@/lib/notificaciones";
import { saveUploadedFile, TIPOS_DOCUMENTO } from "@/lib/upload";
import { parseForm, zId, zFecha, zTexto, zTextoOpcional, ValidationError } from "@/lib/validation";
import { conEstadoDeAccion, type ActionState } from "@/lib/actionState";
import { obtenerHorarioObra } from "@/lib/horasTrabajo";
import { calcularTramo, lunesDe, textoDia, textoHoras, hoyEnUruguay, textoSemana } from "@/lib/horasObra";
import { ESTADOS_ASISTENCIA, ESTADO_ASISTENCIA_LABEL, semanaCerrada, cerrarSemanaHoras, nucleoDelUsuario } from "@/lib/libretaHoras";

/**
 * Fase 1B "Horas con un solo número" (migración 0052): asistencia real de
 * cada turno, avisos de ausencia del socio, licencias y cierre semanal.
 * Permisos: lo mismo que planificar horas (coordinador/a de la Comisión de
 * Trabajo, rol Comisión de Trabajo o conducción), salvo "avisar que no puedo
 * ir", que lo hace cualquier integrante del núcleo de ese turno.
 */

const ERROR_SEMANA_CERRADA = "Esa semana ya está cerrada en la libreta de horas. Para cambiarla, primero hay que reabrirla.";
const zHora = z.string().regex(/^([01]\d|2[0-3]):([0-5]\d)$/, "Elegí una hora válida.");

type Turno = { id: number; nucleo_id: number; nucleo_nombre: string; comision_id: number | null; fecha: string; semana: string; hora_inicio: string; hora_fin: string; minutos: number; estado: string };

async function turno(id: number): Promise<Turno> {
  const t = await get<Turno>(
    `SELECT a.id, a.nucleo_id, n.nombre AS nucleo_nombre, a.comision_id, a.fecha, a.semana, a.hora_inicio, a.hora_fin, a.minutos, a.estado
       FROM asignaciones_horas a JOIN nucleos_familiares n ON n.id = a.nucleo_id WHERE a.id = ?`,
    [id]
  );
  if (!t || t.estado !== "activa") throw new Error("Ese turno ya no existe o fue cancelado.");
  return { ...t, minutos: Number(t.minutos) };
}

function revalidar(comisionId: number) {
  revalidatePath(`/comisiones/${comisionId}`);
  revalidatePath("/comisiones", "layout");
  revalidatePath("/mis-horas");
}

/** Guarda (o corrige) la asistencia de un turno. */
async function guardarAsistencia(params: {
  t: Turno;
  comisionId: number;
  estado: (typeof ESTADOS_ASISTENCIA)[number];
  minutosReales: number;
  horaInicio: string | null;
  horaFin: string | null;
  observaciones: string | null;
  origen: "coordinador" | "aviso";
  usuarioId: number;
}) {
  const { t } = params;
  const anterior = await get<{ id: number; estado: string; minutos_reales: number }>(
    `SELECT id, estado, minutos_reales FROM asistencias_horas WHERE asignacion_id = ? AND anulado_en IS NULL`,
    [t.id]
  );
  const datos = {
    estado: params.estado,
    minutos_planificados: t.minutos,
    minutos_reales: params.minutosReales,
    hora_inicio: params.horaInicio,
    hora_fin: params.horaFin,
    observaciones: params.observaciones,
    confirmado_por_id: params.usuarioId,
    actualizado_en: new Date().toISOString(),
  };
  let id: number;
  if (anterior) {
    id = anterior.id;
    await update("asistencias_horas", anterior.id, { ...datos, origen: params.origen });
  } else {
    id = await insert("asistencias_horas", {
      ...datos,
      asignacion_id: t.id,
      nucleo_id: t.nucleo_id,
      comision_id: params.comisionId,
      fecha: t.fecha,
      semana: t.semana,
      origen: params.origen,
    });
  }
  await audit({
    usuario_id: params.usuarioId,
    accion: "registrar_asistencia_obra",
    entidad: "asistencias_horas",
    entidad_id: id,
    valor_anterior: anterior ? { nucleo: t.nucleo_nombre, asistencia: ESTADO_ASISTENCIA_LABEL[anterior.estado], horas: textoHoras(Number(anterior.minutos_reales)) } : null,
    valor_nuevo: {
      nucleo: t.nucleo_nombre,
      turno: `${textoDia(t.fecha)} ${t.hora_inicio}–${t.hora_fin}`,
      asistencia: ESTADO_ASISTENCIA_LABEL[params.estado],
      horas: textoHoras(params.minutosReales),
      ...(params.observaciones ? { observaciones: params.observaciones } : {}),
    },
  });
}

// ---------- Marcar asistencia de un turno ----------

const marcarSchema = z.object({
  comision_id: zId,
  asignacion_id: zId,
  estado: z.enum(ESTADOS_ASISTENCIA, { message: "Elegí cómo fue la asistencia." }),
  hora_inicio: zHora.optional().or(z.literal("")),
  hora_fin: zHora.optional().or(z.literal("")),
  observaciones: zTextoOpcional(300),
});

export async function marcarAsistenciaAction(formData: FormData) {
  const user = await requireUser();
  const d = parseForm(marcarSchema, formData);
  await comisionDeTrabajo(user, d.comision_id);
  const t = await turno(d.asignacion_id);
  if (await semanaCerrada(t.semana)) throw new Error(ERROR_SEMANA_CERRADA);
  if (t.fecha > hoyEnUruguay()) throw new Error("Todavía no llegó ese día: la asistencia se marca el día del turno o después.");

  let minutos = 0;
  let ini: string | null = null;
  let fin: string | null = null;
  let estado = d.estado;
  if (d.estado === "presente") {
    minutos = t.minutos;
    ini = t.hora_inicio;
    fin = t.hora_fin;
  } else if (d.estado === "tarde" || d.estado === "retiro_anticipado") {
    if (!d.hora_inicio || !d.hora_fin) throw new ValidationError("hora_inicio", "Indicá a qué hora llegó y a qué hora se fue.");
    const tramo = calcularTramo(d.hora_inicio, d.hora_fin, await obtenerHorarioObra());
    if (tramo.error) throw new ValidationError("hora_fin", tramo.error);
    minutos = tramo.minutos;
    ini = d.hora_inicio;
    fin = d.hora_fin;
    // Se deduce de las horas: si llegó después de la hora del turno, "Llegó
    // tarde"; si no, "Se fue antes"; si coincide con el turno, "Vino".
    estado = ini > t.hora_inicio ? "tarde" : fin < t.hora_fin ? "retiro_anticipado" : "presente";
  } else if (d.estado === "ausente_justificada" && !d.observaciones) {
    throw new ValidationError("observaciones", "Escribí el motivo de la falta justificada.");
  }

  await guardarAsistencia({
    t,
    comisionId: d.comision_id,
    estado,
    minutosReales: minutos,
    horaInicio: ini,
    horaFin: fin,
    observaciones: d.observaciones,
    origen: "coordinador",
    usuarioId: user.id,
  });
  revalidar(d.comision_id);
}

export async function marcarAsistenciaFormAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  return conEstadoDeAccion(() => marcarAsistenciaAction(formData));
}

// ---------- Deshacer una marca (vuelve a "sin marcar") ----------

const deshacerSchema = z.object({ comision_id: zId, asistencia_id: zId });

export async function deshacerAsistenciaAction(formData: FormData) {
  const user = await requireUser();
  const d = parseForm(deshacerSchema, formData);
  await comisionDeTrabajo(user, d.comision_id);
  const a = await get<{ id: number; semana: string; estado: string; nucleo_id: number; fecha: string; anulado_en: string | null }>(
    `SELECT id, semana, estado, nucleo_id, fecha, anulado_en FROM asistencias_horas WHERE id = ?`,
    [d.asistencia_id]
  );
  if (!a || a.anulado_en) return;
  if (await semanaCerrada(a.semana)) throw new Error(ERROR_SEMANA_CERRADA);
  await update("asistencias_horas", a.id, { anulado_en: new Date().toISOString(), anulado_por_id: user.id, motivo_anulacion: "Se deshizo la marca" });
  await audit({
    usuario_id: user.id,
    accion: "deshacer_asistencia",
    entidad: "asistencias_horas",
    entidad_id: a.id,
    valor_anterior: { asistencia: ESTADO_ASISTENCIA_LABEL[a.estado], fecha: textoDia(a.fecha) },
  });
  revalidar(d.comision_id);
}

export async function deshacerAsistenciaFormAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  return conEstadoDeAccion(() => deshacerAsistenciaAction(formData));
}

// ---------- Confirmar que vinieron todos los que no tienen marca ----------

const todosSchema = z.object({ comision_id: zId, fecha: zFecha });

export async function confirmarTodosPresentesAction(formData: FormData): Promise<number> {
  const user = await requireUser();
  const d = parseForm(todosSchema, formData);
  await comisionDeTrabajo(user, d.comision_id);
  if (d.fecha > hoyEnUruguay()) throw new Error("Todavía no llegó ese día.");
  if (await semanaCerrada(lunesDe(d.fecha))) throw new Error(ERROR_SEMANA_CERRADA);
  const sinMarca = await all<{ id: number }>(
    `SELECT a.id FROM asignaciones_horas a
      WHERE a.fecha = ? AND a.estado = 'activa'
        AND NOT EXISTS (SELECT 1 FROM asistencias_horas h WHERE h.asignacion_id = a.id AND h.anulado_en IS NULL)`,
    [d.fecha]
  );
  for (const s of sinMarca) {
    const t = await turno(s.id);
    await guardarAsistencia({
      t,
      comisionId: d.comision_id,
      estado: "presente",
      minutosReales: t.minutos,
      horaInicio: t.hora_inicio,
      horaFin: t.hora_fin,
      observaciones: null,
      origen: "coordinador",
      usuarioId: user.id,
    });
  }
  revalidar(d.comision_id);
  return sinMarca.length;
}

export async function confirmarTodosPresentesFormAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  let n = 0;
  const r = await conEstadoDeAccion(async () => {
    n = await confirmarTodosPresentesAction(formData);
  });
  return r.ok ? { ...r, aviso: n ? `Listo: ${n} turno${n === 1 ? "" : "s"} marcado${n === 1 ? "" : "s"} como "Vino".` : "No quedaban turnos sin marcar ese día." } : r;
}

// ---------- Núcleo que vino sin turno planificado ----------

const sinTurnoSchema = z.object({
  comision_id: zId,
  nucleo_id: z.coerce.number({ message: "Elegí un núcleo." }).int().positive("Elegí un núcleo."),
  fecha: zFecha,
  hora_inicio: zHora,
  hora_fin: zHora,
  observaciones: zTextoOpcional(300),
});

export async function registrarSinTurnoAction(formData: FormData) {
  const user = await requireUser();
  const d = parseForm(sinTurnoSchema, formData);
  await comisionDeTrabajo(user, d.comision_id);
  if (d.fecha > hoyEnUruguay()) throw new ValidationError("fecha", "Sólo se registran horas ya trabajadas (hoy o antes).");
  const semana = lunesDe(d.fecha);
  if (await semanaCerrada(semana)) throw new Error(ERROR_SEMANA_CERRADA);
  const nucleo = await get<{ nombre: string }>(`SELECT nombre FROM nucleos_familiares WHERE id = ?`, [d.nucleo_id]);
  if (!nucleo) throw new ValidationError("nucleo_id", "Ese núcleo no existe.");
  const tramo = calcularTramo(d.hora_inicio, d.hora_fin, await obtenerHorarioObra());
  if (tramo.error) throw new ValidationError("hora_fin", tramo.error);
  const id = await insert("asistencias_horas", {
    nucleo_id: d.nucleo_id,
    comision_id: d.comision_id,
    fecha: d.fecha,
    semana,
    hora_inicio: d.hora_inicio,
    hora_fin: d.hora_fin,
    estado: "presente",
    minutos_planificados: 0,
    minutos_reales: tramo.minutos,
    observaciones: d.observaciones,
    origen: "sin_turno",
    confirmado_por_id: user.id,
  });
  await audit({
    usuario_id: user.id,
    accion: "registrar_horas_sin_turno",
    entidad: "asistencias_horas",
    entidad_id: id,
    valor_nuevo: { nucleo: nucleo.nombre, horario: `${textoDia(d.fecha)} ${d.hora_inicio}–${d.hora_fin}`, horas: textoHoras(tramo.minutos) },
  });
  revalidar(d.comision_id);
}

export async function registrarSinTurnoFormAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  return conEstadoDeAccion(() => registrarSinTurnoAction(formData));
}

// ---------- El socio avisa que no puede ir ----------

const avisoSchema = z.object({ asignacion_id: zId, motivo: zTexto(500) });

export async function avisarAusenciaAction(formData: FormData) {
  const user = await requireUser();
  const d = parseForm(avisoSchema, formData);
  const t = await turno(d.asignacion_id);
  const miNucleo = await nucleoDelUsuario(user.id, user.nucleo_id);
  if (miNucleo !== t.nucleo_id) throw new Error("Sólo podés avisar por los turnos de tu núcleo.");
  if (await semanaCerrada(t.semana)) throw new Error("Esa semana ya está cerrada: hablá con la Comisión de Trabajo.");
  const yaAvisado = await get<{ id: number }>(
    `SELECT id FROM avisos_ausencia WHERE asignacion_id = ? AND estado IN ('pendiente', 'aprobado')`,
    [t.id]
  );
  if (yaAvisado) throw new Error("Ya avisaste por este turno.");
  const archivo = formData.get("adjunto");
  const adjuntoUrl = await saveUploadedFile(archivo instanceof File ? archivo : null, user.organization_id, "avisos-ausencia", {
    tiposPermitidos: TIPOS_DOCUMENTO,
  });
  const id = await insert("avisos_ausencia", {
    asignacion_id: t.id,
    nucleo_id: t.nucleo_id,
    fecha: t.fecha,
    motivo: d.motivo,
    adjunto_url: adjuntoUrl,
    avisado_por_id: user.id,
  });
  await audit({
    usuario_id: user.id,
    accion: "avisar_ausencia",
    entidad: "avisos_ausencia",
    entidad_id: id,
    valor_nuevo: { nucleo: t.nucleo_nombre, turno: `${textoDia(t.fecha)} ${t.hora_inicio}–${t.hora_fin}`, motivo: d.motivo },
  });
  // Avisar a quienes organizan la Comisión de Trabajo.
  if (t.comision_id) {
    const coord = await all<{ user_id: number }>(
      `SELECT user_id FROM comision_miembros WHERE comision_id = ? AND activo = 1 AND rol_en_comision = 'coordinador'`,
      [t.comision_id]
    ).catch(() => []);
    await crearNotificacionesParaUsuarios(
      coord.map((c) => c.user_id).filter((uid) => uid !== user.id),
      {
        tipo: "aviso_ausencia",
        titulo: `${t.nucleo_nombre} avisa que no puede ir (${textoDia(t.fecha)})`,
        cuerpo: d.motivo,
        ref_tabla: "comisiones",
        ref_id: t.comision_id,
      }
    ).catch(() => {});
    revalidatePath(`/comisiones/${t.comision_id}`);
  }
  revalidatePath("/mis-horas");
}

export async function avisarAusenciaFormAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  return conEstadoDeAccion(() => avisarAusenciaAction(formData));
}

// ---------- La comisión aprueba o rechaza el aviso ----------

const revisarSchema = z.object({
  comision_id: zId,
  aviso_id: zId,
  decision: z.enum(["aprobado", "rechazado"], { message: "Elegí aprobar o rechazar." }),
  respuesta: zTextoOpcional(300),
});

export async function revisarAvisoAusenciaAction(formData: FormData) {
  const user = await requireUser();
  const d = parseForm(revisarSchema, formData);
  await comisionDeTrabajo(user, d.comision_id);
  const aviso = await get<{ id: number; asignacion_id: number; motivo: string; estado: string; avisado_por_id: number | null }>(
    `SELECT id, asignacion_id, motivo, estado, avisado_por_id FROM avisos_ausencia WHERE id = ?`,
    [d.aviso_id]
  );
  if (!aviso || aviso.estado !== "pendiente") throw new Error("Ese aviso ya fue revisado.");
  const t = await turno(aviso.asignacion_id);
  if (await semanaCerrada(t.semana)) throw new Error(ERROR_SEMANA_CERRADA);
  if (d.decision === "rechazado" && !d.respuesta) throw new ValidationError("respuesta", "Explicá por qué se rechaza (lo va a leer el socio).");

  await update("avisos_ausencia", aviso.id, {
    estado: d.decision,
    revisado_por_id: user.id,
    revisado_en: new Date().toISOString(),
    respuesta: d.respuesta,
  });
  if (d.decision === "aprobado") {
    await guardarAsistencia({
      t,
      comisionId: d.comision_id,
      estado: "ausente_justificada",
      minutosReales: 0,
      horaInicio: null,
      horaFin: null,
      observaciones: aviso.motivo,
      origen: "aviso",
      usuarioId: user.id,
    });
  }
  await audit({
    usuario_id: user.id,
    accion: d.decision === "aprobado" ? "aprobar_aviso_ausencia" : "rechazar_aviso_ausencia",
    entidad: "avisos_ausencia",
    entidad_id: aviso.id,
    valor_nuevo: { nucleo: t.nucleo_nombre, turno: `${textoDia(t.fecha)} ${t.hora_inicio}–${t.hora_fin}`, ...(d.respuesta ? { respuesta: d.respuesta } : {}) },
  });
  if (aviso.avisado_por_id) {
    await crearNotificacion({
      user_id: aviso.avisado_por_id,
      tipo: "aviso_ausencia_revisado",
      titulo: d.decision === "aprobado" ? `Tu falta del ${textoDia(t.fecha)} quedó justificada` : `Tu aviso del ${textoDia(t.fecha)} no fue aceptado`,
      cuerpo: d.respuesta ?? null,
      ref_tabla: "asignaciones_horas",
      ref_id: t.id,
    }).catch(() => {});
  }
  revalidar(d.comision_id);
}

export async function revisarAvisoAusenciaFormAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  return conEstadoDeAccion(() => revisarAvisoAusenciaAction(formData));
}

// ---------- Licencias (el núcleo no debe horas en ese período) ----------

const licenciaSchema = z.object({
  comision_id: zId,
  nucleo_id: z.coerce.number({ message: "Elegí un núcleo." }).int().positive("Elegí un núcleo."),
  desde: zFecha,
  hasta: zFecha,
  motivo: zTexto(300),
});

export async function registrarLicenciaAction(formData: FormData) {
  const user = await requireUser();
  const d = parseForm(licenciaSchema, formData);
  await comisionDeTrabajo(user, d.comision_id);
  if (d.hasta < d.desde) throw new ValidationError("hasta", "La fecha de fin tiene que ser igual o posterior a la de inicio.");
  const nucleo = await get<{ nombre: string }>(`SELECT nombre FROM nucleos_familiares WHERE id = ?`, [d.nucleo_id]);
  if (!nucleo) throw new ValidationError("nucleo_id", "Ese núcleo no existe.");
  const cerradaAfectada = await get<{ semana: string }>(
    `SELECT semana FROM cierres_semana_horas WHERE estado = 'cerrada' AND semana >= ? AND semana <= ? LIMIT 1`,
    [lunesDe(d.desde), d.hasta]
  ).catch(() => undefined);
  if (cerradaAfectada) {
    throw new ValidationError("desde", `La licencia toca una semana ya cerrada (${textoSemana(cerradaAfectada.semana)}). Reabrila primero o empezá la licencia después.`);
  }
  const id = await insert("licencias_horas", { nucleo_id: d.nucleo_id, desde: d.desde, hasta: d.hasta, motivo: d.motivo, registrada_por_id: user.id });
  await audit({
    usuario_id: user.id,
    accion: "registrar_licencia_horas",
    entidad: "licencias_horas",
    entidad_id: id,
    valor_nuevo: { nucleo: nucleo.nombre, desde: d.desde, hasta: d.hasta, motivo: d.motivo },
  });
  revalidar(d.comision_id);
}

export async function registrarLicenciaFormAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  return conEstadoDeAccion(() => registrarLicenciaAction(formData));
}

const anularLicenciaSchema = z.object({ comision_id: zId, licencia_id: zId, motivo: zTexto(300) });

export async function anularLicenciaAction(formData: FormData) {
  const user = await requireUser();
  const d = parseForm(anularLicenciaSchema, formData);
  await comisionDeTrabajo(user, d.comision_id);
  const l = await get<{ id: number; desde: string; hasta: string; anulada_en: string | null }>(`SELECT id, desde, hasta, anulada_en FROM licencias_horas WHERE id = ?`, [d.licencia_id]);
  if (!l || l.anulada_en) return;
  const cerrada = await get<{ semana: string }>(
    `SELECT semana FROM cierres_semana_horas WHERE estado = 'cerrada' AND semana >= ? AND semana <= ? LIMIT 1`,
    [lunesDe(l.desde), l.hasta]
  ).catch(() => undefined);
  if (cerrada) throw new Error("Esa licencia ya se usó en una semana cerrada. Reabrí la semana primero.");
  await update("licencias_horas", l.id, { anulada_en: new Date().toISOString(), anulada_por_id: user.id, motivo_anulacion: d.motivo });
  await audit({ usuario_id: user.id, accion: "anular_licencia_horas", entidad: "licencias_horas", entidad_id: l.id, valor_nuevo: { motivo: d.motivo } });
  revalidar(d.comision_id);
}

export async function anularLicenciaFormAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  return conEstadoDeAccion(() => anularLicenciaAction(formData));
}

// ---------- Cierre y reapertura de semanas ----------

const cerrarSchema = z.object({ comision_id: zId, semana: zFecha });

export async function cerrarSemanaAction(formData: FormData) {
  const user = await requireUser();
  const d = parseForm(cerrarSchema, formData);
  await comisionDeTrabajo(user, d.comision_id);
  const lunes = lunesDe(d.semana);
  const n = await cerrarSemanaHoras(lunes, hoyEnUruguay(), user.id);
  await audit({ usuario_id: user.id, accion: "cerrar_semana_horas", entidad: "cierres_semana_horas", entidad_id: 0, valor_nuevo: { semana: textoSemana(lunes), nucleos: n } });
  revalidar(d.comision_id);
}

export async function cerrarSemanaFormAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  return conEstadoDeAccion(() => cerrarSemanaAction(formData));
}

const reabrirSchema = z.object({ comision_id: zId, semana: zFecha, motivo: zTexto(300) });

export async function reabrirSemanaAction(formData: FormData) {
  const user = await requireUser();
  const d = parseForm(reabrirSchema, formData);
  await comisionDeTrabajo(user, d.comision_id);
  const lunes = lunesDe(d.semana);
  const c = await get<{ id: number; estado: string }>(`SELECT id, estado FROM cierres_semana_horas WHERE semana = ?`, [lunes]);
  if (!c || c.estado !== "cerrada") return;
  await update("cierres_semana_horas", c.id, {
    estado: "reabierta",
    reabierto_en: new Date().toISOString(),
    reabierto_por_id: user.id,
    motivo_reapertura: d.motivo,
  });
  await audit({
    usuario_id: user.id,
    accion: "reabrir_semana_horas",
    entidad: "cierres_semana_horas",
    entidad_id: c.id,
    valor_nuevo: { semana: textoSemana(lunes), motivo: d.motivo },
  });
  revalidar(d.comision_id);
}

export async function reabrirSemanaFormAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  return conEstadoDeAccion(() => reabrirSemanaAction(formData));
}

