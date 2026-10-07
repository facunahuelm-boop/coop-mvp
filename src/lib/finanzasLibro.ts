import { all, get, upsertAlerta } from "@/lib/db";
import { enviarEmailAlerta } from "@/lib/email";
import { hoyEnUruguay, sumarDias } from "@/lib/horasObra";

/**
 * Fase 2A — "Finanzas como un libro" (migración 0055). Cuentas (dónde está la
 * plata), fondos (para qué es), cierre mensual con bloqueo en la base,
 * compromisos y facturas a pagar, flujo de caja y presupuesto por año.
 *
 * Todas las lecturas toleran que la migración 0055 todavía no esté aplicada
 * (justo después de publicar y antes de aplicar las migraciones): en ese caso
 * devuelven listas vacías en vez de romper la pantalla.
 */

export type Cuenta = {
  id: number;
  nombre: string;
  tipo: "banco" | "caja";
  banco: string | null;
  referencia: string | null;
  saldo_inicial: number;
  predeterminada: number;
  para_efectivo: number;
  activa: number;
};
export type Fondo = {
  id: number;
  nombre: string;
  tipo: TipoFondo;
  descripcion: string | null;
  saldo_inicial: number;
  predeterminado: number;
  recibe_cuotas: number;
  comision_id: number | null;
  tope: number | null;
  activo: number;
};
export type TipoFondo = "general" | "obra" | "social" | "reserva" | "mantenimiento" | "caja_chica" | "otro";
export const TIPO_FONDO_LABEL: Record<TipoFondo, string> = {
  general: "General",
  obra: "Obra / préstamo",
  social: "Fondo social",
  reserva: "Reserva",
  mantenimiento: "Mantenimiento",
  caja_chica: "Caja chica",
  otro: "Otro",
};
export type EstadoPeriodo = "abierto" | "cerrado" | "visado";
export const ESTADO_PERIODO_LABEL: Record<EstadoPeriodo, string> = {
  abierto: "Abierto",
  cerrado: "Cerrado — falta el visto de la Fiscal",
  visado: "Cerrado y visado por la Fiscal",
};

export { textoPeriodo, mensajePeriodoCerrado } from "@/lib/periodos";
import { textoPeriodo } from "@/lib/periodos";

export function periodoAnterior(p: string): string {
  const [y, m] = p.split("-").map(Number);
  return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, "0")}`;
}
export function periodoSiguiente(p: string): string {
  const [y, m] = p.split("-").map(Number);
  return m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, "0")}`;
}
/** Quién cierra el mes: tesorería (o un administrador). La Fiscal sólo visa. */
export function puedeCerrarMes(rol: string): boolean {
  return rol === "tesoreria" || rol === "admin";
}

export const money = (n: number) => `$ ${Math.round(Number(n || 0)).toLocaleString("es-UY")}`;

/** Errores de "falta aplicar la migración" (tabla o columna inexistente). */
export function faltaMigracion(err: unknown): boolean {
  const code = (err as { code?: string })?.code;
  return code === "42P01" || code === "42703";
}
function siFaltaMigracion<T>(valor: T) {
  return (err: unknown): T => {
    if (faltaMigracion(err)) return valor;
    throw err;
  };
}

// ---------- Cuentas y fondos ----------

export async function obtenerCuentas(incluirInactivas = false): Promise<Cuenta[]> {
  const filas = await all<Cuenta>(
    `SELECT * FROM cuentas_financieras ${incluirInactivas ? "" : "WHERE activa = 1"} ORDER BY predeterminada DESC, nombre ASC`
  ).catch(siFaltaMigracion([] as Cuenta[]));
  return filas.map((c) => ({ ...c, saldo_inicial: Number(c.saldo_inicial) }));
}

export async function obtenerFondos(incluirInactivos = false): Promise<Fondo[]> {
  const filas = await all<Fondo>(
    `SELECT * FROM fondos ${incluirInactivos ? "" : "WHERE activo = 1"} ORDER BY predeterminado DESC, nombre ASC`
  ).catch(siFaltaMigracion([] as Fondo[]));
  return filas.map((f) => ({ ...f, saldo_inicial: Number(f.saldo_inicial), tope: f.tope == null ? null : Number(f.tope) }));
}

