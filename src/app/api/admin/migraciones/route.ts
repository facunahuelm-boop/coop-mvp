import { NextRequest, NextResponse } from "next/server";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { Pool } from "pg";
import { getCurrentUser } from "@/lib/auth";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// AUDITORÍA INTEGRAL (12/09): endpoint temporal, solo para admin, que corre
// en producción exactamente la misma lógica que scripts/run-migrations.mjs
// (que necesita DATABASE_URL en un .env.local que no existe en ningún
// entorno donde este agente tiene acceso — ni en este contenedor ni en la
// máquina del usuario). Reutiliza la tabla schema_migrations existente
// (transaccional, idempotente, no repite ni rompe nada si se corre de
// nuevo) para aplicar las migraciones pendientes: al momento de escribir
// esto, 0015 (notas_calendario — su ausencia rompía "Agregar nota al
// calendario" con un error genérico), 0017 (gastos_comision), 0018
// (proveedores_extendido) y 0020 (compras_comision_id).
//
// A propósito usa DATABASE_URL (no el pool de src/lib/db.ts, que puede
// apuntar a APP_DATABASE_URL/app_user si está configurada) porque aplicar
// una migración implica DDL (CREATE TABLE, ALTER TABLE, GRANT) — permisos
// que app_user no tiene ni debe tener (ver comentario en db.ts y
// migrations/README.md). Este archivo se borra del repo una vez usado: no
// es una funcionalidad del producto, es una herramienta de mantenimiento
// puntual.
export async function GET(req: NextRequest) {
  const user = await getCurrentUser().catch(() => null);
  if (!user || user.rol !== "admin") {
    return NextResponse.json({ ok: false, error: "No autorizado" }, { status: 401 });
  }

  const connectionString = (process.env.DATABASE_URL || process.env.POSTGRES_URL || "").split("?")[0];
  if (!connectionString) {
    return NextResponse.json({ ok: false, error: "Falta DATABASE_URL en este entorno." }, { status: 500 });
  }

  const dryRun = req.nextUrl.searchParams.get("dry_run") === "1";
  const pool = new Pool({ connectionString, ssl: { rejectUnauthorized: false } });
  const client = await pool.connect();
  const log: string[] = [];

  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        filename TEXT PRIMARY KEY,
        applied_en TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `);

    const { rows: aplicadas } = await client.query(`SELECT filename FROM schema_migrations`);
    const yaAplicadas = new Set(aplicadas.map((r: any) => r.filename));

    const MIGRATIONS_DIR = path.join(process.cwd(), "migrations");
    const archivos = readdirSync(MIGRATIONS_DIR)
      .filter((f) => f.endsWith(".sql"))
      .sort();

    const pendientes = archivos.filter((f) => !yaAplicadas.has(f));

    if (pendientes.length === 0) {
      return NextResponse.json({ ok: true, mensaje: "No hay migraciones pendientes. Base de datos al día.", aplicadas: [] });
    }

    log.push(`Migraciones pendientes: ${pendientes.join(", ")}`);
    if (dryRun) {
      return NextResponse.json({ ok: true, dryRun: true, pendientes, log });
    }

    const aplicadasAhora: string[] = [];
    for (const archivo of pendientes) {
      const sql = readFileSync(path.join(MIGRATIONS_DIR, archivo), "utf8");
      log.push(`Aplicando ${archivo}...`);
      await client.query("BEGIN");
      try {
        await client.query(sql);
        await client.query(`INSERT INTO schema_migrations (filename) VALUES ($1) ON CONFLICT (filename) DO NOTHING`, [archivo]);
        await client.query("COMMIT");
        log.push(`  OK — ${archivo}`);
        aplicadasAhora.push(archivo);
      } catch (err: any) {
        await client.query("ROLLBACK");
        log.push(`  FALLÓ ${archivo}: ${err?.message || err}`);
        return NextResponse.json({ ok: false, error: `Falló ${archivo}: ${err?.message || err}`, log, aplicadasAhora }, { status: 500 });
      }
    }

    return NextResponse.json({ ok: true, mensaje: "Listo.", aplicadasAhora, log });
  } finally {
    client.release();
    await pool.end();
  }
}
