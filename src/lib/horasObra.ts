/**
 * Comisión de Trabajo (05/10) — cálculo de horas de obra. Funciones puras
 * (sin base de datos): las usa el servidor para validar y guardar, y el
 * navegador para mostrar el cálculo mientras se completa el formulario, así
 * los dos cuentan exactamente igual.
 *
 * Reglas:
 *  - Sólo se trabaja dentro del horario de obra (por defecto 07:00 a 17:00).
 *  - El descanso (por defecto 12:00 a 13:00) nunca cuenta como trabajado: un
 *    tramo que lo atraviesa (07:00 a 14:00) se cuenta en dos partes
 *    (07:00–12:00 = 5 h y 13:00–14:00 = 1 h → 6 h).
 *  - Un tramo no puede empezar ni terminar dentro del descanso.
 *  - Cada núcleo tiene su objetivo semanal (nucleos_familiares.
 *    horas_semanales_objetivo, 21 por defecto).
 */

export type HorarioObra = {
  inicio: string; // "07:00"
  fin: string; // "17:00"
  descansoInicio: string; // "12:00"
  descansoFin: string; // "13:00"
};

export const HORARIO_OBRA_DEFAULT: HorarioObra = {
  inicio: "07:00",
  fin: "17:00",
  descansoInicio: "12:00",
  descansoFin: "13:00",
};

export const HORAS_SEMANALES_DEFAULT = 21;

const RE_HORA = /^([01]\d|2[0-3]):([0-5]\d)$/;

export function esHoraValida(h: string | null | undefined): h is string {
  return !!h && RE_HORA.test(h);
}

export function aMinutos(h: string): number {
  const [hh, mm] = h.split(":").map(Number);
  return hh * 60 + mm;
}

export function aHora(min: number): string {
  return `${String(Math.floor(min / 60)).padStart(2, "0")}:${String(min % 60).padStart(2, "0")}`;
}

/** "5 h", "4,5 h", "30 min". */
export function textoHoras(minutos: number): string {
  if (minutos > 0 && minutos < 60) return `${minutos} min`;
  const h = Math.round((minutos / 60) * 100) / 100;
  return `${String(h).replace(".", ",")} h`;
}

export type CalculoTramo = {
  /** Mensaje de error si el tramo no se puede asignar. */
  error: string | null;
  minutos: number;
  /** Partes trabajadas (sin el descanso), para mostrar el cálculo. */
  partes: { inicio: string; fin: string; minutos: number }[];
  atraviesaDescanso: boolean;
};

export function calcularTramo(horaInicio: string, horaFin: string, horario: HorarioObra = HORARIO_OBRA_DEFAULT): CalculoTramo {
  const vacio = (error: string): CalculoTramo => ({ error, minutos: 0, partes: [], atraviesaDescanso: false });
  if (!esHoraValida(horaInicio) || !esHoraValida(horaFin)) return vacio("Completá la hora de inicio y la de finalización.");
  const ini = aMinutos(horaInicio);
  const fin = aMinutos(horaFin);
  const hIni = aMinutos(horario.inicio);
  const hFin = aMinutos(horario.fin);
  const dIni = aMinutos(horario.descansoInicio);
  const dFin = aMinutos(horario.descansoFin);

  if (fin <= ini) return vacio("La hora de finalización tiene que ser posterior a la de inicio.");
  if (ini < hIni || fin > hFin) {
    return vacio(`Ese horario está fuera del horario de obra (${horario.inicio} a ${horario.fin}).`);
  }
  const hayDescanso = dFin > dIni;
  if (hayDescanso && ini >= dIni && fin <= dFin) {
    return vacio(`El horario de ${horario.descansoInicio} a ${horario.descansoFin} corresponde al descanso.`);
  }
  if (hayDescanso && ((ini > dIni && ini < dFin) || (fin > dIni && fin < dFin))) {
    return vacio(`No se puede empezar ni terminar dentro del descanso (${horario.descansoInicio} a ${horario.descansoFin}).`);
  }

  const atraviesa = hayDescanso && ini < dIni && fin > dFin;
  const partes = atraviesa
    ? [
        { inicio: horaInicio, fin: horario.descansoInicio, minutos: dIni - ini },
        { inicio: horario.descansoFin, fin: horaFin, minutos: fin - dFin },
      ]
    : [{ inicio: horaInicio, fin: horaFin, minutos: fin - ini }];
  return { error: null, minutos: partes.reduce((a, p) => a + p.minutos, 0), partes, atraviesaDescanso: atraviesa };
}

