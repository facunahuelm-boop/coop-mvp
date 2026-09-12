import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { get } from "@/lib/db";
import { getSignedUrl } from "@/lib/upload";

export const dynamic = "force-dynamic";

// Fase 11 (Prompt Maestro), hallazgo H-SEC-2 de REQUIREMENTS.md: mismo
// problema y misma solución que /api/archivos/documento/[id] (ver ese
// archivo para el detalle completo), aplicado a los PDFs generados en
// /reportes. La pantalla de Reportes ya solo lista los reportes que generó
// el propio usuario (`WHERE creado_por_id = ?`) — acá se repite exactamente
// esa misma regla de negocio en el backend antes de entregar el archivo, en
// vez de confiar en que nadie arme a mano una URL de un reporte ajeno.
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "No autenticado." }, { status: 401 });

  const { id } = await params;
  const idNum = Number(id);
  if (!Number.isInteger(idNum) || idNum <= 0) {
    return NextResponse.json({ error: "Reporte inválido." }, { status: 400 });
  }

  // get() ya filtra por organization_id vía Row-Level Security — un id de
  // otra cooperativa no aparece acá.
  const reporte = await get<{ id: number; archivo_url: string | null; creado_por_id: number | null }>(
    `SELECT id, archivo_url, creado_por_id FROM reportes_generados WHERE id = ?`,
    [idNum]
  );
  if (!reporte || !reporte.archivo_url) {
    return NextResponse.json({ error: "Ese reporte no existe o no tiene un archivo asociado." }, { status: 404 });
  }
  if (reporte.creado_por_id !== user.id) {
    return NextResponse.json({ error: "Este reporte no fue generado por vos." }, { status: 403 });
  }

  const signedUrl = await getSignedUrl(reporte.archivo_url, 120);
  if (!signedUrl) {
    return NextResponse.json({ error: "No se pudo generar el link de descarga. Intentá de nuevo." }, { status: 500 });
  }

  return NextResponse.redirect(signedUrl);
}
