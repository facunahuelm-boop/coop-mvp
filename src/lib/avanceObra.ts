import { all, get } from "@/lib/db";
import { hoyEnUruguay } from "@/lib/horasObra";

/**
 * Fase 3D — avance físico contra planificado y contra financiero, y los
 * desembolsos del préstamo.
 *
 *  - Avance físico: suma de (incidencia del rubro × su avance), con la
 *    última medición de cada rubro. Si las incidencias no suman 100 se
 *    normaliza.
 *  - Avance planificado: lo que el plan dice para el mes (acumulado; si un
 *    mes no tiene valor se toma el último anterior).
 *  - Avance financiero: lo gastado en la obra sobre el presupuesto de obra
 *    (suma de los montos de los rubros). Qué gastos cuentan se elige:
 *    los del fondo de obra, o todos los egresos (sin transferencias).
 *  - Préstamo: lo cobrado de los desembolsos sobre el total del préstamo.
 */

export type Rubro = { id: number; nombre: string; orden: number; peso_pct: number; monto: number; avance: number; ultima: string | null };
export type Desembolso = {
  id: number;
  numero: number;
  descripcion: string | null;
  monto_previsto: number;
  fecha_prevista: string | null;
  avance_requerido_pct: number | null;
  estado: "previsto" | "solicitado" | "cobrado" | "anulado";
  fecha_solicitud: string | null;
  fecha_cobro: string | null;
  monto_cobrado: number | null;
  observaciones: string | null;
  compromiso_id: number | null;
  compromiso_estado: string | null;
};
export type OrigenFinanciero = "fondo_obra" | "todos";
export const ORIGEN_FINANCIERO_LABEL: Record<OrigenFinanciero, string> = {
  fondo_obra: "Los gastos del fondo de obra",
  todos: "Todos los egresos (sin transferencias entre cuentas)",
};

const r1 = (n: number) => Math.round(n * 10) / 10;

export async function cargarRubros(hasta?: string): Promise<Rubro[]> {
  const filas = await all<{ id: number; nombre: string; orden: number; peso_pct: number; monto: number; avance: number | null; ultima: string | null }>(
    `SELECT r.id, r.nombre, r.orden, r.peso_pct, r.monto, a.avance_pct AS avance, a.fecha AS ultima
       FROM obra_rubros r
       LEFT JOIN LATERAL (
         SELECT avance_pct, fecha FROM obra_avances_rubro x
          WHERE x.rubro_id = r.id AND x.anulado_en IS NULL ${hasta ? "AND x.fecha <= ?" : ""}
          ORDER BY x.fecha DESC, x.id DESC LIMIT 1
       ) a ON true
      WHERE r.activo = 1 ORDER BY r.orden, r.id`,
    hasta ? [hasta] : []
  ).catch(() => []);
  return filas.map((f) => ({ ...f, peso_pct: Number(f.peso_pct), monto: Number(f.monto), avance: Number(f.avance ?? 0) }));
}

export function avanceFisico(rubros: Rubro[]): number {
  const pesos = rubros.reduce((a, r) => a + r.peso_pct, 0);
  if (pesos <= 0) return 0;
  return r1(rubros.reduce((a, r) => a + r.peso_pct * r.avance, 0) / pesos);
}

export async function origenFinanciero(): Promise<OrigenFinanciero> {
  const v = await get<{ valor: string }>(`SELECT valor FROM configuracion_reglas WHERE clave = 'avance_financiero_origen'`).catch(() => undefined);
  if (v?.valor === "fondo_obra" || v?.valor === "todos") return v.valor;
  const hayFondoObra = await get<{ id: number }>(`SELECT id FROM fondos WHERE tipo = 'obra' AND activo = 1 LIMIT 1`).catch(() => undefined);
  return hayFondoObra ? "fondo_obra" : "todos";
}

/** Lo gastado en la obra hasta una fecha (inclusive), según el origen elegido. */
export async function gastoObra(origen: OrigenFinanciero, hasta: string = hoyEnUruguay()): Promise<number> {
  const filtro =
    origen === "fondo_obra"
      ? `AND m.fondo_id IN (SELECT id FROM fondos WHERE tipo = 'obra')`
      : `AND m.transferencia_id IS NULL`;
  const f = await get<{ total: string | null }>(
    `SELECT COALESCE(SUM(m.monto), 0) AS total FROM movimientos_financieros m
      WHERE m.tipo = 'egreso' AND COALESCE(m.estado, 'activo') <> 'anulado' AND left(m.fecha::text, 10) <= ? ${filtro}`,
    [hasta]
  ).catch(() => undefined);
  return Number(f?.total ?? 0);
}

