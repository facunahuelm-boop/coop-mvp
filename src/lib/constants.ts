import type { Module } from "@/lib/roles";

export const CHECKLIST_BASE = [
  "Uso de casco en obra",
  "Vallado de zonas de riesgo (excavaciones, huecos)",
  "Extintor accesible y señalizado",
  "Botiquín completo y accesible",
  "Señalización de riesgo eléctrico",
  "Andamios con amarre y plataforma completa",
  "Orden y limpieza de circulaciones",
];

/**
 * Fase D (punto 22 del rediseño): "Compras" ya no es sólo material de obra —
 * una cooperativa habitada también compra (mantenimiento, administración,
 * espacios comunes). Esto clasifica cada solicitud; no reemplaza a
 * "Comisión solicitante" (quién la pide), sólo dice para qué es.
 *
 * Fase 1 del rediseño de Compras (pedido explícito, sección 2): se agregan
 * "seguridad" y "servicios" — dos rubros reales que una cooperativa compra
 * seguido (EPP/señalización/extintores; electricidad/sanitaria/transporte
 * contratados) y que antes cadían todos en "Otros". A propósito NO se
 * explota esto en decenas de categorías rígidas (cemento, guantes, cascos,
 * etc.) — el pedido pide expresamente evitarlo; ese nivel de detalle va en
 * el campo libre "subcategoria" (migración 0025), no acá. Los 6 valores
 * existentes NO se tocan (renombrarlos rompería solicitudes y gastos ya
 * guardados con ese valor).
 */
export const CATEGORIA_COMPRA_LABEL: Record<string, string> = {
  general: "Compra general",
  obra: "Compra de obra",
  mantenimiento: "Mantenimiento",
  administracion: "Administración",
  espacios_comunes: "Espacios comunes",
  seguridad: "Seguridad",
  servicios: "Servicios",
  otros: "Otros",
};

/**
 * Reclamos y Mantenimiento (etapa habitada — ver moduloVisible() en Nav.tsx):
 * categoriza el problema reportado, no reemplaza la vivienda/espacio común
 * (eso es un campo aparte, opcional).
 */
export const CATEGORIA_RECLAMO_LABEL: Record<string, string> = {
  filtracion: "Filtración / humedad",
  electricidad: "Electricidad",
  plomeria: "Plomería",
  espacios_comunes: "Espacios comunes",
  estructura: "Estructura / mampostería",
  otros: "Otros",
};

export const PRIORIDAD_RECLAMO_LABEL: Record<string, string> = {
  baja: "Baja",
  media: "Media",
  alta: "Alta",
};

/**
 * Fase 5, Sub-fase 5.4 ("Soporte", sección 22, migración 0040): categoriza un
 * ticket de soporte hacia la plataforma — no confundir con
 * CATEGORIA_RECLAMO_LABEL, que es para problemas físicos/edilicios de la
 * propia cooperativa (ver Reclamos y Mantenimiento).
 */
export const CATEGORIA_TICKET_LABEL: Record<string, string> = {
  consulta: "Consulta",
  error: "Reportar un error",
  otro: "Otro",
};

export const ESTADO_TICKET_LABEL: Record<string, string> = {
  abierto: "Abierto",
  en_proceso: "En proceso",
  resuelto: "Resuelto",
};

/**
 * Proveedores fijos vs. nuevos/a presupuestar (pedido explícito). Viven acá
 * (y no en actions/proveedores.ts) porque un archivo "use server" solo puede
 * exportar funciones async — un array/objeto exportado desde ahí rompe el
 * build ("A 'use server' file can only export async functions").
 */
export const ESTADO_PROVEEDOR = ["nuevo", "habitual", "en_evaluacion", "inactivo"] as const;
export const ESTADO_PROVEEDOR_LABEL: Record<(typeof ESTADO_PROVEEDOR)[number], string> = {
  nuevo: "Nuevo / a presupuestar",
  habitual: "Habitual",
  en_evaluacion: "En evaluación",
  inactivo: "Inactivo",
};
export const TIPO_PROVEEDOR = ["empresa", "persona_fisica"] as const;
export const TIPO_PROVEEDOR_LABEL: Record<(typeof TIPO_PROVEEDOR)[number], string> = {
  empresa: "Empresa",
  persona_fisica: "Persona física",
};

