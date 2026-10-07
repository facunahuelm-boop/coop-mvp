import Papa from "papaparse";
import ExcelJS from "exceljs";
import { createHash } from "node:crypto";
import { all, get, withTenantTransaction } from "@/lib/db";
import { sumarDias } from "@/lib/horasObra";

/**
 * Fase 2B — conciliación bancaria. Leer el extracto del banco (CSV o Excel,
 * con el formato que sea), proponer con qué movimiento de COOVA coincide cada
 * línea (A9) y llevar la cuenta de lo que falta conciliar.
 *
 * Orden de las propuestas (sección 8.4 del plan):
 *  1) código de pago exacto (ej. "COO-014" en el concepto de la transferencia);
 *  2) mismo monto y fecha ±3 días;
 *  3) sugerencia: mismo monto dentro de ±20 días.
 * Siempre confirma una persona (salvo que el reglamento pida confirmar solas
 * las coincidencias exactas por código).
 */

export type ColumnasExtracto = {
  fecha: number;
  descripcion: number | null;
  referencia: number | null;
  monto: number | null;
  debito: number | null;
  credito: number | null;
  saldo: number | null;
  /** Títulos del archivo con el que se guardó este formato. */
  titulos?: string[];
};
export type LineaLeida = { fecha: string; descripcion: string; referencia: string; monto: number; saldo: number | null };
export type ExtractoLeido = { encabezados: string[]; filas: string[][] };

const MAX_FILAS = 5000;

function textoDeCelda(v: unknown): string {
  if (v === null || v === undefined) return "";
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (typeof v === "object") {
    const o = v as { text?: unknown; result?: unknown; richText?: { text: string }[] };
    if (typeof o.text === "string") return o.text;
    if (Array.isArray(o.richText)) return o.richText.map((r) => r.text).join("");
    if (o.result !== undefined) return textoDeCelda(o.result);
    return "";
  }
  return String(v).trim();
}

/** Lee el archivo del banco y encuentra la fila de los títulos (muchos bancos ponen datos de la cuenta arriba). */
export async function leerExtracto(file: File): Promise<ExtractoLeido> {
  const nombre = file.name.toLowerCase();
  const buffer = Buffer.from(await file.arrayBuffer());
  let filas: string[][] = [];
  if (nombre.endsWith(".csv") || nombre.endsWith(".txt") || file.type === "text/csv") {
    let texto = buffer.toString("utf8");
    if (texto.includes("�")) texto = buffer.toString("latin1"); // archivos viejos en Windows-1252
    const r = Papa.parse<string[]>(texto.replace(/^﻿/, ""), { skipEmptyLines: true });
    filas = r.data.map((f) => f.map((c) => String(c ?? "").trim()));
  } else if (nombre.endsWith(".xlsx")) {
    const libro = new ExcelJS.Workbook();
    try {
      await libro.xlsx.load(buffer as unknown as ArrayBuffer);
    } catch {
      throw new Error("No se pudo leer el archivo. Si es un Excel viejo (.xls), abrilo y guardalo como .xlsx o como .csv.");
    }
    const hoja = libro.worksheets[0];
    if (!hoja) throw new Error("El archivo no tiene ninguna hoja.");
    hoja.eachRow({ includeEmpty: false }, (fila) => {
      const valores: string[] = [];
      fila.eachCell({ includeEmpty: true }, (celda, col) => {
        valores[col - 1] = textoDeCelda(celda.value);
      });
      filas.push(Array.from(valores, (v) => v ?? ""));
    });
  } else {
    throw new Error("Subí el extracto como .csv o .xlsx (en el home banking suele estar como «Exportar» o «Descargar»).");
  }
  filas = filas.filter((f) => f.some((c) => c !== ""));
  if (!filas.length) throw new Error("El archivo está vacío.");
  // Fila de títulos: la primera (de las primeras 25) que dice "fecha" y tiene al menos 3 columnas con algo.
  let idx = filas.slice(0, 25).findIndex((f) => f.filter(Boolean).length >= 3 && f.some((c) => /fecha/i.test(c)));
  if (idx < 0) idx = filas.slice(0, 25).findIndex((f) => f.filter(Boolean).length >= 3);
  if (idx < 0) idx = 0;
  const encabezados = filas[idx].map((c, i) => c || `Columna ${i + 1}`);
  const datos = filas.slice(idx + 1);
  if (datos.length > MAX_FILAS) throw new Error(`El archivo tiene ${datos.length} líneas: el máximo es ${MAX_FILAS}. Exportá un período más corto.`);
  return { encabezados, filas: datos };
}

