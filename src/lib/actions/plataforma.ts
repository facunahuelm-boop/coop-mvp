"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { Pool } from "pg";
import { rootAll, rootGet, update, audit, pool as appPool } from "@/lib/db";
import { requirePlatformAdmin, hashPassword } from "@/lib/auth";
import { parseForm, zId, zTexto, zEnumSeguro, ValidationError } from "@/lib/validation";
import { conEstadoDeAccion, type ActionState } from "@/lib/actionState";
import { PLANES, PLAN_PRESET_MODULOS } from "@/lib/planes";

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
  errorConteoUsuarios: string | null;
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
  }>(
    `SELECT o.id, o.slug, o.nombre, o.etapa, o.plan, o.activo, o.creado_en
     FROM organizations o
     ORDER BY o.id ASC`
  );

  // Conexión elevada compartida por el resto de esta función (usuarios
  // activos por cooperativa + migraciones pendientes) — se crea una sola vez
  // acá y se cierra al final.
  let poolElevado: Pool | null = null;
  try {
    poolElevado = crearPoolMigraciones();
  } catch {
    poolElevado = null; // sin DATABASE_URL en este entorno — se degrada, no rompe la pantalla.
  }

  // HALLAZGO EN VERIFICACIÓN EN VIVO (Sub-fase 5.2, 24/09): la versión
  // anterior de esta consulta (Sub-fase 5.1) contaba usuarios activos con una
  // subconsulta correlacionada sobre `users` corrida con rootAll — es decir,
  // con la conexión NORMAL de la app (`pool` de db.ts, rol app_user), que
  // nunca fija `app.current_org_id` (withRootClient no lo toca). Como `users`
  // tiene Row-Level Security FORZADA (migrations/0003), esa columna en los
  // hechos mostraba el conteo de CUALQUIER cooperativa cuya consulta hubiera
  // dejado esa variable de sesión pegada en la misma conexión física del
  // pool (reutilizada entre pedidos) — con una sola cooperativa real en
  // producción hasta hoy, siempre coincidía por casualidad. Al crear acá
  // mismo la primera cooperativa nueva de la historia de este sistema
  // ("Cooperativa de Prueba QA"), apareció con "0 usuarios activos" a pesar
  // de que el alta había funcionado perfectamente (confirmado iniciando
  // sesión con esa cuenta) — la cuenta en sí nunca estuvo mal, era esta
  // lectura. Se arregla usando la misma conexión elevada (bypass RLS) que ya
  // usan las migraciones: es la única forma correcta de ver usuarios de
  // TODAS las cooperativas a la vez sin depender de qué conexión del pool
  // normal toque en cada pedido.
  let conteos = new Map<number, number>();
  let errorConteoUsuarios: string | null = null;
  if (poolElevado) {
    try {
      const { rows } = await poolElevado.query<{ organization_id: number; cantidad: string }>(
        `SELECT organization_id, count(*)::text AS cantidad FROM users WHERE activo = 1 GROUP BY organization_id`
      );
      conteos = new Map(rows.map((r) => [Number(r.organization_id), Number(r.cantidad)]));
    } catch (err) {
      errorConteoUsuarios = err instanceof Error ? err.message : String(err);
    }
  } else {
    errorConteoUsuarios = "Falta la variable de entorno DATABASE_URL en este entorno.";
  }

  const cooperativas: CooperativaResumen[] = filas.map((f) => ({
    id: f.id,
    slug: f.slug,
    nombre: f.nombre,
    etapa: f.etapa,
    plan: f.plan,
    activo: f.activo === 1,
    creado_en: f.creado_en,
    usuarios_activos: conteos.get(f.id) ?? 0,
  }));

  let migracionesPendientes: string[] = [];
  let errorMigraciones: string | null = null;
  try {
    if (!poolElevado) throw new Error("Falta la variable de entorno DATABASE_URL en este entorno.");
    migracionesPendientes = await listarMigracionesPendientes(poolElevado);
  } catch (err) {
    errorMigraciones = err instanceof Error ? err.message : String(err);
  } finally {
    if (poolElevado) await poolElevado.end();
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

  return { cooperativas, errorConteoUsuarios, migracionesPendientes, errorMigraciones, diagnosticoRls, errorDiagnostico };
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

// ---------------------------------------------------------------------------
// Sub-fase 5.2: Alta de cooperativas (sección 19).
//
// Hallazgo de la auditoría (ver comentario de src/app/api/setup/route.ts, que
// ya anticipaba esto): no existía ninguna forma de dar de alta una
// cooperativa nueva más que con SQL directo contra la base — `/api/setup`
// es exclusivamente para sembrar datos de demostración en "coova" y
// explícitamente dice que NO es el camino para esto. Acá se cubren las dos
// mitades del alta: la fila de `organizations` y el primer usuario 'admin'
// (tenant-scoped, no `es_platform_admin`) de esa cooperativa — sin ninguna
// de las dos, la cooperativa quedaría creada pero sin nadie que pueda entrar,
// o con un usuario sin cooperativa real detrás.
//
// Por qué NO se usa insert("users", ...) de db.ts para el segundo paso: esa
// función (como get/all/update) pasa siempre por withTenantClient, que fija
// `app.current_org_id` a la cooperativa de QUIEN EJECUTA LA ACCIÓN (el admin
// de plataforma, vía requireOrgContext()) — la política de Row-Level Security
// de `users` (migrations/0003_rls_policies.sql, WITH CHECK) rechazaría de
// entrada un INSERT con organization_id de una cooperativa distinta a esa.
// En vez de forzar el contexto global de la ejecución completa (arriesgando
// que la auditoría de esta misma acción, más abajo, quede mal atribuida a la
// cooperativa nueva en vez de a la del admin de plataforma), se abre acá una
// única conexión/transacción del pool normal de la app y se fija
// `app.current_org_id` a la cooperativa NUEVA solo en ESA conexión — la
// fila de `organizations` no tiene RLS (es la tabla raíz), así que el mismo
// INSERT le sirve sin ningún cambio de contexto. Todo el alta queda atómica:
// si el segundo INSERT fallara, el primero se revierte y no queda una
// cooperativa fantasma sin ningún usuario que pueda entrar.
const slugCooperativa = z
  .string()
  .trim()
  .toLowerCase()
  .min(2, "Mínimo 2 caracteres.")
  .max(40, "Máximo 40 caracteres.")
  .regex(/^[a-z][a-z0-9-]*$/, "Solo minúsculas, números y guiones — tiene que empezar con una letra.");

const emailAdminCooperativa = z
  .string()
  .trim()
  .toLowerCase()
  .max(200, "Máximo 200 caracteres.")
  .refine((v) => z.string().email().safeParse(v).success, "Ingresá un email válido.");

const passwordInicialCooperativa = z
  .string()
  .min(8, "Tiene que tener al menos 8 caracteres.")
  .max(200, "Máximo 200 caracteres.");

const crearCooperativaSchema = z.object({
  nombre: zTexto(200),
  slug: slugCooperativa,
  // Fase 5, Sub-fase 5.3 ("Planes y módulos"): con fallback a "trial" — el
  // mismo default que ya tiene la columna organizations.plan desde la Fase 0
  // — para que un envío directo del formulario sin tocar el select (o desde
  // cualquier otro lugar que llame a esta acción) no rompa por un campo
  // ausente.
  plan: zEnumSeguro(PLANES, "trial"),
  adminNombre: zTexto(200),
  adminEmail: emailAdminCooperativa,
  adminPassword: passwordInicialCooperativa,
});

const PG_UNIQUE_VIOLATION = "23505";

export async function crearCooperativaAction(formData: FormData) {
  const admin = await requirePlatformAdmin();
  const datos = parseForm(crearCooperativaSchema, formData);

  // Chequeo previo con mensaje claro pegado al campo — mismo criterio que
  // crearUsuarioAction (usuariosAdmin.ts) con el email: sin esto, el mismo
  // caso cae en la restricción UNIQUE(slug) de la base y sale como un error
  // técnico genérico (ver esErrorTecnico en actionState.ts).
  const existente = await rootGet<{ id: number }>(`SELECT id FROM organizations WHERE slug = ?`, [datos.slug]);
  if (existente) throw new ValidationError("slug", "Ya existe una cooperativa con ese identificador.");

  const hash = await hashPassword(datos.adminPassword);

  let nuevaOrgId: number;
  const client = await appPool.connect();
  try {
    await client.query("BEGIN");
    // Fase 5, Sub-fase 5.1: etapa NO usa el default de la columna ('obra',
    // pensado para las cooperativas que ya existían al agregar esta columna
    // — ver migrations/0001) — una cooperativa recién dada de alta arranca
    // en 'pre_obra' (decisión confirmada con el usuario, 24/09).
    //
    // Fase 5, Sub-fase 5.3: `plan` y su preset de `modulos_override` (ver
    // lib/planes.ts) se fijan acá mismo, en la misma fila — a diferencia de
    // cambiarPlanCooperativaAction (más abajo, para una cooperativa ya
    // existente), acá no hay ningún ajuste manual previo que se pueda pisar.
    const { rows } = await client.query(
      `INSERT INTO organizations (slug, nombre, etapa, plan, modulos_override) VALUES ($1, $2, 'pre_obra', $3, $4) RETURNING id`,
      [datos.slug, datos.nombre, datos.plan, JSON.stringify(PLAN_PRESET_MODULOS[datos.plan])]
    );
    nuevaOrgId = rows[0].id;
    await client.query("SELECT set_config('app.current_org_id', $1, false)", [String(nuevaOrgId)]);
    await client.query(
      `INSERT INTO users (organization_id, nombre, email, password_hash, rol, activo) VALUES ($1, $2, $3, $4, 'admin', 1)`,
      [nuevaOrgId, datos.adminNombre, datos.adminEmail, hash]
    );
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    if (err && typeof err === "object" && (err as { code?: string }).code === PG_UNIQUE_VIOLATION) {
      throw new ValidationError("slug", "Ya existe una cooperativa con ese identificador.");
    }
    throw err;
  } finally {
    client.release();
  }

  // Sin la contraseña en la auditoría, ni en texto plano ni el hash — mismo
  // criterio que crearUsuarioAction. Queda en la auditoría de la cooperativa
  // del propio admin de plataforma que la ejecuta (mismo criterio ya
  // documentado en aplicarMigracionesPendientesAction, más arriba: no existe
  // una tabla de auditoría "de plataforma" separada).
  await audit({
    usuario_id: admin.id,
    accion: "crear_cooperativa",
    entidad: "organizations",
    entidad_id: nuevaOrgId,
    valor_nuevo: { slug: datos.slug, nombre: datos.nombre, admin_email: datos.adminEmail, plan: datos.plan },
  });
  revalidatePath("/plataforma");
}

export async function crearCooperativaFormAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  return conEstadoDeAccion(() => crearCooperativaAction(formData));
}