export type SaldoDe = { id: number; nombre: string; saldoInicial: number; ingresos: number; egresos: number; saldo: number };

/** Saldo de cada cuenta (o fondo) hasta una fecha (inclusive). Sin fecha: hoy y todo lo cargado. */
export async function saldosPor(dimension: "cuenta" | "fondo", hasta?: string): Promise<SaldoDe[]> {
  const tabla = dimension === "cuenta" ? "cuentas_financieras" : "fondos";
  const col = dimension === "cuenta" ? "cuenta_id" : "fondo_id";
  const filtroFecha = hasta ? `AND left(m.fecha, 10) <= ?` : "";
  const filas = await all<{ id: number; nombre: string; saldo_inicial: string; ingresos: string; egresos: string }>(
    `SELECT t.id, t.nombre, t.saldo_inicial,
            COALESCE(SUM(CASE WHEN m.tipo = 'ingreso' THEN m.monto END), 0) AS ingresos,
            COALESCE(SUM(CASE WHEN m.tipo = 'egreso' THEN m.monto END), 0) AS egresos
       FROM ${tabla} t
       LEFT JOIN movimientos_financieros m ON m.${col} = t.id AND COALESCE(m.estado, 'activo') <> 'anulado' ${filtroFecha}
      GROUP BY t.id, t.nombre, t.saldo_inicial
      ORDER BY t.nombre`,
    hasta ? [hasta] : []
  ).catch(siFaltaMigracion([] as { id: number; nombre: string; saldo_inicial: string; ingresos: string; egresos: string }[]));
  return filas.map((f) => {
    const saldoInicial = Number(f.saldo_inicial || 0);
    const ingresos = Number(f.ingresos || 0);
    const egresos = Number(f.egresos || 0);
    return { id: f.id, nombre: f.nombre, saldoInicial, ingresos, egresos, saldo: saldoInicial + ingresos - egresos };
  });
}

export type OpcionesLibro = {
  cuentas: { id: number; nombre: string; predeterminada: boolean }[];
  fondos: { id: number; nombre: string; predeterminado: boolean }[];
  rubros: string[];
  hoy: string;
};

/** Lo que necesitan los formularios de movimientos: cuentas, fondos y rubros conocidos. */
export async function opcionesLibro(): Promise<OpcionesLibro> {
  const [cuentas, fondos, rubros] = await Promise.all([
    obtenerCuentas(),
    obtenerFondos(),
    all<{ categoria: string }>(
      `SELECT categoria FROM (
         SELECT DISTINCT categoria FROM movimientos_financieros WHERE categoria IS NOT NULL AND categoria <> ''
         UNION SELECT DISTINCT categoria FROM presupuesto_general WHERE categoria IS NOT NULL AND categoria <> ''
       ) x ORDER BY categoria`
    ).catch(() => [] as { categoria: string }[]),
  ]);
  return {
    cuentas: cuentas.map((c) => ({ id: c.id, nombre: c.nombre, predeterminada: !!c.predeterminada })),
    fondos: fondos.map((f) => ({ id: f.id, nombre: f.nombre, predeterminado: !!f.predeterminado })),
    rubros: rubros.map((r) => r.categoria),
    hoy: hoyEnUruguay(),
  };
}

// ---------- Cierre mensual ----------

export type Periodo = {
  periodo: string;
  estado: EstadoPeriodo;
  ingresos: number;
  egresos: number;
  movimientos: number;
  cerrado_en: string | null;
  cerrado_por: string | null;
  visado_en: string | null;
  visado_por: string | null;
  observacion_fiscal: string | null;
  observado_en: string | null;
  motivo_reapertura: string | null;
};

export async function estadoDePeriodo(periodo: string): Promise<EstadoPeriodo> {
  const r = await get<{ estado: EstadoPeriodo }>(`SELECT estado FROM periodos_financieros WHERE periodo = ?`, [periodo]).catch(
    siFaltaMigracion(undefined)
  );
  return r?.estado ?? "abierto";
}

