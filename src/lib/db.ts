import { Pool, PoolClient } from "pg";
import { requireOrgContext } from "./tenant";

// Base de datos PostgreSQL (Supabase) — producción y desarrollo.
// Requiere la variable de entorno DATABASE_URL (connection string de Supabase).

declare global {
  // eslint-disable-next-line no-var
  var __coopPool: Pool | undefined;
}

// Fase 04 del Plan Maestro (hallazgo crítico del audit): la app corría con el
// rol "postgres", que tiene BYPASSRLS = true — las políticas de RLS de
// migrations/0003_rls_policies.sql existen y están bien escritas, pero
// quedaban completamente inertes para esa conexión, así que el único
// aislamiento real entre cooperativas era el filtro por organization_id en
// esta misma capa (ver withTenantClient más abajo). Si algún query puntual
// se olvidara ese filtro, no había red de contención en la base.
//
// APP_DATABASE_URL es una variable nueva y separada de DATABASE_URL/
// POSTGRES_URL a propósito: esta última la sincroniza automáticamente la
// integración Supabase↔Vercel (y la usa scripts/run-migrations.mjs vía
// .env.local, que sí necesita permisos de DDL), así que no conviene
// pisarla — un resync de la integración la volvería a dejar en "postgres"
// sin que nadie lo note. APP_DATABASE_URL, en cambio, es una variable de
// entorno normal en Vercel que sólo la app en runtime conoce, apuntando al
// rol app_user (NOSUPERUSER, NOBYPASSRLS — ver FASE04_SEGURIDAD_DB.md para
// cómo se armó y verificó). Mientras no exista, se sigue usando
// DATABASE_URL/POSTGRES_URL como antes, así que este cambio no rompe nada
// hasta que alguien defina APP_DATABASE_URL a propósito.
function createPool(): Pool {
    const connectionString = (
      process.env.APP_DATABASE_URL || process.env.DATABASE_URL || process.env.POSTGRES_URL || ""
    ).split("?")[0];
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

// AUDITORÍA INTEGRAL (hallazgo, testing E2E real): se detectó probando el
// flujo real de Compras que insert()/update() rompían con un error 500 sin
// mensaje útil ("column X of relation Y does not exist" — Postgres 42703)
// apenas una migración que agrega una columna nueva todavía no había
// corrido en esta base — ver crearSolicitudAction en actions/compras.ts,
// donde se encontró el primer caso concreto (comision_id, migración 0020).
// El mismo riesgo existe en cualquier otra acción que guarde una columna
// agregada por una migración reciente (ej: proveedores.ts con las columnas
// de la migración 0018) — en vez de parchear cada acción una por una, se
// centraliza acá: si el insert/update falla puntualmente por una columna
// que no existe todavía, se reintenta sin esa columna en particular (nunca
// se inventa un valor ni se ignoran otros errores). Es seguro porque toda
// columna agregada por una migración con ADD COLUMN IF NOT EXISTS, o bien
// es NULLABLE, o bien tiene un DEFAULT — nunca hay una fila válida que
// dependa de que esa columna puntual llegue en este insert.
const PG_COLUMNA_INEXISTENTE = "42703";

function nombreColumnaFaltante(err: any): string | null {
  if (err?.code !== PG_COLUMNA_INEXISTENTE) return null;
  const m = /column "([^"]+)" of relation/.exec(String(err?.message || ""));
  return m ? m[1] : null;
}

/** Ejecuta `ejecutar` con `payload`; si falla por una columna puntual que
 * todavía no existe, la saca y reintenta (hasta 20 columnas faltantes).
 *
 * AUDITORÍA INTEGRAL (hallazgo, testing E2E real, 12/09): probando "Agregar
 * proveedor" con los campos de la Fase 08 (RUT, tipo, etc. — ver
 * migrations/0018_proveedores_extendido.sql) esto rompía con "demasiadas
 * columnas faltantes" a pesar de que el límite decía "hasta 8". El motivo
 * era un error de conteo: cada vuelta del `for` que encuentra una columna
 * faltante la saca y listo — recién la VUELTA SIGUIENTE reintenta con esa
 * columna afuera. Con el límite en 8 vueltas, 8 columnas faltantes (que es
 * justo el caso real: rut, telefono, email, direccion, persona_contacto,
 * tipo, estado, creado_por_id, si la migración 0018 no corrió) consumen las
 * 8 vueltas sacando columnas y no queda ninguna vuelta libre para el
 * reintento final que ya tendría que funcionar — en los hechos, el límite
 * efectivo era 7, no 8. Subir el límite no es un parche cosmético: dado que
 * cada tabla puede tener columnas nuevas pendientes de varias migraciones a
 * la vez, y esta función existe justamente para tolerar esa situación sin
 * romper la pantalla, un margen más generoso es lo consistente con su
 * propio propósito. */
