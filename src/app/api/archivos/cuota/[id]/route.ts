import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { ROLES_FINANZAS_DETALLE } from "@/lib/roles";
import { get } from "@/lib/db";
import { getSignedUrl } from "@/lib/upload";

export const dynamic = "force-dynamic";

// Mismo patrón que /api/archivos/gasto/[id] (Fase 11, hallazgo H-SEC-2): el
// comprobante de un movimiento de cuenta de socio se sirve mediado en vez de
// con una URL pública y permanente. El chequeo de permiso es más amplio que
// el de gastos: además de Tesorería/Administración/Directiva/Fiscal/Admin
// (ROLES_FINANZAS_DETALLE), el PROPIO socio dueño de ese movimiento también
// puede ver su comprobante — mismo criterio ya usado en /socios/[id]
// ("esElPropioSocio" puede ver su cuenta corriente).
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "No autenticado." }, { status: 401 });

  const { id } = await params;
  const idNum = Number(id);
  if (!Number.isInteger(idNum) || idNum <= 0) {
    return NextResponse.json({ error: "Movimiento inválido." }, { status: 400 });
  }

  const movimiento = await get<{ id: number; comprobante_url: string | null; socio_id: number }>(
    `SELECT id, comprobante_url, socio_id FROM movimientos_cuenta_socio WHERE id = ?`,
    [idNum]
  );
  if (!movimiento || !movimiento.comprobante_url) {
    return NextResponse.json({ error: "Ese comprobante no existe." }, { status: 404 });
  }

  const esFinanzas = ROLES_FINANZAS_DETALLE.includes(user.rol);
  let esElPropioSocio = false;
  if (!esFinanzas) {
    const socio = await get<{ user_id: number | null }>(`SELECT user_id FROM socios WHERE id = ?`, [movimiento.socio_id]);
    esElPropioSocio = !!socio?.user_id && socio.user_id === user.id;
  }
  if (!esFinanzas && !esElPropioSocio) {
    return NextResponse.json({ error: "No tenés permiso para ver esto." }, { status: 403 });
  }

  const signedUrl = await getSignedUrl(movimiento.comprobante_url, 120);
  if (!signedUrl) {
    return NextResponse.json({ error: "No se pudo generar el link. Intentá de nuevo." }, { status: 500 });
  }

  return NextResponse.redirect(signedUrl);
}
