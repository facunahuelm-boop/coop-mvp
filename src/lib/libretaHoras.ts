import { all, get, withTenantTransaction } from "@/lib/db";
import { requireOrgContext } from "@/lib/tenant";
import { HORAS_SEMANALES_DEFAULT, lunesDe, sumarDias, diasDeSemana } from "@/lib/horasObra";

/**
 * Fase 1B "Horas con un solo número" (migración 0052).
 *
 * Un único recorrido para las horas de ayuda mutua:
 *   PLANIFICACIÓN (asignaciones_horas) → ASISTENCIA (asistencias_horas) → SALDO.
 *
 * Reglas (las de reglamento se configuran en configuracion_reglas):
 *  - Un turno planificado sin marcar, cuando su día ya pasó, se toma como
 *    trabajado ("presunto"): el coordinador marca las excepciones (faltas,
 *    llegadas tarde), no tiene que tildar a todos. Así una comisión de
 *    voluntarios no genera deudas falsas por no haber pasado lista.
 *  - Ausencia justificada (regla `horas_justificadas`):
 *      no_generan_deuda (por defecto): esas horas se descuentan del objetivo
 *        de la semana — no suman, pero tampoco dejan deuda;
 *      generan_deuda: se registran como justificadas pero hay que recuperarlas;
 *      cuentan_como_hechas: suman como si hubiera trabajado.
 *  - Licencia (licencias_horas): los días de licencia descuentan del objetivo
 *    en proporción (7 días de licencia = la semana no se debe).
 *  - Horas de más (regla `horas_a_favor`): por defecto se acumulan a favor;
 *    con "no_acumulan" una semana con exceso cierra en 0.
 *  - Saldo de la semana = horas reales − horas exigibles. Negativo = deuda.
 */

export type ReglaJustificadas = "no_generan_deuda" | "generan_deuda" | "cuentan_como_hechas";
export type ReglaAFavor = "acumulan" | "no_acumulan";
export type ReglasHoras = { justificadas: ReglaJustificadas; aFavor: ReglaAFavor };

export const REGLAS_HORAS_DEFAULT: ReglasHoras = { justificadas: "no_generan_deuda", aFavor: "acumulan" };

export const ESTADO_ASISTENCIA_LABEL: Record<string, string> = {
  presente: "Vino",
  tarde: "Llegó tarde",
  retiro_anticipado: "Se fue antes",
  ausente_justificada: "Faltó con aviso (justificada)",
  ausente_injustificada: "Faltó sin justificar",
  presunto: "Sin marcar (se toma como hecho)",
  pendiente: "Todavía no llegó el día",
};
export const ESTADOS_ASISTENCIA = ["presente", "tarde", "retiro_anticipado", "ausente_justificada", "ausente_injustificada"] as const;
export type EstadoAsistencia = (typeof ESTADOS_ASISTENCIA)[number];

export async function obtenerReglasHoras(): Promise<ReglasHoras> {
  const filas = await all<{ clave: string; valor: string }>(
    `SELECT clave, valor FROM configuracion_reglas WHERE clave IN ('horas_justificadas', 'horas_a_favor')`
  ).catch(() => [] as { clave: string; valor: string }[]);
  const por = Object.fromEntries(filas.map((f) => [f.clave, f.valor]));
  const j = por["horas_justificadas"];
  const f = por["horas_a_favor"];
  return {
    justificadas: j === "generan_deuda" || j === "cuentan_como_hechas" ? j : "no_generan_deuda",
    aFavor: f === "no_acumulan" ? "no_acumulan" : "acumulan",
  };
}

// ---------- Cálculo puro de una semana de un núcleo ----------

export type TurnoPlanificado = { id: number; fecha: string; hora_inicio: string; hora_fin: string; minutos: number };
export type AsistenciaRegistrada = {
  id: number;
  asignacion_id: number | null;
  fecha: string;
  estado: EstadoAsistencia;
  minutos_planificados: number;
  minutos_reales: number;
  hora_inicio: string | null;
  hora_fin: string | null;
  observaciones: string | null;
};
export type TurnoConEstado = TurnoPlanificado & {
  estado: EstadoAsistencia | "presunto" | "pendiente";
  minutosReales: number;
  asistenciaId: number | null;
  observaciones: string | null;
};

