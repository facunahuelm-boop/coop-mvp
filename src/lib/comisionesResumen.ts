import { all } from "@/lib/db";
import dayjs from "dayjs";
import { FUNCION_COMISION, funcionDe, comisionDisponibleEnEtapa } from "@/lib/comisionesFunciones";
import { cargarSemanaHoras, proximaJornadaHoras } from "@/lib/horasTrabajo";
import { hoyEnUruguay, lunesDe, sumarDias, textoDia, textoHoras, NOMBRE_DIA, indiceDia } from "@/lib/horasObra";
import type { ComisionResumen } from "@/components/comisiones/ComisionResumenCard";

/**
 * Comisiones como áreas de trabajo (05/10) — datos del tablero de
 * Comisiones: una tarjeta-resumen por comisión. Pocas consultas agregadas
 * (no una por comisión). Cada función puede aportar su propia métrica: hoy
 * Trabajo muestra las horas de la semana; el resto, sus tareas pendientes.
 */

export type ComisionRow = {
  id: number;
  nombre: string;
  descripcion: string | null;
  objetivo: string | null;
  tipo: string | null;
  fecha_inicio: string | null;
  fecha_fin: string | null;
  comision_padre_id: number | null;
  actualizado_en: string;
  funcion?: string | null;
  etapas?: string | null;
};

type Miembro = { comision_id: number; user_id: number; nombre: string; rol_en_comision: string };