const sinAcentos = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

/** Adivina qué columna es cada cosa mirando los títulos. */
export function sugerirColumnas(encabezados: string[]): ColumnasExtracto {
  const buscar = (re: RegExp, excluir?: RegExp) => {
    const i = encabezados.findIndex((h) => re.test(sinAcentos(h)) && !(excluir && excluir.test(sinAcentos(h))));
    return i >= 0 ? i : null;
  };
  const fecha = buscar(/fecha/, /valor|vto|venc/) ?? buscar(/fecha/) ?? 0;
  const debito = buscar(/debito|debe\b|egreso|retiro|cargo/);
  const credito = buscar(/credito|haber|ingreso|deposito|abono/);
  return {
    fecha,
    descripcion: buscar(/concepto|descrip|detalle|movimiento|observ/),
    referencia: buscar(/referencia|document|comprobante|n[°ºo]\.?\s|numero|nro/),
    monto: debito !== null && credito !== null ? null : buscar(/importe|monto|valor/, /saldo/),
    debito,
    credito,
    saldo: buscar(/saldo/),
  };
}

/** "1.234,56" · "1,234.56" · "-1234.5" · "(1.000)" · "1.000-" → número. */
export function leerMonto(v: string): number | null {
  let s = (v || "").trim();
  if (!s) return null;
  let negativo = false;
  if (/^\(.*\)$/.test(s)) {
    negativo = true;
    s = s.slice(1, -1);
  }
  if (/-\s*$/.test(s)) {
    negativo = true;
    s = s.replace(/-\s*$/, "");
  }
  if (s.startsWith("-")) {
    negativo = !negativo;
    s = s.slice(1);
  }
  s = s.replace(/[^\d.,]/g, "");
  if (!s) return null;
  const ultimoPunto = s.lastIndexOf(".");
  const ultimaComa = s.lastIndexOf(",");
  if (ultimoPunto >= 0 && ultimaComa >= 0) {
    // El último separador es el decimal.
    s = ultimaComa > ultimoPunto ? s.replace(/\./g, "").replace(",", ".") : s.replace(/,/g, "");
  } else if (ultimaComa >= 0) {
    // Sólo comas: decimal si tiene 1 o 2 cifras después; si no, miles.
    s = /,\d{1,2}$/.test(s) ? s.replace(/,(?=\d{3}(\D|$))/g, "").replace(",", ".") : s.replace(/,/g, "");
  } else if (ultimoPunto >= 0 && !/\.\d{1,2}$/.test(s)) {
    s = s.replace(/\./g, ""); // "1.000" = mil
  }
  const n = Number(s);
  if (!Number.isFinite(n)) return null;
  return Math.round((negativo ? -n : n) * 100) / 100;
}

/** "05/10/2026" · "5-10-26" · "2026-10-05" · "05/10/2026 14:30" → "2026-10-05". */
export function leerFecha(v: string): string | null {
  const s = (v || "").trim();
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})/);
  if (m) {
    const anio = m[3].length === 2 ? `20${m[3]}` : m[3];
    const mes = Number(m[2]);
    const dia = Number(m[1]);
    if (mes < 1 || mes > 12 || dia < 1 || dia > 31) return null;
    return `${anio}-${String(mes).padStart(2, "0")}-${String(dia).padStart(2, "0")}`;
  }
  return null;
}

