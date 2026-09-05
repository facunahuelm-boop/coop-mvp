import { Pool, PoolClient } from "pg";
import { requireOrgContext } from "./tenant";

// Base de datos PostgreSQL (Supabase) — producción y desarrollo.
// Requiere la variable de entorno DATABASE_URL (connection string de Supabase).

declare global {
  // eslint-disable-next-line no-var
  var __coopPool: Pool | undefined;
}

function createPool(): Pool {
  const connectionString = process.env.DATABASE_URL || process.env.POSTGRES_URL;
  if (!connectionString) {
    throw new Error(
      "Falta la variable de entorno DATABASE_URL. Configurala en .env.local con el connection string de Supabase."
    );
  }
  return new Pool({
    connectionString,
    ssl: { rejectUnauthorized: false },
    max: 10, // máximo de conexiones simultáneas (pooler de Supabase soporta esto bien)
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 10000,
  });
}

// Reutilizar el pool entre recargas en desarrollo (hot reload de Next.js)
export const pool: Pool = global.__coopPool ?? createPool();
if (process.env.NODE_ENV !== "production") global.__coopPool = pool;

// ---------- helpers genéricos ----------
// Nota: el resto del código fue escrito originalmente para SQLite y usa "?"
// como placeholder posicional. Esta capa convierte automáticamente "?" -> $1, $2, ...
// para que no haya que reescribir cada consulta SQL a mano.

function toPgSql(sql: string): string {
  let i = 0;
  return sql.replace(/\?/g, () => `$${++i}`);
}

// ---------- aislamiento por cooperativa (multi-tenant) ----------
// Toda consulta de datos de una cooperativa pasa por acá. Antes de correr la
// consulta del que llama, se fija la cooperativa activa (ver src/lib/tenant.ts)
// como variable de sesión de Postgres. Esa variable es la que leen las
// políticas de Row-Level Security de cada tabla (ver migrations/0003_rls_policies.sql):
// aunque una consulta puntual tuviera un error y no filtrara por cooperativa,
// la base de datos igual va a impedir ver o modificar filas de otra cooperativa.
//
// Cada llamada toma una conexión nueva del pool (nunca se reutiliza entre
// llamadas) para que esta variable de sesión nunca "quede pegada" de un
// pedido a otro.
async function withTenantClient<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
  const orgId = await requireOrgContext();
  const client = await pool.connect();
  try {
    await client.query("SELECT set_config('app.current_org_id', $1, false)", [String(orgId)]);
    return await fn(client);
  } finally {
    client.release();
  }
}

// Para operaciones de plataforma que NO pertenecen a ninguna cooperativa
// (alta de una cooperativa nueva, scripts de migración). No usar para datos
// de una cooperativa — no tiene el filtro de Row-Level Security activado.
async function withRootClient<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    return await fn(client);
  } finally {
    client.release();
  }
}

export async function all<T = any>(sql: string, params: any[] = []): Promise<T[]> {
  return withTenantClient(async (client) => {
    const result = await client.query(toPgSql(sql), params);
    return result.rows as T[];
  });
}

export async function get<T = any>(sql: string, params: any[] = []): Promise<T | undefined> {
  return withTenantClient(async (client) => {
    const result = await client.query(toPgSql(sql), params);
    return (result.rows[0] as T) || undefined;
  });
}

export async function run(sql: string, params: any[] = []) {
  return withTenantClient((client) => client.query(toPgSql(sql), params));
}

/**
 * Consultas de plataforma, sin cooperativa activa (ej: buscar una cooperativa
 * por su slug antes de iniciar sesión, o el alta de una cooperativa nueva).
 * Usar solo en flujos explícitamente a nivel de plataforma — nunca para leer
 * datos que pertenecen a una cooperativa.
 */
export async function rootAll<T = any>(sql: string, params: any[] = []): Promise<T[]> {
  return withRootClient(async (client) => (await client.query(toPgSql(sql), params)).rows as T[]);
}
export async function rootGet<T = any>(sql: string, params: any[] = []): Promise<T | undefined> {
  return withRootClient(async (client) => (await client.query(toPgSql(sql), params)).rows[0] as T | undefined);
}

function buildInsert(table: string, data: Record<string, any>) {
  const keys = Object.keys(data);
  const placeholders = keys.map((_, i) => `$${i + 1}`).join(", ");
  const sql = `INSERT INTO ${table} (${keys.join(", ")}) VALUES (${placeholders}) RETURNING id`;
  const values = keys.map((k) => {
    const v = data[k];
    return v !== null && typeof v === "object" ? JSON.stringify(v) : v;
  });
  return { sql, values };
}

