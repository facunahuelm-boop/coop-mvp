import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { buscarGlobal } from "@/lib/logic";

export const dynamic = "force-dynamic";

/**
 * Fase 11 del Plan Maestro — atajo Ctrl+K (ver CommandPalette.tsx). El
 * componente necesita traer resultados mientras la persona todavía está
 * escribiendo, sin recargar ninguna página — por eso esto es una ruta de
 * API liviana y no un Server Action (que solo puede dispararse desde un
 * <form>). Usa la misma buscarGlobal() que /buscar, así que respeta los
 * mismos permisos por rol.
 */
export async function GET(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ resultados: [] }, { status: 401 });

  const q = (req.nextUrl.searchParams.get("q") || "").trim();
  if (q.length < 2) return NextResponse.json({ resultados: [] });

  const resultados = await buscarGlobal(q, user.rol);
  return NextResponse.json({ resultados: resultados.slice(0, 20) });
}
