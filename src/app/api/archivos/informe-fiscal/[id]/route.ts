import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { get } from "@/lib/db";
import { canRead } from "@/lib/roles";
import { getSignedUrl } from "@/lib/upload";

export const dynamic = "force-dynamic";

// Sub-fase 1.5 ("Panel de Comisión Fiscal"): mismo mecanismo que
// /api/archivos/libro/[id] (URL firmada, nunca la URL cruda de Storage) —
// pero con su propio criterio de autorización. El Informe de la Comisión
// Fiscal no es un dato personal de quien lo generó (no usa el criterio de
// /api/archivos/reporte/[id]) ni tampoco algo transparente para toda la
// cooperativa como los Libros Sociales (no usa canRead sobre "comisiones").
// Es un documento de control interno: solo lo leen los mismos roles que ya
// tienen lectura sobre "auditoria" en la matriz de permisos (tesorería,
// consejo directivo, fiscal, admin) — exactamente el grupo de "conducción y
// control", ni más amplio ni más restringido.
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "No autenticado." }, { status: 401 });
  if (!canRead(user.rol, "auditoria")) {
    return NextResponse.json({ error: "No tenés permiso para ver los informes de la Comisión Fiscal." }, { status: 403 });
  }

  const { id } = await params;
  const idNum = Number(id);
  if (!Number.isInteger(idNum) || idNum <= 0) {
    return NextResponse.json({ error: "Informe inválido." }, { status: 400 });
  }

  // get() ya filtra por organization_id vía Row-Level Security — un id de
  // otra cooperativa no aparece acá.
  const informe = await get<{ id: number; archivo_url: string | null; tipo: string }>(
    `SELECT id, archivo_url, tipo FROM reportes_generados WHERE id = ?`,
    [idNum]
  );
  if (!informe || !informe.archivo_url) {
    return NextResponse.json({ error: "Ese informe no existe o no tiene un archivo asociado." }, { status: 404 });
  }
  if (informe.tipo !== "informe_fiscal") {
    return NextResponse.json({ error: "Ese registro no es un informe de la Comisión Fiscal." }, { status: 404 });
  }

  const signedUrl = await getSignedUrl(informe.archivo_url, 120);
  if (!signedUrl) {
    return NextResponse.json({ error: "No se pudo generar el link de descarga. Intentá de nuevo." }, { status: 500 });
  }

  return NextResponse.redirect(signedUrl);
}