/** Todos los meses desde el primer movimiento hasta el mes actual, con su estado y totales. */
export async function listarPeriodos(): Promise<Periodo[]> {
  const actual = hoyEnUruguay().slice(0, 7);
  const [totales, registrados] = await Promise.all([
    all<{ periodo: string; ingresos: string; egresos: string; n: string }>(
      `SELECT left(fecha, 7) AS periodo,
              COALESCE(SUM(CASE WHEN tipo = 'ingreso' AND transferencia_id IS NULL THEN monto END), 0) AS ingresos,
              COALESCE(SUM(CASE WHEN tipo = 'egreso' AND transferencia_id IS NULL THEN monto END), 0) AS egresos,
              COUNT(*) AS n
         FROM movimientos_financieros WHERE COALESCE(estado, 'activo') <> 'anulado'
        GROUP BY left(fecha, 7)`
    ).catch(siFaltaMigracion([] as { periodo: string; ingresos: string; egresos: string; n: string }[])),
    all<{
      periodo: string;
      estado: EstadoPeriodo;
      cerrado_en: string | null;
      cerrado_por: string | null;
      visado_en: string | null;
      visado_por: string | null;
      observacion_fiscal: string | null;
      observado_en: string | null;
      motivo_reapertura: string | null;
    }>(
      `SELECT p.periodo, p.estado, p.cerrado_en, uc.nombre AS cerrado_por, p.visado_en, uv.nombre AS visado_por,
              p.observacion_fiscal, p.observado_en, p.motivo_reapertura
         FROM periodos_financieros p
         LEFT JOIN users uc ON uc.id = p.cerrado_por_id
         LEFT JOIN users uv ON uv.id = p.visado_por_id`
    ).catch(siFaltaMigracion([] as never[])),
  ]);
  const porPeriodo = new Map(totales.filter((t) => /^\d{4}-\d{2}$/.test(t.periodo)).map((t) => [t.periodo, t]));
  const reg = new Map(registrados.map((r) => [r.periodo, r]));
  const primero = [...porPeriodo.keys(), ...reg.keys()].sort()[0] ?? actual;
  const lista: Periodo[] = [];
  for (let p = primero < actual ? primero : actual; p <= actual; p = periodoSiguiente(p)) {
    const t = porPeriodo.get(p);
    const r = reg.get(p);
    lista.push({
      periodo: p,
      estado: r?.estado ?? "abierto",
      ingresos: Number(t?.ingresos || 0),
      egresos: Number(t?.egresos || 0),
      movimientos: Number(t?.n || 0),
      cerrado_en: r?.cerrado_en ?? null,
      cerrado_por: r?.cerrado_por ?? null,
      visado_en: r?.visado_en ?? null,
      visado_por: r?.visado_por ?? null,
      observacion_fiscal: r?.observacion_fiscal ?? null,
      observado_en: r?.observado_en ?? null,
      motivo_reapertura: r?.motivo_reapertura ?? null,
    });
    if (lista.length > 240) break;
  }
  return lista.reverse();
}

export function ultimoDiaDe(periodo: string): string {
  const [y, m] = periodo.split("-").map(Number);
  const d = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return `${periodo}-${String(d).padStart(2, "0")}`;
}

export type ResumenPeriodo = {
  periodo: string;
  ingresos: number;
  egresos: number;
  porCuenta: { nombre: string; inicial: number; ingresos: number; egresos: number; final: number }[];
  porFondo: { nombre: string; inicial: number; ingresos: number; egresos: number; final: number }[];
  porRubro: { categoria: string; ingresos: number; egresos: number }[];
  contraMovimientos: number;
  anulados: number;
};

