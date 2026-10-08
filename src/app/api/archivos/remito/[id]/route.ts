import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { canRead } from "@/lib/roles";
import { get } from "@/lib/db";
import { getSignedUrl } from "@/lib/upload";

export const dynamic = "force-dynamic";

/** Fase 3C — foto del remito de una recepción de materiales (mismo criterio que las demás fotos: sesión, RLS y permiso). */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "No autenticado." }, { status: 401 });
  if (!canRead(user.rol, "compras") && !canRead(user.rol, "obra")) return NextResponse.json({ error: "No tenés permiso para ver esto." }, { status: 403 });
  const id = Number((await params).id);
  if (!Number.isInteger(id) || id <= 0) return NextResponse.json({ error: "Recepción inválida." }, { status: 400 });
  const r = await get<{ remito_foto_url: string | null }>(`SELECT remito_foto_url FROM recepciones_material WHERE id = ?`, [id]).catch(() => undefined);
  if (!r?.remito_foto_url) return NextResponse.json({ error: "Esa foto no existe." }, { status: 404 });
  const url = await getSignedUrl(r.remito_foto_url, 120);
  if (!url) return NextResponse.json({ error: "No se pudo generar el link. Intentá de nuevo." }, { status: 500 });
  return NextResponse.redirect(url);
}