export type CalculoSemanaNucleo = {
  objetivoMin: number;
  /** Objetivo después de descontar licencia. */
  objetivoEfectivoMin: number;
  planificadoMin: number;
  realMin: number;
  justificadoMin: number;
  injustificadoMin: number;
  licenciaMin: number;
  /** Horas que se exigen esa semana (según la regla de justificadas). */
  exigibleMin: number;
  /** real − exigible (con la regla de horas a favor aplicada). Negativo = deuda. */
  saldoMin: number;
  /** Lo que todavía falta hacer esta semana (0 si ya cumplió). */
  faltanMin: number;
  turnos: TurnoConEstado[];
  /** Turnos ya pasados sin marcar. */
  presuntos: number;
};

export function calcularSemanaNucleo(params: {
  objetivoHoras: number;
  turnos: TurnoPlanificado[];
  asistencias: AsistenciaRegistrada[];
  diasLicencia: number;
  hoy: string;
  reglas: ReglasHoras;
}): CalculoSemanaNucleo {
  const { turnos, asistencias, hoy, reglas } = params;
  const objetivoMin = Math.round((params.objetivoHoras > 0 ? params.objetivoHoras : HORAS_SEMANALES_DEFAULT) * 60);
  const diasLic = Math.max(0, Math.min(7, params.diasLicencia));
  const licenciaMin = Math.round((objetivoMin * diasLic) / 7);
  const objetivoEfectivoMin = objetivoMin - licenciaMin;

  const porTurno = new Map<number, AsistenciaRegistrada>();
  for (const a of asistencias) if (a.asignacion_id) porTurno.set(a.asignacion_id, a);

  let realMin = 0;
  let justificadoMin = 0;
  let injustificadoMin = 0;
  let presuntos = 0;
  const conEstado: TurnoConEstado[] = turnos.map((t) => {
    const a = porTurno.get(t.id);
    if (a) {
      if (a.estado === "ausente_justificada") justificadoMin += Number(a.minutos_planificados || t.minutos);
      else if (a.estado === "ausente_injustificada") injustificadoMin += Number(a.minutos_planificados || t.minutos);
      else realMin += Number(a.minutos_reales);
      return { ...t, estado: a.estado, minutosReales: Number(a.minutos_reales), asistenciaId: a.id, observaciones: a.observaciones };
    }
    if (t.fecha < hoy) {
      presuntos++;
      realMin += Number(t.minutos);
      return { ...t, estado: "presunto", minutosReales: Number(t.minutos), asistenciaId: null, observaciones: null };
    }
    return { ...t, estado: "pendiente", minutosReales: 0, asistenciaId: null, observaciones: null };
  });
  // Núcleo que vino sin turno planificado.
  for (const a of asistencias) {
    if (!a.asignacion_id && a.estado !== "ausente_justificada" && a.estado !== "ausente_injustificada") realMin += Number(a.minutos_reales);
  }

  let exigibleMin = objetivoEfectivoMin;
  let computable = realMin;
  if (reglas.justificadas === "no_generan_deuda") exigibleMin = Math.max(0, objetivoEfectivoMin - justificadoMin);
  if (reglas.justificadas === "cuentan_como_hechas") computable = realMin + justificadoMin;
  let saldoMin = computable - exigibleMin;
  if (saldoMin > 0 && reglas.aFavor === "no_acumulan") saldoMin = 0;

  return {
    objetivoMin,
    objetivoEfectivoMin,
    planificadoMin: turnos.reduce((s, t) => s + Number(t.minutos), 0),
    realMin,
    justificadoMin,
    injustificadoMin,
    licenciaMin,
    exigibleMin,
    saldoMin,
    faltanMin: Math.max(0, exigibleMin - computable),
    turnos: conEstado,
    presuntos,
  };
}