export function interpretarFilas(filas: string[][], c: ColumnasExtracto): { lineas: LineaLeida[]; descartadas: number } {
  const lineas: LineaLeida[] = [];
  let descartadas = 0;
  for (const f of filas) {
    const fecha = leerFecha(f[c.fecha] ?? "");
    let monto: number | null = null;
    if (c.monto !== null) monto = leerMonto(f[c.monto] ?? "");
    else {
      const deb = c.debito !== null ? leerMonto(f[c.debito] ?? "") : null;
      const cred = c.credito !== null ? leerMonto(f[c.credito] ?? "") : null;
      if (deb !== null || cred !== null) monto = Math.round(((cred ?? 0) - Math.abs(deb ?? 0)) * 100) / 100;
    }
    if (!fecha || monto === null || monto === 0) {
      descartadas++;
      continue;
    }
    lineas.push({
      fecha,
      monto,
      descripcion: c.descripcion !== null ? (f[c.descripcion] ?? "").slice(0, 300) : "",
      referencia: c.referencia !== null ? (f[c.referencia] ?? "").slice(0, 120) : "",
      saldo: c.saldo !== null ? leerMonto(f[c.saldo] ?? "") : null,
    });
  }
  return { lineas, descartadas };
}

export function huellaDe(l: LineaLeida, repeticion: number): string {
  return createHash("sha1").update([l.fecha, l.monto.toFixed(2), l.descripcion.trim().toLowerCase(), l.referencia.trim().toLowerCase(), repeticion].join("|")).digest("hex");
}

// ---------- Propuestas (A9) ----------

type Candidato = { id: number; tipo: string; monto: number; fecha: string; socio_id: number | null };

const diasEntre = (a: string, b: string) => Math.abs((Date.parse(a + "T12:00:00Z") - Date.parse(b + "T12:00:00Z")) / 86400000);

/** Prefijo de los códigos de pago de esta cooperativa (ver codigoDePago en reglamento.ts). */
async function prefijoCodigo(): Promise<string> {
  const org = await get<{ slug: string }>(`SELECT slug FROM organizations WHERE id = NULLIF(current_setting('app.current_org_id', true), '')::int`);
  return ((org?.slug || "").replace(/[^a-z0-9]/gi, "").slice(0, 3) || "COO").toUpperCase();
}

/**
 * Recalcula la propuesta de todas las líneas pendientes de una cuenta. Si
 * `autoconfirmar`, concilia sola las coincidencias exactas por código de pago.
 * Devuelve cuántas quedaron con propuesta y cuántas se conciliaron solas.
 */
