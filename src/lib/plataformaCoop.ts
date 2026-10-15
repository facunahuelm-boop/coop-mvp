import type { PoolClient } from "pg";
import { pool as appPool, sinDatosSensibles } from "@/lib/db";
import { requirePlatformAdmin, type SessionUser } from "@/lib/auth";

/**
 * Panel de administración por cooperativa (/plataforma/[id]) — capa de datos.
 *
 * El administrador de la plataforma opera sobre CUALQUIER cooperativa, no solo
 * la de su sesión. Las tablas de datos tienen Row-Level Security forzada
 * (migrations/0003), así que cada operación abre una transacción propia sobre
 * una conexión del pool normal (rol app_user, sin BYPASSRLS) y fija
 * `app.current_org_id` SOLO para esa transacción (`set_config(..., true)` =
 * local: se apaga al terminar, nunca queda pegada en la conexión). Es el mismo
 * patrón ya probado en plataforma.ts (crearCooperativaAction,
 * responderTicketPlataformaAction). La base sigue garantizando el aislamiento:
 * dentro de la transacción solo se ven y modifican filas de la cooperativa
 * elegida.
 */

export type Tx = {
  run: (sql: string, params?: unknown[]) => Promise<number>;
  get: <T = Record<string, unknown>>(sql: string, params?: unknown[]) => Promise<T | undefined>;
  all: <T = Record<string, unknown>>(sql: string, params?: unknown[]) => Promise<T[]>;
  /** Ejecuta `fn` dentro de un SAVEPOINT: si falla, deshace solo eso y relanza. */
  tolerante: <T>(fn: () => Promise<T>) => Promise<{ ok: true; valor: T } | { ok: false; error: unknown }>;
  orgId: number;
};

function toPg(sql: string): string {
  let i = 0;
  return sql.replace(/\?/g, () => `$${++i}`);
}

function armarTx(client: PoolClient, orgId: number): Tx {
  let n = 0;
  return {
    orgId,
    run: async (sql, params = []) => (await client.query(toPg(sql), params as unknown[])).rowCount ?? 0,
    get: async <T,>(sql: string, params: unknown[] = []) => (await client.query(toPg(sql), params)).rows[0] as T | undefined,
    all: async <T,>(sql: string, params: unknown[] = []) => (await client.query(toPg(sql), params)).rows as T[],
    tolerante: async <T,>(fn: () => Promise<T>) => {
      const nombre = `sp_${++n}`;
      await client.query(`SAVEPOINT ${nombre}`);
      try {
        const valor = await fn();
        await client.query(`RELEASE SAVEPOINT ${nombre}`);
        return { ok: true as const, valor };
      } catch (error) {
        await client.query(`ROLLBACK TO SAVEPOINT ${nombre}`);
        await client.query(`RELEASE SAVEPOINT ${nombre}`);
        return { ok: false as const, error };
      }
    },
  };
}

/**
 * Corre `fn` como administrador de plataforma sobre la cooperativa `orgId`,
 * todo o nada. Si `fn` tira, se hace ROLLBACK y el error se relanza tal cual.
 */