/** Cuántos días (0..7) de la semana que empieza en `lunes` caen dentro de alguna licencia. */
export function diasDeLicenciaEnSemana(lunes: string, licencias: { desde: string; hasta: string }[]): number {
  return diasDeSemana(lunes).filter((d) => licencias.some((l) => l.desde <= d && d <= l.hasta)).length;
}

// ---------- Lecturas ----------

export type NucleoHoras = { id: number; nombre: string; objetivoHoras: number; horasAnteriores: number };

/**
 * Núcleos que deben horas: todos, salvo los que tienen socios vinculados y
 * ninguno está activo (núcleo dado de baja).
 */
export async function nucleosQueDebenHoras(): Promise<NucleoHoras[]> {
  const filas = await all<{ id: number; nombre: string; horas_semanales_objetivo: number | null; horas_acumuladas: number | null; socios: string; activos: string }>(
    `SELECT n.id, n.nombre, n.horas_semanales_objetivo, n.horas_acumuladas,
            (SELECT COUNT(*) FROM socios s WHERE s.nucleo_id = n.id) AS socios,
            (SELECT COUNT(*) FROM socios s WHERE s.nucleo_id = n.id AND s.estado IN ('activo', 'suspendido', 'renunciante')) AS activos
       FROM nucleos_familiares n ORDER BY n.nombre ASC`
  ).catch(() => []);
  return filas
    .filter((n) => Number(n.socios) === 0 || Number(n.activos) > 0)
    .map((n) => ({
      id: n.id,
      nombre: n.nombre,
      objetivoHoras: Number(n.horas_semanales_objetivo) > 0 ? Number(n.horas_semanales_objetivo) : HORAS_SEMANALES_DEFAULT,
      horasAnteriores: Number(n.horas_acumuladas) || 0,
    }));
}

/** Primera semana con horas planificadas en la cooperativa (desde ahí se cuentan saldos). */
export async function semanaDeInicioHoras(): Promise<string | null> {
  const f = await get<{ semana: string | null }>(`SELECT MIN(semana) AS semana FROM asignaciones_horas WHERE estado = 'activa'`).catch(() => undefined);
  return f?.semana ?? null;
}

type DatosSemana = {
  turnos: (TurnoPlanificado & { nucleo_id: number })[];
  asistencias: (AsistenciaRegistrada & { nucleo_id: number })[];
  licencias: { nucleo_id: number; desde: string; hasta: string }[];
};

async function datosDeSemana(lunes: string, nucleoId?: number): Promise<DatosSemana> {
  const domingo = sumarDias(lunes, 6);
  const filtro = nucleoId ? " AND nucleo_id = ?" : "";
  const extra = nucleoId ? [nucleoId] : [];
  const [turnos, asistencias, licencias] = await Promise.all([
    all<TurnoPlanificado & { nucleo_id: number }>(
      `SELECT id, nucleo_id, fecha, hora_inicio, hora_fin, minutos FROM asignaciones_horas
        WHERE semana = ? AND estado = 'activa'${filtro} ORDER BY fecha, hora_inicio`,
      [lunes, ...extra]
    ).catch(() => []),
    all<AsistenciaRegistrada & { nucleo_id: number }>(
      `SELECT id, asignacion_id, nucleo_id, fecha, estado, minutos_planificados, minutos_reales, hora_inicio, hora_fin, observaciones
         FROM asistencias_horas WHERE semana = ? AND anulado_en IS NULL${filtro}`,
      [lunes, ...extra]
    ).catch(() => []),
    all<{ nucleo_id: number; desde: string; hasta: string }>(
      `SELECT nucleo_id, desde, hasta FROM licencias_horas
        WHERE anulada_en IS NULL AND desde <= ? AND hasta >= ?${filtro}`,
      [domingo, lunes, ...extra]
    ).catch(() => []),
  ]);
  return {
    turnos: turnos.map((t) => ({ ...t, minutos: Number(t.minutos) })),
    asistencias: asistencias.map((a) => ({ ...a, minutos_planificados: Number(a.minutos_planificados), minutos_reales: Number(a.minutos_reales) })),
    licencias,
  };
}

