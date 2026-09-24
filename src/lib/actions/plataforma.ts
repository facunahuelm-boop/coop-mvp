"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { Pool } from "pg";
import { rootAll, rootGet, update, audit, pool as appPool } from "@/lib/db";
import { requirePlatformAdmin } from "@/lib/auth";
import { parseForm, zId, zEnumSeguro } from "@/lib/validation";
import { conEstadoDeAccion, type ActionState } from "@/lib/actionState";

/**
 * Fase 5 (Multicooperativa/arquitectura SaaS(19) + Administrador de
 * plataforma(20) + Planes y módulos(21) + Soporte(22)) — Sub-fase 5.1:
 * Administrador de plataforma (sección 20).
 *
 * Reemplaza dos endpoints temporales que el propio código marcaba "se borra
 * del repo una vez usado": `/api/admin/migraciones` (corría DDL sobre TODA
 * la base) y `/api/admin/diagnostico-rls` (mismo alcance, solo lectura).
 * Ambos estaban gateados a `user.rol === "admin"` — el admin tenant-scoped
 * de CUALQUIER cooperativa, no un rol separado para quien opera la
 * plataforma entera. Acá viven como pantalla (`/plataforma`) gateada a
 * `requirePlatformAdmin()` (ver auth.ts, `es_platform_admin`), en vez de una
 * URL que se navegaba a mano sin ningún registro de quién la usó.
 *
 * Aplicar migraciones sigue usando una conexión NUEVA a `DATABASE_URL`
 * (nunca el `pool`/`rootAll` de db.ts, que en producción puede apuntar a
 * `APP_DATABASE_URL`/app_user) — aplicar una migración implica DDL (CREATE
 * TABLE, ALTER TABLE, GRANT), permisos que app_user no tiene ni debe tener
 * (mismo motivo que ya explicaba el endpoint retirado). El diagnóstico de
 * RLS, en cambio, sigue usando a propósito el `pool` normal de la app (ver
 * `appPool` más abajo): la pregunta que responde es "¿con qué rol está
 * corriendo la app en runtime?", así que tiene que ser la misma conexión que
 * usa el resto del sistema, no una nueva.
 */

function crearPoolMigraciones(): Pool {
  const connectionString = (process.env.DATABASE_URL || process.env.POSTGRES_URL || "").split("?")[0];
  if (!connectionString) throw new Error("Falta la variable de entorno DATABASE_URL en este entorno.");
  return new Pool({ connectionString, ssl: { rejectUnauthorized: false } });
}

const MIGRATIONS_DIR = path.join(process.cwd(), "migrations");

async function listarMigracionesPendientes(pool: Pool): Promise<string[]> {
  const client = await pool.connect();
  try {
    await client.query(
      `CREATE TABLE IF NOT EXISTS schema_migrations (filename TEXT PRIMARY KEY, applied_en TIMESTAMPTZ NOT NULL DEFAULT now())`
    );
    const { rows: aplicadas } = await client.query(`SELECT filename FROM schema_migrations`);
    const yaAplicadas = new Set(aplicadas.map((r: { filename: string }) => r.filename));
    const archivos = readdirSync(MIGRATIONS_DIR)
      .filter((f) => f.endsWith(".sql"))
      .sort();
    return archivos.filter((f) => !yaAplicadas.has(f));
  } finally {
    client.release();
  }
}

export type CooperativaResumen = {
  id: number;
  slug: string;
  nombre: string;
  etapa: string;
  plan: string;
  activo: boolean;
  creado_en: string;
  usuarios_activos: number;
};

export type EstadoPlataforma = {
  cooperativas: CooperativaResumen[];
  migracionesPendientes: string[];
  errorMigraciones: string | null;
  diagnosticoRls: { rol_conectado: string; es_superusuario: boolean; puede_saltar_rls: boolean } | null;
  errorDiagnostico: string | null;
};

/**
 * Lectura de la pantalla /plataforma — no es un form action (no muta nada),
 * pero vive en este mismo archivo "use server" para no duplicar el gate ni
 * la conexión de migraciones en un tercer módulo. Se llama directo desde el
 * Server Component de la página.
 */