/** Lo que se "congela" al cerrar el mes: saldos de apertura y cierre por cuenta y fondo, y totales por rubro. */
export async function resumenDePeriodo(periodo: string): Promise<ResumenPeriodo> {
  const inicio = `${periodo}-01`;
  const fin = ultimoDiaDe(periodo);
  const diaAnterior = sumarDias(inicio, -1);
  const [cAntes, cDespues, fAntes, fDespues, rubros, extra] = await Promise.all([
    saldosPor("cuenta", diaAnterior),
    saldosPor("cuenta", fin),
    saldosPor("fondo", diaAnterior),
    saldosPor("fondo", fin),
    all<{ categoria: string; ingresos: string; egresos: string }>(
      `SELECT categoria,
              COALESCE(SUM(CASE WHEN tipo = 'ingreso' THEN monto END), 0) AS ingresos,
              COALESCE(SUM(CASE WHEN tipo = 'egreso' THEN monto END), 0) AS egresos
         FROM movimientos_financieros
        WHERE left(fecha, 7) = ? AND COALESCE(estado, 'activo') <> 'anulado' AND transferencia_id IS NULL
        GROUP BY categoria ORDER BY categoria`,
      [periodo]
    ).catch(siFaltaMigracion([] as { categoria: string; ingresos: string; egresos: string }[])),
    get<{ contra: string; anulados: string }>(
      `SELECT COUNT(*) FILTER (WHERE contra_de_id IS NOT NULL AND COALESCE(estado, 'activo') <> 'anulado') AS contra,
              COUNT(*) FILTER (WHERE estado = 'anulado') AS anulados
         FROM movimientos_financieros WHERE left(fecha, 7) = ?`,
      [periodo]
    ).catch(siFaltaMigracion(undefined)),
  ]);
  const combinar = (antes: SaldoDe[], despues: SaldoDe[]) =>
    despues.map((d) => {
      const a = antes.find((x) => x.id === d.id);
      const inicial = a ? a.saldo : d.saldoInicial;
      return { nombre: d.nombre, inicial, ingresos: d.ingresos - (a?.ingresos ?? 0), egresos: d.egresos - (a?.egresos ?? 0), final: d.saldo };
    });
  const porRubro = rubros.map((r) => ({ categoria: r.categoria || "Sin rubro", ingresos: Number(r.ingresos), egresos: Number(r.egresos) }));
  return {
    periodo,
    ingresos: porRubro.reduce((a, r) => a + r.ingresos, 0),
    egresos: porRubro.reduce((a, r) => a + r.egresos, 0),
    porCuenta: combinar(cAntes, cDespues),
    porFondo: combinar(fAntes, fDespues),
    porRubro,
    contraMovimientos: Number(extra?.contra || 0),
    anulados: Number(extra?.anulados || 0),
  };
}

export type Verificacion = { ok: boolean; texto: string; bloquea: boolean };