/** Cálculo en vivo de una semana para todos los núcleos (o uno solo). */
export async function calcularSemana(lunes: string, hoy: string, opciones?: { nucleoId?: number; reglas?: ReglasHoras; nucleos?: NucleoHoras[] }) {
  const [reglas, nucleos, datos] = await Promise.all([
    opciones?.reglas ? Promise.resolve(opciones.reglas) : obtenerReglasHoras(),
    opciones?.nucleos ? Promise.resolve(opciones.nucleos) : nucleosQueDebenHoras(),
    datosDeSemana(lunes, opciones?.nucleoId),
  ]);
  const lista = opciones?.nucleoId ? nucleos.filter((n) => n.id === opciones.nucleoId) : nucleos;
  return lista.map((n) => ({
    nucleo: n,
    calculo: calcularSemanaNucleo({
      objetivoHoras: n.objetivoHoras,
      turnos: datos.turnos.filter((t) => t.nucleo_id === n.id),
      asistencias: datos.asistencias.filter((a) => a.nucleo_id === n.id),
      diasLicencia: diasDeLicenciaEnSemana(lunes, datos.licencias.filter((l) => l.nucleo_id === n.id)),
      hoy,
      reglas,
    }),
  }));
}

export type SemanaLibreta = {
  semana: string;
  cerrada: boolean;
  objetivoMin: number;
  realMin: number;
  justificadoMin: number;
  injustificadoMin: number;
  licenciaMin: number;
  saldoMin: number;
};

export type LibretaNucleo = {
  nucleo: NucleoHoras;
  semanas: SemanaLibreta[];
  /** Suma de saldos de las semanas cerradas. */
  saldoAcumuladoMin: number;
  /** Horas trabajadas en total (sistema nuevo). */
  horasTrabajadasMin: number;
  semanaActual: CalculoSemanaNucleo | null;
};

/**
 * Libreta de horas: semanas cerradas (foto guardada) + la semana en curso
 * calculada en vivo. El saldo acumulado sólo suma semanas cerradas.
 */
export async function cargarLibretas(hoy: string, nucleoId?: number): Promise<LibretaNucleo[]> {
  const lunesActual = lunesDe(hoy);
  const [nucleos, saldos, actual] = await Promise.all([
    nucleosQueDebenHoras(),
    all<{ nucleo_id: number; semana: string; objetivo_min: number; real_min: number; justificado_min: number; injustificado_min: number; licencia_min: number; saldo_min: number }>(
      `SELECT s.nucleo_id, s.semana, s.objetivo_min, s.real_min, s.justificado_min, s.injustificado_min, s.licencia_min, s.saldo_min
         FROM saldos_horas_semana s
         JOIN cierres_semana_horas c ON c.semana = s.semana AND c.estado = 'cerrada'
        ${nucleoId ? "WHERE s.nucleo_id = ?" : ""}
        ORDER BY s.semana DESC`,
      nucleoId ? [nucleoId] : []
    ).catch(() => []),
    calcularSemana(lunesActual, hoy, nucleoId ? { nucleoId } : undefined),
  ]);
  const lista = nucleoId ? nucleos.filter((n) => n.id === nucleoId) : nucleos;
  return lista.map((n) => {
    const propias = saldos.filter((s) => s.nucleo_id === n.id);
    const semanas: SemanaLibreta[] = propias.map((s) => ({
      semana: s.semana,
      cerrada: true,
      objetivoMin: Number(s.objetivo_min),
      realMin: Number(s.real_min),
      justificadoMin: Number(s.justificado_min),
      injustificadoMin: Number(s.injustificado_min),
      licenciaMin: Number(s.licencia_min),
      saldoMin: Number(s.saldo_min),
    }));
    const enCurso = actual.find((a) => a.nucleo.id === n.id)?.calculo ?? null;
    return {
      nucleo: n,
      semanas,
      saldoAcumuladoMin: semanas.reduce((s, x) => s + x.saldoMin, 0),
      horasTrabajadasMin: semanas.reduce((s, x) => s + x.realMin, 0) + (enCurso?.realMin ?? 0),
      semanaActual: enCurso,
    };
  });
}