export async function proponerConciliaciones(cuentaId: number, autoconfirmar = false): Promise<{ propuestas: number; automaticas: number }> {
  const lineas = await all<{ id: number; fecha: string; monto: string; descripcion: string | null; referencia: string | null }>(
    `SELECT id, fecha, monto, descripcion, referencia FROM extracto_lineas WHERE cuenta_id = ? AND estado = 'pendiente' ORDER BY fecha, id`,
    [cuentaId]
  );
  if (!lineas.length) return { propuestas: 0, automaticas: 0 };
  const desde = sumarDias(lineas[0].fecha, -20);
  const hasta = sumarDias(lineas[lineas.length - 1].fecha, 20);
  const [candidatosCrudos, socios, pref] = await Promise.all([
    all<{ id: number; tipo: string; monto: string; fecha: string; socio_id: number | null }>(
      `SELECT m.id, m.tipo, m.monto, left(m.fecha, 10) AS fecha, mcs.socio_id
         FROM movimientos_financieros m
         LEFT JOIN movimientos_cuenta_socio mcs ON mcs.id = m.movimiento_cuenta_socio_id
        WHERE m.cuenta_id = ? AND COALESCE(m.estado, 'activo') <> 'anulado' AND m.conciliado_linea_id IS NULL
          AND left(m.fecha, 10) BETWEEN ? AND ?`,
      [cuentaId, desde, hasta]
    ),
    all<{ id: number; nucleo_id: number | null; estado: string }>(`SELECT id, nucleo_id, estado FROM socios`),
    prefijoCodigo(),
  ]);
  const candidatos: Candidato[] = candidatosCrudos.map((c) => ({ ...c, monto: Number(c.monto) }));
  const usados = new Set<number>();
  const socioPorId = new Map(socios.map((s) => [s.id, s]));
  const socioPorNucleo = new Map<number, number>();
  for (const s of socios) if (s.nucleo_id && (s.estado === "activo" || !socioPorNucleo.has(s.nucleo_id))) socioPorNucleo.set(s.nucleo_id, s.id);
  const reCodigo = new RegExp(`\\b${pref}\\s?-\\s?(S?)(\\d{1,6})\\b`, "i");

  let propuestas = 0;
  let automaticas = 0;
  for (const l of lineas) {
    const monto = Number(l.monto);
    const tipo = monto > 0 ? "ingreso" : "egreso";
    const abs = Math.abs(monto);
    const mismos = candidatos.filter((c) => !usados.has(c.id) && c.tipo === tipo && Math.abs(c.monto - abs) < 0.005);
    let propuesta: { tipo: "codigo" | "monto_fecha" | "sugerencia"; mov: number | null; socio: number | null } | null = null;

    // 1) Código de pago en el concepto o la referencia.
    const m = `${l.descripcion ?? ""} ${l.referencia ?? ""}`.match(reCodigo);
    if (m && tipo === "ingreso") {
      const n = Number(m[2]);
      const socioId = m[1] ? (socioPorId.has(n) ? n : null) : socioPorNucleo.get(n) ?? null;
      if (socioId) {
        const delSocio = mismos.filter((c) => c.socio_id === socioId && diasEntre(c.fecha, l.fecha) <= 7).sort((a, b) => diasEntre(a.fecha, l.fecha) - diasEntre(b.fecha, l.fecha))[0];
        propuesta = { tipo: "codigo", mov: delSocio?.id ?? null, socio: socioId };
      }
    }
    // 2) Mismo monto y fecha ±3 días.
    if (!propuesta) {
      const cerca = mismos.filter((c) => diasEntre(c.fecha, l.fecha) <= 3).sort((a, b) => diasEntre(a.fecha, l.fecha) - diasEntre(b.fecha, l.fecha))[0];
      if (cerca) propuesta = { tipo: "monto_fecha", mov: cerca.id, socio: cerca.socio_id };
    }
    // 3) Sugerencia: mismo monto dentro de ±20 días.
    if (!propuesta) {
      const sug = mismos.filter((c) => diasEntre(c.fecha, l.fecha) <= 20).sort((a, b) => diasEntre(a.fecha, l.fecha) - diasEntre(b.fecha, l.fecha))[0];
      if (sug) propuesta = { tipo: "sugerencia", mov: sug.id, socio: sug.socio_id };
    }

    if (propuesta?.mov) usados.add(propuesta.mov);
    if (propuesta) propuestas++;
    if (autoconfirmar && propuesta?.tipo === "codigo" && propuesta.mov) {
      await conciliarEnBase(l.id, propuesta.mov, null, "automatica");
      automaticas++;
      continue;
    }
    await withTenantTransaction(async (tx) => {
      await tx.run(`UPDATE extracto_lineas SET propuesta_tipo = ?, propuesta_movimiento_id = ?, propuesta_socio_id = ? WHERE id = ?`, [
        propuesta?.tipo ?? null,
        propuesta?.mov ?? null,
        propuesta?.socio ?? null,
        l.id,
      ]);
    });
  }
  return { propuestas, automaticas };
}

