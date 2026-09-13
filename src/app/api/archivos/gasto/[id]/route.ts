import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { canRead } from "@/lib/roles";
import { get } from "@/lib/db";
import { getSignedUrl } from "@/lib/upload";

export const dynamic = "force-dynamic";

// Fase 11 (Prompt Maestro), hallazgo H-SEC-2 de REQUIREMENTS.md: mismo patrón
// que /api/archivos/documento/[id] — el comprobante de un gasto pasa a
// servirse mediado, re-verificando sesión, cooperativa y permiso, en vez de
// una URL pública y permanente. El chequeo de permiso repite exactamente el
// gate de lectura de /gastos (canRead compras O finanzas — ver page.tsx),
// para no ser ni más restrictivo ni más permisivo que la pantalla que enlaza
// acá.
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "No autenticado." }, { status: 401 });
  if (!canRead(user.rol, "compras") && !canRead(user.rol, "finanzas")) {
    return NextResponse.json({ error: "No tenés permiso para ver esto." }, { status: 403 });
  }

  const { id } = await params;
  const idNum = Number(id);
  if (!Number.isInteger(idNum) || idNum <= 0) {
    return NextResponse.json({ error: "Gasto inválido." }, { status: 400 });
  }

  const gasto = await get<{ id: number; comprobante_url: string | null }>(
    `SELECT id, comprobante_url FROM gastos_comision WHERE id = ?`,
    [idNum]
  );
  if (!gasto || !gasto.comprobante_url) {
    return NextResponse.json({ error: "Ese comprobante no existe." }, { status: 404 });
  }

  const signedUrl = await getSignedUrl(gasto.comprobante_url, 120);
  if (!signedUrl) {
    return NextResponse.json({ error: "No se pudo generar el link. Intentá de nuevo." }, { status: 500 });
  }

  return NextResponse.redirect(signedUrl);
}
