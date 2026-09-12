// Roles del sistema (ver sección 7 del análisis: Roles y permisos)
export const ROLES = [
  "socio",
  "comision_obra",
  "comision_trabajo",
  "comision_compras",
  "comision_seguridad",
  "administracion",
  "tesoreria",
  "consejo_directivo",
  "fiscal",
  "tecnico",
  "admin",
] as const;

export type Role = (typeof ROLES)[number];

export const ROLE_LABELS: Record<Role, string> = {
  socio: "Socio/a",
  comision_obra: "Comisión de Obra",
  comision_trabajo: "Comisión de Trabajo",
  comision_compras: "Comisión de Compras",
  comision_seguridad: "Comisión de Seguridad",
  administracion: "Administración",
  tesoreria: "Tesorería",
  consejo_directivo: "Consejo Directivo",
  fiscal: "Comisión Fiscal",
  tecnico: "IAT / Dirección técnica",
  admin: "Administrador del sistema",
};

type Access = "none" | "read" | "edit" | "approve" | "config";

export type Module = "obra" | "trabajo" | "compras" | "seguridad" | "finanzas" | "documentos" | "auditoria" | "comisiones" | "socios" | "reclamos";

// Matriz de permisos (sección 7 del análisis). Punto de partida configurable,
// no una definición legal ni estatutaria cerrada.
//
// "comisiones" (módulo de Comisiones y Reuniones): igual criterio que
// "documentos" — todo el mundo puede ver quién integra cada comisión y la
// agenda de reuniones; administración arma reuniones y actas del día a día;
// consejo directivo aprueba/edita con más alcance (puede cerrar una reunión
// de cualquier comisión); fiscal solo mira, como en el resto de sus permisos.
//
// "socios" (ficha de socios, viviendas y lista de espera, Fase 05 del plan):
// cualquier socio puede ver el padrón y la lista de espera (transparencia
// básica), administración es quien día a día da de alta socios/viviendas y
// gestiona la lista de espera, consejo directivo aprueba (ej: incorporar a
// alguien de la lista de espera como socio pleno), fiscal solo mira.
//
// "reclamos" (Reclamos y Mantenimiento, etapa habitada — ver moduloVisible()
// en Nav.tsx): a diferencia de compras, acá cualquier socio necesita poder
// reportar un problema de su vivienda o de un espacio común sin depender de
// que alguien de una comisión lo cargue por él, así que tiene "edit" (crear
// + ver) en vez de "read". Administración y la Comisión de Seguridad (o el
// técnico) son quienes día a día toman y resuelven los reclamos; consejo
// directivo aprueba/cierra con más alcance; el resto de las comisiones (que
// no tienen nada que ver con mantenimiento del edificio) solo miran.
const MATRIX: Record<Role, Record<Module, Access>> = {
  socio: { obra: "read", trabajo: "read", compras: "none", seguridad: "read", finanzas: "read", documentos: "read", auditoria: "none", comisiones: "read", socios: "read", reclamos: "edit" },
  comision_obra: { obra: "edit", trabajo: "read", compras: "edit", seguridad: "read", finanzas: "none", documentos: "read", auditoria: "none", comisiones: "edit", socios: "read", reclamos: "read" },
  comision_trabajo: { obra: "read", trabajo: "edit", compras: "edit", seguridad: "read", finanzas: "none", documentos: "read", auditoria: "none", comisiones: "edit", socios: "read", reclamos: "read" },
  comision_compras: { obra: "read", trabajo: "read", compras: "edit", seguridad: "read", finanzas: "read", documentos: "read", auditoria: "none", comisiones: "edit", socios: "read", reclamos: "read" },
  comision_seguridad: { obra: "read", trabajo: "read", compras: "edit", seguridad: "edit", finanzas: "none", documentos: "read", auditoria: "none", comisiones: "edit", socios: "read", reclamos: "edit" },
  administracion: { obra: "read", trabajo: "read", compras: "read", seguridad: "read", finanzas: "edit", documentos: "edit", auditoria: "none", comisiones: "edit", socios: "edit", reclamos: "edit" },
  tesoreria: { obra: "read", trabajo: "read", compras: "approve", seguridad: "read", finanzas: "approve", documentos: "read", auditoria: "read", comisiones: "read", socios: "read", reclamos: "read" },
  consejo_directivo: { obra: "approve", trabajo: "approve", compras: "approve", seguridad: "approve", finanzas: "approve", documentos: "edit", auditoria: "read", comisiones: "approve", socios: "approve", reclamos: "approve" },
  fiscal: { obra: "read", trabajo: "read", compras: "read", seguridad: "read", finanzas: "read", documentos: "read", auditoria: "read", comisiones: "read", socios: "read", reclamos: "read" },
  tecnico: { obra: "edit", trabajo: "read", compras: "read", seguridad: "edit", finanzas: "none", documentos: "read", auditoria: "none", comisiones: "read", socios: "read", reclamos: "edit" },
  admin: { obra: "config", trabajo: "config", compras: "config", seguridad: "config", finanzas: "config", documentos: "config", auditoria: "read", comisiones: "config", socios: "config", reclamos: "config" },
};

