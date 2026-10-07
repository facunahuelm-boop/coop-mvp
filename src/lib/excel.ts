import ExcelJS from "exceljs";

/**
 * Fase 2A — planillas Excel (.xlsx) para analizar o mandar al contador
 * (regla de la sección 13: PDF para lo oficial, Excel para analizar). Una
 * sola forma de armarlas para todo el sistema: encabezado en negrita y
 * congelado, filtros, anchos legibles, montos con formato de moneda y
 * fechas como fechas reales (para que el contador pueda ordenar y sumar).
 */

export type ColumnaExcel = {
  titulo: string;
  clave: string;
  ancho?: number;
  tipo?: "texto" | "monto" | "fecha" | "numero";
};

export type HojaExcel = {
  nombre: string;
  columnas: ColumnaExcel[];
  filas: Record<string, string | number | null | undefined>[];
  /** Líneas de texto arriba de la tabla (título, período, cooperativa). */
  encabezado?: string[];
  /** Fila final con totales de las columnas de tipo "monto". */
  totales?: boolean;
};

function aFecha(v: unknown): Date | string | null {
  if (v == null || v === "") return null;
  const s = String(v);
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return s;
  return new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 12));
}

export async function crearLibroExcel(hojas: HojaExcel[], autor = "COOVA"): Promise<Buffer> {
  const libro = new ExcelJS.Workbook();
  libro.creator = autor;
  libro.created = new Date();
  for (const h of hojas) {
    const hoja = libro.addWorksheet(h.nombre.slice(0, 31).replace(/[\\/?*[\]:]/g, " "));
    let fila = 1;
    for (const linea of h.encabezado ?? []) {
      const c = hoja.getCell(fila, 1);
      c.value = linea;
      c.font = { bold: fila === 1, size: fila === 1 ? 14 : 11 };
      fila++;
    }
    if (h.encabezado?.length) fila++;
    const filaTitulos = fila;
    h.columnas.forEach((col, i) => {
      const c = hoja.getCell(filaTitulos, i + 1);
      c.value = col.titulo;
      c.font = { bold: true, color: { argb: "FFFFFFFF" } };
      c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1E3A5F" } };
      c.alignment = { vertical: "middle", wrapText: true };
      hoja.getColumn(i + 1).width = col.ancho ?? (col.tipo === "monto" ? 14 : col.tipo === "fecha" ? 12 : 22);
    });
    h.filas.forEach((f, r) => {
      h.columnas.forEach((col, i) => {
        const c = hoja.getCell(filaTitulos + 1 + r, i + 1);
        const v = f[col.clave];
        if (col.tipo === "monto" || col.tipo === "numero") {
          c.value = v == null || v === "" ? null : Number(v);
          if (col.tipo === "monto") c.numFmt = '#,##0.00;[Red]-#,##0.00';
        } else if (col.tipo === "fecha") {
          c.value = aFecha(v);
          c.numFmt = "dd/mm/yyyy";
        } else {
          c.value = v == null ? "" : String(v);
        }
      });
    });
    const ultima = filaTitulos + h.filas.length;
    if (h.totales && h.filas.length) {
      const filaTot = ultima + 1;
      hoja.getCell(filaTot, 1).value = "Total";
      hoja.getCell(filaTot, 1).font = { bold: true };
      h.columnas.forEach((col, i) => {
        if (col.tipo !== "monto") return;
        const letra = hoja.getColumn(i + 1).letter;
        const c = hoja.getCell(filaTot, i + 1);
        c.value = { formula: `SUM(${letra}${filaTitulos + 1}:${letra}${ultima})` };
        c.numFmt = '#,##0.00;[Red]-#,##0.00';
        c.font = { bold: true };
      });
    }
    hoja.views = [{ state: "frozen", ySplit: filaTitulos }];
    if (h.filas.length) {
      hoja.autoFilter = { from: { row: filaTitulos, column: 1 }, to: { row: ultima, column: h.columnas.length } };
    }
  }
  const buf = await libro.xlsx.writeBuffer();
  return Buffer.from(buf as ArrayBuffer);
}

export function respuestaExcel(buffer: Buffer, nombreArchivo: string): Response {
  return new Response(new Uint8Array(buffer), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${nombreArchivo.replace(/[^a-zA-Z0-9_.-]/g, "_")}"`,
      "Cache-Control": "no-store",
    },
  });
}
