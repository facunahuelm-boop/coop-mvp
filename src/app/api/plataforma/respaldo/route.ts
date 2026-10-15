import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { leerRespaldoLimpieza } from "@/lib/plataformaLimpieza";

export const dynamic = "force-dynamic";

/**
 * Descarga el respaldo (JSON) que guardó una limpieza de datos de prueba.
 * Solo el administrador de la plataforma. Uso: /api/plataforma/respaldo?org=1&id=3
 */
export async function GET(req: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  if (!user.es_platform_admin) return NextResponse.json({ error: "Sin permiso" }, { status: 403 });
  const url = new URL(req.url);
  const orgId = Number(url.searchParams.get("org"));
  const id = Number(url.searchParams.get("id"));
  if (!Number.isInteger(orgId) || orgId <= 0 || !Number.isInteger(id) || id <= 0) {
    return NextResponse.json({ error: "Faltan datos" }, { status: 400 });
  }
  const contenido = await leerRespaldoLimpieza(orgId, id);
  if (!contenido) return NextResponse.json({ error: "No existe ese respaldo" }, { status: 404 });
  return new NextResponse(JSON.stringify(contenido, null, 2), {
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Disposition": `attachment; filename="respaldo-limpieza-${orgId}-${id}.json"`,
      "Cache-Control": "no-store",
    },
  });
}
