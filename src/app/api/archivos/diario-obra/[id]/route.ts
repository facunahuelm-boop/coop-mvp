import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { canRead } from "@/lib/roles";
import { get } from "@/lib/db";
import { getSignedUrl } from "@/lib/upload";

export const dynamic = "force-dynamic";

/** Fase 3C — foto del diario de obra (sesión, RLS y permiso de Obra). */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "No autenticado." }, { status: 401 });
  if (!canRead(user.rol, "obra")) return NextResponse.json({ error: "No tenés permiso para ver esto." }, { status: 403 });
  const id = Number((await params).id);
  if (!Number.isInteger(id) || id <= 0) return NextResponse.json({ error: "Foto inválida." }, { status: 400 });
  const f = await get<{ foto_url: string }>(`SELECT foto_url FROM diario_obra_fotos WHERE id = ?`, [id]).catch(() => undefined);
  if (!f) return NextResponse.json({ error: "Esa foto no existe." }, { status: 404 });
  const url = await getSignedUrl(f.foto_url, 120);
  if (!url) return NextResponse.json({ error: "No se pudo generar el link. Intentá de nuevo." }, { status: 500 });
  return NextResponse.redirect(url);
}
