import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { canRead } from "@/lib/roles";
import { get } from "@/lib/db";
import { getSignedUrl } from "@/lib/upload";

export const dynamic = "force-dynamic";

// Fase 11 (Prompt Maestro), hallazgo H-SEC-2 de REQUIREMENTS.md: mismo patrón
// que /api/archivos/documento/[id] — la foto de un incidente de seguridad
// pasa a servirse mediada, re-verificando sesión, cooperativa y permiso, en
// vez de imprimir la URL pública y permanente directo en el <img src>.
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "No autenticado." }, { status: 401 });
  if (!canRead(user.rol, "seguridad")) {
    return NextResponse.json({ error: "No tenés permiso para ver esto." }, { status: 403 });
  }

  const { id } = await params;
  const idNum = Number(id);
  if (!Number.isInteger(idNum) || idNum <= 0) {
    return NextResponse.json({ error: "Incidente inválido." }, { status: 400 });
  }

  const incidente = await get<{ id: number; foto_url: string | null }>(
    `SELECT id, foto_url FROM incidentes_seguridad WHERE id = ?`,
    [idNum]
  );
  if (!incidente || !incidente.foto_url) {
    return NextResponse.json({ error: "Esa foto no existe." }, { status: 404 });
  }

  const signedUrl = await getSignedUrl(incidente.foto_url, 120);
  if (!signedUrl) {
    return NextResponse.json({ error: "No se pudo generar el link. Intentá de nuevo." }, { status: 500 });
  }

  return NextResponse.redirect(signedUrl);
}
