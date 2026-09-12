import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { pool } from "@/lib/db";

export const dynamic = "force-dynamic";

// Herramienta temporal de diagnóstico (Fase 11/12 del Prompt Maestro,
// hallazgo H-SEC-1 de REQUIREMENTS.md): la app usa `pool` (src/lib/db.ts),
// EXACTAMENTE la misma conexión que usa el resto del sistema en producción
// — no una conexión nueva armada acá — para confirmar con qué rol de
// Postgres está corriendo realmente ahora mismo, y si ese rol puede saltarse
// Row-Level Security. Si `rolbypassrls` da `true`, todo el aislamiento entre
// cooperativas depende únicamente del filtro manual de cada consulta, sin
// red de contención en la base — hay que fijar APP_DATABASE_URL en Vercel
// apuntando al rol app_user (ver FASE04_SEGURIDAD_DB.md) y volver a
// desplegar. Solo lectura, solo admin. Se borra del repo una vez confirmado.
export async function GET() {
  const user = await getCurrentUser().catch(() => null);
  if (!user || user.rol !== "admin") {
    return NextResponse.json({ ok: false, error: "No autorizado" }, { status: 401 });
  }

  const client = await pool.connect();
  try {
    const { rows } = await client.query(
      `SELECT current_user AS rol_conectado,
              (SELECT rolsuper FROM pg_roles WHERE rolname = current_user) AS es_superusuario,
              (SELECT rolbypassrls FROM pg_roles WHERE rolname = current_user) AS puede_saltar_rls`
    );
    const info = rows[0];
    const seguro = info?.es_superusuario === false && info?.puede_saltar_rls === false;
    return NextResponse.json({
      ok: true,
      ...info,
      diagnostico: seguro
        ? "OK: la app corre con un rol sin privilegios de superusuario y sin BYPASSRLS — el aislamiento por Row-Level Security entre cooperativas es real."
        : "ALERTA: la app está corriendo con un rol que puede saltarse Row-Level Security. El único aislamiento real entre cooperativas hoy es el filtro manual de cada consulta, sin red de contención en la base. Hace falta definir APP_DATABASE_URL en Vercel apuntando al rol app_user (ver FASE04_SEGURIDAD_DB.md) y volver a desplegar.",
    });
  } finally {
    client.release();
  }
}
