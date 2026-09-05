import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { all } from "@/lib/db";
import { resumenFinanciero } from "@/lib/logic";
import { ROLES_FINANZAS_DETALLE } from "@/lib/roles";
import PDFDocument from "pdfkit";
import dayjs from "dayjs";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

const money = (n: number) => `$${Math.round(n).toLocaleString("es-UY")}`;
const MARGIN = 48;
const PAGE_RIGHT = 595.28 - MARGIN; // A4 width en puntos, menos el margen derecho

const ALTO_FILA = 14;

function fila(doc: PDFKit.PDFDocument, celdas: string[], anchos: number[]) {
  const y = doc.y;
  let x = MARGIN;
  celdas.forEach((celda, i) => {
    // width + height juntos son necesarios para que "ellipsis" trunque a una
    // sola línea — con solo "width" pdfkit igual hace salto de línea y las
    // filas de la tabla terminan pisándose entre sí.
    doc.text(celda ?? "", x, y, { width: anchos[i] - 6, height: ALTO_FILA, ellipsis: true });
    x += anchos[i];
  });
  doc.y = y + ALTO_FILA + 3;
}

function asegurarEspacio(doc: PDFKit.PDFDocument, necesario: number) {
  if (doc.y + necesario > doc.page.height - doc.page.margins.bottom) {
    doc.addPage();
  }
}

function tituloSeccion(doc: PDFKit.PDFDocument, texto: string) {
  asegurarEspacio(doc, 60);
  doc.moveDown(0.6);
  doc.fontSize(12.5).font("Helvetica-Bold").fillColor("#123240").text(texto, MARGIN, doc.y, { lineBreak: true });
  doc.moveDown(0.4);
}

