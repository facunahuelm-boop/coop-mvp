import { insert, update, get, audit } from "@/lib/db";
import { textoDia, textoHoras } from "@/lib/horasObra";
import { ESTADOS_ASISTENCIA, ESTADO_ASISTENCIA_LABEL } from "@/lib/libretaHoras";

/**
 * Registro de la asistencia de un turno (Fase 1B), compartido por el
 * coordinador (actions/asistenciaHoras.ts) y la fichada por QR (Fase 3A).
 * No es una Server Action: recibe datos ya validados.
 */
export type Turno = { id: number; nucleo_id: number; nucleo_nombre: string; comision_id: number | null; fecha: string; semana: string; hora_inicio: string; hora_fin: string; minutos: number; estado: string };

export async function turno(id: number): Promise<Turno> {
  const t = await get<Turno>(
    `SELECT a.id, a.nucleo_id, n.nombre AS nucleo_nombre, a.comision_id, a.fecha, a.semana, a.hora_inicio, a.hora_fin, a.minutos, a.estado
       FROM asignaciones_horas a JOIN nucleos_familiares n ON n.id = a.nucleo_id WHERE a.id = ?`,
    [id]
  );
  if (!t || t.estado !== "activa") throw new Error("Ese turno ya no existe o fue cancelado.");
  return { ...t, minutos: Number(t.minutos) };
}


/** Guarda (o corrige) la asistencia de un turno. */
export async function guardarAsistencia(params: {
  t: Turno;
  comisionId: number | null;
  estado: (typeof ESTADOS_ASISTENCIA)[number];
  minutosReales: number;
  horaInicio: string | null;
  horaFin: string | null;
  observaciones: string | null;
  origen: "coordinador" | "aviso" | "qr";
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

