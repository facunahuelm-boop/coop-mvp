import { NextRequest, NextResponse } from "next/server";
import { rootAll } from "@/lib/db";
import { setOrgContext } from "@/lib/tenant";
import { hoyEnUruguay } from "@/lib/horasObra";
import { tareasDiariasCooperativa } from "@/lib/automatizaciones";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Fase 1C — tareas automáticas diarias (ver lib/automatizaciones.ts): cierre
// de semanas de horas, cuotas del mes, recargos y recordatorios. Corre una
// vez por día (vercel.json, 10:00 UTC = 07:00 en Montevideo) para cada
// cooperativa activa, cada una aislada en su propio contexto. Misma
// autenticación que /api/cron/recordatorios (CRON_SECRET).
function autorizado(req: NextRequest): boolean {
  const secreto = process.env.CRON_SECRET;
  if (!secreto) return false;
  if (req.headers.get("authorization") === `Bearer ${secreto}`) return true;
  return req.nextUrl.searchParams.get("key") === secreto;
}

export async function GET(req: NextRequest) {
  if (!autorizado(req)) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  // Sólo para pruebas en un entorno aislado: CRON_PERMITIR_FECHA=1 deja simular otra fecha.
  const fechaPedida = req.nextUrl.searchParams.get("hoy");
  const hoy = fechaPedida && process.env.CRON_PERMITIR_FECHA === "1" && /^\d{4}-\d{2}-\d{2}$/.test(fechaPedida) ? fechaPedida : hoyEnUruguay();
  const organizaciones = await rootAll<{ id: number; etapa: string }>(`SELECT id, etapa FROM organizations WHERE activo = 1`);
  const resumen: Record<number, unknown> = {};
  for (const org of organizaciones) {
    setOrgContext(org.id);
    try {
      resumen[org.id] = await tareasDiariasCooperativa(hoy, org.etapa);
    } catch (err) {
      resumen[org.id] = { error: String((err as Error)?.message ?? err) };
    }
  }
  return NextResponse.json({ hoy, resumen });
}
