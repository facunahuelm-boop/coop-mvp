import { all } from "@/lib/db";
import {
  HORARIO_OBRA_DEFAULT,
  HORAS_SEMANALES_DEFAULT,
  esHoraValida,
  aMinutos,
  estadoHorasNucleo,
  sumarDias,
  type HorarioObra,
  type EstadoHorasNucleo,
} from "@/lib/horasObra";

/**
 * Comisión de Trabajo (05/10) — lecturas del calendario de horas. Todo
 * tolera que la migración 0050 todavía no esté aplicada (devuelve vacío).
 */

export const CLAVES_HORARIO_OBRA = {
  inicio: "obra_hora_inicio",
  fin: "obra_hora_fin",
  descansoInicio: "obra_descanso_inicio",
  descansoFin: "obra_descanso_fin",
} as const;

/** Horario de obra de la cooperativa (Configuración → Reglas), o el default 07–17 / descanso 12–13. */
export async function obtenerHorarioObra(): Promise<HorarioObra> {
  const filas = await all<{ clave: string; valor: string }>(
    `SELECT clave, valor FROM configuracion_reglas WHERE clave IN (?, ?, ?, ?)`,
    Object.values(CLAVES_HORARIO_OBRA)
  ).catch(() => [] as { clave: string; valor: string }[]);
  const por = Object.fromEntries(filas.map((f) => [f.clave, f.valor]));
  const h: HorarioObra = {
    inicio: esHoraValida(por[CLAVES_HORARIO_OBRA.inicio]) ? por[CLAVES_HORARIO_OBRA.inicio] : HORARIO_OBRA_DEFAULT.inicio,
    fin: esHoraValida(por[CLAVES_HORARIO_OBRA.fin]) ? por[CLAVES_HORARIO_OBRA.fin] : HORARIO_OBRA_DEFAULT.fin,
    descansoInicio: esHoraValida(por[CLAVES_HORARIO_OBRA.descansoInicio]) ? por[CLAVES_HORARIO_OBRA.descansoInicio] : HORARIO_OBRA_DEFAULT.descansoInicio,
    descansoFin: esHoraValida(por[CLAVES_HORARIO_OBRA.descansoFin]) ? por[CLAVES_HORARIO_OBRA.descansoFin] : HORARIO_OBRA_DEFAULT.descansoFin,
  };
  // Configuración inconsistente → default (nunca un horario imposible).
  const ok = aMinutos(h.inicio) < aMinutos(h.fin) && aMinutos(h.descansoInicio) <= aMinutos(h.descansoFin);
  return ok ? h : HORARIO_OBRA_DEFAULT;
}

export type AsignacionHoras = {
  id: number;
  comision_id: number | null;
  nucleo_id: number;
  nucleo_nombre: string;
  semana: string;
  fecha: string;
  hora_inicio: string;
  hora_fin: string;
  minutos: number;
  observaciones: string | null;
  creado_por_nombre: string | null;
  actualizado_en: string;
};

export type NucleoSemana = {
  id: number;
  nombre: string;
  objetivoHoras: number;
  minutos: number;
  estado: EstadoHorasNucleo;
};

export type SemanaHoras = {
  lunes: string;
  asignaciones: AsignacionHoras[];
  nucleos: NucleoSemana[];
  resumen: {
    nucleos: number;
    minutosProgramados: number;
    minutosObjetivo: number;
    completos: number;
    pendientes: number;
    exceso: number;
    sinHoras: number;
  };
};

/** Todo lo de una semana (lunes a domingo): asignaciones activas y estado de cada núcleo. */
export async function cargarSemanaHoras(lunes: string): Promise<SemanaHoras> {
  const [asignaciones, nucleos] = await Promise.all([
    all<AsignacionHoras>(
      `SELECT a.id, a.comision_id, a.nucleo_id, n.nombre AS nucleo_nombre, a.semana, a.fecha, a.hora_inicio, a.hora_fin,
              a.minutos, a.observaciones, u.nombre AS creado_por_nombre, a.actualizado_en
         FROM asignaciones_horas a
         JOIN nucleos_familiares n ON n.id = a.nucleo_id
         LEFT JOIN users u ON u.id = a.creado_por_id
        WHERE a.semana = ? AND a.estado = 'activa'
        ORDER BY a.fecha ASC, a.hora_inicio ASC, n.nombre ASC`,
      [lunes]
    ).catch(() => [] as AsignacionHoras[]),
    all<{ id: number; nombre: string; horas_semanales_objetivo: number | null }>(
      `SELECT id, nombre, horas_semanales_objetivo FROM nucleos_familiares ORDER BY nombre ASC`
    ).catch(() => [] as { id: number; nombre: string; horas_semanales_objetivo: number | null }[]),
  ]);

  const minutosPorNucleo = new Map<number, number>();
  for (const a of asignaciones) minutosPorNucleo.set(a.nucleo_id, (minutosPorNucleo.get(a.nucleo_id) || 0) + Number(a.minutos));

  const filas: NucleoSemana[] = nucleos.map((n) => {
    const objetivoHoras = Number(n.horas_semanales_objetivo) > 0 ? Number(n.horas_semanales_objetivo) : HORAS_SEMANALES_DEFAULT;
    const minutos = minutosPorNucleo.get(n.id) || 0;
    return { id: n.id, nombre: n.nombre, objetivoHoras, minutos, estado: estadoHorasNucleo(minutos, objetivoHoras) };
  });

  return {
    lunes,
    asignaciones: asignaciones.map((a) => ({ ...a, minutos: Number(a.minutos) })),
    nucleos: filas,
    resumen: {
      nucleos: filas.length,
      minutosProgramados: filas.reduce((s, n) => s + n.minutos, 0),
      minutosObjetivo: filas.reduce((s, n) => s + Math.round(n.objetivoHoras * 60), 0),
      completos: filas.filter((n) => n.estado === "completo").length,
      pendientes: filas.filter((n) => n.estado === "pendiente").length,
      exceso: filas.filter((n) => n.estado === "exceso").length,
      sinHoras: filas.filter((n) => n.estado === "sin_horas").length,
    },
  };
}

/** Próximo día (desde `hoy`) con horas asignadas, y cuántos núcleos trabajan ese día. */
export async function proximaJornadaHoras(hoy: string): Promise<{ fecha: string; nucleos: number } | null> {
  const fila = await all<{ fecha: string; nucleos: string }>(
    `SELECT fecha, COUNT(DISTINCT nucleo_id) AS nucleos FROM asignaciones_horas
      WHERE estado = 'activa' AND fecha >= ? AND fecha <= ?
      GROUP BY fecha ORDER BY fecha ASC LIMIT 1`,
    [hoy, sumarDias(hoy, 60)]
  ).catch(() => [] as { fecha: string; nucleos: string }[]);
  return fila[0] ? { fecha: fila[0].fecha, nucleos: Number(fila[0].nucleos) } : null;
}
