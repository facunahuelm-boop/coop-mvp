import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { get } from "@/lib/db";
import { getSignedUrl } from "@/lib/upload";
import { puedePlanificarHorasTrabajo } from "@/lib/comisionAuth";

export const dynamic = "force-dynamic";

// Fase 1B: certificado adjunto a un aviso de ausencia. Mismo criterio que
// /api/archivos/documento: se verifica sesión, cooperativa (RLS) y permiso
// antes de generar un link firmado de corta duración. Lo ven quien avisó y
// quien organiza las horas de la Comisión de Trabajo de ese turno.
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "No autenticado." }, { status: 401 });
  const { id } = await params;
  const idNum = Number(id);
  if (!Number.isInteger(idNum) || idNum <= 0) return NextResponse.json({ error: "Aviso inválido." }, { status: 400 });

  const aviso = await get<{ adjunto_url: string | null; avisado_por_id: number | null; comision_id: number | null }>(
    `SELECT v.adjunto_url, v.avisado_por_id, a.comision_id
       FROM avisos_ausencia v JOIN asignaciones_horas a ON a.id = v.asignacion_id WHERE v.id = ?`,
    [idNum]
  ).catch(() => undefined);
  if (!aviso || !aviso.adjunto_url) return NextResponse.json({ error: "Ese aviso no tiene un archivo." }, { status: 404 });
  const permitido =
    aviso.avisado_por_id === user.id || (aviso.comision_id ? await puedePlanificarHorasTrabajo(user, aviso.comision_id) : false);
  if (!permitido) return NextResponse.json({ error: "No tenés permiso para ver este archivo." }, { status: 403 });

  const signedUrl = await getSignedUrl(aviso.adjunto_url, 120);
  if (!signedUrl) return NextResponse.json({ error: "No se pudo generar el link de descarga. Intentá de nuevo." }, { status: 500 });
  return NextResponse.redirect(signedUrl);
}
