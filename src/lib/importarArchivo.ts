import ExcelJS from "exceljs";
import Papa from "papaparse";

// Fase 6, Sub-fase 6.1 ("Migración de datos Excel/CSV", sección 30): motor
// de lectura de archivos, compartido por todos los importadores (hoy Padrón
// de socios y Movimientos financieros — ver actions/importaciones.ts).
//
// Elección de librerías (no es un detalle menor): la opción más conocida
// para leer .xlsx en Node es el paquete "xlsx" de SheetJS, pero la versión
// publicada en npm tiene 2 vulnerabilidades conocidas SIN parche disponible
// (prototype pollution + ReDoS, ver `npm audit`) — el fix solo se distribuye
// desde el CDN propio de SheetJS, no por npm. Como esta función procesa
// archivos subidos por cualquier usuario autenticado, se prefirió no sumar
// esa superficie de ataque: se usa "exceljs" (.xlsx, mantenido, sin CVEs
// abiertos) y "papaparse" (.csv, igual de establecido) en su lugar.
//
// Formato de salida uniforme para ambos tipos de archivo: un array de filas,
// cada una un diccionario columna→valor ya con las claves normalizadas
// (minúsculas, sin acentos, espacios→guión bajo) para que el resto del
// código compare contra nombres de columna fijos sin importar cómo haya
// tipeado el encabezado la persona que armó la planilla ("Nombre completo",
// "nombre_completo", "NOMBRE" son todas la misma columna).

export type FilaCruda = Record<string, string>;

const MAX_FILAS = 5000; // límite razonable para una cooperativa — evita que un archivo gigante cuelgue la función serverless

function normalizarClave(valor: string): string {
  return valor
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "") // saca acentos
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "_");
}

function normalizarValor(valor: unknown): string {
  if (valor === null || valor === undefined) return "";
  if (valor instanceof Date) {
    // Fecha nativa de una celda con formato de fecha en Excel — se convierte
    // a YYYY-MM-DD (mismo formato que usa el resto del sistema, ver zFecha
    // en validation.ts) usando la fecha en UTC para no correr un día por el
    // huso horario del servidor.
    return valor.toISOString().slice(0, 10);
  }
  if (typeof valor === "object") {
    // ExcelJS puede devolver objetos { text/richText } o { result } para
    // celdas con fórmula o texto enriquecido — nos quedamos con el valor
    // legible en vez de "[object Object]".
    const conTexto = valor as { text?: unknown; result?: unknown };
    if (typeof conTexto.text === "string") return conTexto.text;
    if (conTexto.result !== undefined) return normalizarValor(conTexto.result);
    return "";
  }
  return String(valor).trim();
}

export class ArchivoImportacionError extends Error {}

/**
 * Lee un archivo .xlsx o .csv y devuelve sus filas como diccionarios con
 * claves normalizadas. No valida el CONTENIDO de cada columna (eso lo hace
 * cada importador con su propio schema de zod) — solo la estructura del
 * archivo en sí.
 */