export async function obtenerEstadoPlataforma(): Promise<EstadoPlataforma> {
  await requirePlatformAdmin();

  const filas = await rootAll<{
    id: number;
    slug: string;
    nombre: string;
    etapa: string;
    plan: string;
    activo: number;
    creado_en: string;
    usuarios_activos: string;
  }>(
    `SELECT o.id, o.slug, o.nombre, o.etapa, o.plan, o.activo, o.creado_en,
            (SELECT count(*)::text FROM users u WHERE u.organization_id = o.id AND u.activo = 1) AS usuarios_activos
     FROM organizations o
     ORDER BY o.id ASC`
  );
  const cooperativas: CooperativaResumen[] = filas.map((f) => ({
    id: f.id,
    slug: f.slug,
    nombre: f.nombre,
    etapa: f.etapa,
    plan: f.plan,
    activo: f.activo === 1,
    creado_en: f.creado_en,
    usuarios_activos: Number(f.usuarios_activos || 0),
  }));

  let migracionesPendientes: string[] = [];
  let errorMigraciones: string | null = null;
  try {
    const pool = crearPoolMigraciones();
    try {
      migracionesPendientes = await listarMigracionesPendientes(pool);
    } finally {
      await pool.end();
    }
  } catch (err) {
    errorMigraciones = err instanceof Error ? err.message : String(err);
  }

  let diagnosticoRls: EstadoPlataforma["diagnosticoRls"] = null;
  let errorDiagnostico: string | null = null;
  try {
    const client = await appPool.connect();
    try {
      const { rows } = await client.query(
        `SELECT current_user AS rol_conectado,
                (SELECT rolsuper FROM pg_roles WHERE rolname = current_user) AS es_superusuario,
                (SELECT rolbypassrls FROM pg_roles WHERE rolname = current_user) AS puede_saltar_rls`
      );
      diagnosticoRls = rows[0] ?? null;
    } finally {
      client.release();
    }
  } catch (err) {
    errorDiagnostico = err instanceof Error ? err.message : String(err);
  }

  return { cooperativas, migracionesPendientes, errorMigraciones, diagnosticoRls, errorDiagnostico };
}

const alternarActivoCoopSchema = z.object({ id: zId, activo: zEnumSeguro(["true", "false"] as const) });

export async function alternarActivoCooperativaAction(formData: FormData) {
  const admin = await requirePlatformAdmin();
  const { id, activo } = parseForm(alternarActivoCoopSchema, formData);
  const nuevoActivo = activo === "true";

  // Mismo criterio que ya usa alternarActivoUsuarioAction
  // (usuariosAdmin.ts, Sub-fase 4.1): no te podés cortar el propio acceso.
  // Acá el riesgo es peor — desactivar la cooperativa a la que pertenece
  // este mismo admin de plataforma le bloquearía el login por completo
  // (loginAction ya chequea organizations.activo), sin ninguna otra cuenta
  // de plataforma que pueda revertirlo.
  if (id === admin.organization_id && !nuevoActivo) {
    throw new Error("No podés desactivar tu propia cooperativa desde acá — te dejaría sin poder entrar.");
  }

  const coop = await rootGet<{ nombre: string; slug: string }>(`SELECT nombre, slug FROM organizations WHERE id = ?`, [id]);
  if (!coop) throw new Error("Esa cooperativa ya no existe.");

  await update("organizations", id, { activo: nuevoActivo ? 1 : 0 });
  await audit({
    usuario_id: admin.id,
    accion: nuevoActivo ? "activar_cooperativa" : "desactivar_cooperativa",
    entidad: "organizations",
    entidad_id: id,
    valor_nuevo: { slug: coop.slug },
  });
  revalidatePath("/plataforma");
}

export async function alternarActivoCooperativaFormAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  return conEstadoDeAccion(() => alternarActivoCooperativaAction(formData));
}

const aplicarMigracionesSchema = z.object({ confirmar: zEnumSeguro(["si"] as const) });

/**
 * Corre en producción, contra `DATABASE_URL` directo, exactamente la misma
 * lógica que tenía `/api/admin/migraciones` (transaccional por archivo,
 * `schema_migrations` como registro — no repite ni rompe nada si se corre
 * de nuevo). La auditoría queda en la cooperativa del propio admin de
 * plataforma que ejecuta la acción (no existe todavía ninguna tabla de
 * auditoría "de plataforma", y esto no ameritaba crear una solo para este
 * caso) — se distingue igual por la acción ("aplicar_migraciones") y el
 * detalle de qué archivos se aplicaron.
 */
export async function aplicarMigracionesPendientesAction(formData: FormData) {
  const admin = await requirePlatformAdmin();
  parseForm(aplicarMigracionesSchema, formData);

  const pool = crearPoolMigraciones();
  const aplicadasAhora: string[] = [];
  try {
    const client = await pool.connect();
    try {
      const pendientes = await listarMigracionesPendientes(pool);
      for (const archivo of pendientes) {
        const sql = readFileSync(path.join(MIGRATIONS_DIR, archivo), "utf8");
        await client.query("BEGIN");
        try {
          await client.query(sql);
          await client.query(`INSERT INTO schema_migrations (filename) VALUES ($1) ON CONFLICT (filename) DO NOTHING`, [archivo]);
          await client.query("COMMIT");
          aplicadasAhora.push(archivo);
        } catch (err: unknown) {
          await client.query("ROLLBACK");
          const mensaje = err instanceof Error ? err.message : String(err);
          throw new Error(`Falló ${archivo}: ${mensaje}`);
        }
      }
    } finally {
      client.release();
    }
  } finally {
    await pool.end();
  }

  await audit({
    usuario_id: admin.id,
    accion: "aplicar_migraciones",
    entidad: "schema_migrations",
    entidad_id: null,
    valor_nuevo: { aplicadas: aplicadasAhora },
  });
  revalidatePath("/plataforma");
}

export async function aplicarMigracionesPendientesFormAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  return conEstadoDeAccion(() => aplicarMigracionesPendientesAction(formData));
}
