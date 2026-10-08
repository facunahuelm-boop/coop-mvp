import { all } from "@/lib/db";
import { REGLAS_HORAS_DEFAULT, type ReglasHoras } from "@/lib/libretaHoras";

/**
 * Fase 1C — "Reglamento de la cooperativa": todos los parámetros que antes
 * estaban fijos en el código o en la cabeza de alguien, en un solo lugar
 * (tabla configuracion_reglas, clave/valor por cooperativa). Los valores por
 * defecto son conservadores: nada automático está prendido hasta que la
 * cooperativa lo revisa y lo activa.
 */

export type TipoRecargo = "ninguno" | "porcentaje" | "fijo";

export type Reglamento = {
  cuotas: {
    automaticas: boolean;
    diaGeneracion: number;
    diaVencimiento: number;
    monto: number;
    concepto: string;
    diasGracia: number;
    recargoTipo: TipoRecargo;
    recargoValor: number;
    avisos: boolean;
  };
  recibos: { porEmail: boolean };
  horas: ReglasHoras;
  ayuda: { telefono: string; horario: string };
  seguridad: { exigir2fa: boolean };
  /** Fase 2A: % del presupuesto de un rubro que dispara el aviso (A18) y día del mes en que se recuerda cerrar el mes anterior. */
  finanzas: { alertaPresupuesto: number; avisoCierreDia: number; conciliacionAutomatica: boolean };
  /** Fase 2D: lo que el estatuto dice de las asambleas. */
  asambleas: {
    anticipacionOrdinaria: number;
    anticipacionExtraordinaria: number;
    plazoModo: "avisar" | "bloquear";
    quorumPrimera: number;
    quorumSegunda: number;
    minutosSegunda: number;
    maxCuotasVencidas: number | null;
    antiguedadMinimaMeses: number;
    poderes: boolean;
    poderesMax: number;
    voto: "titular" | "persona";
  };
  /** Fase 2F: resumen de los lunes (A20). */
  difusion: { resumenSemanal: boolean };
  /** Fase 2G (A14): compras grandes. montoFormal 0 = no hay regla. */
  compras: { montoFormal: number; presupuestosMinimos: number; aprobacion: "tesoreria_o_consejo" | "consejo" };
  /** Fase 3E: qué pasa al asignar horas de obra a un núcleo sin nadie con la inducción de seguridad. */
  obra: { induccionModo: "avisar" | "bloquear" };
  /** Fase 3I: A25 (deuda de horas → medida propuesta) y A28 (reclamo sin respuesta → escalar). 0 = apagado. */
  seguimiento: { deudaHorasUmbral: number; deudaHorasMedida: string; reclamosDiasEscalar: number };
};

export const CLAVES_REGLAMENTO = [
  "cuotas_automaticas",
  "cuotas_dia_generacion",
  "cuotas_dia_vencimiento",
  "cuotas_monto",
  "cuotas_concepto",
  "cuotas_dias_gracia",
  "recargo_tipo",
  "recargo_valor",
  "avisos_cuotas",
  "recibos_por_email",
  "horas_justificadas",
  "horas_a_favor",
  "ayuda_telefono",
  "ayuda_horario",
  "seguridad_exigir_2fa",
  "presupuesto_alerta_porcentaje",
  "cierre_aviso_dia",
  "conciliacion_autoconfirmar",
  "asamblea_anticipacion_ordinaria",
  "asamblea_anticipacion_extraordinaria",
  "asamblea_plazo_modo",
  "asamblea_quorum_primera",
  "asamblea_quorum_segunda",
  "asamblea_minutos_segunda",
  "asamblea_max_cuotas_vencidas",
  "asamblea_antiguedad_minima_meses",
  "asamblea_poderes",
  "asamblea_poderes_max",
  "asamblea_voto",
  "avisos_resumen_semanal",
  "compras_monto_formal",
  "compras_presupuestos_minimos",
  "compras_aprobacion",
  "seguridad_induccion_modo",
  "horas_deuda_umbral",
  "horas_deuda_medida",
  "reclamos_dias_escalar",
] as const;

export const REGLAMENTO_DEFAULT: Reglamento = {
  cuotas: {
    automaticas: false,
    diaGeneracion: 1,
    diaVencimiento: 10,
    monto: 0,
    concepto: "Cuota social",
    diasGracia: 5,
    recargoTipo: "ninguno",
    recargoValor: 0,
    avisos: false,
  },
  recibos: { porEmail: false },
  horas: REGLAS_HORAS_DEFAULT,
  ayuda: { telefono: "", horario: "" },
  seguridad: { exigir2fa: false },
  finanzas: { alertaPresupuesto: 90, avisoCierreDia: 10, conciliacionAutomatica: false },
  asambleas: {
    anticipacionOrdinaria: 10,
    anticipacionExtraordinaria: 5,
    plazoModo: "avisar",
    quorumPrimera: 50,
    quorumSegunda: 0,
    minutosSegunda: 30,
    maxCuotasVencidas: null,
    antiguedadMinimaMeses: 0,
    poderes: false,
    poderesMax: 1,
    voto: "titular",
  },
  difusion: { resumenSemanal: false },
  compras: { montoFormal: 0, presupuestosMinimos: 3, aprobacion: "tesoreria_o_consejo" },
  obra: { induccionModo: "avisar" },
  seguimiento: { deudaHorasUmbral: 0, deudaHorasMedida: "Citación de la Comisión de Trabajo según el reglamento interno", reclamosDiasEscalar: 0 },
};

const entero = (v: string | undefined, def: number, min: number, max: number) => {
  const n = Number(v);
  return Number.isInteger(n) && n >= min && n <= max ? n : def;
};
const numero = (v: string | undefined, def: number) => {
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? n : def;
};