/** Semanas pasadas (desde el inicio del cómputo) que todavía no se cerraron. */
export async function semanasSinCerrar(hoy: string, maxSemanas = 12): Promise<string[]> {
  const inicio = await semanaDeInicioHoras();
  if (!inicio) return [];
  const cerradas = new Set(
    (await all<{ semana: string }>(`SELECT semana FROM cierres_semana_horas WHERE estado = 'cerrada'`).catch(() => [])).map((c) => c.semana)
  );
  const lunesActual = lunesDe(hoy);
  const pendientes: string[] = [];
  for (let l = lunesDe(inicio); l < lunesActual; l = sumarDias(l, 7)) if (!cerradas.has(l)) pendientes.push(l);
  return pendientes.slice(-maxSemanas);
}

/** Núcleo del usuario (por su ficha de socio o por users.nucleo_id). */
export async function nucleoDelUsuario(userId: number, nucleoIdSesion: number | null): Promise<number | null> {
  const s = await get<{ nucleo_id: number | null }>(`SELECT nucleo_id FROM socios WHERE user_id = ? AND nucleo_id IS NOT NULL ORDER BY id LIMIT 1`, [userId]).catch(() => undefined);
  return s?.nucleo_id ?? nucleoIdSesion ?? null;
}

/** ¿La semana (lunes) ya está cerrada en la libreta? Mientras esté cerrada no se cambian sus horas. */
export async function semanaCerrada(lunes: string): Promise<boolean> {
  const f = await get<{ id: number }>(`SELECT id FROM cierres_semana_horas WHERE semana = ? AND estado = 'cerrada'`, [lunes]).catch(() => undefined);
  return !!f;
}

/**
 * Cierra una semana ya terminada: guarda el saldo de cada núcleo (foto para
 * la libreta) y la marca cerrada. Si estaba reabierta, se vuelve a calcular.
 * La usan el botón "Cerrar semana" (usuarioId) y el cierre automático diario
 * (usuarioId = null). Devuelve cuántos núcleos se calcularon.
 */
export async function cerrarSemanaHoras(lunes: string, hoy: string, usuarioId: number | null): Promise<number> {
  if (lunes >= lunesDe(hoy)) throw new Error("Sólo se puede cerrar una semana que ya terminó.");
  const orgId = await requireOrgContext();
  const filas = await calcularSemana(lunes, hoy);
  await withTenantTransaction(async (tx) => {
    for (const { nucleo, calculo: c } of filas) {
      await tx.run(
        `INSERT INTO saldos_horas_semana
           (organization_id, nucleo_id, semana, objetivo_min, planificado_min, real_min, justificado_min, injustificado_min, licencia_min, saldo_min, calculado_en)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, now()::text)
         ON CONFLICT (organization_id, nucleo_id, semana) DO UPDATE SET
           objetivo_min = EXCLUDED.objetivo_min, planificado_min = EXCLUDED.planificado_min, real_min = EXCLUDED.real_min,
           justificado_min = EXCLUDED.justificado_min, injustificado_min = EXCLUDED.injustificado_min,
           licencia_min = EXCLUDED.licencia_min, saldo_min = EXCLUDED.saldo_min, calculado_en = now()::text`,
        [orgId, nucleo.id, lunes, c.objetivoMin, c.planificadoMin, c.realMin, c.justificadoMin, c.injustificadoMin, c.licenciaMin, c.saldoMin]
      );
    }
    await tx.run(
      `INSERT INTO cierres_semana_horas (organization_id, semana, estado, cerrado_en, cerrado_por_id)
       VALUES (?, ?, 'cerrada', now()::text, ?)
       ON CONFLICT (organization_id, semana) DO UPDATE SET estado = 'cerrada', cerrado_en = now()::text, cerrado_por_id = EXCLUDED.cerrado_por_id`,
      [orgId, lunes, usuarioId]
    );
  });
  return filas.length;
}
