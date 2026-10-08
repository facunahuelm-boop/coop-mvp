// CI — Fase 1A "Base segura": verifica, contra una base de PRUEBA con todas
// las migraciones aplicadas, que el aislamiento entre cooperativas y las
// reglas de "nada se borra" se cumplen. Nunca correr contra producción: crea
// dos cooperativas ficticias.
//
// Uso: DATABASE_URL=postgres://… node scripts/ci/verificar-aislamiento.mjs
//
// Chequea:
//  1) Toda tabla con organization_id tiene RLS activado y forzado, y al
//     menos una política. Las únicas tablas sin organization_id son las de
//     plataforma conocidas (lista de abajo): una tabla nueva sin aislamiento
//     hace fallar el CI.
//  2) Conectada como app_user, la cooperativa B no ve NINGUNA fila de la
//     cooperativa A en ninguna tabla.
//  3) app_user no puede insertar filas a nombre de otra cooperativa.
//  4) app_user no puede borrar (DELETE) en las tablas de dinero y negocio.
//  5) Lo que va a la papelera queda oculto, salvo activando
//     app.incluir_eliminados dentro de la transacción.

import pg from "pg";

const TABLAS_DE_PLATAFORMA = new Set(["organizations", "permissions", "role_permissions", "roles", "schema_migrations"]);
const SIN_DELETE = [
  "movimientos_cuenta_socio", "convenios_pago", "movimientos_financieros", "gastos_comision",
  "solicitudes_compra", "presupuestos_proveedor", "decisiones_compra", "proveedores", "documentos",
  "socios", "nucleos_familiares", "asignaciones_horas", "actas", "auditoria",
  "asistencias_horas", "avisos_ausencia", "licencias_horas", "cierres_semana_horas", "saldos_horas_semana",
  "recibos", "ejecuciones_automaticas",
  // Fase 2A
  "cuentas_financieras", "fondos", "periodos_financieros", "facturas_proveedor", "mapeo_contable", "presupuesto_general", "compromisos_futuros",
  // Fase 2B
  "formatos_extracto", "extractos_bancarios", "extracto_lineas",
  // Fase 2C
  "socio_estados", "checklist_ingreso", "habilidades_nucleo", "lista_espera",
  // Fase 2D
  "asamblea_padron", "asamblea_votaciones", "asamblea_votos", "consejo_directivo_cargos",
  // Fase 2E
  "tramites_hitos",
  // Fase 2F
  "avisos", "aviso_destinatarios", "contactos_externos", "proveedor_documentos", "plantillas_texto",
  // Fase 3
  "fichadas_obra", "epp_entregas", "inducciones_seguridad",
  "recepciones_material", "panol_items", "panol_movimientos", "diario_obra", "diario_obra_fotos",
  "obra_rubros", "obra_avances_rubro", "obra_plan_mensual", "prestamo_desembolsos",
  "correspondencia", "elecciones", "listas_electorales",
  "accesos_delegados", "conceptos_cuota", "mantenimiento_preventivo", "mantenimiento_registros", "espacios_comunes", "reservas_espacios", "liquidaciones_egreso",
  "encuestas", "encuesta_respuestas", "medidas_propuestas",
];

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("Falta DATABASE_URL");
  process.exit(1);
}
if (/supabase|pooler|prod/i.test(url)) {
  console.error("Esto parece una base real. Este script solo corre contra una base de prueba.");
  process.exit(1);
}

const client = new pg.Client({ connectionString: url });
await client.connect();
const errores = [];
const ok = (m) => console.log("  ✔ " + m);
const mal = (m) => {
  errores.push(m);
  console.log("  ✘ " + m);
};

// ---------- 1) Cobertura de RLS ----------
console.log("1) Cobertura de RLS");
const { rows: tablas } = await client.query(`
  SELECT c.relname AS tabla, c.relrowsecurity AS rls, c.relforcerowsecurity AS forzado,
         (SELECT count(*) FROM pg_policies p WHERE p.schemaname = 'public' AND p.tablename = c.relname)::int AS politicas,
         EXISTS (SELECT 1 FROM information_schema.columns k
                  WHERE k.table_schema = 'public' AND k.table_name = c.relname AND k.column_name = 'organization_id') AS con_org
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'public' AND c.relkind = 'r'
   ORDER BY c.relname`);
