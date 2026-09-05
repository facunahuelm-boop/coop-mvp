// Corre las migraciones SQL de multi-tenant (carpeta /migrations) contra la
// base de datos de DATABASE_URL, en orden, una sola vez cada una.
//
// Reemplaza al viejo enfoque de /api/setup: en vez de un solo endpoint que
// recrea y BORRA todas las tablas, cada cambio de esquema queda en un
// archivo .sql versionado, y este script lleva registro (en la tabla
// schema_migrations) de cuáles ya se aplicaron — correrlo de nuevo no repite
// ni rompe nada.
//
// Uso:
//   node --env-file=.env.local scripts/run-migrations.mjs
//   node --env-file=.env.local scripts/run-migrations.mjs --dry-run

import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import pg from "pg";

const { Pool } = pg;
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = path.join(__dirname, "..", "migrations");
const dryRun = process.argv.includes("--dry-run");

async function main() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    console.error("Falta DATABASE_URL. Corré este script con --env-file=.env.local (o la env que corresponda).");
    process.exit(1);
  }

  const pool = new Pool({ connectionString, ssl: { rejectUnauthorized: false } });
  const client = await pool.connect();

  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        filename TEXT PRIMARY KEY,
        applied_en TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `);

    const { rows: aplicadas } = await client.query(`SELECT filename FROM schema_migrations`);
    const yaAplicadas = new Set(aplicadas.map((r) => r.filename));

    const archivos = readdirSync(MIGRATIONS_DIR)
      .filter((f) => f.endsWith(".sql"))
      .sort();

    const pendientes = archivos.filter((f) => !yaAplicadas.has(f));

    if (pendientes.length === 0) {
      console.log("No hay migraciones pendientes. Base de datos al día.");
      return;
    }

    console.log(`Migraciones pendientes: ${pendientes.join(", ")}`);
    if (dryRun) {
      console.log("(--dry-run: no se ejecuta nada)");
      return;
    }

    for (const archivo of pendientes) {
      const sql = readFileSync(path.join(MIGRATIONS_DIR, archivo), "utf8");
      console.log(`Aplicando ${archivo}...`);
      await client.query("BEGIN");
      try {
        await client.query(sql);
        await client.query(`INSERT INTO schema_migrations (filename) VALUES ($1)`, [archivo]);
        await client.query("COMMIT");
        console.log(`  OK — ${archivo}`);
      } catch (err) {
        await client.query("ROLLBACK");
        console.error(`  FALLÓ ${archivo}:`, err.message);
        throw err;
      }
    }

    console.log("Listo.");
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