export async function leerArchivoTabular(file: File): Promise<FilaCruda[]> {
  const nombre = file.name.toLowerCase();
  const buffer = Buffer.from(await file.arrayBuffer());

  let filas: FilaCruda[];

  if (nombre.endsWith(".csv") || file.type === "text/csv") {
    const texto = buffer.toString("utf8");
    const resultado = Papa.parse<Record<string, string>>(texto, {
      header: true,
      skipEmptyLines: true,
      transformHeader: normalizarClave,
    });
    if (resultado.errors.length > 0 && resultado.data.length === 0) {
      throw new ArchivoImportacionError(`No se pudo leer el archivo CSV: ${resultado.errors[0].message}`);
    }
    filas = resultado.data.map((fila) => {
      const normalizada: FilaCruda = {};
      for (const [clave, valor] of Object.entries(fila)) normalizada[clave] = normalizarValor(valor);
      return normalizada;
    });
  } else if (nombre.endsWith(".xlsx") || nombre.endsWith(".xls")) {
    const workbook = new ExcelJS.Workbook();
    try {
      await workbook.xlsx.load(buffer as unknown as ArrayBuffer);
    } catch {
      throw new ArchivoImportacionError("No se pudo leer el archivo — ¿es un .xlsx válido? Los .xls muy viejos (Excel 97-2003) no están soportados, guardalo de nuevo como .xlsx.");
    }
    const hoja = workbook.worksheets[0];
    if (!hoja) throw new ArchivoImportacionError("El archivo no tiene ninguna hoja con datos.");

    const encabezados: string[] = [];
    hoja.getRow(1).eachCell({ includeEmpty: false }, (celda, numeroColumna) => {
      encabezados[numeroColumna] = normalizarClave(normalizarValor(celda.value));
    });
    if (encabezados.filter(Boolean).length === 0) {
      throw new ArchivoImportacionError("No se encontró una fila de encabezados en la primera hoja.");
    }

    filas = [];
    hoja.eachRow((fila, numeroFila) => {
      if (numeroFila === 1) return; // encabezado
      const valores: (string | number | boolean | Date | null)[] = [];
      fila.eachCell({ includeEmpty: true }, (celda, numeroColumna) => {
        valores[numeroColumna] = celda.value as string | number | boolean | Date | null;
      });
      // Fila completamente vacía (a veces queda al final del rango usado) — se descarta.
      if (valores.every((v) => v === null || v === undefined || v === "")) return;
      const normalizada: FilaCruda = {};
      encabezados.forEach((clave, i) => {
        if (!clave) return;
        normalizada[clave] = normalizarValor(valores[i]);
      });
      filas.push(normalizada);
    });
  } else {
    throw new ArchivoImportacionError("Formato no soportado — subí un archivo .xlsx o .csv.");
  }

  if (filas.length === 0) throw new ArchivoImportacionError("El archivo no tiene ninguna fila de datos (solo encabezado, o está vacío).");
  if (filas.length > MAX_FILAS) {
    throw new ArchivoImportacionError(`El archivo tiene ${filas.length} filas — el máximo por importación es ${MAX_FILAS}. Dividilo en partes más chicas.`);
  }

  return filas;
}

/**
 * Normaliza una fecha escrita a mano en una planilla al formato que espera
 * el resto del sistema (YYYY-MM-DD, ver zFecha en validation.ts). Acepta
 * además el formato DD/MM/YYYY (el que casi cualquiera tipea en Uruguay) y
 * DD-MM-YYYY. Una celda de Excel con formato de fecha real ya llega en
 * YYYY-MM-DD (ver normalizarValor arriba) y pasa sin cambios.
 */
export function normalizarFecha(valor: string): string {
  const v = valor.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(v)) return v;
  const conBarrasOGuiones = v.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/);
  if (conBarrasOGuiones) {
    const [, dia, mes, anio] = conBarrasOGuiones;
    return `${anio}-${mes.padStart(2, "0")}-${dia.padStart(2, "0")}`;
  }
  return v; // no reconocida — se deja para que la validación de zod la rechace con un mensaje claro
}

/**
 * Normaliza un monto escrito a mano en una planilla: saca separadores de
 * miles y símbolos de moneda, y convierte la coma decimal (uso habitual en
 * Uruguay/España, "1.500,50") al punto que espera Number()/zMontoPositivo.
 * Heurística: si el valor tiene punto Y coma, el punto es separador de
 * miles (se saca) y la coma es la decimal; si solo tiene coma, la coma es
 * la decimal; si solo tiene punto, se asume que ya es el formato estándar.
 */
export function normalizarMonto(valor: string): string {
  let v = valor.trim().replace(/[^\d.,-]/g, ""); // saca "$", "UYU", espacios, etc.
  const tienePunto = v.includes(".");
  const tieneComa = v.includes(",");
  if (tienePunto && tieneComa) {
    v = v.replace(/\./g, "").replace(",", ".");
  } else if (tieneComa) {
    v = v.replace(",", ".");
  }
  return v;
}
