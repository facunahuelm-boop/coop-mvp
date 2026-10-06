import { get } from "@/lib/db";
import type { SessionUser } from "@/lib/auth";
import { canRead } from "@/lib/roles";
import { puedePlanificarHorasTrabajo, ERROR_SIN_PERMISO_HORAS } from "@/lib/comisionAuth";
import { comisionDisponibleEnEtapa, funcionDe } from "@/lib/comisionesFunciones";

/**
 * Comisión de Trabajo: valida que la comisión exista, sea de función Trabajo,
 * esté disponible en la etapa actual y que el usuario pueda organizar sus
 * horas (coordinador/a, rol Comisión de Trabajo o conducción). Lo usan la
 * planificación (actions/horasTrabajo.ts) y la asistencia/libreta
 * (actions/asistenciaHoras.ts).
 */
export async function comisionDeTrabajo(user: SessionUser, comisionId: number) {
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
