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
 */
export const CATEGORIA_COMPRA_LABEL: Record<string, string> = {
  general: "Compra general",
  obra: "Compra de obra",
  mantenimiento: "Mantenimiento",
  administracion: "Administración",
  espacios_comunes: "Espacios comunes",
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