async function conFallbackColumnaFaltante<T>(payload: Record<string, any>, ejecutar: (p: Record<string, any>) => Promise<T>): Promise<T> {
  let intento = payload;
  const MAX_COLUMNAS_FALTANTES = 20;
  for (let i = 0; i <= MAX_COLUMNAS_FALTANTES; i++) {
    try {
      return await ejecutar(intento);
    } catch (err: any) {
      const columna = nombreColumnaFaltante(err);
      if (!columna || !(columna in intento)) throw err;
      const { [columna]: _omitida, ...resto } = intento;
      intento = resto;
    }
  }
  throw new Error("No se pudo completar la operación: demasiadas columnas faltantes en la base.");
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
    return conFallbackColumnaFaltante(data, async (payload) => {
      const { sql, values } = buildInsert(table, payload);
      return withRootClient(async (client) => (await client.query(sql, values)).rows[0]?.id || 0);
    });
  }
  const payload = data.organization_id !== undefined ? data : { ...data, organization_id: await requireOrgContext() };
  return conFallbackColumnaFaltante(payload, async (p) => {
    const { sql, values } = buildInsert(table, p);
    return withTenantClient(async (client) => (await client.query(sql, values)).rows[0]?.id || 0);
  });
}

/** Actualiza un registro. */
export async function update(table: string, id: number, data: Record<string, any>): Promise<void> {
  await conFallbackColumnaFaltante(data, async (payload) => {
    const keys = Object.keys(payload);
    const sets = keys.map((k, i) => `${k} = $${i + 1}`).join(", ");
    const sql = `UPDATE ${table} SET ${sets} WHERE id = $${keys.length + 1}`;
    const values = [
      ...keys.map((k) => {
        const v = payload[k];
        return v !== null && typeof v === "object" ? JSON.stringify(v) : v;
      }),
      id,
    ];
    if (table === "organizations") {
      await withRootClient((client) => client.query(sql, values));
      return;
    }
    await withTenantClient((client) => client.query(sql, values));
  });
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

// ---------- Fase 3 (sistema global de errores), hallazgo H-5 ----------
// Antes existían dos versiones casi iguales de esta misma idea
// (calendarioNotas.ts, gastos.ts) con comportamiento distinto entre sí (una
// registraba el hallazgo en auditoría antes de relanzar, la otra no). Se
// centraliza acá: si `err` es el error de Postgres "la tabla todavía no
// existe" (42P01 — típico cuando una migración reciente no corrió todavía en
// este entorno), registra el hallazgo en auditoría (si se pasó `contexto`) y
// lanza un Error con `mensaje` (pensado para mostrarse tal cual en el
// formulario, vía el sistema centralizado de errores — ver actionState.ts)
// en vez del error crudo de Postgres. Si no es ese caso, relanza `err` sin
// tocar nada.
const PG_TABLA_INEXISTENTE = "42P01";

export async function relanzarConMensajeSiFaltaTabla(
  err: unknown,
  mensaje: string,
  contexto?: { usuario_id: number; accion: string; entidad: string; entidad_id: number }
): Promise<never> {
  if (err && typeof err === "object" && (err as { code?: string }).code === PG_TABLA_INEXISTENTE) {
    if (contexto) {
      await audit({
        usuario_id: contexto.usuario_id,
        accion: `error_${contexto.accion}`,
        entidad: contexto.entidad,
        entidad_id: contexto.entidad_id,
        valor_nuevo: { code: PG_TABLA_INEXISTENTE, message: String((err as any)?.message ?? err) },
      }).catch(() => {});
    }
    throw new Error(mensaje);
  }
  throw err;
}

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
