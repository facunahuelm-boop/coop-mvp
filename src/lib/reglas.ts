import { all } from "./db";

// Fase 3 ("Reglas de la cooperativa, Estatuto/Reglamentos como
// configuración, Motor de reglas evento-condición-acción") — Sub-fase 3.1:
// Reglas de la cooperativa (sección 12). Ver migración 0034 para el porqué
// completo. Este archivo centraliza los dos umbrales que antes estaban
// hardcodeados en 7 lugares distintos (logic.ts x3, ia.ts x1,
// cumplimiento/page.tsx x1, seguridad/page.tsx x1, finanzas/page.tsx x1) —
// una cooperativa que no configure nada sigue viendo exactamente el mismo
// comportamiento de siempre, porque los defaults de acá son los mismos
// valores que estaban hardcodeados.
export const DIAS_ALERTA_VENCIMIENTO_DEFAULT = 15;
export const PORCENTAJE_DESVIO_PRESUPUESTO_DEFAULT = 0.15;

export type ReglasCooperativa = {
  diasAlertaVencimiento: number;
  porcentajeDesvioPresupuesto: number;
};

// `.catch(() => [])` por si todavía no corrió la migración 0034 en este
// entorno — en ese caso se usan los defaults, igual que el comportamiento
// de siempre.
export async function obtenerReglasCooperativa(): Promise<ReglasCooperativa> {
  const filas = await all<{ clave: string; valor: string }>(
    `SELECT clave, valor FROM configuracion_reglas`
  ).catch(() => [] as { clave: string; valor: string }[]);
  const porClave = Object.fromEntries(filas.map((f) => [f.clave, f.valor]));

  const dias = Number(porClave["dias_alerta_vencimiento"]);
  const porcentaje = Number(porClave["porcentaje_desvio_presupuesto"]);

  return {
    diasAlertaVencimiento: Number.isFinite(dias) && dias > 0 ? dias : DIAS_ALERTA_VENCIMIENTO_DEFAULT,
    // Guardado en la tabla como porcentaje entero (ej. "15"), se devuelve
    // como fracción (0.15) porque así se compara contra la desviación real
    // en logic.ts/finanzas — igual que estaba hardcodeado antes.
    porcentajeDesvioPresupuesto: Number.isFinite(porcentaje) && porcentaje > 0 ? porcentaje / 100 : PORCENTAJE_DESVIO_PRESUPUESTO_DEFAULT,
  };
}