export function accessTo(role: Role, mod: Module): Access {
  return MATRIX[role]?.[mod] ?? "none";
}

export function canRead(role: Role, mod: Module) {
  return accessTo(role, mod) !== "none";
}
export function canEdit(role: Role, mod: Module) {
  return ["edit", "approve", "config"].includes(accessTo(role, mod));
}
export function canApprove(role: Role, mod: Module) {
  return ["approve", "config"].includes(accessTo(role, mod));
}

/**
 * Fase 4 del Prompt Maestro (arquitectura de permisos granulares,
 * REQUIREMENTS.md sección 5.4): resuelve un permiso "recurso.accion" (ej.
 * "documentos.edit") para un rol dado. A propósito NO consulta las tablas
 * `roles`/`permissions`/`role_permissions` (migración 0022) — esas tablas
 * son el catálogo/base para que a futuro una cooperativa pueda tener
 * permisos personalizados sin tocar código (ver REQUIREMENTS.md), pero
 * mientras ese caso no exista, cada chequeo de permiso granular tiene que
 * dar EXACTAMENTE el mismo resultado que ya dan canRead/canEdit/canApprove
 * hoy — cero riesgo de que un permiso granular quede desincronizado de la
 * matriz real que efectivamente se aplica. El seed de esas tablas (ver
 * scripts/generar-seed-permisos.mjs) se generó a partir de esta misma
 * MATRIX, así que ambos caminos concuerdan por construcción.
 */
export function tienePermiso(role: Role, permiso: string): boolean {
  const [recurso, accion] = permiso.split(".");
  if (!recurso || !accion) return false;
  const mod = recurso as Module;
  switch (accion) {
    case "read":
      return canRead(role, mod);
    case "edit":
      return canEdit(role, mod);
    case "approve":
      return canApprove(role, mod);
    case "config":
      return accessTo(role, mod) === "config";
    default:
      return false;
  }
}

/**
 * AUDITORÍA INTEGRAL (hallazgo de seguridad, 12/09): "reclamos" es el único
 * módulo donde "edit" significa dos cosas distintas según el rol — para
 * "socio" es "puede reportar un problema" (ver el comentario de la MATRIX de
 * arriba), para administracion/comision_seguridad/tecnico es "puede además
 * tomar y resolver reclamos". canEdit() por sí solo no distingue esto: un
 * socio que llame a tomarReclamoAction/resolverReclamoAction directamente
 * (sin pasar por la UI, que ya lo oculta) podía tomar o marcar como
 * "resuelto" cualquier reclamo, incluso ajeno, sin que nadie de
 * mantenimiento lo haya solucionado — se detectó tanto en el backend
 * (actions/reclamos.ts) como en la UI (reclamos/page.tsx) que faltaba esta
 * distinción. Esta función es la fuente única de verdad para "puede tomar o
 * resolver un reclamo" — cualquier otro lugar que necesite esa regla debe
 * usar esta función, no reimplementarla.
 */
export function puedeGestionarReclamos(role: Role) {
  return role !== "socio" && canEdit(role, "reclamos");
}

// Roles que pueden ver montos financieros detallados
export const ROLES_FINANZAS_DETALLE: Role[] = ["administracion", "tesoreria", "consejo_directivo", "fiscal", "admin"];
