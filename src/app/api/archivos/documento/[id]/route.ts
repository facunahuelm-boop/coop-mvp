import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { canRead } from "@/lib/roles";
import { get } from "@/lib/db";
import { getSignedUrl } from "@/lib/upload";

export const dynamic = "force-dynamic";

// Fase 11 (Prompt Maestro), hallazgo H-SEC-2 de REQUIREMENTS.md: antes, la
// pantalla de Documentos (y el acta dentro de una Reunión) imprimían la URL
// pública y permanente del archivo directo en el HTML — quien la obtuviera
// (compartida, guardada, en el historial del navegador) podía descargarla
// para siempre, sin sesión ni pertenecer a la cooperativa, y el sistema no
// tenía forma de saberlo ni impedirlo. Ahora todo enlace de descarga de un
// documento pasa por acá, que vuelve a verificar sesión, cooperativa y
// permiso ANTES de generar recién en este momento una URL firmada de corta
// duración (ver getSignedUrl en src/lib/upload.ts).
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "No autenticado." }, { status: 401 });
  if (!canRead(user.rol, "documentos")) {
    return NextResponse.json({ error: "No tenés permiso para ver documentos." }, { status: 403 });
  }

  const { id } = await params;
  const idNum = Number(id);
  if (!Number.isInteger(idNum) || idNum <= 0) {
    return NextResponse.json({ error: "Documento inválido." }, { status: 400 });
  }

  // get() ya filtra por organization_id vía Row-Level Security (ver
  // src/lib/db.ts): un id que pertenece a otra cooperativa simplemente no
  // aparece acá, no hace falta (ni alcanzaría) comparar organization_id a mano.
  const doc = await get<{ id: number; archivo_url: string | null }>(
    `SELECT id, archivo_url FROM documentos WHERE id = ?`,
    [idNum]
  );
  if (!doc || !doc.archivo_url) {
    return NextResponse.json({ error: "Ese documento no existe o no tiene un archivo asociado." }, { status: 404 });
  }

  const signedUrl = await getSignedUrl(doc.archivo_url, 120);
  if (!signedUrl) {
    return NextResponse.json({ error: "No se pudo generar el link de descarga. Intentá de nuevo." }, { status: 500 });
  }

  return NextResponse.redirect(signedUrl);
}
