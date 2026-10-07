import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { crearLibroExcel, respuestaExcel } from "@/lib/excel";

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

// Fase 2H: el padrón incluye el núcleo y la relación (una fila por persona).
const PLANTILLAS: Record<string, { encabezados: string[]; ejemplos: string[][] }> = {
  socios: {
    encabezados: ["nombre", "documento", "email", "telefono", "fecha_ingreso", "nucleo", "relacion", "notas"],
    ejemplos: [
      ["Ana Pérez (ejemplo)", "1234567-8", "ana@ejemplo.com", "099123456", "15/03/2020", "Pérez Gómez", "titular", "Vivienda 12"],
      ["Luis Gómez (ejemplo)", "2345678-9", "", "098765432", "", "Pérez Gómez", "pareja", ""],
      ["Sofía Pérez (ejemplo)", "", "", "", "", "Pérez Gómez", "hija", ""],
    ],
  },
  movimientos: {
    encabezados: ["tipo", "monto", "categoria", "fecha", "descripcion"],
    ejemplos: [["ingreso", "15000", "Cuota social", "2024-01-10", "Cuota social enero 2024"]],
  },
};

export async function GET(request: NextRequest, { params }: { params: Promise<{ tipo: string }> }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  if (user.rol !== "admin") return NextResponse.json({ error: "No autorizado" }, { status: 403 });

  const { tipo } = await params;
  const plantilla = PLANTILLAS[tipo];
  if (!plantilla) return NextResponse.json({ error: "Plantilla desconocida." }, { status: 404 });

  if (request.nextUrl.searchParams.get("formato") === "xlsx") {
    const buffer = await crearLibroExcel([
      {
        nombre: tipo === "socios" ? "Padrón" : "Movimientos",
        columnas: plantilla.encabezados.map((h) => ({ titulo: h, clave: h, ancho: Math.max(14, h.length + 4) })),
        filas: plantilla.ejemplos.map((f) => Object.fromEntries(plantilla.encabezados.map((h, i) => [h, f[i]]))),
      },
      ...(tipo === "socios"
        ? [
            {
              nombre: "Cómo completarla",
              columnas: [{ titulo: "Ayuda", clave: "t", ancho: 110 }],
              filas: [
                { t: "Una fila por persona. Borrá las filas de ejemplo antes de subirla." },
                { t: "nombre: obligatorio. documento: la cédula (con o sin puntos y guion)." },
                { t: "nucleo: el nombre del núcleo familiar. Todas las personas del mismo núcleo llevan el mismo nombre." },
                { t: "relacion: vacío o «titular» para el socio titular; para los demás: pareja, hijo, hija, padre, madre, hermano, hermana u otro." },
                { t: "fecha_ingreso: DD/MM/AAAA. Si no la sabés, dejala vacía." },
                { t: "Antes de guardar, COOVA te muestra una vista previa con los errores explicados. Nada se guarda hasta que confirmes." },
              ],
            },
          ]
        : []),
    ]);
    return respuestaExcel(buffer, `plantilla-${tipo}.xlsx`);
  }

  const csv = [plantilla.encabezados, ...plantilla.ejemplos].map((fila) => fila.map(csvEscape).join(";")).join("\n");
  const contenido = "﻿" + csv; // BOM UTF-8

  return new NextResponse(contenido, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="plantilla-${tipo}.csv"`,
    },
  });
}
