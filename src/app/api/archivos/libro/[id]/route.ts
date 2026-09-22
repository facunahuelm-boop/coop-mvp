import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { get } from "@/lib/db";
import { canRead } from "@/lib/roles";
import { getSignedUrl } from "@/lib/upload";

export const dynamic = "force-dynamic";

// Sub-fase 1.2 ("Libros Sociales digitales"): mismo mecanismo que
// /api/archivos/reporte/[id] (URL firmada, nunca la URL cruda de Storage),
// pero con una regla de autorización distinta a propósito. Los reportes de
// /reportes son una foto personal de quien la generó y esa pantalla ya
// filtra "WHERE creado_por_id = ?" — por eso su ruta exige que el que
// descarga sea quien lo generó. Un libro social es lo opuesto: es un
// registro institucional, mismo criterio de "comisiones y reuniones son
// transparentes para toda la cooperativa" que ya rige /reuniones y
// /decisiones (ver roles.ts) — así que acá la autorización es canRead
// sobre "comisiones", no "sos el autor".
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "No autenticado." }, { status: 401 });
  if (!canRead(user.rol, "comisiones")) {
    return NextResponse.json({ error: "No tenés permiso para ver los libros sociales." }, { status: 403 });
  }

  const { id } = await params;
  const idNum = Number(id);
  if (!Number.isInteger(idNum) || idNum <= 0) {
    return NextResponse.json({ error: "Libro inválido." }, { status: 400 });
  }

  // get() ya filtra por organization_id vía Row-Level Security — un id de
  // otra cooperativa no aparece acá.
  const libro = await get<{ id: number; archivo_url: string | null; tipo: string }>(
    `SELECT id, archivo_url, tipo FROM reportes_generados WHERE id = ?`,
    [idNum]
  );
  if (!libro || !libro.archivo_url) {
    return NextResponse.json({ error: "Ese libro no existe o no tiene un archivo asociado." }, { status: 404 });
  }
  if (!libro.tipo?.startsWith("libro_actas_") && libro.tipo !== "registro_socios") {
    return NextResponse.json({ error: "Ese registro no es un libro social." }, { status: 404 });
  }

  const signedUrl = await getSignedUrl(libro.archivo_url, 120);
  if (!signedUrl) {
    return NextResponse.json({ error: "No se pudo generar el link de descarga. Intentá de nuevo." }, { status: 500 });
  }

  return NextResponse.redirect(signedUrl);
}
