import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { all } from "@/lib/db";
import { resumenFinanciero } from "@/lib/logic";
import { ROLES_FINANZAS_DETALLE } from "@/lib/roles";
import { generarPdfBuffer, type SeccionPdf } from "@/lib/pdf";
import dayjs from "dayjs";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

const money = (n: number) => `$${Math.round(n || 0).toLocaleString("es-UY")}`;

// Fase 6, Sub-fase 6.2 ("Reportes", hallazgo H-2 de REQUIREMENTS.md): esta
// ruta dibujaba su propio PDF a mano con pdfkit directo (tablas, paginación
// y numeración de página reimplementadas desde cero), en paralelo al motor
// compartido `generarPdfBuffer` (lib/pdf.ts) que ya usan las actas de
// reuniones, el informe fiscal, el Libro de Actas y el hub /reportes — la
// auditoría previa de esta sub-fase encontró que ese hallazgo seguía sin
// resolver. Se unifica acá sin cambiar el comportamiento visible desde
// /finanzas ("📄 Descargar reporte PDF" sigue siendo una descarga directa,
// completa —sin el límite de 100 filas del hub— y sin quedar guardada en
// reportes_generados, a diferencia de "Reporte Financiero" del hub).
//
// Diferencias menores y deliberadas frente a la versión anterior, aceptadas
// a cambio de no duplicar el motor de dibujo: el pie de página pasa a ser el
// mismo de todos los PDFs generados por el sistema ("Generado
// automáticamente por <cooperativa> el <fecha>") en vez de una numeración
// de página propia; una sección sin datos (sin presupuesto, sin egresos,
// etc.) se muestra como una tabla con solo el encabezado, igual que ya hacen
// hoy las demás secciones vacías del hub, en vez de un texto tipo "Sin
// presupuesto cargado" a medida.
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

  const secciones: SeccionPdf[] = [
    {
      tipo: "tabla",
      encabezado: "Resumen general",
      columnas: ["Concepto", "Monto"],
      filas: [
        ["Ingresos totales", money(fin.ingresos)],
        ["Egresos totales", money(fin.egresos)],
        ["Saldo", money(fin.saldo)],
        ["Comprometido (compromisos futuros)", money(fin.comprometido)],
        ["Gastos proyectados (próximos 30 días)", money(fin.gastosProyectados)],
        ["Disponible prudencial", money(fin.disponiblePrudencial)],
      ],
    },
    {
      tipo: "texto",
      parrafos: ["Disponible prudencial = saldo actual menos lo ya comprometido. No es lo mismo que el saldo bancario."],
    },
    {
      tipo: "tabla",
      encabezado: "Gasto por categoría",
      columnas: ["Categoría", "Total gastado"],
      filas: (fin.porCategoria as any[]).map((c) => [c.categoria, money(c.total)]),
    },
    {
      tipo: "tabla",
      encabezado: "Presupuesto vs. gasto real",
      columnas: ["Categoría", "Presupuestado", "Gastado", "Desvío"],
      filas: (fin.presupuestoVsReal as any[]).map((p) => {
        const desv = p.monto_presupuestado > 0 ? Math.round(((p.gastado - p.monto_presupuestado) / p.monto_presupuestado) * 100) : 0;
        return [p.categoria, money(p.monto_presupuestado), money(p.gastado), `${desv}%`];
      }),
    },
    {
      tipo: "tabla",
      encabezado: "Próximos pagos y compromisos",
      columnas: ["Fecha", "Descripción", "Origen", "Monto"],
      filas: compromisos.map((c: any) => [dayjs(c.fecha_estimada).format("DD/MM/YYYY"), c.descripcion || "—", c.origen || "—", money(c.monto)]),
    },
    {
      tipo: "tabla",
      encabezado: `Movimientos (${movimientos.length})`,
      columnas: ["Fecha", "Tipo", "Categoría", "Descripción", "Monto"],
      // Sub-fase 4.4: un movimiento anulado ya no cuenta en fin.* de arriba,
      // pero sigue listado acá para trazabilidad — marcado, sin límite de
      // filas (esta ruta es la descarga de detalle completo; el resumen de
      // 50/100 filas es del hub /reportes, no de acá).
      filas: movimientos.map((m: any) => [
        dayjs(m.fecha).format("DD/MM/YYYY"),
        (m.tipo === "ingreso" ? "Ingreso" : "Egreso") + (m.estado === "anulado" ? " (anulado)" : ""),
        m.categoria || "—",
        m.descripcion || "—",
        money(m.monto),
      ]),
    },
  ];

  const pdfBuffer = await generarPdfBuffer({
    titulo: "Reporte Financiero",
    subtitulo: `Generado el ${dayjs().format("DD/MM/YYYY [a las] HH:mm")}`,
    organizacion: user.organizacion,
    secciones,
  });

  return new NextResponse(new Uint8Array(pdfBuffer), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="coova-reporte-financiero-${dayjs().format("YYYY-MM-DD")}.pdf"`,
      "Cache-Control": "no-store",
    },
  });
}