export async function conCooperativa<T>(orgId: number, fn: (tx: Tx, admin: SessionUser) => Promise<T>): Promise<T> {
  const admin = await requirePlatformAdmin();
  if (!Number.isInteger(orgId) || orgId <= 0) throw new Error("Cooperativa inválida.");
  const client = await appPool.connect();
  try {
    await client.query("BEGIN");
    const org = (await client.query(`SELECT id FROM organizations WHERE id = $1`, [orgId])).rows[0];
    if (!org) throw new Error("Esa cooperativa no existe.");
    await client.query("SELECT set_config('app.current_org_id', $1, true)", [String(orgId)]);
    const resultado = await fn(armarTx(client, orgId), admin);
    await client.query("COMMIT");
    return resultado;
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

/** Auditoría dentro de la misma transacción, marcada con la cooperativa que se administró. */
export async function auditarTx(
  tx: Tx,
  admin: SessionUser,
  accion: string,
  entidad: string,
  entidadId: number | null,
  valorNuevo?: unknown,
  valorAnterior?: unknown
) {
  const aTexto = (v: unknown) => (v === undefined || v === null ? null : typeof v === "object" ? JSON.stringify(sinDatosSensibles(v)) : String(v));
  await tx.run(
    `INSERT INTO auditoria (organization_id, usuario_id, accion, entidad, entidad_id, valor_anterior, valor_nuevo) VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [tx.orgId, admin.id, accion, entidad, entidadId, aTexto(valorAnterior), aTexto(valorNuevo)]
  );
}

/** Minúsculas, sin tildes y con espacios simples: "Álvarez  Mercedes" == "alvarez mercedes". */
export function normalizarNombre(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

// ---------------------------------------------------------------------------
// Lectura del detalle de una cooperativa
// ---------------------------------------------------------------------------

export type NucleoFila = {
  socio_id: number;
  numero_nucleo: number | null;
  nombre: string;
  documento: string | null;
  telefono: string | null;
  email: string | null;
  estado: string;
  nucleo_id: number | null;
  user_id: number | null;
  usuario_nombre: string | null;
  integrantes: IntegranteFila[];
};

export type IntegranteFila = {
  id: number;
  socio_id: number;
  nombre: string;
  apellido: string | null;
  documento: string | null;
  telefono: string | null;
  email: string | null;
  relacion: string;
  estado: string;
};

export type UsuarioFila = {
  id: number;
  nombre: string;
  email: string | null;
  rol: string;
  activo: boolean;
  estado_cuenta: string;
  es_platform_admin: boolean;
  socio_id: number | null;
  numero_nucleo: number | null;
  invitacion_vigente: boolean;
  comision_ids: number[];
};

export type ComisionFila = {
  id: number;
  nombre: string;
  activa: boolean;
  miembros: { user_id: number; nombre: string; numero_nucleo: number | null }[];
};

export type DetalleCooperativa = {
  org: { id: number; slug: string; nombre: string; etapa: string; plan: string; activo: boolean };
  nucleos: NucleoFila[];
  usuarios: UsuarioFila[];
  comisiones: ComisionFila[];
};

export async function leerDetalleCooperativa(orgId: number): Promise<DetalleCooperativa | null> {
  const existe = await conCooperativa(orgId, async (tx) => {
    const org = await tx.get<{ id: number; slug: string; nombre: string; etapa: string; plan: string; activo: number }>(
      `SELECT id, slug, nombre, etapa, plan, activo FROM organizations WHERE id = ?`,
      [orgId]
    );
    if (!org) return null;

    const socios = await tx.all<{
      socio_id: number;
      numero_nucleo: number | null;
      nombre: string;
      documento: string | null;
      telefono: string | null;
      email: string | null;
      estado: string;
      nucleo_id: number | null;
      user_id: number | null;
      usuario_nombre: string | null;
    }>(
      `SELECT s.id AS socio_id, s.numero_nucleo, s.nombre, s.documento, s.telefono, s.email, s.estado,
              s.nucleo_id, s.user_id, u.nombre AS usuario_nombre
         FROM socios s LEFT JOIN users u ON u.id = s.user_id
        WHERE s.estado <> 'baja'
        ORDER BY s.numero_nucleo ASC NULLS LAST, s.nombre ASC`
    );
    const integrantes = await tx.all<IntegranteFila>(
      `SELECT id, socio_id, nombre, apellido, documento, telefono, email, relacion, estado
         FROM socio_integrantes ORDER BY id ASC`
    );
    const porSocio = new Map<number, IntegranteFila[]>();
    for (const i of integrantes) {
      const lista = porSocio.get(i.socio_id) ?? [];
      lista.push(i);
      porSocio.set(i.socio_id, lista);
    }

    const usuariosCrudos = await tx.all<{
      id: number;
      nombre: string;
      email: string | null;
      rol: string;
      activo: number;
      estado_cuenta: string;
      es_platform_admin: boolean;
      socio_id: number | null;
      numero_nucleo: number | null;
      invitacion_vigente: boolean;
    }>(
      `SELECT u.id, u.nombre, u.email, u.rol, u.activo, u.estado_cuenta, u.es_platform_admin,
              s.id AS socio_id, s.numero_nucleo,
              (u.reset_token_hash IS NOT NULL AND u.reset_token_expira_en > NOW()) AS invitacion_vigente
         FROM users u LEFT JOIN socios s ON s.user_id = u.id AND s.estado <> 'baja'
        ORDER BY u.nombre ASC`
    );
    const membresias = await tx.all<{ comision_id: number; user_id: number }>(
      `SELECT comision_id, user_id FROM comision_miembros WHERE activo = 1`
    );
    const comisionesDeUsuario = new Map<number, number[]>();
    for (const m of membresias) {
      const l = comisionesDeUsuario.get(m.user_id) ?? [];
      l.push(m.comision_id);
      comisionesDeUsuario.set(m.user_id, l);
    }
    const usuarios: UsuarioFila[] = usuariosCrudos.map((u) => ({
      ...u,
      activo: u.activo === 1,
      comision_ids: comisionesDeUsuario.get(u.id) ?? [],
    }));
    const usuarioPorId = new Map(usuarios.map((u) => [u.id, u]));

    const comisionesCrudas = await tx.all<{ id: number; nombre: string; activa: number }>(
      `SELECT id, nombre, activa FROM comisiones ORDER BY nombre ASC`
    );
    const comisiones: ComisionFila[] = comisionesCrudas.map((c) => ({
      id: c.id,
      nombre: c.nombre,
      activa: c.activa === 1,
      miembros: membresias
        .filter((m) => m.comision_id === c.id)
        .map((m) => usuarioPorId.get(m.user_id))
        .filter((u): u is UsuarioFila => !!u)
        .map((u) => ({ user_id: u.id, nombre: u.nombre, numero_nucleo: u.numero_nucleo })),
    }));

    const detalle: DetalleCooperativa = {
      org: { id: org.id, slug: org.slug, nombre: org.nombre, etapa: org.etapa, plan: org.plan, activo: org.activo === 1 },
      nucleos: socios.map((s) => ({ ...s, integrantes: porSocio.get(s.socio_id) ?? [] })),
      usuarios,
      comisiones,
    };
    return detalle;
  });
  return existe;
}