export async function cargarResumenComisiones(comisiones: ComisionRow[], etapa: string) {
  const hoy = hoyEnUruguay();
  const lunes = lunesDe(hoy);
  const domingo = sumarDias(lunes, 6);
  const disponibles = comisiones.filter((c) => comisionDisponibleEnEtapa(c, etapa));
  const fueraDeEtapa = comisiones.filter((c) => !comisionDisponibleEnEtapa(c, etapa));
  const hayTrabajo = disponibles.some((c) => funcionDe(c.funcion) === "trabajo");

  const [miembros, tareas, reuniones, actividades, decisiones, semanaHoras, proximaHoras] = await Promise.all([
    all<Miembro>(
      `SELECT m.comision_id, m.user_id, u.nombre, m.rol_en_comision FROM comision_miembros m JOIN users u ON u.id = m.user_id
        WHERE m.activo = 1 ORDER BY CASE m.rol_en_comision WHEN 'coordinador' THEN 0 WHEN 'integrante' THEN 1 ELSE 2 END, u.nombre ASC`
    ),
    all<{ comision_id: number; pendientes: string; vencidas: string; esta_semana: string }>(
      `SELECT comision_id,
              COUNT(*) FILTER (WHERE estado <> 'completada') AS pendientes,
              COUNT(*) FILTER (WHERE estado <> 'completada' AND fecha_vencimiento IS NOT NULL AND fecha_vencimiento < ?) AS vencidas,
              COUNT(*) FILTER (WHERE estado <> 'completada' AND fecha_vencimiento BETWEEN ? AND ?) AS esta_semana
         FROM tareas GROUP BY comision_id`,
      [hoy, lunes, domingo]
    ).catch(() => []),
    all<{ comision_id: number; titulo: string; fecha: string }>(
      `SELECT comision_id, titulo, fecha FROM reuniones
        WHERE comision_id IS NOT NULL AND estado = 'planificada' AND substr(fecha::text, 1, 10) >= ? ORDER BY fecha ASC`,
      [hoy]
    ).catch(() => []),
    all<{ comision_id: number; titulo: string; fecha: string; hora: string | null }>(
      `SELECT comision_id, titulo, fecha, hora FROM notas_calendario
        WHERE comision_id IS NOT NULL AND fecha >= ? ORDER BY fecha ASC, hora ASC NULLS FIRST`,
      [hoy]
    ).catch(() => []),
    all<{ comision_id: number; pendientes: string }>(
      `SELECT comision_id, COUNT(*) AS pendientes FROM decisiones_comision WHERE resultado = 'pendiente' GROUP BY comision_id`
    ).catch(() => []),
    hayTrabajo ? cargarSemanaHoras(lunes) : Promise.resolve(null),
    hayTrabajo ? proximaJornadaHoras(hoy) : Promise.resolve(null),
  ]);

  const diaCorto = (fecha: string) => {
    const f = fecha.slice(0, 10);
    if (f === hoy) return "Hoy";
    if (f === sumarDias(hoy, 1)) return "Mañana";
    return f < sumarDias(hoy, 7) ? NOMBRE_DIA[indiceDia(f)] : dayjs(f).format("DD/MM");
  };

  const tarjetas: ComisionResumen[] = disponibles.map((c) => {
    const funcion = funcionDe(c.funcion);
    const integrantes = miembros.filter((m) => m.comision_id === c.id);
    const coordinadores = integrantes.filter((m) => m.rol_en_comision === "coordinador").map((m) => m.nombre);
    const t = tareas.find((x) => x.comision_id === c.id);
    const pendientes = Number(t?.pendientes || 0);
    const vencidas = Number(t?.vencidas || 0);
    const decPend = Number(decisiones.find((d) => d.comision_id === c.id)?.pendientes || 0);
    const proxReunion = reuniones.find((r) => r.comision_id === c.id);
    const proxActividad = actividades.find((a) => a.comision_id === c.id);

    // Próxima actividad: lo más cercano entre reunión, actividad del
    // calendario y (Trabajo) el próximo día con horas asignadas.
    const candidatos: { fecha: string; texto: string }[] = [];
    if (proxReunion) candidatos.push({ fecha: proxReunion.fecha.slice(0, 10), texto: `${diaCorto(proxReunion.fecha)} — ${proxReunion.titulo}` });
    if (proxActividad) candidatos.push({ fecha: proxActividad.fecha, texto: `${diaCorto(proxActividad.fecha)} — ${proxActividad.titulo}` });
    if (funcion === "trabajo" && proximaHoras) {
      candidatos.push({ fecha: proximaHoras.fecha, texto: `${diaCorto(proximaHoras.fecha)} — Jornada de obra (${proximaHoras.nucleos} núcleo${proximaHoras.nucleos === 1 ? "" : "s"})` });
    }
    candidatos.sort((a, b) => (a.fecha < b.fecha ? -1 : 1));

    let metrica: ComisionResumen["metrica"] = { label: "Tareas pendientes", valor: vencidas ? `${pendientes} (${vencidas} vencida${vencidas === 1 ? "" : "s"})` : String(pendientes) };
    const semana: string[] = [];
    let conHorasEstaSemana = false;
    if (funcion === "trabajo" && semanaHoras) {
      const r = semanaHoras.resumen;
      conHorasEstaSemana = r.minutosProgramados > 0;
      metrica = { label: "Esta semana", valor: `${textoHoras(r.minutosProgramados).replace(" h", "")} / ${textoHoras(r.minutosObjetivo)}` };
      semana.push(`${r.completos} de ${r.nucleos} núcleos con la semana completa`);
      if (r.pendientes) semana.push(`${r.pendientes} con horas pendientes`);
      if (r.sinHoras) semana.push(`${r.sinHoras} sin horas asignadas`);
      if (r.exceso) semana.push(`${r.exceso} con exceso de horas`);
    } else {
      const estaSemana = Number(t?.esta_semana || 0);
      if (estaSemana) semana.push(`${estaSemana} tarea${estaSemana === 1 ? "" : "s"} vence${estaSemana === 1 ? "" : "n"} esta semana`);
    }

    const actividad: string[] = [];
    if (funcion === "trabajo") actividad.push(`Tareas pendientes: ${pendientes}${vencidas ? ` (${vencidas} vencidas)` : ""}`);
    if (decPend) actividad.push(`Decisiones pendientes: ${decPend}`);
    if (proxReunion) actividad.push(`Próxima reunión: ${textoDia(proxReunion.fecha.slice(0, 10))} ${proxReunion.fecha.slice(11, 16)}`.trim());

    const enActividad = pendientes > 0 || conHorasEstaSemana || candidatos.some((x) => x.fecha <= sumarDias(hoy, 14));
    const estado: ComisionResumen["estado"] =
      integrantes.length === 0
        ? { label: "Sin integrantes", color: "amarillo" }
        : enActividad
          ? { label: "En actividad", color: "verde" }
          : { label: "Sin actividad", color: "gray" };

    return {
      id: c.id,
      nombre: c.nombre,
      descripcion: c.descripcion,
      objetivo: c.objetivo,
      funcionLabel: `Función: ${FUNCION_COMISION[funcion].label}`,
      responsable: coordinadores.join(", ") || null,
      integrantes: integrantes.map((m) => ({ userId: m.user_id, nombre: m.nombre, rol: m.rol_en_comision })),
      estado,
      metrica,
      proxima: candidatos[0]?.texto ?? null,
      semana,
      actividad,
    };
  });

  return { tarjetas, fueraDeEtapa };
}