/** ¿Se superponen dos tramos del mismo día? (bordes que se tocan no cuentan) */
export function seSuperponen(a: { hora_inicio: string; hora_fin: string }, b: { hora_inicio: string; hora_fin: string }): boolean {
  return aMinutos(a.hora_inicio) < aMinutos(b.hora_fin) && aMinutos(b.hora_inicio) < aMinutos(a.hora_fin);
}

// ---------- Estado semanal de un núcleo ----------

export type EstadoHorasNucleo = "completo" | "pendiente" | "exceso" | "sin_horas";

export const ESTADO_HORAS_LABEL: Record<EstadoHorasNucleo, string> = {
  completo: "Semana completa",
  pendiente: "Horas pendientes",
  exceso: "Con exceso",
  sin_horas: "Sin horas asignadas",
};

export function estadoHorasNucleo(minutosAsignados: number, horasObjetivo: number): EstadoHorasNucleo {
  const objetivo = Math.round(horasObjetivo * 60);
  if (minutosAsignados <= 0) return "sin_horas";
  if (minutosAsignados === objetivo) return "completo";
  return minutosAsignados > objetivo ? "exceso" : "pendiente";
}

/** "Faltan 5 h", "Semana completa", "Exceso de 3 h", "Sin horas asignadas". */
export function textoEstadoHoras(minutosAsignados: number, horasObjetivo: number): string {
  const objetivo = Math.round(horasObjetivo * 60);
  const estado = estadoHorasNucleo(minutosAsignados, horasObjetivo);
  if (estado === "completo") return "Semana completa";
  if (estado === "sin_horas") return "Sin horas asignadas";
  if (estado === "exceso") return `Exceso de ${textoHoras(minutosAsignados - objetivo)}`;
  return `Faltan ${textoHoras(objetivo - minutosAsignados)}`;
}

/** Fase 1B: saldo de la libreta en palabras ("3 h a favor", "Debe 5 h", "Al día"). */
export function textoSaldo(min: number): { texto: string; color: "verde" | "rojo" | "gray" } {
  if (min > 0) return { texto: `${textoHoras(min)} a favor`, color: "verde" };
  if (min < 0) return { texto: `Debe ${textoHoras(-min)}`, color: "rojo" };
  return { texto: "Al día", color: "gray" };
}

// ---------- Semanas (lunes a domingo) ----------

const pad = (n: number) => String(n).padStart(2, "0");
function aISO(d: Date): string {
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}
function deISO(iso: string): Date {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

export function esFechaISO(v: string | null | undefined): v is string {
  return !!v && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(deISO(v).getTime());
}

/** Lunes de la semana de esa fecha. */
export function lunesDe(fechaISO: string): string {
  const d = deISO(fechaISO);
  const dia = d.getUTCDay(); // 0 = domingo
  d.setUTCDate(d.getUTCDate() - (dia === 0 ? 6 : dia - 1));
  return aISO(d);
}

export function sumarDias(fechaISO: string, dias: number): string {
  const d = deISO(fechaISO);
  d.setUTCDate(d.getUTCDate() + dias);
  return aISO(d);
}

/** Los 7 días (lunes a domingo) de la semana que empieza en `lunes`. */
export function diasDeSemana(lunes: string): string[] {
  return Array.from({ length: 7 }, (_, i) => sumarDias(lunes, i));
}

export const NOMBRE_DIA = ["Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado", "Domingo"];
const MESES = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];

/** Índice 0..6 (lunes..domingo) de una fecha. */
export function indiceDia(fechaISO: string): number {
  const d = deISO(fechaISO).getUTCDay();
  return d === 0 ? 6 : d - 1;
}

/** "Lunes 05/10" */
export function textoDia(fechaISO: string): string {
  const [, m, d] = fechaISO.split("-");
  return `${NOMBRE_DIA[indiceDia(fechaISO)]} ${d}/${m}`;
}

/** "Semana del 5 al 11 de octubre" (o "del 28 de septiembre al 4 de octubre"). */
export function textoSemana(lunes: string): string {
  const domingo = sumarDias(lunes, 6);
  const [, m1, d1] = lunes.split("-").map(Number);
  const [y2, m2, d2] = domingo.split("-").map(Number);
  return m1 === m2
    ? `Semana del ${d1} al ${d2} de ${MESES[m2 - 1]}`
    : `Semana del ${d1} de ${MESES[m1 - 1]} al ${d2} de ${MESES[m2 - 1]}${y2 !== Number(lunes.slice(0, 4)) ? ` de ${y2}` : ""}`;
}

/** Fecha de hoy en Uruguay (el servidor corre en UTC). */
export function hoyEnUruguay(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: "America/Montevideo" });
}