/** Vincula una línea del banco con un movimiento de COOVA (en una sola operación). */
export async function conciliarEnBase(lineaId: number, movimientoId: number, usuarioId: number | null, como: string): Promise<void> {
  await withTenantTransaction(async (tx) => {
    const ahora = new Date().toISOString();
    const linea = await tx.get<{ estado: string }>(`SELECT estado FROM extracto_lineas WHERE id = ? FOR UPDATE`, [lineaId]);
    if (!linea || linea.estado !== "pendiente") throw new Error("Esa línea del banco ya no está pendiente.");
    const mov = await tx.get<{ conciliado_linea_id: number | null }>(`SELECT conciliado_linea_id FROM movimientos_financieros WHERE id = ? FOR UPDATE`, [movimientoId]);
    if (!mov) throw new Error("Ese movimiento no existe.");
    if (mov.conciliado_linea_id) throw new Error("Ese movimiento ya está conciliado con otra línea del banco.");
    await tx.run(
      `UPDATE extracto_lineas SET estado = 'conciliada', movimiento_financiero_id = ?, conciliada_como = ?, conciliado_por_id = ?, conciliado_en = ? WHERE id = ?`,
      [movimientoId, como, usuarioId, ahora, lineaId]
    );
    await tx.run(`UPDATE movimientos_financieros SET conciliado_linea_id = ?, conciliado_en = ? WHERE id = ?`, [lineaId, ahora, movimientoId]);
  });
}

// ---------- Resumen ----------

export type ResumenConciliacion = {
  pendientes: number;
  conciliadas: number;
  ignoradas: number;
  desde: string | null;
  hasta: string | null;
  saldoBanco: { saldo: number; fecha: string } | null;
  saldoCoova: number;
  movimientosSinConciliar: number;
};

export async function resumenConciliacion(cuentaId: number): Promise<ResumenConciliacion> {
  const [cuenta, totales, ultimoSaldo] = await Promise.all([
    get<{ saldo_inicial: string }>(`SELECT saldo_inicial FROM cuentas_financieras WHERE id = ?`, [cuentaId]),
    get<{ pendientes: string; conciliadas: string; ignoradas: string; desde: string | null; hasta: string | null }>(
      `SELECT COUNT(*) FILTER (WHERE estado = 'pendiente') AS pendientes, COUNT(*) FILTER (WHERE estado = 'conciliada') AS conciliadas,
              COUNT(*) FILTER (WHERE estado = 'ignorada') AS ignoradas, MIN(fecha) AS desde, MAX(fecha) AS hasta
         FROM extracto_lineas WHERE cuenta_id = ?`,
      [cuentaId]
    ),
    get<{ saldo: string; fecha: string }>(
      `SELECT saldo, fecha FROM extracto_lineas WHERE cuenta_id = ? AND saldo IS NOT NULL ORDER BY fecha DESC, id DESC LIMIT 1`,
      [cuentaId]
    ),
  ]);
  const hasta = totales?.hasta ?? null;
  const [saldoCoova, sinConciliar] = await Promise.all([
    get<{ s: string }>(
      `SELECT COALESCE(SUM(CASE WHEN tipo = 'ingreso' THEN monto ELSE -monto END), 0) AS s FROM movimientos_financieros
        WHERE cuenta_id = ? AND COALESCE(estado, 'activo') <> 'anulado' ${ultimoSaldo ? "AND left(fecha, 10) <= ?" : ""}`,
      ultimoSaldo ? [cuentaId, ultimoSaldo.fecha] : [cuentaId]
    ),
    totales?.desde
      ? get<{ n: string }>(
          `SELECT COUNT(*) AS n FROM movimientos_financieros
            WHERE cuenta_id = ? AND COALESCE(estado, 'activo') <> 'anulado' AND conciliado_linea_id IS NULL AND left(fecha, 10) BETWEEN ? AND ?`,
          [cuentaId, totales.desde, hasta]
        )
      : Promise.resolve({ n: "0" }),
  ]);
  return {
    pendientes: Number(totales?.pendientes || 0),
    conciliadas: Number(totales?.conciliadas || 0),
    ignoradas: Number(totales?.ignoradas || 0),
    desde: totales?.desde ?? null,
    hasta,
    saldoBanco: ultimoSaldo ? { saldo: Number(ultimoSaldo.saldo), fecha: ultimoSaldo.fecha } : null,
    saldoCoova: Number(cuenta?.saldo_inicial || 0) + Number(saldoCoova?.s || 0),
    movimientosSinConciliar: Number(sinConciliar?.n || 0),
  };
}
