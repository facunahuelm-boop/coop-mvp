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
