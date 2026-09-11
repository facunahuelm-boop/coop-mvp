import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { canRead } from "@/lib/roles";
import { all } from "@/lib/db";
import { CATEGORIA_COMPRA_LABEL } from "@/lib/constants";
import dayjs from "dayjs";

export const dynamic = "force-dynamic";

// Exportar gastos a CSV (pedido explícito: "permitir exportar la información
// cuando corresponda"). Se eligió CSV en vez de PDF (como ya hace
// /api/reportes/finanzas) porque acá el pedido es poder seguir trabajando el
// detalle en una planilla (filtrar, sumar, tablas dinámicas) — algo que un
// PDF no permite y que además es más simple de generar sin pdfkit. Mismos
// filtros y mismo permiso de lectura que la pantalla /gastos.

function csvEscape(v: any): string {
  const s = v === null || v === undefined ? "" : String(v);
  if (/[",\n;]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

export async function GET(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  if (!canRead(user.rol, "compras") && !canRead(user.rol, "finanzas")) {
    return NextResponse.json({ error: "No autorizado" }, { status: 403 });
  }

  const sp = request.nextUrl.searchParams;
  const condiciones: string[] = [];
  const params: any[] = [];
  const comisionId = sp.get("comision_id");
  const categoria = sp.get("categoria");
  const proveedorId = sp.get("proveedor_id");
  const estado = sp.get("estado");
  const formaPago = sp.get("forma_pago");
  const desde = sp.get("desde");
  const hasta = sp.get("hasta");
  if (comisionId) { condiciones.push(`g.comision_id = ?`); params.push(Number(comisionId)); }
  if (categoria) { condiciones.push(`g.categoria = ?`); params.push(categoria); }
  if (proveedorId) { condiciones.push(`g.proveedor_id = ?`); params.push(Number(proveedorId)); }
  if (estado) { condiciones.push(`g.estado = ?`); params.push(estado); }
  if (formaPago) { condiciones.push(`g.forma_pago ILIKE ?`); params.push(`%${formaPago}%`); }
  if (desde) { condiciones.push(`g.fecha >= ?`); params.push(desde); }
  if (hasta) { condiciones.push(`g.fecha <= ?`); params.push(hasta); }
  const where = condiciones.length ? `WHERE ${condiciones.join(" AND ")}` : "";

  let gastos: any[] = [];
  try {
    gastos = await all<any>(
      `SELECT g.fecha, c.nombre as comision, g.descripcion, p.nombre as proveedor, g.categoria, g.importe, g.forma_pago, g.estado, u.nombre as creado_por
       FROM gastos_comision g
       JOIN comisiones c ON c.id = g.comision_id
       LEFT JOIN proveedores p ON p.id = g.proveedor_id
       LEFT JOIN users u ON u.id = g.creado_por_id
       ${where}
       ORDER BY g.fecha DESC, g.creado_en DESC`,
      params
    );
  } catch {
    gastos = [];
  }

  const encabezados = ["Fecha", "Comisión", "Descripción", "Proveedor", "Categoría", "Importe", "Forma de pago", "Estado", "Registrado por"];
  const filas = gastos.map((g) => [
    g.fecha,
    g.comision,
    g.descripcion,
    g.proveedor || "",
    CATEGORIA_COMPRA_LABEL[g.categoria] || g.categoria,
    g.importe,
    g.forma_pago || "",
    g.estado,
    g.creado_por || "",
  ]);
  const csv = [encabezados, ...filas].map((fila) => fila.map(csvEscape).join(";")).join("\n");
  // BOM UTF-8 al inicio: Excel en Windows (el destino más probable de este
  // export) interpreta el CSV como Latin-1 sin esto, rompiendo tildes/ñ.
  const contenido = "﻿" + csv;

  return new NextResponse(contenido, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="gastos-${dayjs().format("YYYY-MM-DD")}.csv"`,
    },
  });
}
