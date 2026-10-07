/** Fase 2E — textos de trámites e hitos (los usan también las pantallas). */

export const ESTADO_HITO_LABEL: Record<string, string> = {
  pendiente: "Pendiente",
  en_curso: "En curso",
  hecho: "Hecho",
  trabado: "Trabado",
  no_aplica: "No corresponde",
};
export const ESTADO_HITO_COLOR: Record<string, "gray" | "azul" | "verde" | "rojo" | "amarillo"> = {
  pendiente: "gray",
  en_curso: "azul",
  hecho: "verde",
  trabado: "rojo",
  no_aplica: "gray",
};
export const CATEGORIA_HITO_LABEL: Record<string, string> = {
  personeria: "Personería jurídica",
  terreno: "Terreno",
  proyecto: "Proyecto",
  prestamo: "Préstamo",
  permisos: "Permisos",
  obra: "Obra",
  otro: "Otro",
};

/** Pasos típicos de una cooperativa de vivienda en Uruguay (se pueden cambiar o quitar). */
export const PLANTILLA_HITOS: { titulo: string; categoria: string; descripcion: string }[] = [
  { titulo: "Estatuto aprobado y personería jurídica", categoria: "personeria", descripcion: "Asamblea constitutiva, estatuto y reconocimiento de la personería." },
  { titulo: "Inscripción en los registros públicos", categoria: "personeria", descripcion: "Registro de cooperativas y organismos que correspondan." },
  { titulo: "Contrato con el Instituto de Asistencia Técnica (IAT)", categoria: "proyecto", descripcion: "Elección del equipo técnico y firma del contrato." },
  { titulo: "Terreno conseguido", categoria: "terreno", descripcion: "Búsqueda, adjudicación o compra del terreno." },
  { titulo: "Anteproyecto", categoria: "proyecto", descripcion: "Primer diseño de las viviendas, aprobado por la cooperativa." },
  { titulo: "Proyecto ejecutivo", categoria: "proyecto", descripcion: "Planos y metrajes completos para presentar." },
  { titulo: "Permiso de construcción", categoria: "permisos", descripcion: "Trámite ante la Intendencia." },
  { titulo: "Presentación para el préstamo", categoria: "prestamo", descripcion: "Carpeta presentada para el financiamiento." },
  { titulo: "Préstamo otorgado", categoria: "prestamo", descripcion: "Sorteo o priorización y aprobación del préstamo." },
  { titulo: "Firma del préstamo", categoria: "prestamo", descripcion: "Escritura y firma del contrato de préstamo." },
  { titulo: "Inicio de obra", categoria: "obra", descripcion: "¡Empieza la construcción!" },
];