/**
 * Padrón de Socios y Núcleos (pedido explícito): relación de cada integrante
 * con el titular del núcleo. Misma razón que ESTADO_PROVEEDOR de arriba para
 * vivir en constants.ts y no en actions/socios.ts.
 */
export const RELACION_INTEGRANTE = [
  "titular",
  "pareja",
  "hijo",
  "hija",
  "padre",
  "madre",
  "hermano",
  "hermana",
  "otro",
] as const;
export const RELACION_INTEGRANTE_LABEL: Record<(typeof RELACION_INTEGRANTE)[number], string> = {
  titular: "Titular",
  pareja: "Pareja",
  hijo: "Hijo",
  hija: "Hija",
  padre: "Padre",
  madre: "Madre",
  hermano: "Hermano",
  hermana: "Hermana",
  otro: "Otro",
};
export const TIPO_INTEGRANTE = ["adulto", "menor"] as const;
export const ESTADO_INTEGRANTE = ["activo", "inactivo"] as const;

/**
 * Fase 6, Sub-fase 6.2 ("Reportes", sección 31): metadata de los 6 tipos de
 * reporte que gestiona el hub /reportes (src/app/(app)/reportes/page.tsx +
 * src/lib/actions/reportes.ts). Vive acá y no en actions/reportes.ts porque
 * un archivo "use server" solo puede exportar funciones async (mismo motivo
 * que CATEGORIA_COMPRA_LABEL más arriba) — y se necesita como dato plano en
 * 3 lugares que antes no compartían ninguna fuente de verdad: la propia
 * página (para armar las tarjetas y para filtrar "Reportes recientes" por
 * los módulos que la persona puede leer), la ruta de descarga
 * /api/archivos/reporte/[id] (para decidir quién puede descargar según su
 * permiso de MÓDULO en vez de "solo quien lo generó" — la Sub-fase 6.2
 * cambia ese criterio a propósito, ver el comentario en esa ruta) y
 * actions/reportes.ts. Los otros tipos que ya vivían en reportes_generados
 * antes de esta sub-fase (informe_fiscal, libro_actas_<organo>,
 * registro_socios) NO están acá a propósito: pertenecen a otras pantallas
 * (Panel Fiscal, Libro de Actas) con su propia ruta de descarga y su propio
 * criterio de acceso — no deben aparecer ni ser descargables desde este hub.
 */
export const REPORTES_HUB: { tipo: string; modulo: Module; nombre: string; descripcion: string; icon: string }[] = [
  { tipo: "obra", modulo: "obra", nombre: "Reporte de Obra", descripcion: "Resumen mensual del avance de la obra, tareas completadas, problemas y cronograma", icon: "🏗️" },
  { tipo: "finanzas", modulo: "finanzas", nombre: "Reporte Financiero", descripcion: "Estado de ingresos, egresos, presupuesto vs real y proyecciones", icon: "💰" },
  { tipo: "trabajo", modulo: "trabajo", nombre: "Reporte de Jornadas", descripcion: "Asistencias, horas acumuladas por núcleo, distribución de tareas", icon: "🤝" },
  { tipo: "compras", modulo: "compras", nombre: "Reporte de Compras", descripcion: "Gastos por comisión, solicitudes de compra y estado de proveedores", icon: "🛒" },
  { tipo: "socios", modulo: "socios", nombre: "Reporte de Padrón de Socios", descripcion: "Núcleos, viviendas, estado de cada socio y lista de espera", icon: "🏘️" },
  { tipo: "comisiones", modulo: "comisiones", nombre: "Reporte de Solicitudes y Decisiones", descripcion: "Solicitudes entre comisiones y decisiones tomadas, con su estado", icon: "📋" },
];

export type TipoReporteHub = (typeof REPORTES_HUB)[number]["tipo"];

export function moduloDeReporteHub(tipo: string): Module | null {
  return REPORTES_HUB.find((r) => r.tipo === tipo)?.modulo ?? null;
}