let conOrg = 0;
for (const t of tablas) {
  if (!t.con_org) {
    if (!TABLAS_DE_PLATAFORMA.has(t.tabla)) mal(`${t.tabla}: no tiene organization_id (¿falta aislarla por cooperativa?)`);
    continue;
  }
  conOrg++;
  if (!t.rls || !t.forzado) mal(`${t.tabla}: RLS ${t.rls ? "" : "NO activado "}${t.forzado ? "" : "NO forzado"}`.trim());
  if (t.politicas === 0) mal(`${t.tabla}: no tiene ninguna política de aislamiento`);
}
ok(`${conOrg} tablas de cooperativa revisadas`);

// ---------- Datos de prueba: dos cooperativas ficticias ----------
const sufijo = Date.now();
const crearOrg = async (slug) =>
  (await client.query(`INSERT INTO organizations (slug, nombre) VALUES ($1, $2) RETURNING id`, [`${slug}-${sufijo}`, `CI ${slug}`])).rows[0].id;
const orgA = await crearOrg("ci-a");
const orgB = await crearOrg("ci-b");

const enOrg = async (org, sql, params = []) => {
  await client.query(`SELECT set_config('app.current_org_id', $1, false)`, [String(org)]);
  return client.query(sql, params);
};
// Filas mínimas de la cooperativa A en tablas clave (como superusuario).
await client.query(`SELECT set_config('app.current_org_id', $1, false)`, [String(orgA)]);
const userA = (await client.query(
  `INSERT INTO users (nombre, email, password_hash, rol, organization_id) VALUES ('CI A', $1, 'x', 'admin', $2) RETURNING id`,
  [`ci-a-${sufijo}@ci.test`, orgA]
)).rows[0].id;
const nucleoA = (await client.query(`INSERT INTO nucleos_familiares (nombre, organization_id) VALUES ('Núcleo CI', $1) RETURNING id`, [orgA])).rows[0].id;
const socioA = (await client.query(`INSERT INTO socios (organization_id, nombre, nucleo_id) VALUES ($1, 'Socio CI', $2) RETURNING id`, [orgA, nucleoA])).rows[0].id;
await client.query(
  `INSERT INTO movimientos_cuenta_socio (organization_id, socio_id, tipo, concepto, monto, fecha) VALUES ($1, $2, 'cargo', 'Cuota CI', 100, '2026-01-01')`,
  [orgA, socioA]
);
const docA = (await client.query(
  `INSERT INTO documentos (organization_id, categoria, nombre, subido_por_id) VALUES ($1, 'otros', 'Doc CI', $2) RETURNING id`,
  [orgA, userA]
)).rows[0].id;
await client.query(`INSERT INTO comisiones (organization_id, nombre) VALUES ($1, 'Comisión CI')`, [orgA]);

// ---------- 2) B no ve nada de A ----------
console.log("2) La cooperativa B no ve datos de A");
await client.query(`SET ROLE app_user`);
let fugas = 0;
for (const t of tablas.filter((x) => x.con_org)) {
  try {
    const { rows } = await enOrg(orgB, `SELECT count(*)::int AS n FROM ${t.tabla} WHERE organization_id <> $1`, [orgB]);
    if (rows[0].n > 0) {
      fugas++;
      mal(`${t.tabla}: la cooperativa B ve ${rows[0].n} fila(s) de otra cooperativa`);
    }
  } catch (err) {
    if (err.code !== "42501") mal(`${t.tabla}: error al leer como app_user (${err.message})`);
  }
}
if (!fugas) ok("ninguna tabla deja ver filas de otra cooperativa");
const { rows: propias } = await enOrg(orgA, `SELECT count(*)::int AS n FROM socios`);
if (propias[0].n >= 1) ok("la cooperativa A sí ve sus propios datos");
else mal("la cooperativa A no ve sus propios socios");

// ---------- 3) No se puede escribir a nombre de otra cooperativa ----------
console.log("3) Escritura cruzada bloqueada");
try {
  await enOrg(orgB, `INSERT INTO socios (organization_id, nombre) VALUES ($1, 'Intruso')`, [orgA]);
  mal("app_user pudo insertar un socio en otra cooperativa");
} catch (err) {
  if (err.code === "42501") ok("insertar en otra cooperativa es rechazado");
  else mal(`error inesperado: ${err.message}`);
}