/** Lo que se revisa antes de cerrar un mes (en lenguaje simple). */
export async function verificacionesDeCierre(periodo: string): Promise<Verificacion[]> {
  const actual = hoyEnUruguay().slice(0, 7);
  const anterior = periodoAnterior(periodo);
  const [estadoAnterior, hayAnteriores, sinCuenta, facturasVencidas, sinConciliar] = await Promise.all([
    estadoDePeriodo(anterior),
    get<{ n: string }>(`SELECT COUNT(*) AS n FROM movimientos_financieros WHERE left(fecha, 7) = ?`, [anterior]).catch(() => ({ n: "0" })),
    get<{ n: string }>(
      `SELECT COUNT(*) AS n FROM movimientos_financieros WHERE left(fecha, 7) = ? AND (cuenta_id IS NULL OR fondo_id IS NULL) AND COALESCE(estado, 'activo') <> 'anulado'`,
      [periodo]
    ).catch(() => ({ n: "0" })),
    get<{ n: string }>(
      `SELECT COUNT(*) AS n FROM facturas_proveedor WHERE estado = 'a_pagar' AND fecha_vencimiento IS NOT NULL AND fecha_vencimiento <= ?`,
      [ultimoDiaDe(periodo)]
    ).catch(() => ({ n: "0" })),
    contarSinConciliar(periodo),
  ]);
  const v: Verificacion[] = [];
  v.push(
    periodo >= actual
      ? { ok: false, bloquea: true, texto: "El mes todavía no terminó. Se puede cerrar a partir del día 1 del mes siguiente." }
      : { ok: true, bloquea: false, texto: "El mes ya terminó." }
  );
  const anteriorTieneMovs = Number(hayAnteriores?.n || 0) > 0;
  v.push(
    anteriorTieneMovs && estadoAnterior === "abierto"
      ? { ok: false, bloquea: false, texto: `El mes anterior (${textoPeriodo(anterior)}) sigue abierto. Conviene cerrarlo primero.` }
      : { ok: true, bloquea: false, texto: "Los meses anteriores están cerrados o no tienen movimientos." }
  );
  const nSin = Number(sinCuenta?.n || 0);
  v.push(
    nSin > 0
      ? { ok: false, bloquea: true, texto: `Hay ${nSin} movimiento(s) sin cuenta o sin fondo. Asignalos antes de cerrar.` }
      : { ok: true, bloquea: false, texto: "Todos los movimientos tienen cuenta y fondo." }
  );
  if (sinConciliar !== null) {
    v.push(
      sinConciliar > 0
        ? { ok: false, bloquea: false, texto: `Hay ${sinConciliar} línea(s) del extracto del banco de este mes sin conciliar.` }
        : { ok: true, bloquea: false, texto: "El extracto del banco de este mes está conciliado (o no se importó)." }
    );
  }
  const nFact = Number(facturasVencidas?.n || 0);
  v.push(
    nFact > 0
      ? { ok: false, bloquea: false, texto: `Hay ${nFact} factura(s) vencida(s) sin pagar. No impide cerrar, pero conviene revisarlas.` }
      : { ok: true, bloquea: false, texto: "No hay facturas vencidas sin pagar." }
  );
  return v;
}

/** Líneas del extracto bancario sin conciliar en el mes (Fase 2B). null si todavía no existe la conciliación. */
async function contarSinConciliar(periodo: string): Promise<number | null> {
  const r = await get<{ n: string }>(
    `SELECT COUNT(*) AS n FROM extracto_lineas WHERE left(fecha, 7) = ? AND estado = 'pendiente'`,
    [periodo]
  ).catch(() => undefined);
  return r ? Number(r.n || 0) : null;
}

// ---------- Compromisos y facturas ----------

export type Compromiso = {
  id: number;
  descripcion: string;
  monto: number;
  fecha_estimada: string;
  origen: string | null;
  estado: "pendiente" | "facturado" | "pagado" | "cancelado";
  tipo: "egreso" | "ingreso";
  categoria: string | null;
  solicitud_compra_id: number | null;
  proveedor_nombre: string | null;
};
export type Factura = {
  id: number;
  proveedor_id: number | null;
  proveedor_nombre: string | null;
  solicitud_compra_id: number | null;
  numero: string | null;
  fecha_emision: string | null;
  fecha_vencimiento: string | null;
  monto: number;
  categoria: string | null;
  descripcion: string | null;
  estado: "a_pagar" | "pagada" | "anulada";
  pagada_en: string | null;
  documento_id: number | null;
  archivo_url: string | null;
};

export async function compromisosPendientes(): Promise<Compromiso[]> {
  const filas = await all<Compromiso>(
    `SELECT c.id, c.descripcion, c.monto, c.fecha_estimada, c.origen, c.estado, c.tipo, c.categoria, c.solicitud_compra_id, p.nombre AS proveedor_nombre
       FROM compromisos_futuros c LEFT JOIN proveedores p ON p.id = c.proveedor_id
      WHERE c.estado = 'pendiente'
      ORDER BY c.fecha_estimada ASC`
  ).catch(async (err) => {
    if (!faltaMigracion(err)) throw err;
    const viejas = await all<{ id: number; descripcion: string; monto: number; fecha_estimada: string; origen: string | null }>(
      `SELECT id, descripcion, monto, fecha_estimada, origen FROM compromisos_futuros ORDER BY fecha_estimada ASC`
    );
    return viejas.map((v) => ({ ...v, estado: "pendiente", tipo: "egreso", categoria: null, solicitud_compra_id: null, proveedor_nombre: null }) as Compromiso);
  });
  return filas.map((c) => ({ ...c, monto: Number(c.monto) }));
}

