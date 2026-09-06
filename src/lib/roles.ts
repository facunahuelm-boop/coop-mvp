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

export type Module = "obra" | "trabajo" | "compras" | "seguridad" | "finanzas" | "documentos" | "auditoria" | "comisiones" | "socios";

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
const MATRIX: Record<Role, Record<Module, Access>> = {
  socio: { obra: "read", trabajo: "read", compras: "none", seguridad: "read", finanzas: "read", documentos: "read", auditoria: "none", comisiones: "read", socios: "read" },
  comision_obra: { obra: "edit", trabajo: "read", compras: "edit", seguridad: "read", finanzas: "none", documentos: "read", auditoria: "none", comisiones: "edit", socios: "read" },
  comision_trabajo: { obra: "read", trabajo: "edit", compras: "edit", seguridad: "read", finanzas: "none", documentos: "read", auditoria: "none", comisiones: "edit", socios: "read" },
  comision_compras: { obra: "read", trabajo: "read", compras: "edit", seguridad: "read", finanzas: "read", documentos: "read", auditoria: "none", comisiones: "edit", socios: "read" },
  comision_seguridad: { obra: "read", trabajo: "read", compras: "edit", seguridad: "edit", finanzas: "none", documentos: "read", auditoria: "none", comisiones: "edit", socios: "read" },
  administracion: { obra: "read", trabajo: "read", compras: "read", seguridad: "read", finanzas: "edit", documentos: "edit", auditoria: "none", comisiones: "edit", socios: "edit" },
  tesoreria: { obra: "read", trabajo: "read", compras: "approve", seguridad: "read", finanzas: "approve", documentos: "read", auditoria: "read", comisiones: "read", socios: "read" },
  consejo_directivo: { obra: "approve", trabajo: "approve", compras: "approve", seguridad: "approve", finanzas: "approve", documentos: "edit", auditoria: "read", comisiones: "approve", socios: "approve" },
  fiscal: { obra: "read", trabajo: "read", compras: "read", seguridad: "read", finanzas: "read", documentos: "read", auditoria: "read", comisiones: "read", socios: "read" },
  tecnico: { obra: "edit", trabajo: "read", compras: "read", seguridad: "edit", finanzas: "none", documentos: "read", auditoria: "none", comisiones: "read", socios: "read" },
  admin: { obra: "config", trabajo: "config", compras: "config", seguridad: "config", finanzas: "config", documentos: "config", auditoria: "read", comisiones: "config", socios: "config" },
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

// Roles que pueden ver montos financieros detallados
export const ROLES_FINANZAS_DETALLE: Role[] = ["administracion", "tesoreria", "consejo_directivo", "fiscal", "admin"];
