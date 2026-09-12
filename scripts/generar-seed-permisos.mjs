#!/usr/bin/env node
// Fase 4 del Prompt Maestro (roles/permisos granulares, REQUIREMENTS.md 5.4).
//
// Genera los INSERT de seed para las tablas `roles`, `permissions` y
// `role_permissions` (migrations/0022_roles_permissions.sql) directamente a
// partir de la MATRIX real de src/lib/roles.ts — nunca transcriptos a mano,
// para que no puedan desincronizarse de lo que el código realmente aplica
// (canRead/canEdit/canApprove).
//
// Uso: si `roles.ts` cambia (se agrega un rol, un módulo, o se ajusta un
// nivel de acceso en la MATRIX), correr:
//
//   node scripts/generar-seed-permisos.mjs > /tmp/seed.sql
//
// y pegar el resultado en una migración NUEVA (nunca editar una migración ya
// aplicada) que primero borre las filas viejas de role_permissions/roles/
// permissions que ya no correspondan.
//
// No usa un parser TS de verdad: extrae los literales ROLES, ROLE_LABELS y
// MATRIX del archivo fuente con una expresión regular y los evalúa como
// objeto/array JS (son sintaxis JS válida, solo con anotaciones de tipo
// alrededor) — suficiente porque este script se corre a mano, sobre el
// propio código del repo, nunca sobre datos de un usuario.

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rolesSrc = readFileSync(path.join(__dirname, "..", "src", "lib", "roles.ts"), "utf8");

function extraerLiteral(nombre) {
  const inicio = rolesSrc.indexOf(`const ${nombre}`);
  if (inicio === -1) throw new Error(`No se encontró "const ${nombre}" en roles.ts`);
  const igual = rolesSrc.indexOf("=", inicio);
  let i = rolesSrc.indexOf(/[[{]/.test(rolesSrc[igual + 1]) ? rolesSrc[igual + 1] : "", igual);
  // Encontrar el primer '{' o '[' después del '='.
  let j = igual + 1;
  while (!"{[".includes(rolesSrc[j])) j++;
  const abre = rolesSrc[j];
  const cierra = abre === "{" ? "}" : "]";
  let profundidad = 0;
  let k = j;
  for (; k < rolesSrc.length; k++) {
    if (rolesSrc[k] === abre) profundidad++;
    else if (rolesSrc[k] === cierra) {
      profundidad--;
      if (profundidad === 0) break;
    }
  }
  const literal = rolesSrc.slice(j, k + 1);
  // eslint-disable-next-line no-eval
  return eval(`(${literal})`);
}

const ROLES = extraerLiteral("ROLES");
const ROLE_LABELS = extraerLiteral("ROLE_LABELS");
const MATRIX = extraerLiteral("MATRIX");
const MODULES = [...new Set(Object.values(MATRIX).flatMap((fila) => Object.keys(fila)))];

// Jerarquía de acceso, igual que canRead/canEdit/canApprove en roles.ts:
// config incluye approve, que incluye edit, que incluye read.
const TIERS = ["read", "edit", "approve", "config"];
function permisosIncluidos(access) {
  const idx = TIERS.indexOf(access);
  if (idx === -1) return []; // "none"
  return TIERS.slice(0, idx + 1);
}

function sqlStr(s) {
  return "'" + String(s).replace(/'/g, "''") + "'";
}

const out = [];

out.push("-- roles: seed 1:1 con ROLES (src/lib/roles.ts)");
out.push("INSERT INTO roles (nombre, etiqueta) VALUES");
out.push(
  ROLES.map((r, i) => `  (${sqlStr(r)}, ${sqlStr(ROLE_LABELS[r])})${i === ROLES.length - 1 ? "" : ","}`).join("\n") +
    "\nON CONFLICT (nombre) DO NOTHING;"
);
out.push("");

const pares = [];
const permSet = new Set();
for (const role of ROLES) {
  for (const mod of MODULES) {
    const access = MATRIX[role][mod];
    for (const tier of permisosIncluidos(access)) {
      pares.push([role, `${mod}.${tier}`]);
      permSet.add(`${mod}.${tier}`);
    }
  }
}

out.push(
  '-- permissions: catálogo recurso.accion — solo los permisos que la MATRIX (roles.ts) realmente otorga a algún rol hoy.'
);
const permsOrdered = [...permSet].sort();
out.push("INSERT INTO permissions (recurso, accion, nombre) VALUES");
out.push(
  permsOrdered
    .map((p, i) => {
      const [recurso, accion] = p.split(".");
      return `  (${sqlStr(recurso)}, ${sqlStr(accion)}, ${sqlStr(p)})${i === permsOrdered.length - 1 ? "" : ","}`;
    })
    .join("\n") + "\nON CONFLICT (nombre) DO NOTHING;"
);
out.push("");

out.push(
  "-- role_permissions: derivado 1:1 de la MATRIX existente (roles.ts) — jerarquía config > approve > edit > read, igual que canRead/canEdit/canApprove."
);
out.push("INSERT INTO role_permissions (role_id, permission_id)");
out.push("SELECT r.id, p.id FROM (VALUES");
out.push(pares.map(([role, perm], i) => `  (${sqlStr(role)}, ${sqlStr(perm)})${i === pares.length - 1 ? "" : ","}`).join("\n"));
out.push(") AS v(rol_nombre, permiso_nombre)");
out.push("JOIN roles r ON r.nombre = v.rol_nombre");
out.push("JOIN permissions p ON p.nombre = v.permiso_nombre");
out.push("ON CONFLICT (role_id, permission_id) DO NOTHING;");

console.log(out.join("\n"));
console.error(`-- (${pares.length} filas role_permissions, ${permsOrdered.length} permisos, ${ROLES.length} roles)`);
