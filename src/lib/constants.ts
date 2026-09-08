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
