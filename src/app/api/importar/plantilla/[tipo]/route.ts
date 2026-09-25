import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";

export const dynamic = "force-dynamic";

/**
 * Fase 6, Sub-fase 6.1 ("Migración de datos Excel/CSV"): plantilla
 * descargable con las columnas exactas que espera cada importador (ver
 * actions/importaciones.ts) — se eligió este camino (columnas fijas +
 * plantilla) en vez de un mapeo de columnas configurable a mano, para no
 * sumar una pantalla de mapeo genérica encima de una función que hoy solo
 * cubre 2 entidades. Mismo criterio de BOM UTF-8 que /api/gastos/export
 * para que Excel en Windows abra tildes/ñ sin romperse.
 */
function csvEscape(v: string): string {
  if (/[",\n;]/.test(v)) return `"${v.replace(/"/g, '""')}"`;
  return v;
}

const PLANTILLAS: Record<string, { encabezados: string[]; ejemplo: string[] }> = {
  socios: {
    encabezados: ["nombre", "documento", "email", "telefono", "fecha_ingreso", "notas"],
    ejemplo: ["Ana Pérez", "1234567-8", "ana@ejemplo.com", "099123456", "2020-03-15", "Titular de la vivienda 12"],
  },
  movimientos: {
    encabezados: ["tipo", "monto", "categoria", "fecha", "descripcion"],
    ejemplo: ["ingreso", "15000", "Cuota social", "2024-01-10", "Cuota social enero 2024"],
  },
};

export async function GET(request: NextRequest, { params }: { params: Promise<{ tipo: string }> }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  if (user.rol !== "admin") return NextResponse.json({ error: "No autorizado" }, { status: 403 });

  const { tipo } = await params;
  const plantilla = PLANTILLAS[tipo];
  if (!plantilla) return NextResponse.json({ error: "Plantilla desconocida." }, { status: 404 });

  const csv = [plantilla.encabezados, plantilla.ejemplo].map((fila) => fila.map(csvEscape).join(";")).join("\n");
  const contenido = "﻿" + csv; // BOM UTF-8

  return new NextResponse(contenido, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="plantilla-${tipo}.csv"`,
    },
  });
}