export async function obtenerReglamento(): Promise<Reglamento> {
  const filas = await all<{ clave: string; valor: string }>(
    `SELECT clave, valor FROM configuracion_reglas WHERE clave = ANY(?::text[])`,
    [[...CLAVES_REGLAMENTO]]
  ).catch(() => [] as { clave: string; valor: string }[]);
  const v = Object.fromEntries(filas.map((f) => [f.clave, f.valor])) as Record<string, string | undefined>;
  const d = REGLAMENTO_DEFAULT;
  const recargo = v.recargo_tipo;
  const just = v.horas_justificadas;
  return {
    cuotas: {
      automaticas: v.cuotas_automaticas === "si",
      diaGeneracion: entero(v.cuotas_dia_generacion, d.cuotas.diaGeneracion, 1, 28),
      diaVencimiento: entero(v.cuotas_dia_vencimiento, d.cuotas.diaVencimiento, 1, 28),
      monto: numero(v.cuotas_monto, d.cuotas.monto),
      concepto: v.cuotas_concepto?.trim() || d.cuotas.concepto,
      diasGracia: entero(v.cuotas_dias_gracia, d.cuotas.diasGracia, 0, 60),
      recargoTipo: recargo === "porcentaje" || recargo === "fijo" ? recargo : "ninguno",
      recargoValor: numero(v.recargo_valor, 0),
      avisos: v.avisos_cuotas === "si",
    },
    recibos: { porEmail: v.recibos_por_email === "si" },
    horas: {
      justificadas: just === "generan_deuda" || just === "cuentan_como_hechas" ? just : "no_generan_deuda",
      aFavor: v.horas_a_favor === "no_acumulan" ? "no_acumulan" : "acumulan",
    },
    ayuda: { telefono: v.ayuda_telefono?.trim() || "", horario: v.ayuda_horario?.trim() || "" },
    seguridad: { exigir2fa: v.seguridad_exigir_2fa === "si" },
    finanzas: {
      alertaPresupuesto: entero(v.presupuesto_alerta_porcentaje, d.finanzas.alertaPresupuesto, 50, 150),
      avisoCierreDia: entero(v.cierre_aviso_dia, d.finanzas.avisoCierreDia, 1, 28),
      conciliacionAutomatica: v.conciliacion_autoconfirmar === "si",
    },
    asambleas: {
      anticipacionOrdinaria: entero(v.asamblea_anticipacion_ordinaria, d.asambleas.anticipacionOrdinaria, 0, 120),
      anticipacionExtraordinaria: entero(v.asamblea_anticipacion_extraordinaria, d.asambleas.anticipacionExtraordinaria, 0, 120),
      plazoModo: v.asamblea_plazo_modo === "bloquear" ? "bloquear" : "avisar",
      quorumPrimera: entero(v.asamblea_quorum_primera, d.asambleas.quorumPrimera, 0, 100),
      quorumSegunda: entero(v.asamblea_quorum_segunda, d.asambleas.quorumSegunda, 0, 100),
      minutosSegunda: entero(v.asamblea_minutos_segunda, d.asambleas.minutosSegunda, 0, 240),
      maxCuotasVencidas: v.asamblea_max_cuotas_vencidas === undefined || v.asamblea_max_cuotas_vencidas === "" ? null : entero(v.asamblea_max_cuotas_vencidas, 0, 0, 60),
      antiguedadMinimaMeses: entero(v.asamblea_antiguedad_minima_meses, 0, 0, 240),
      poderes: v.asamblea_poderes === "si",
      poderesMax: entero(v.asamblea_poderes_max, d.asambleas.poderesMax, 1, 10),
      voto: v.asamblea_voto === "persona" ? "persona" : "titular",
    },
    difusion: { resumenSemanal: v.avisos_resumen_semanal === "si" },
    compras: {
      montoFormal: numero(v.compras_monto_formal, d.compras.montoFormal),
      presupuestosMinimos: entero(v.compras_presupuestos_minimos, d.compras.presupuestosMinimos, 1, 5),
      aprobacion: v.compras_aprobacion === "consejo" ? "consejo" : "tesoreria_o_consejo",
    },
    obra: { induccionModo: v.seguridad_induccion_modo === "bloquear" ? "bloquear" : "avisar" },
    seguimiento: {
      deudaHorasUmbral: entero(v.horas_deuda_umbral, 0, 0, 1000),
      deudaHorasMedida: v.horas_deuda_medida?.trim() || d.seguimiento.deudaHorasMedida,
      reclamosDiasEscalar: entero(v.reclamos_dias_escalar, 0, 0, 365),
    },
  };
}

/** Monto del recargo para una deuda pendiente, según el reglamento. */
export function montoRecargo(pendiente: number, r: Reglamento["cuotas"]): number {
  if (r.recargoTipo === "porcentaje") return Math.round(pendiente * (r.recargoValor / 100) * 100) / 100;
  if (r.recargoTipo === "fijo") return Math.round(r.recargoValor * 100) / 100;
  return 0;
}

/** "Cuota social octubre 2026" */
const MESES = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "setiembre", "octubre", "noviembre", "diciembre"];
export function textoMes(mes: string): string {
  const [y, m] = mes.split("-").map(Number);
  return `${MESES[m - 1]} ${y}`;
}

/** Código con el que el núcleo identifica sus transferencias ("UFA-014"). */
export function codigoDePago(slug: string, nucleoId: number | null, socioId: number): string {
  const pref = (slug.replace(/[^a-z0-9]/gi, "").slice(0, 3) || "COO").toUpperCase();
  return nucleoId ? `${pref}-${String(nucleoId).padStart(3, "0")}` : `${pref}-S${socioId}`;
}
