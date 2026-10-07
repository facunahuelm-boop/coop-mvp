import { Pool, PoolClient, types } from "pg";

// Fase 2 (corrección en producción): algunas columnas de fecha de la base
// real son TIMESTAMP o DATE (en la base de pruebas son TEXT). Para que el
// código trate igual a las dos, esos tipos llegan como texto
// ("2026-10-07 00:00:00" / "2026-10-07") en vez de objetos Date.
types.setTypeParser(1114, (v: string) => v); // timestamp without time zone
types.setTypeParser(1082, (v: string) => v); // date
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
 * H-4 (auditoría integral, 27/09): helper de transacción multi-sentencia
 * para una misma cooperativa, generalizando el patrón que ya existía —
 * probado en producción — en plataforma.ts::responderTicketPlataformaAction
 * (client tomado directo del pool, BEGIN/COMMIT/ROLLBACK manual,
 * `set_config('app.current_org_id', ...)` explícito). Hasta ahora, `run()` de
 * arriba toma una conexión NUEVA (y hace commit implícito) en cada llamada —
 * a propósito, para que la variable de sesión de RLS nunca "quede pegada" de
 * un pedido a otro — pero eso también significa que una acción que encadena
 * varios DELETE/UPDATE relacionados (ej: `eliminarSolicitudAction` en
 * actions/compras.ts) no tiene ninguna garantía de "todo o nada": si el
 * proceso se cae a mitad de camino, algunas filas quedan borradas y otras no
 * — confirmado en vivo durante esta auditoría con un trigger de prueba.
 *
 * `fn` recibe `run`/`get`/`all` con la misma firma y el mismo `?` -> $1,$2,…
 * que las funciones sueltas de arriba, para que migrar una acción existente
 * sea un cambio mínimo. Si `fn` tira cualquier error, se hace ROLLBACK y se
 * relanza tal cual — nada se traga en silencio. Ojo con un detalle propio de
 * Postgres: si dentro de `fn` hace falta tolerar que una sentencia puntual
 * falle (ej: una tabla que una migración todavía no creó) sin abortar el
 * resto, hay que envolver esa sentencia en su propio SAVEPOINT y hacer
 * `ROLLBACK TO SAVEPOINT` si falla — un `catch` de JavaScript solo, sin eso,
 * no alcanza: Postgres deja la transacción entera en estado "aborted" apenas
 * una sentencia falla, y todo lo que se ejecute después (aunque el error se
 * haya atrapado en JS) sale rechazado con 25P02 ("current transaction is
 * aborted"). Usa la cooperativa activa (`requireOrgContext()`) — no
 * reemplaza a `withRootClient` para operaciones de plataforma sin
 * cooperativa.
 */
export type TenantTx = {
  run: (sql: string, params?: any[]) => Promise<void>;
  get: <T = any>(sql: string, params?: any[]) => Promise<T | undefined>;
  all: <T = any>(sql: string, params?: any[]) => Promise<T[]>;
};

export async function withTenantTransaction<T>(fn: (tx: TenantTx) => Promise<T>): Promise<T> {
  const orgId = await requireOrgContext();
  const client = await pool.connect();
  const tx: TenantTx = {
    run: async (sql, params = []) => {
      await client.query(toPgSql(sql), params);
    },
    get: async (sql, params = []) => (await client.query(toPgSql(sql), params)).rows[0],
    all: async (sql, params = []) => (await client.query(toPgSql(sql), params)).rows,
  };
  try {
    await client.query("BEGIN");
    await client.query("SELECT set_config('app.current_org_id', $1, false)", [String(orgId)]);
    const resultado = await fn(tx);
    await client.query("COMMIT");
    return resultado;
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Fase 1A "nada se borra" (migración 0051): eliminación lógica (papelera).
 * La fila queda en la base con eliminado_en / eliminado_por_id /
 * motivo_eliminacion y la política de aislamiento la oculta de todas las
 * consultas normales. Postgres exige que la fila siga siendo visible para el
 * UPDATE que la marca, por eso se activa `app.incluir_eliminados` solo dentro
 * de esta transacción (set_config(..., true) = local: se apaga al terminar).
 * Devuelve false si la fila no existía o ya estaba eliminada.
 */
const TABLAS_CON_PAPELERA = new Set(["solicitudes_compra", "proveedores", "documentos"]);
export async function eliminarLogico(tabla: string, id: number, usuarioId: number, motivo: string): Promise<boolean> {
  if (!TABLAS_CON_PAPELERA.has(tabla)) throw new Error(`La tabla ${tabla} no tiene papelera.`);
  return withTenantTransaction(async (tx) => {
    await tx.run(`SELECT set_config('app.incluir_eliminados', '1', true)`);
    const fila = await tx.get<{ id: number }>(
      `UPDATE ${tabla} SET eliminado_en = now()::text, eliminado_por_id = ?, motivo_eliminacion = ?
        WHERE id = ? AND eliminado_en IS NULL RETURNING id`,
      [usuarioId, motivo, id]
    );
    return !!fila;
  });
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

/**
 * Sub-fase 4.4 (Eliminación segura de movimientos financieros): mismo
 * chequeo puntual que ya tenía su propia copia local en actions/
 * recuperarPassword.ts (Sub-fase 4.3, `esColumnaInexistente`) — se centraliza
 * acá para no sumar una tercera copia idéntica al agregarlo también en
 * actions/finanzas.ts y actions/cuentaSocios.ts. Uso: un `SELECT` que
 * menciona una columna nueva en su texto (a diferencia de insert/update de
 * arriba, que ya tienen su propio reintento automático) necesita distinguir
 * "todavía no corrió la migración" de cualquier otro error real, sin usar
 * `any` para el catch.
 */
export function esColumnaInexistente(err: unknown): boolean {
  return !!err && typeof err === "object" && (err as { code?: unknown }).code === PG_COLUMNA_INEXISTENTE;
}

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

/**
 * Actualiza un registro.
 *
 * Fase 12 (Prompt Maestro), hallazgo H-SEC-3 de REQUIREMENTS.md: hasta acá,
 * el UPDATE de esta función solo filtraba por `id` — el aislamiento entre
 * cooperativas dependía 100% de que la política de Row-Level Security de la
 * tabla estuviera bien escrita y activa (confirmado real en producción por
 * H-SEC-1, ver diagnóstico-rls). Sigue siendo así: RLS es y sigue siendo la
 * defensa real. Lo que se agrega acá es una segunda barrera, a nivel de
 * aplicación, además de esa — "defensa en profundidad": el propio UPDATE
 * ahora nunca toca una fila que no sea de la cooperativa activa, aunque el
 * día de mañana una política de RLS tuviera un error o quedara mal
 * configurada. No cambia ningún comportamiento hoy: `organization_id` es
 * NOT NULL con clave foránea en las 28 tablas originales (migración 0002) y
 * en cada tabla agregada después (convención de la sección 7 de este
 * documento), así que un `id` real de la cooperativa activa siempre matchea
 * igual que antes — la única fila que este chequeo extra puede llegar a
 * frenar es una que ya no debería haberse podido tocar. `organizations` es
 * la única tabla que queda afuera (es la raíz, no pertenece a ninguna
 * cooperativa — ver el resto de este archivo).
 */
export async function update(table: string, id: number, data: Record<string, any>): Promise<void> {
  await conFallbackColumnaFaltante(data, async (payload) => {
    const keys = Object.keys(payload);
    const sets = keys.map((k, i) => `${k} = $${i + 1}`).join(", ");
    if (table === "organizations") {
      const sql = `UPDATE ${table} SET ${sets} WHERE id = $${keys.length + 1}`;
      const values = [
        ...keys.map((k) => {
          const v = payload[k];
          return v !== null && typeof v === "object" ? JSON.stringify(v) : v;
        }),
        id,
      ];
      await withRootClient((client) => client.query(sql, values));
      return;
    }
    const orgId = await requireOrgContext();
    const sql = `UPDATE ${table} SET ${sets} WHERE id = $${keys.length + 1} AND organization_id = $${keys.length + 2}`;
    const values = [
      ...keys.map((k) => {
        const v = payload[k];
        return v !== null && typeof v === "object" ? JSON.stringify(v) : v;
      }),
      id,
      orgId,
    ];
    await withTenantClient((client) => client.query(sql, values));
  });
}

/**
 * H-3 (auditoría integral, 27/09): edición concurrente del mismo registro por
 * dos usuarios resultaba en "last write wins" en silencio — ninguno de los
 * dos se enteraba de que su cambio (o el del otro) se había perdido, y ambos
 * veían el mismo toast de éxito. Confirmado en vivo en Comisiones, Finanzas
 * y Compras (ver migrations/0047_bloqueo_optimista_h3.sql, que agrega la
 * columna `actualizado_en` sólo a esas 3 tablas).
 *
 * A propósito NO se cambia `update()` de arriba (usada por ~30 tablas sin
 * ningún control de versión) — este es un helper aparte, de uso explícito,
 * sólo para las acciones donde ya se confirmó el problema.
 *
 * Cómo funciona: el formulario de edición carga `actualizado_en` como campo
 * oculto cuando se abre. Acá, el UPDATE filtra también por ese valor exacto
 * (`AND actualizado_en = versionEsperada`) — todo en una sola sentencia, para
 * que no quede una ventana entre "leer para comparar" y "escribir" donde
 * alguien más pueda meterse en el medio. Si el UPDATE afecta 0 filas:
 * - Si la fila SIGUE existiendo (para esta cooperativa), es porque alguien
 *   más la modificó mientras el formulario estaba abierto (el `actualizado_en`
 *   ya cambió) → se tira ConflictoConcurrenciaError, con un mensaje claro
 *   para que la persona recargue y vea el cambio ajeno antes de reintentar.
 * - Si la fila ya no existe (o no es de esta cooperativa), es el mismo caso
 *   que ya manejaba `update()` — se avisa que el registro ya no existe.
 */
export class ConflictoConcurrenciaError extends Error {
  constructor(mensaje = "Alguien más modificó este registro mientras lo tenías abierto. Recargá la página para ver los cambios más recientes antes de volver a guardar.") {
    super(mensaje);
    this.name = "ConflictoConcurrenciaError";
  }
}

export async function updateConBloqueoOptimista(
  table: string,
  id: number,
  data: Record<string, any>,
  versionEsperada: string
): Promise<void> {
  await conFallbackColumnaFaltante(data, async (payload) => {
    const keys = Object.keys(payload);
    const sets = keys.map((k, i) => `${k} = $${i + 1}`).join(", ");
    const orgId = await requireOrgContext();
    const idxId = keys.length + 1;
    const idxOrg = keys.length + 2;
    const idxVersion = keys.length + 3;
    const sql = `UPDATE ${table} SET ${sets}, actualizado_en = now()::text WHERE id = $${idxId} AND organization_id = $${idxOrg} AND actualizado_en = $${idxVersion}`;
    const values = [
      ...keys.map((k) => {
        const v = payload[k];
        return v !== null && typeof v === "object" ? JSON.stringify(v) : v;
      }),
      id,
      orgId,
      versionEsperada,
    ];
    const resultado = await withTenantClient((client) => client.query(sql, values));
    if (resultado.rowCount === 0) {
      const existente = await withTenantClient((client) =>
        client.query(`SELECT 1 FROM ${table} WHERE id = $1 AND organization_id = $2`, [id, orgId])
      );
      if ((existente.rowCount ?? 0) > 0) throw new ConflictoConcurrenciaError();
      throw new Error("Ese registro ya no existe.");
    }
  });
}

// Auditoría (append-only): registra quién hizo qué y cuándo
//
// Sub-fase 4.2 (sesiones y auditoría de accesos): usuario_id ahora acepta
// null — un login fallido contra un email que no existe en esta cooperativa
// no tiene ningún usuario a quien atribuirle el intento (a diferencia de un
// login fallido por contraseña incorrecta, que sí conoce el id). auditoria.
// usuario_id ya era nullable en el schema (migrations iniciales) — esto solo
// abre el tipo de TypeScript para que ese caso se pueda registrar.
type AuditParams = {
  usuario_id: number | null;
  accion: string;
  entidad: string;
  entidad_id: number | null;
  valor_anterior?: any;
  valor_nuevo?: any;
};

// Auditoría (04/10): nunca se guardan contraseñas, hashes, tokens ni
// secretos en el historial, aunque una acción pase el registro completo
// (ej. un `SELECT *` de users como valor_anterior). Se reemplazan por
// "[oculto]" a cualquier profundidad, antes de escribir.
const CLAVE_SENSIBLE = /pass(word)?|contrase|hash|token|secret|api_?key|clave|credencial|session|cookie/i;
export function sinDatosSensibles(valor: unknown, profundidad = 0): unknown {
  if (profundidad > 6 || valor === null || typeof valor !== "object") return valor;
  if (Array.isArray(valor)) return valor.map((v) => sinDatosSensibles(v, profundidad + 1));
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(valor as Record<string, unknown>)) {
    out[k] = CLAVE_SENSIBLE.test(k) ? "[oculto]" : sinDatosSensibles(v, profundidad + 1);
  }
  return out;
}
function valorDeAuditoria(v: unknown): string | null {
  if (v === undefined || v === null) return null;
  return typeof v === "object" ? JSON.stringify(sinDatosSensibles(v)) : String(v);
}

export async function audit(params: AuditParams) {
  await insert("auditoria", {
    usuario_id: params.usuario_id,
    accion: params.accion,
    entidad: params.entidad,
    entidad_id: params.entidad_id,
    valor_anterior: valorDeAuditoria(params.valor_anterior),
    valor_nuevo: valorDeAuditoria(params.valor_nuevo),
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
