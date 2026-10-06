import PDFDocument from "pdfkit";
import QRCode from "qrcode";

/**
 * Fase 1C — recibo de pago en PDF (A5 apaisado, letra grande, pensado para
 * imprimir y guardar). Lleva un QR con el link de verificación pública: quien
 * lo escanee ve si el recibo es válido o fue anulado, sin datos personales.
 */
export type DatosReciboPdf = {
  organizacion: { nombre: string; color_primario?: string | null };
  numero: number;
  fecha: string; // YYYY-MM-DD
  socio: string;
  codigoPago: string | null;
  monto: number;
  concepto: string | null;
  metodoPago: string | null;
  aplicadoA: { concepto: string; monto: number }[];
  linkVerificacion: string;
  codigoVerificacion: string;
  anulado: { motivo: string | null } | null;
};

const money = (n: number) => `$ ${n.toLocaleString("es-UY", { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;
const MESES = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "setiembre", "octubre", "noviembre", "diciembre"];
const fechaLarga = (iso: string) => {
  const [y, m, d] = iso.slice(0, 10).split("-").map(Number);
  return `${d} de ${MESES[m - 1]} de ${y}`;
};
const METODO: Record<string, string> = { efectivo: "Efectivo", transferencia: "Transferencia", deposito: "Depósito", cheque: "Cheque", debito: "Débito", otro: "Otro" };

export async function generarReciboPdf(d: DatosReciboPdf): Promise<Buffer> {
  const qr = await QRCode.toBuffer(d.linkVerificacion, { margin: 1, width: 220 });
  return new Promise((resolve, reject) => {
    try {
      const doc = new PDFDocument({ size: "A5", layout: "landscape", margin: 36 });
      const chunks: Buffer[] = [];
      doc.on("data", (c) => chunks.push(c as Buffer));
      doc.on("end", () => resolve(Buffer.concat(chunks)));
      doc.on("error", reject);

      const W = doc.page.width;
      const color = d.organizacion.color_primario || "#3b3f8c";
      doc.rect(0, 0, W, 64).fill(color);
      doc.fillColor("#ffffff").font("Helvetica-Bold").fontSize(17).text(d.organizacion.nombre, 36, 18, { width: W - 220 });
      doc.font("Helvetica-Bold").fontSize(17).text(`RECIBO N° ${d.numero}`, W - 220, 18, { width: 184, align: "right" });
      doc.font("Helvetica").fontSize(10).text(fechaLarga(d.fecha), W - 220, 40, { width: 184, align: "right" });

      let y = 86;
      doc.fillColor("#111111").font("Helvetica").fontSize(12).text("Recibimos de", 36, y);
      doc.font("Helvetica-Bold").fontSize(16).text(d.socio, 36, y + 16, { width: W - 230 });
      if (d.codigoPago) doc.font("Helvetica").fontSize(10).fillColor("#444444").text(`Código de pago: ${d.codigoPago}`, 36, doc.y + 2);
      y = doc.y + 12;
      doc.fillColor("#111111").font("Helvetica").fontSize(12).text("la suma de", 36, y);
      doc.font("Helvetica-Bold").fontSize(26).text(money(d.monto), 36, y + 14);
      y = doc.y + 6;
      doc.font("Helvetica").fontSize(12).text(`Concepto: ${d.concepto || "Pago de cuota"}`, 36, y, { width: W - 230 });
      if (d.metodoPago) doc.text(`Forma de pago: ${METODO[d.metodoPago] ?? d.metodoPago}`, 36, doc.y + 2);
      if (d.aplicadoA.length) {
        doc.moveDown(0.4).font("Helvetica-Bold").fontSize(11).text("Se aplicó a:", 36, doc.y);
        doc.font("Helvetica").fontSize(11);
        for (const a of d.aplicadoA.slice(0, 6)) doc.text(`• ${a.concepto}: ${money(a.monto)}`, 44, doc.y + 1, { width: W - 240 });
      }

      doc.image(qr, W - 186, 82, { width: 150 });
      doc.font("Helvetica").fontSize(8.5).fillColor("#444444").text("Escaneá para verificar", W - 186, 236, { width: 150, align: "center" });
      doc.text(`Código: ${d.codigoVerificacion}`, W - 186, 248, { width: 150, align: "center" });

      // El pie va en el margen inferior: sin esto pdfkit agrega una página en blanco.
      doc.page.margins.bottom = 0;
      if (d.anulado) {
        doc.save();
        doc.rotate(-18, { origin: [W / 2, doc.page.height / 2] });
        doc.font("Helvetica-Bold").fontSize(64).fillColor("#c0392b").opacity(0.25).text("ANULADO", 0, doc.page.height / 2 - 40, { width: W, align: "center" });
        doc.restore();
        doc.opacity(1).font("Helvetica-Bold").fontSize(10).fillColor("#c0392b").text(`Recibo anulado${d.anulado.motivo ? `: ${d.anulado.motivo}` : ""}`, 36, doc.page.height - 58, { width: W - 72, lineBreak: false });
      }

      doc.opacity(1).font("Helvetica").fontSize(8).fillColor("#888888").text(`Emitido por ${d.organizacion.nombre} con COOVA. Verificación: ${d.linkVerificacion}`, 36, doc.page.height - 30, {
        width: W - 72,
        lineBreak: false,
      });
      doc.end();
    } catch (err) {
      reject(err);
    }
  });
}
