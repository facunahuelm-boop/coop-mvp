import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { canRead } from "@/lib/roles";
import { get } from "@/lib/db";
import { getSignedUrl } from "@/lib/upload";

export const dynamic = "force-dynamic";

// Fase 11 (Prompt Maestro), hallazgo H-SEC-2 de REQUIREMENTS.md: mismo patrón
// que /api/archivos/documento/[id] — la foto de un reclamo pasa a servirse
// mediada, re-verificando sesión, cooperativa y permiso, en vez de imprimir
// la URL pública y permanente directo en el <img src>.
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "No autenticado." }, { status: 401 });
  if (!canRead(user.rol, "reclamos")) {
    return NextResponse.json({ error: "No tenés permiso para ver esto." }, { status: 403 });
  }

  const { id } = await params;
  const idNum = Number(id);
  if (!Number.isInteger(idNum) || idNum <= 0) {
    return NextResponse.json({ error: "Reclamo inválido." }, { status: 400 });
  }

  const reclamo = await get<{ id: number; foto_url: string | null }>(
    `SELECT id, foto_url FROM reclamos WHERE id = ?`,
    [idNum]
  );
  if (!reclamo || !reclamo.foto_url) {
    return NextResponse.json({ error: "Esa foto no existe." }, { status: 404 });
  }

  const signedUrl = await getSignedUrl(reclamo.foto_url, 120);
  if (!signedUrl) {
    return NextResponse.json({ error: "No se pudo generar el link. Intentá de nuevo." }, { status: 500 });
  }

  return NextResponse.redirect(signedUrl);
}
