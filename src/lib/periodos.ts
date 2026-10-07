/**
 * Fase 2A — textos de los meses del cierre mensual. Sin dependencias del
 * servidor: lo usan también formularios del navegador (actionState.ts).
 */
const MESES = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "setiembre", "octubre", "noviembre", "diciembre"];

/** "2026-09" → "setiembre de 2026" */
export function textoPeriodo(p: string): string {
  const [y, m] = p.split("-").map(Number);
  return MESES[m - 1] ? `${MESES[m - 1]} de ${y}` : p;
}

/** Texto claro para el error del trigger de meses cerrados (migración 0055). */
export function mensajePeriodoCerrado(err: unknown): string | null {
  const msg = String((err as { message?: string })?.message || "");
  const m = msg.match(/PERIODO_CERRADO:(\d{4}-\d{2})/);
  if (!m) return null;
  return `El mes de ${textoPeriodo(m[1])} ya está cerrado: no se pueden agregar, cambiar ni anular movimientos con fecha de ese mes. Usá una fecha de un mes abierto. Si hay que corregir algo de ese mes, hacé un contra-movimiento (Finanzas → Movimientos → «Corregir»).`;
}
