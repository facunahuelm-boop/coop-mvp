import { get } from "@/lib/db";

/** Fase 2H — en qué paso está el alta de la cooperativa («Tu cooperativa está lista»). */
export type EstadoAlta = {
  completada: boolean;
  modalidad: string;
  etapa: string;
  nombre: string;
  pasos: { datos: boolean; reglamento: boolean; socios: number; comisiones: number; usuarios: number };
  hechos: number;
};

export async function estadoAlta(orgId: number): Promise<EstadoAlta> {
  const org = await get<{ nombre: string; modalidad: string | null; etapa: string; alta_completada_en: string | null }>(
    `SELECT nombre, modalidad, etapa, alta_completada_en FROM organizations WHERE id = ?`,
    [orgId]
  ).catch(() => undefined);
  const n = async (sql: string) => Number((await get<{ n: string }>(sql).catch(() => undefined))?.n ?? 0);
  const [datos, reglamento, socios, comisiones, usuarios] = await Promise.all([
    n(`SELECT COUNT(*) AS n FROM auditoria WHERE accion = 'alta_datos'`),
    n(`SELECT COUNT(*) AS n FROM configuracion_reglas WHERE clave LIKE 'cuotas_%'`),
    n(`SELECT COUNT(*) AS n FROM socios WHERE estado NOT IN ('baja', 'egresado', 'excluido')`),
    n(`SELECT COUNT(*) AS n FROM comisiones WHERE activa = 1`),
    n(`SELECT COUNT(*) AS n FROM users WHERE activo = 1`),
  ]);
  const pasos = { datos: datos > 0, reglamento: reglamento > 0, socios, comisiones, usuarios };
  const hechos = [pasos.datos, pasos.reglamento, socios > 0, comisiones > 0, usuarios > 1].filter(Boolean).length;
  return {
    completada: !org || !!org.alta_completada_en,
    modalidad: org?.modalidad ?? "ayuda_mutua",
    etapa: org?.etapa ?? "obra",
    nombre: org?.nombre ?? "",
    pasos,
    hechos,
  };
}
