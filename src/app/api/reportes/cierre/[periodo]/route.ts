import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { get } from "@/lib/db";
import { ROLES_FINANZAS_DETALLE } from "@/lib/roles";
import { generarPdfBuffer, type SeccionPdf } from "@/lib/pdf";
import { resumenDePeriodo, textoPeriodo, money, ESTADO_PERIODO_LABEL, type ResumenPeriodo, type EstadoPeriodo } from "@/lib/finanzasLibro";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

/**
 * Fase 2A — "Cierre mensual por fondo" (PDF, sección 13). Si el mes está
 * cerrado se imprime lo que quedó congelado al cerrarlo; si está abierto, se
 * marca como BORRADOR con los números de ahora.
 */
export async function GET(_req: Request, { params }: { params: Promise<{ periodo: string }> }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  if (!ROLES_FINANZAS_DETALLE.includes(user.rol)) return NextResponse.json({ error: "Sin permiso" }, { status: 403 });
  const { periodo } = await params;
  if (!/^\d{4}-\d{2}$/.test(periodo)) return NextResponse.json({ error: "Mes inválido" }, { status: 400 });

  const p = await get<{ estado: EstadoPeriodo; resumen: ResumenPeriodo | string | null; cerrado_en: string | null; cerrado_por: string | null; visado_en: string | null; visado_por: string | null }>(
    `SELECT p.estado, p.resumen, p.cerrado_en, uc.nombre AS cerrado_por, p.visado_en, uv.nombre AS visado_por
       FROM periodos_financieros p LEFT JOIN users uc ON uc.id = p.cerrado_por_id LEFT JOIN users uv ON uv.id = p.visado_por_id
      WHERE p.periodo = ?`,
    [periodo]
  ).catch(() => undefined);
  const estado: EstadoPeriodo = p?.estado ?? "abierto";
  const congelado = estado !== "abierto" && p?.resumen ? (typeof p.resumen === "string" ? (JSON.parse(p.resumen) as ResumenPeriodo) : p.resumen) : null;
  const r = congelado ?? (await resumenDePeriodo(periodo));
  const f = (iso: string | null) => (iso ? iso.slice(0, 10).split("-").reverse().join("/") : "");

  const tablaSaldos = (encabezado: string, filas: ResumenPeriodo["porCuenta"]): SeccionPdf => ({
    tipo: "tabla",
    encabezado,
    columnas: ["", "Saldo al empezar", "Entró", "Salió", "Saldo al terminar"],
    filas: [
      ...filas.map((x) => [x.nombre, money(x.inicial), money(x.ingresos), money(x.egresos), money(x.final)]),
      [
        "Total",
        money(filas.reduce((a, x) => a + x.inicial, 0)),
        money(filas.reduce((a, x) => a + x.ingresos, 0)),
        money(filas.reduce((a, x) => a + x.egresos, 0)),
        money(filas.reduce((a, x) => a + x.final, 0)),
      ],
    ],
  });

  const secciones: SeccionPdf[] = [
    {
      tipo: "texto",
      parrafos: [
        `Estado: ${ESTADO_PERIODO_LABEL[estado]}.`,
        ...(p?.cerrado_en && estado !== "abierto" ? [`Cerrado el ${f(p.cerrado_en)} por ${p.cerrado_por ?? "—"}.`] : []),
        ...(p?.visado_en && estado === "visado" ? [`Visado por la Comisión Fiscal el ${f(p.visado_en)} (${p.visado_por ?? "—"}).`] : []),
        ...(estado === "abierto" ? ["BORRADOR: el mes todavía está abierto, estos números pueden cambiar."] : []),
        `Ingresos del mes: ${money(r.ingresos)} · Egresos del mes: ${money(r.egresos)} · Resultado: ${money(r.ingresos - r.egresos)}.`,
        ...(r.contraMovimientos ? [`Correcciones (contra-movimientos) en el mes: ${r.contraMovimientos}.`] : []),
        ...(r.anulados ? [`Movimientos anulados en el mes (no cuentan): ${r.anulados}.`] : []),
      ],
    },
    tablaSaldos("Por fondo (para qué es la plata)", r.porFondo),
    tablaSaldos("Por cuenta (dónde está la plata)", r.porCuenta),
    {
      tipo: "tabla",
      encabezado: "Por rubro",
      columnas: ["Rubro", "Ingresos", "Egresos"],
      filas: r.porRubro.map((x) => [x.categoria, money(x.ingresos), money(x.egresos)]),
    },
    {
      tipo: "texto",
      encabezado: "Firmas",
      parrafos: ["Tesorería: ______________________________", "Comisión Fiscal: ______________________________"],
    },
  ];

  const pdf = await generarPdfBuffer({
    titulo: `Cierre de ${textoPeriodo(periodo)}`,
    subtitulo: estado === "abierto" ? "Borrador — mes abierto" : "Cierre mensual por fondo",
    organizacion: user.organizacion,
    secciones,
  });
  return new Response(new Uint8Array(pdf), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="cierre-${periodo}.pdf"`,
      "Cache-Control": "no-store",
    },
  });
}