export async function facturasAPagar(incluirPagadas = false): Promise<Factura[]> {
  const filas = await all<Factura>(
    `SELECT f.*, p.nombre AS proveedor_nombre, d.archivo_url
       FROM facturas_proveedor f
       LEFT JOIN proveedores p ON p.id = f.proveedor_id
       LEFT JOIN documentos d ON d.id = f.documento_id
      ${incluirPagadas ? "WHERE f.estado <> 'anulada'" : "WHERE f.estado = 'a_pagar'"}
      ORDER BY f.estado = 'a_pagar' DESC, COALESCE(f.fecha_vencimiento, '9999') ASC, f.id DESC
      LIMIT 300`
  ).catch(siFaltaMigracion([] as Factura[]));
  return filas.map((f) => ({ ...f, monto: Number(f.monto) }));
}

// ---------- Flujo de caja proyectado ----------

export type LineaFlujo = { texto: string; monto: number; detalle?: string };
export type Horizonte = { dias: number; hasta: string; entradas: LineaFlujo[]; salidas: LineaFlujo[]; saldoFinal: number };
export type FlujoDeCaja = { hoy: string; saldoHoy: number; horizontes: Horizonte[]; deudaAtrasada: number };

/**
 * ¿Cuánta plata vamos a tener en 30, 60 y 90 días? Saldo de hoy + lo que se
 * espera cobrar (cuotas que vencen en el período e ingresos esperados, como
 * un desembolso del préstamo) − lo que hay que pagar (compromisos y facturas).
 * La deuda ya atrasada NO se cuenta como entrada (criterio prudente): se
 * muestra aparte.
 */
export type CuotaPorCobrar = { vence: string; pendiente: number };

export async function flujoDeCaja(opciones: { cuotas: CuotaPorCobrar[]; cuotasMensualesEstimadas?: number }): Promise<FlujoDeCaja> {
  const hoy = hoyEnUruguay();
  const cuotas = opciones.cuotas;
  const [cuentas, compromisos, facturas] = await Promise.all([saldosPor("cuenta"), compromisosPendientes(), facturasAPagar()]);
  const saldoHoy = cuentas.reduce((a, c) => a + c.saldo, 0);
  let deudaAtrasada = 0;
  for (const c of cuotas) if (c.vence < hoy) deudaAtrasada += Math.max(0, c.pendiente);

  const horizontes: Horizonte[] = [30, 60, 90].map((dias) => {
    const hasta = sumarDias(hoy, dias);
    const cuotasEnPeriodo = cuotas
      .filter((c) => c.vence >= hoy && c.vence <= hasta)
      .reduce((a, c) => a + Math.max(0, c.pendiente), 0);
    const entradas: LineaFlujo[] = [{ texto: "Cuotas que vencen en el período (ya generadas)", monto: cuotasEnPeriodo }];
    if (opciones.cuotasMensualesEstimadas && opciones.cuotasMensualesEstimadas > 0) {
      // Meses completos que todavía no tienen cuotas generadas dentro del horizonte.
      const mesesExtra = Math.max(0, Math.floor(dias / 30) - 1);
      if (mesesExtra > 0) {
        entradas.push({
          texto: `Cuotas de los próximos ${mesesExtra} mes(es) (estimado según el reglamento)`,
          monto: opciones.cuotasMensualesEstimadas * mesesExtra,
        });
      }
    }
    const ingresosEsperados = compromisos.filter((c) => c.tipo === "ingreso" && c.fecha_estimada <= hasta);
    if (ingresosEsperados.length) {
      entradas.push({
        texto: "Ingresos esperados (ej. desembolsos del préstamo)",
        monto: ingresosEsperados.reduce((a, c) => a + c.monto, 0),
        detalle: ingresosEsperados.map((c) => c.descripcion).join(", "),
      });
    }
    const compromisosEgreso = compromisos.filter((c) => c.tipo === "egreso" && c.fecha_estimada <= hasta);
    const facturasEnPeriodo = facturas.filter((f) => !f.fecha_vencimiento || f.fecha_vencimiento <= hasta);
    const salidas: LineaFlujo[] = [
      { texto: "Facturas a pagar", monto: facturasEnPeriodo.reduce((a, f) => a + f.monto, 0) },
      { texto: "Compromisos ya asumidos (compras aprobadas y otros)", monto: compromisosEgreso.reduce((a, c) => a + c.monto, 0) },
    ];
    const saldoFinal = saldoHoy + entradas.reduce((a, l) => a + l.monto, 0) - salidas.reduce((a, l) => a + l.monto, 0);
    return { dias, hasta, entradas, salidas, saldoFinal };
  });
  return { hoy, saldoHoy, horizontes, deudaAtrasada };
}

