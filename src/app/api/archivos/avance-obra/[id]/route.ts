import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { canRead } from "@/lib/roles";
import { get } from "@/lib/db";
import { getSignedUrl } from "@/lib/upload";

export const dynamic = "force-dynamic";

// Fase 11 (Prompt Maestro), hallazgo H-SEC-2 de REQUIREMENTS.md: mismo patrón
// que /api/archivos/documento/[id] — antes, la foto de un avance de obra se
// imprimía como URL pública y permanente directo en el <img src>. Ahora el
// <img> apunta acá, que vuelve a verificar sesión, cooperativa y permiso, y
// recién ahí genera una URL firmada de corta duración y redirige — el
// navegador sigue la redirección de forma transparente, así que la foto se
// sigue viendo igual que antes, sin cambiar la interfaz.
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "No autenticado." }, { status: 401 });
  if (!canRead(user.rol, "obra")) {
    return NextResponse.json({ error: "No tenés permiso para ver esto." }, { status: 403 });
  }

  const { id } = await params;
  const idNum = Number(id);
  if (!Number.isInteger(idNum) || idNum <= 0) {
    return NextResponse.json({ error: "Avance inválido." }, { status: 400 });
  }

  // get() ya filtra por organization_id vía Row-Level Security (ver
  // src/lib/db.ts): un id de otra cooperativa simplemente no aparece acá.
  const avance = await get<{ id: number; foto_url: string | null }>(
    `SELECT id, foto_url FROM avances_obra WHERE id = ?`,
    [idNum]
  );
  if (!avance || !avance.foto_url) {
    return NextResponse.json({ error: "Esa foto no existe." }, { status: 404 });
  }

  const signedUrl = await getSignedUrl(avance.foto_url, 120);
  if (!signedUrl) {
    return NextResponse.json({ error: "No se pudo generar el link. Intentá de nuevo." }, { status: 500 });
  }

  return NextResponse.redirect(signedUrl);
}