/**
 * Inserta y devuelve el id autogenerado.
 *
 * Salvo para la tabla `organizations` (que es la raíz y no pertenece a
 * ninguna cooperativa), todo insert queda automáticamente marcado con la
 * cooperativa activa — el resto del código (Server Actions, etc.) no cambia:
 * sigue llamando insert("tabla", {...}) exactamente igual que antes.
 */
export async function insert(table: string, data: Record<string, any>): Promise<number> {
  if (table === "organizations") {
    const { sql, values } = buildInsert(table, data);
    return withRootClient(async (client) => (await client.query(sql, values)).rows[0]?.id || 0);
  }
  const payload = data.organization_id !== undefined ? data : { ...data, organization_id: await requireOrgContext() };
  const { sql, values } = buildInsert(table, payload);
  return withTenantClient(async (client) => (await client.query(sql, values)).rows[0]?.id || 0);
}

/** Actualiza un registro. */
export async function update(table: string, id: number, data: Record<string, any>): Promise<void> {
  const keys = Object.keys(data);
  const sets = keys.map((k, i) => `${k} = $${i + 1}`).join(", ");
  const sql = `UPDATE ${table} SET ${sets} WHERE id = $${keys.length + 1}`;
  const values = [
    ...keys.map((k) => {
      const v = data[k];
      return v !== null && typeof v === "object" ? JSON.stringify(v) : v;
    }),
    id,
  ];
  if (table === "organizations") {
    await withRootClient((client) => client.query(sql, values));
    return;
  }
  await withTenantClient((client) => client.query(sql, values));
}

// Auditoría (append-only): registra quién hizo qué y cuándo
type AuditParams = {
  usuario_id: number;
  accion: string;
  entidad: string;
  entidad_id: number;
  valor_anterior?: any;
  valor_nuevo?: any;
};

export async function audit(params: AuditParams) {
  await insert("auditoria", {
    usuario_id: params.usuario_id,
    accion: params.accion,
    entidad: params.entidad,
    entidad_id: params.entidad_id,
    valor_anterior:
      params.valor_anterior !== undefined && params.valor_anterior !== null
        ? typeof params.valor_anterior === "object"
          ? JSON.stringify(params.valor_anterior)
          : String(params.valor_anterior)
        : null,
    valor_nuevo:
      params.valor_nuevo !== undefined && params.valor_nuevo !== null
        ? typeof params.valor_nuevo === "object"
          ? JSON.stringify(params.valor_nuevo)
          : String(params.valor_nuevo)
        : null,
  });
}

// Alias retrocompatible
export const registrarAuditoria = audit;

// ---------- alertas ----------
// Inserta una alerta nueva si no existe ya una abierta equivalente (mismo tipo +
// referencia), o actualiza sus datos si ya existe. Evita duplicar alertas cada
// vez que se recalculan (ver logic.ts::recalcularAlertas).
// NOTA: esta función no existía en db.ts (ni siquiera en la versión SQLite
// original) pese a ser importada desde logic.ts — se agrega acá como fix
// mínimo para que el módulo compile; ver aviso en el reporte final.
type UpsertAlertaParams = {
  tipo: string;
  severidad: string;
  origen_modulo: string;
  titulo: string;
  descripcion?: string | null;
  asignado_a_rol?: string | null;
  ref_tabla?: string | null;
  ref_id?: number | null;
};

export async function upsertAlerta(params: UpsertAlertaParams): Promise<{ id: number; esNueva: boolean }> {
  const refTabla = params.ref_tabla ?? null;
  const refId = params.ref_id ?? null;
  const existente = await get<{ id: number }>(
    `SELECT id FROM alertas
     WHERE tipo = ? AND estado = 'abierta'
       AND COALESCE(ref_tabla, '') = COALESCE(?, '')
       AND COALESCE(ref_id, -1) = COALESCE(?, -1)`,
    [params.tipo, refTabla, refId]
  );
  if (existente) {
    await update("alertas", existente.id, {
      severidad: params.severidad,
      titulo: params.titulo,
      descripcion: params.descripcion ?? null,
      asignado_a_rol: params.asignado_a_rol ?? null,
    });
    return { id: existente.id, esNueva: false };
  } else {
    const id = await insert("alertas", {
      tipo: params.tipo,
      severidad: params.severidad,
      origen_modulo: params.origen_modulo,
      titulo: params.titulo,
      descripcion: params.descripcion ?? null,
      asignado_a_rol: params.asignado_a_rol ?? null,
      estado: "abierta",
      ref_tabla: refTabla,
      ref_id: refId,
    });
    return { id, esNueva: true };
  }
}