export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  if (!ROLES_FINANZAS_DETALLE.includes(user.rol)) {
    return NextResponse.json({ error: "No tenés permiso para ver el detalle financiero" }, { status: 403 });
  }

  const [fin, movimientos, compromisos] = await Promise.all([
    resumenFinanciero(),
    all<any>(
      `SELECT m.*, u.nombre as registrado_por FROM movimientos_financieros m
       LEFT JOIN users u ON u.id = m.registrado_por_id ORDER BY fecha DESC`
    ),
    all<any>(`SELECT * FROM compromisos_futuros ORDER BY fecha_estimada ASC`),
  ]);

  const chunks: Buffer[] = [];
  const doc = new PDFDocument({ size: "A4", margin: MARGIN, bufferPages: true });
  doc.on("data", (c: Buffer) => chunks.push(c));

  const pdfBuffer: Buffer = await new Promise((resolve, reject) => {
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    // ---------- Encabezado ----------
    doc.fontSize(19).font("Helvetica-Bold").fillColor("#123240").text("UFAMA — Reporte Financiero");
    doc.moveDown(0.15);
    doc
      .fontSize(9.5)
      .font("Helvetica")
      .fillColor("#666")
      .text(`Cooperativa de vivienda por ayuda mutua · generado el ${dayjs().format("DD/MM/YYYY [a las] HH:mm")}`);
    doc.moveDown(0.5);
    doc.strokeColor("#123240").lineWidth(1.4).moveTo(MARGIN, doc.y).lineTo(PAGE_RIGHT, doc.y).stroke();

    // ---------- Resumen general ----------
    tituloSeccion(doc, "Resumen general");
    doc.fontSize(10).font("Helvetica").fillColor("#333");
    const resumen: [string, string][] = [
      ["Ingresos totales", money(fin.ingresos)],
      ["Egresos totales", money(fin.egresos)],
      ["Saldo", money(fin.saldo)],
      ["Comprometido (compromisos futuros)", money(fin.comprometido)],
      ["Gastos proyectados (próximos 30 días)", money(fin.gastosProyectados)],
    ];
    resumen.forEach(([label, valor]) => fila(doc, [label, valor], [340, 150]));
    doc.moveDown(0.2);
    doc.fontSize(10.5).font("Helvetica-Bold").fillColor(fin.disponiblePrudencial < 0 ? "#b0392c" : "#123240");
    fila(doc, ["Disponible prudencial", money(fin.disponiblePrudencial)], [340, 150]);
    doc.fontSize(8.5).font("Helvetica").fillColor("#888").text(
      "Disponible prudencial = saldo actual menos lo ya comprometido. No es lo mismo que el saldo bancario.",
      MARGIN,
      doc.y + 2,
      { width: PAGE_RIGHT - MARGIN }
    );
    doc.moveDown(0.4);

    // ---------- Gasto por categoría ----------
    tituloSeccion(doc, "Gasto por categoría");
    if (fin.porCategoria.length === 0) {
      doc.fontSize(9.5).font("Helvetica").fillColor("#999").text("Sin egresos registrados.");
    } else {
      doc.fontSize(9).font("Helvetica-Bold").fillColor("#666");
      fila(doc, ["Categoría", "Total gastado"], [340, 150]);
      doc.font("Helvetica").fillColor("#333");
      (fin.porCategoria as any[]).forEach((c) => fila(doc, [c.categoria, money(c.total)], [340, 150]));
    }

    // ---------- Presupuesto vs real ----------
    tituloSeccion(doc, "Presupuesto vs. gasto real");
    if ((fin.presupuestoVsReal as any[]).length === 0) {
      doc.fontSize(9.5).font("Helvetica").fillColor("#999").text("Sin presupuesto cargado.");
    } else {
      doc.fontSize(9).font("Helvetica-Bold").fillColor("#666");
      fila(doc, ["Categoría", "Presupuestado", "Gastado", "Desvío"], [180, 120, 120, 80]);
      doc.font("Helvetica").fillColor("#333");
      (fin.presupuestoVsReal as any[]).forEach((p) => {
        const desv = p.monto_presupuestado > 0 ? Math.round(((p.gastado - p.monto_presupuestado) / p.monto_presupuestado) * 100) : 0;
        fila(doc, [p.categoria, money(p.monto_presupuestado), money(p.gastado), `${desv}%`], [180, 120, 120, 80]);
      });
    }

    // ---------- Próximos compromisos ----------
    tituloSeccion(doc, "Próximos pagos y compromisos");
    if (compromisos.length === 0) {
      doc.fontSize(9.5).font("Helvetica").fillColor("#999").text("Sin compromisos futuros cargados.");
    } else {
      doc.fontSize(9).font("Helvetica-Bold").fillColor("#666");
      fila(doc, ["Fecha", "Descripción", "Origen", "Monto"], [70, 210, 130, 90]);
      doc.font("Helvetica").fillColor("#333");
      compromisos.forEach((c: any) => {
        asegurarEspacio(doc, ALTO_FILA + 5);
        fila(doc, [dayjs(c.fecha_estimada).format("DD/MM/YYYY"), c.descripcion || "-", c.origen || "-", money(c.monto)], [70, 210, 130, 90]);
      });
    }

    // ---------- Movimientos (detalle completo) ----------
    tituloSeccion(doc, `Movimientos (${movimientos.length})`);
    if (movimientos.length === 0) {
      doc.fontSize(9.5).font("Helvetica").fillColor("#999").text("Sin movimientos registrados.");
    } else {
      doc.fontSize(9).font("Helvetica-Bold").fillColor("#666");
      fila(doc, ["Fecha", "Tipo", "Categoría", "Descripción", "Monto"], [60, 55, 110, 195, 60]);
      doc.font("Helvetica").fillColor("#333");
      movimientos.forEach((m: any) => {
        asegurarEspacio(doc, ALTO_FILA + 5);
        fila(
          doc,
          [dayjs(m.fecha).format("DD/MM/YY"), m.tipo === "ingreso" ? "Ingreso" : "Egreso", m.categoria || "-", m.descripcion || "-", money(m.monto)],
          [60, 55, 110, 195, 60]
        );
      });
    }

    // ---------- Numeración de página ----------
    const rango = doc.bufferedPageRange();
    for (let i = rango.start; i < rango.start + rango.count; i++) {
      doc.switchToPage(i);
      doc
        .fontSize(8)
        .font("Helvetica")
        .fillColor("#aaa")
        .text(`UFAMA · página ${i + 1} de ${rango.count}`, MARGIN, doc.page.height - 32, {
          width: PAGE_RIGHT - MARGIN,
          align: "center",
        });
    }

    doc.end();
  });

  return new NextResponse(new Uint8Array(pdfBuffer), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="ufama-reporte-financiero-${dayjs().format("YYYY-MM-DD")}.pdf"`,
      "Cache-Control": "no-store",
    },
  });
}