// ---------- Presupuesto por año ----------

export type LineaPresupuesto = {
  id: number;
  categoria: string;
  presupuestado: number;
  gastado: number;
  comprometido: number;
  porcentaje: number;
};

export async function presupuestoDelAnio(anio: string): Promise<{ lineas: LineaPresupuesto[]; sinPresupuesto: { categoria: string; gastado: number }[] }> {
  const [lineas, gastos, comprometidos] = await Promise.all([
    all<{ id: number; categoria: string; monto_presupuestado: string }>(
      `SELECT id, categoria, monto_presupuestado FROM presupuesto_general
        WHERE COALESCE(activo, 1) = 1 AND (periodo = ? OR (COALESCE(periodo, '') = '' AND ? = ?))
        ORDER BY categoria`,
      [anio, anio, hoyEnUruguay().slice(0, 4)]
    ).catch(async (err) => {
      if (!faltaMigracion(err)) throw err;
      return all<{ id: number; categoria: string; monto_presupuestado: string }>(
        `SELECT id, categoria, monto_presupuestado FROM presupuesto_general WHERE periodo = ? OR COALESCE(periodo, '') = '' ORDER BY categoria`,
        [anio]
      );
    }),
    all<{ categoria: string; total: string }>(
      `SELECT categoria, SUM(monto) AS total FROM movimientos_financieros
        WHERE tipo = 'egreso' AND COALESCE(estado, 'activo') <> 'anulado' AND left(fecha, 4) = ? AND transferencia_id IS NULL
        GROUP BY categoria`,
      [anio]
    ).catch(async (err) => {
      if (!faltaMigracion(err)) throw err;
      return all<{ categoria: string; total: string }>(
        `SELECT categoria, SUM(monto) AS total FROM movimientos_financieros
          WHERE tipo = 'egreso' AND COALESCE(estado, 'activo') <> 'anulado' AND left(fecha, 4) = ? GROUP BY categoria`,
        [anio]
      );
    }),
    all<{ categoria: string; total: string }>(
      `SELECT categoria, SUM(monto) AS total FROM (
         SELECT categoria, monto FROM compromisos_futuros WHERE estado = 'pendiente' AND tipo = 'egreso'
         UNION ALL SELECT categoria, monto FROM facturas_proveedor WHERE estado = 'a_pagar'
       ) x WHERE categoria IS NOT NULL GROUP BY categoria`
    ).catch(() => [] as { categoria: string; total: string }[]),
  ]);
  const norm = (s: string | null) => (s || "").trim().toLowerCase();
  const gastoDe = new Map(gastos.map((g) => [norm(g.categoria), Number(g.total)]));
  const compDe = new Map(comprometidos.map((g) => [norm(g.categoria), Number(g.total)]));
  const conPresupuesto = new Set(lineas.map((l) => norm(l.categoria)));
  return {
    lineas: lineas.map((l) => {
      const presupuestado = Number(l.monto_presupuestado || 0);
      const gastado = gastoDe.get(norm(l.categoria)) ?? 0;
      const comprometido = compDe.get(norm(l.categoria)) ?? 0;
      return {
        id: l.id,
        categoria: l.categoria,
        presupuestado,
        gastado,
        comprometido,
        porcentaje: presupuestado > 0 ? Math.round(((gastado + comprometido) / presupuestado) * 100) : 0,
      };
    }),
    sinPresupuesto: gastos
      .filter((g) => !conPresupuesto.has(norm(g.categoria)))
      .map((g) => ({ categoria: g.categoria || "Sin rubro", gastado: Number(g.total) }))
      .sort((a, b) => b.gastado - a.gastado),
  };
}