// ---------------------------------------------------------------------------
// Sub-fase 5.3: cambiar el plan de una cooperativa YA existente.
//
// A diferencia del alta (donde el preset se escribe en una fila que todavía
// no tiene ningún ajuste manual), acá SÍ puede haber un `modulos_override`
// que la propia cooperativa configuró a mano desde Configuración → Módulos —
// cambiar el plan lo REEMPLAZA por el preset del plan nuevo a propósito (ver
// lib/planes.ts): un plan que solo "sugiriera" módulos sin aplicarlos no
// sería un preset. La pantalla (/plataforma) avisa esto explícitamente antes
// de guardar.
const cambiarPlanSchema = z.object({ id: zId, plan: zEnumSeguro(PLANES) });

export async function cambiarPlanCooperativaAction(formData: FormData) {
  const admin = await requirePlatformAdmin();
  const { id, plan } = parseForm(cambiarPlanSchema, formData);

  const coop = await rootGet<{ nombre: string; slug: string; plan: string }>(
    `SELECT nombre, slug, plan FROM organizations WHERE id = ?`,
    [id]
  );
  if (!coop) throw new Error("Esa cooperativa ya no existe.");
  if (coop.plan === plan) return; // nada que hacer, evita una fila de auditoría vacía

  const preset: Record<string, "mostrar" | "ocultar"> = PLAN_PRESET_MODULOS[plan];
  await update("organizations", id, { plan, modulos_override: preset });
  await audit({
    usuario_id: admin.id,
    accion: "cambiar_plan_cooperativa",
    entidad: "organizations",
    entidad_id: id,
    valor_anterior: { plan: coop.plan },
    valor_nuevo: { plan, modulos_override: preset },
  });
  revalidatePath("/plataforma");
}

export async function cambiarPlanCooperativaFormAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  return conEstadoDeAccion(() => cambiarPlanCooperativaAction(formData));
}