// ---------- 4) Sin DELETE en tablas de negocio ----------
console.log("4) La app no puede borrar datos de negocio");
for (const t of SIN_DELETE) {
  try {
    await enOrg(orgA, `DELETE FROM ${t} WHERE false`);
    mal(`${t}: app_user todavía tiene permiso DELETE`);
  } catch (err) {
    if (err.code !== "42501") mal(`${t}: error inesperado (${err.message})`);
  }
}
if (!errores.some((e) => e.includes("DELETE"))) ok(`${SIN_DELETE.length} tablas sin permiso de borrar`);

// ---------- 5) Papelera ----------
console.log("5) Papelera (eliminación lógica)");
await enOrg(orgA, `BEGIN`);
await client.query(`SELECT set_config('app.incluir_eliminados', '1', true)`);
await client.query(`UPDATE documentos SET eliminado_en = now()::text, eliminado_por_id = $1, motivo_eliminacion = 'CI' WHERE id = $2`, [userA, docA]);
await client.query(`COMMIT`);
const { rows: visibles } = await enOrg(orgA, `SELECT count(*)::int AS n FROM documentos WHERE id = $1`, [docA]);
if (visibles[0].n === 0) ok("un documento en la papelera no se ve en la app");
else mal("un documento en la papelera sigue visible");
await client.query(`BEGIN`);
await client.query(`SELECT set_config('app.incluir_eliminados', '1', true)`);
const { rows: enPapelera } = await client.query(`SELECT count(*)::int AS n FROM documentos WHERE id = $1`, [docA]);
await client.query(`COMMIT`);
if (enPapelera[0].n === 1) ok("sigue existiendo (recuperable) dentro de la papelera");
else mal("el documento no existe ni en la papelera");

// ---------- 6) Meses cerrados bloqueados (Fase 2A) ----------
console.log("6) Un mes cerrado no se puede tocar");
const { rows: movCi } = await enOrg(
  orgA,
  `INSERT INTO movimientos_financieros (organization_id, tipo, monto, categoria, fecha) VALUES ($1, 'ingreso', 100, 'CI', '2026-01-10') RETURNING id`,
  [orgA]
);
await enOrg(orgA, `INSERT INTO periodos_financieros (organization_id, periodo, estado) VALUES ($1, '2026-01', 'cerrado')`, [orgA]);
const esperaBloqueo = async (sql, params, texto) => {
  try {
    await enOrg(orgA, sql, params);
    mal(`${texto}: se pudo, y no debería`);
  } catch (err) {
    if (String(err.message).includes("PERIODO_CERRADO")) ok(`${texto}: bloqueado`);
    else mal(`${texto}: error inesperado (${err.message})`);
  }
};
await esperaBloqueo(`INSERT INTO movimientos_financieros (organization_id, tipo, monto, categoria, fecha) VALUES ($1, 'egreso', 5, 'CI', '2026-01-20')`, [orgA], "agregar un movimiento en un mes cerrado");
await esperaBloqueo(`UPDATE movimientos_financieros SET monto = 999 WHERE id = $1`, [movCi[0].id], "cambiar el monto de un movimiento de un mes cerrado");
await esperaBloqueo(`UPDATE movimientos_financieros SET fecha = '2026-02-01' WHERE id = $1`, [movCi[0].id], "sacar un movimiento de un mes cerrado cambiándole la fecha");
await esperaBloqueo(`UPDATE movimientos_financieros SET estado = 'anulado' WHERE id = $1`, [movCi[0].id], "anular un movimiento de un mes cerrado");
try {
  await enOrg(orgA, `UPDATE movimientos_financieros SET actualizado_en = now()::text WHERE id = $1`, [movCi[0].id]);
  ok("un cambio que no toca la plata (ej. conciliación) sí se permite");
} catch (err) {
  mal(`un cambio que no toca la plata fue bloqueado (${err.message})`);
}
await enOrg(orgA, `INSERT INTO movimientos_financieros (organization_id, tipo, monto, categoria, fecha) VALUES ($1, 'egreso', 5, 'CI', '2026-02-03')`, [orgA])
  .then(() => ok("en un mes abierto se puede registrar"))
  .catch((err) => mal(`no se pudo registrar en un mes abierto (${err.message})`));

await client.query(`RESET ROLE`);
await client.end();

if (errores.length) {
  console.log(`\n${errores.length} problema(s) de aislamiento o borrado. Revisar antes de publicar.`);
  process.exit(1);
}
console.log("\nAislamiento entre cooperativas y reglas de \"nada se borra\": OK");