export async function planificadoAl(mes: string): Promise<number | null> {
  const f = await get<{ avance_pct: number }>(`SELECT avance_pct FROM obra_plan_mensual WHERE mes <= ? ORDER BY mes DESC LIMIT 1`, [mes]).catch(() => undefined);
  return f ? Number(f.avance_pct) : null;
}

export async function cargarDesembolsos(): Promise<Desembolso[]> {
  // Cobrado = su ingreso esperado ya se registró en Finanzas («Ya entró»).
  const filas = await all<Desembolso>(
    `SELECT d.id, d.numero, d.descripcion, d.monto_previsto, d.fecha_prevista, d.avance_requerido_pct,
            CASE WHEN c.estado = 'pagado' THEN 'cobrado' ELSE d.estado END AS estado,
            d.fecha_solicitud,
            COALESCE(left(m.fecha::text, 10), d.fecha_cobro) AS fecha_cobro,
            COALESCE(m.monto, d.monto_cobrado) AS monto_cobrado,
            d.observaciones, d.compromiso_id, c.estado AS compromiso_estado
       FROM prestamo_desembolsos d
       LEFT JOIN compromisos_futuros c ON c.id = d.compromiso_id
       LEFT JOIN movimientos_financieros m ON m.id = c.movimiento_financiero_id AND COALESCE(m.estado, 'activo') <> 'anulado'
      WHERE d.estado <> 'anulado' ORDER BY d.numero, d.id`
  ).catch(() => []);
  return filas.map((d) => ({
    ...d,
    monto_previsto: Number(d.monto_previsto),
    monto_cobrado: d.monto_cobrado == null ? null : Number(d.monto_cobrado),
    avance_requerido_pct: d.avance_requerido_pct == null ? null : Number(d.avance_requerido_pct),
  }));
}

export async function datosPrestamo(): Promise<{ total: number; entidad: string }> {
  const filas = await all<{ clave: string; valor: string }>(
    `SELECT clave, valor FROM configuracion_reglas WHERE clave IN ('prestamo_monto_total', 'prestamo_entidad')`
  ).catch(() => []);
  const v = Object.fromEntries(filas.map((f) => [f.clave, f.valor]));
  const total = Number(v.prestamo_monto_total);
  return { total: Number.isFinite(total) && total > 0 ? total : 0, entidad: v.prestamo_entidad ?? "" };
}

/** Desembolsos que ya se pueden pedir: el avance físico alcanzó lo que exigen y todavía no se pidieron. */
export function desembolsosParaPedir(desembolsos: Desembolso[], fisico: number): Desembolso[] {
  return desembolsos.filter((d) => d.estado === "previsto" && d.avance_requerido_pct != null && fisico >= d.avance_requerido_pct);
}

export type PuntoCurva = { mes: string; planificado: number | null; fisico: number; financiero: number | null };

const finDeMes = (mes: string) => {
  const [y, m] = mes.split("-").map(Number);
  const d = new Date(Date.UTC(y, m, 0));
  return d.toISOString().slice(0, 10);
};
const mesSiguiente = (mes: string) => {
  const [y, m] = mes.split("-").map(Number);
  return m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, "0")}`;
};

/** La curva mes a mes (hasta 24 meses): planificado, físico real y financiero (acumulados). */
export async function curvaAvance(presupuesto: number, origen: OrigenFinanciero): Promise<PuntoCurva[]> {
  const hoyMes = hoyEnUruguay().slice(0, 7);
  const primero = await get<{ m: string | null }>(
    `SELECT MIN(m) AS m FROM (
       SELECT left(fecha, 7) AS m FROM obra_avances_rubro WHERE anulado_en IS NULL
       UNION ALL SELECT mes FROM obra_plan_mensual
     ) x WHERE m <= ?`,
    [hoyMes]
  ).catch(() => undefined);
  if (!primero?.m) return [];
  let mes = primero.m;
  const meses: string[] = [];
  while (mes <= hoyMes && meses.length < 60) {
    meses.push(mes);
    mes = mesSiguiente(mes);
  }
  const ultimos = meses.slice(-24);
  const puntos: PuntoCurva[] = [];
  for (const m of ultimos) {
    const corte = m === hoyMes ? hoyEnUruguay() : finDeMes(m);
    const [rubros, plan, gasto] = await Promise.all([cargarRubros(corte), planificadoAl(m), presupuesto > 0 ? gastoObra(origen, corte) : Promise.resolve(0)]);
    puntos.push({ mes: m, planificado: plan, fisico: avanceFisico(rubros), financiero: presupuesto > 0 ? r1((gasto / presupuesto) * 100) : null });
  }
  return puntos;
}

export const MESES_CORTOS = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "set", "oct", "nov", "dic"];
export const textoMesCorto = (mes: string) => {
  const [y, m] = mes.split("-").map(Number);
  return `${MESES_CORTOS[m - 1]} ${String(y).slice(2)}`;
};