// ---------- Alertas financieras (A18, A19 y facturas) ----------

async function alertar(params: Parameters<typeof upsertAlerta>[0]) {
  const { esNueva } = await upsertAlerta(params);
  if (esNueva) {
    await enviarEmailAlerta({
      tipo: params.tipo,
      severidad: params.severidad,
      titulo: params.titulo,
      descripcion: params.descripcion,
      origen_modulo: params.origen_modulo,
    }).catch(() => {});
  }
}

/**
 * A18 (un rubro llega al % del presupuesto), A19 (el saldo proyectado a 60
 * días da negativo) y facturas vencidas. Corre al recalcular alertas y en la
 * tarea diaria.
 */
export async function alertasFinancieras(umbralPresupuesto: number, cuotas: CuotaPorCobrar[], cuotasMensualesEstimadas = 0): Promise<void> {
  const anio = hoyEnUruguay().slice(0, 4);
  const [pres, flujo, vencidas] = await Promise.all([
    presupuestoDelAnio(anio).catch(() => ({ lineas: [] as LineaPresupuesto[], sinPresupuesto: [] })),
    flujoDeCaja({ cuotas, cuotasMensualesEstimadas }).catch(() => null),
    all<{ id: number; monto: string; fecha_vencimiento: string; proveedor: string | null; numero: string | null }>(
      `SELECT f.id, f.monto, f.fecha_vencimiento, p.nombre AS proveedor, f.numero FROM facturas_proveedor f
         LEFT JOIN proveedores p ON p.id = f.proveedor_id
        WHERE f.estado = 'a_pagar' AND f.fecha_vencimiento IS NOT NULL AND f.fecha_vencimiento < ?`,
      [hoyEnUruguay()]
    ).catch(() => []),
  ]);
  for (const l of pres.lineas) {
    if (l.presupuestado > 0 && l.porcentaje >= umbralPresupuesto) {
      await alertar({
        tipo: "presupuesto_cerca_del_tope",
        severidad: l.porcentaje >= 100 ? "critica" : "importante",
        origen_modulo: "finanzas",
        titulo: `El rubro «${l.categoria}» ya usó el ${l.porcentaje}% de su presupuesto ${anio}`,
        descripcion: `Gastado ${money(l.gastado)} y comprometido ${money(l.comprometido)}, sobre ${money(l.presupuestado)} presupuestados.`,
        asignado_a_rol: "tesoreria",
        ref_tabla: "presupuesto_general",
        ref_id: l.id,
      });
    }
  }
  const a60 = flujo?.horizontes.find((h) => h.dias === 60);
  if (a60 && a60.saldoFinal < 0) {
    await alertar({
      tipo: "liquidez_60_dias",
      severidad: "critica",
      origen_modulo: "finanzas",
      titulo: "Dentro de 60 días la plata no alcanzaría",
      descripcion: `Con lo que hay hoy, lo que se espera cobrar y lo que hay que pagar, el saldo proyectado al ${a60.hasta.split("-").reverse().join("/")} da ${money(a60.saldoFinal)}.`,
      asignado_a_rol: "tesoreria",
      ref_tabla: "movimientos_financieros",
    });
  }
  for (const f of vencidas) {
    await alertar({
      tipo: "factura_vencida",
      severidad: "importante",
      origen_modulo: "finanzas",
      titulo: `Factura vencida sin pagar${f.proveedor ? ` de ${f.proveedor}` : ""}${f.numero ? ` (N° ${f.numero})` : ""}`,
      descripcion: `${money(Number(f.monto))}, venció el ${f.fecha_vencimiento.split("-").reverse().join("/")}.`,
      asignado_a_rol: "tesoreria",
      ref_tabla: "facturas_proveedor",
      ref_id: f.id,
    });
  }
}
