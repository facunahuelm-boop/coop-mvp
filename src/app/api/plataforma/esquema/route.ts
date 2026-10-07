import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { rootAll } from "@/lib/db";

export const dynamic = "force-dynamic";

/**
 * Diagnóstico de plataforma (sólo el administrador de la plataforma): los
 * tipos de las columnas de la base (sin ningún dato). Sirve para comparar la
 * base de producción con la de pruebas antes de publicar cambios.
 */
export async function GET() {
  const user = await getCurrentUser();
  if (!user?.es_platform_admin) return NextResponse.json({ error: "No autorizado" }, { status: 403 });
  const columnas = await rootAll<{ t: string; c: string; tipo: string }>(
    `SELECT table_name AS t, column_name AS c, data_type AS tipo FROM information_schema.columns WHERE table_schema = 'public' ORDER BY table_name, ordinal_position`
  );
  return NextResponse.json(columnas.map((x) => `${x.t}.${x.c}:${x.tipo}`));
}
