import PDFDocument from "pdfkit";

// Motor de PDF real (Fase 07 del Plan Maestro). Hasta ahora "reportes.ts"
// armaba el contenido y lo guardaba como JSON, pero el botón "PDF" no
// producía ningún archivo — pdfkit ya estaba instalado como dependencia,
// sin usar. Esta función es el único lugar que sabe dibujar un PDF: cada
// módulo (actas, reportes, y lo que venga después) le pasa título +
// secciones de contenido, y acá se estampa el nombre y el color de marca de
// la cooperativa automáticamente, para que cualquier documento generado se
// vea "de esa cooperativa" sin que cada módulo tenga que ocuparse de eso.

export type SeccionPdf =
  | { tipo: "texto"; encabezado?: string; parrafos: string[] }
  | { tipo: "tabla"; encabezado?: string; columnas: string[]; filas: (string | number)[][] };

export type DatosPdf = {
  titulo: string;
  subtitulo?: string;
  organizacion: { nombre: string; color_primario?: string | null };
  secciones: SeccionPdf[];
};

const MARGEN = 50;

// Texto tipeado en un <textarea> puede llegar con saltos de línea "\r\n"
// (Windows) en vez de "\n". La fuente estándar Helvetica de pdfkit no tiene
// un glyph para el retorno de carro ("\r") y termina dibujando un caracter
// basura (una "Ð" suelta) al final de cada línea — esto lo evita limpiando
// cualquier texto antes de pasarlo a doc.text().
function limpiarTexto(texto: string): string {
  return texto.replace(/\r\n?/g, "\n");
}

function dibujarTabla(doc: PDFKit.PDFDocument, columnas: string[], filas: (string | number)[][]) {
  const anchoDisponible = doc.page.width - MARGEN * 2;
  const anchoColumna = anchoDisponible / columnas.length;
  const startX = MARGEN;

  const filaCabe = (y: number) => y < doc.page.height - MARGEN - 20;

  let y = doc.y + 4;
  doc.font("Helvetica-Bold").fontSize(9).fillColor("#333333");
  columnas.forEach((c, i) => doc.text(limpiarTexto(c), startX + i * anchoColumna, y, { width: anchoColumna - 6 }));
  y += 16;
  doc.moveTo(startX, y - 4).lineTo(startX + anchoDisponible, y - 4).strokeColor("#dddddd").stroke();

  doc.font("Helvetica").fontSize(9).fillColor("#111111");
  for (const fila of filas) {
    if (!filaCabe(y)) {
      doc.addPage();
      y = MARGEN;
    }
    fila.forEach((valor, i) =>
      doc.text(limpiarTexto(String(valor ?? "—")), startX + i * anchoColumna, y, { width: anchoColumna - 6 })
    );
    y += 16;
  }
  doc.y = y + 10;
}

/**
 * Genera un PDF en memoria (Buffer) a partir de título + secciones de texto
 * o tablas, con el nombre y color de la cooperativa en el encabezado. No
 * escribe nada en disco ni sube nada — eso lo hace quien llama, con
 * saveGeneratedFile (src/lib/upload.ts), para no atar este módulo a Storage.
 */
export function generarPdfBuffer(datos: DatosPdf): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    try {
      const doc = new PDFDocument({ size: "A4", margin: MARGEN });
      const chunks: Buffer[] = [];
      doc.on("data", (chunk) => chunks.push(chunk as Buffer));
      doc.on("end", () => resolve(Buffer.concat(chunks)));
      doc.on("error", reject);

      const colorPrimario = datos.organizacion.color_primario || "#123240";
      const altoEncabezado = 80;

      doc.rect(0, 0, doc.page.width, altoEncabezado).fill(colorPrimario);
      doc
        .fillColor("#ffffff")
        .font("Helvetica-Bold")
        .fontSize(16)
        .text(datos.organizacion.nombre, MARGEN, 24, { width: doc.page.width - MARGEN * 2 });
      doc.font("Helvetica").fontSize(9).text("Sistema de gestión", MARGEN, 46);

      doc.fillColor("#111111");
      doc.y = altoEncabezado + 28;
      doc.font("Helvetica-Bold").fontSize(17).text(limpiarTexto(datos.titulo), MARGEN, doc.y, { width: doc.page.width - MARGEN * 2 });
      if (datos.subtitulo) {
        doc.moveDown(0.3);
        doc.font("Helvetica").fontSize(10).fillColor("#555555").text(limpiarTexto(datos.subtitulo));
        doc.fillColor("#111111");
      }
      doc.moveDown(1);

      for (const seccion of datos.secciones) {
        if (doc.y > doc.page.height - MARGEN - 60) doc.addPage();

        if (seccion.encabezado) {
          doc.moveDown(0.6);
          doc.font("Helvetica-Bold").fontSize(12.5).fillColor("#111111").text(limpiarTexto(seccion.encabezado));
          doc.moveDown(0.3);
        }

        if (seccion.tipo === "texto") {
          doc.font("Helvetica").fontSize(10.5).fillColor("#222222");
          for (const parrafo of seccion.parrafos) {
            doc.text(limpiarTexto(parrafo), { align: "left" });
            doc.moveDown(0.4);
          }
        } else {
          dibujarTabla(doc, seccion.columnas, seccion.filas);
        }
      }

      const piePagina = `Generado automáticamente por ${datos.organizacion.nombre} el ${new Date().toLocaleString("es-UY")}`;
      doc.font("Helvetica").fontSize(7.5).fillColor("#999999").text(piePagina, MARGEN, doc.page.height - 30, {
        width: doc.page.width - MARGEN * 2,
        align: "left",
      });

      doc.end();
    } catch (err) {
      reject(err);
    }
  });
}
