import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { get } from "@/lib/db";
import { getSignedUrl } from "@/lib/upload";
import { canRead } from "@/lib/roles";
import { moduloDeReporteHub } from "@/lib/constants";

export const dynamic = "force-dynamic";

// Fase 11 (Prompt Maestro), hallazgo H-SEC-2 de REQUIREMENTS.md: originalmente
// esta ruta exigía `creado_por_id === user.id` (mismo criterio que
// /api/archivos/documento/[id]) porque la pantalla de Reportes solo listaba
// lo que había generado el propio usuario. Fase 6, Sub-fase 6.2 ("Reportes")
// cambia ese criterio a propósito: un Reporte Financiero generado por
// Tesorería debe poder descargarlo también Consejo Directivo, no solo quien
// hizo click en "Generar PDF" — así que el gate pasa a ser "¿esta persona
// tiene permiso de LECTURA del módulo de este tipo de reporte?" (mismo
// canRead que ya decide qué tarjetas ve en /reportes), en vez de "¿lo generó
// vos?". reportes_generados también guarda tipos de OTRAS pantallas
// (informe_fiscal, libro_actas_<organo>, registro_socios, cada una con su
// propia ruta y su propio criterio) — moduloDeReporteHub() devuelve null
// para esos, y se deniega, para no abrir sin querer una puerta de acceso a
// esos documentos desde acá.
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
  const reporte = await get<{ id: number; tipo: string; archivo_url: string | null }>(
    `SELECT id, tipo, archivo_url FROM reportes_generados WHERE id = ?`,
    [idNum]
  );
  if (!reporte || !reporte.archivo_url) {
    return NextResponse.json({ error: "Ese reporte no existe o no tiene un archivo asociado." }, { status: 404 });
  }

  const modulo = moduloDeReporteHub(reporte.tipo);
  if (!modulo || !canRead(user.rol, modulo)) {
    return NextResponse.json({ error: "No tenés permiso para descargar este reporte." }, { status: 403 });
  }

  const signedUrl = await getSignedUrl(reporte.archivo_url, 120);
  if (!signedUrl) {
    return NextResponse.json({ error: "No se pudo generar el link de descarga. Intentá de nuevo." }, { status: 500 });
  }

  return NextResponse.redirect(signedUrl);
}
