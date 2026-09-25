/**
 * Rediseño del Calendario (15/09, pedido explícito): categorías de evento
 * centralizadas — antes cada uno de `MonthCalendar.tsx`, `dashboard/page.tsx`
 * y `calendario/page.tsx` definía su PROPIO mapa de tipo→color/etiqueta
 * (`TIPO_COLOR_DOT`/`TIPO_LABEL`/`TIPO_COLOR`), triplicado a mano y sin
 * garantía de que los 3 coincidieran. Este archivo es la única fuente de
 * verdad: los 3 lugares (y cualquier otro que necesite mostrar un evento del
 * calendario) importan de acá.
 *
 * Los colores son ALIAS de los tokens que ya existían (`globals.css`) — no
 * se inventó ninguno nuevo, para no romper la paleta coherente del sistema
 * ("colores suaves y elegantes, no fluorescentes" — pedido explícito).
 */

/**
 * Rediseño del Calendario, Etapa 1 (25/09, pedido explícito): se agregan 6
 * categorías nuevas (pago, tarea, mantenimiento, seguridad, evento, general)
 * para la "actividad" enriquecida (antes "nota de calendario", ver
 * calendarioNotas.ts) — comision/asamblea/reunion se siguen usando igual que
 * antes. "obra"/"importante"/"personal" quedan como categorías LEGACY: ya no
 * se ofrecen como opción nueva (ver CATEGORIAS_ACTIVIDAD más abajo, el
 * catálogo real del <select>), pero siguen existiendo acá para que una nota
 * vieja que las tenga guardadas se siga viendo bien sin necesitar ninguna
 * migración de datos — mismo criterio que CATEGORIA_LEGACY más abajo.
 */
export type CategoriaEvento =
  | "comision"
  | "asamblea"
  | "reunion"
  | "obra"
  | "importante"
  | "personal"
  | "pago"
  | "tarea"
  | "mantenimiento"
  | "seguridad"
  | "evento"
  | "general"
  | "personalizada";

export const CATEGORIAS_EVENTO = [
  "comision",
  "asamblea",
  "reunion",
  "obra",
  "importante",
  "personal",
  "pago",
  "tarea",
  "mantenimiento",
  "seguridad",
  "personalizada",
  "evento",
  "general",
] as const satisfies readonly CategoriaEvento[];

/** Catálogo REAL que ofrece el <select> de "Tipo" al crear/editar una
 * actividad (punto 8 del pedido) — a propósito no es CATEGORIAS_EVENTO
 * completo: "obra"/"importante"/"personal" son conceptos legacy (ver el
 * comentario de arriba), no algo que alguien elija de cero hoy. "personal"
 * en particular queda reemplazado por "general" + "personalizada" + dejar el
 * campo vacío (= sin categoría, ver calendarioNotas.ts). */
export const CATEGORIAS_ACTIVIDAD = [
  "comision",
  "reunion",
  "asamblea",
  "pago",
  "tarea",
  "mantenimiento",
  "seguridad",
  "evento",
  "general",
  "personalizada",
] as const;
export type CategoriaActividad = (typeof CATEGORIAS_ACTIVIDAD)[number];

/** Los 7 colores elegibles para una actividad de categoría "personalizada"
 * (punto 7 del pedido, textual: "Verde, Azul, Violeta, Amarillo, Naranja,
 * Rojo, Gris") — se guardan en notas_calendario.color_personalizado. */
export const COLORES_PERSONALIZADOS = ["verde", "azul", "violeta", "amarillo", "naranja", "rojo", "gris"] as const;
export type ColorPersonalizado = (typeof COLORES_PERSONALIZADOS)[number];

export const COLOR_PERSONALIZADO_LABEL: Record<ColorPersonalizado, string> = {
  verde: "🟢 Verde",
  azul: "🔵 Azul",
  violeta: "🟣 Violeta",
  amarillo: "🟡 Amarillo",
  naranja: "🟠 Naranja",
  rojo: "🔴 Rojo",
  gris: "⚪ Gris",
};
export const COLOR_PERSONALIZADO_VAR: Record<ColorPersonalizado, string> = {
  verde: "--color-verde",
  azul: "--accent-blue",
  violeta: "--accent-violet",
  amarillo: "--color-amarillo",
  naranja: "--color-naranja",
  rojo: "--color-rojo",
  gris: "--color-ink-muted",
};
export const COLOR_PERSONALIZADO_BG_VAR: Record<ColorPersonalizado, string> = {
  verde: "--color-verde-bg",
  azul: "--accent-blue-bg",
  violeta: "--accent-violet-bg",
  amarillo: "--color-amarillo-bg",
  naranja: "--color-naranja-bg",
  rojo: "--color-rojo-bg",
  gris: "--color-border",
};

/** Etiqueta visible (con el emoji del pedido, para la leyenda y el <select>
 * de categoría del formulario de crear/editar evento). */
export const CATEGORIA_EVENTO_LABEL: Record<CategoriaEvento, string> = {
  comision: "🟢 Comisión",
  asamblea: "🔵 Asamblea",
  reunion: "🟡 Reunión",
  obra: "🟣 Obra",
  importante: "🔴 Importante",
  personal: "⚪ Personal",
  pago: "🟠 Pago / vencimiento",
  tarea: "🟣 Tarea",
  mantenimiento: "🔧 Mantenimiento",
  seguridad: "🔴 Seguridad",
  evento: "⚪ Evento",
  general: "⚪ General",
  personalizada: "🎨 Personalizada",
};

/** Sólo el nombre, sin emoji — para lugares donde el emoji ya se muestra
 * aparte (ej. el puntito de color de la leyenda). */
export const CATEGORIA_EVENTO_NOMBRE: Record<CategoriaEvento, string> = {
  comision: "Comisión",
  asamblea: "Asamblea",
  reunion: "Reunión",
  obra: "Obra",
  importante: "Importante",
  personal: "Personal",
  pago: "Pago / vencimiento",
  tarea: "Tarea",
  mantenimiento: "Mantenimiento",
  seguridad: "Seguridad",
  evento: "Evento",
  general: "General",
  personalizada: "Personalizada",
};

/** Nombre de las variables CSS (ver globals.css) para el color de texto/dot y
 * su fondo suave, una categoría por fila. */
export const CATEGORIA_EVENTO_COLOR_VAR: Record<CategoriaEvento, string> = {
  comision: "--color-calendar-comision",
  asamblea: "--color-calendar-asamblea",
  reunion: "--color-calendar-reunion",
  obra: "--color-calendar-obra",
  importante: "--color-calendar-importante",
  personal: "--color-calendar-personal",
  pago: "--color-calendar-pago",
  tarea: "--color-calendar-tarea",
  mantenimiento: "--color-calendar-mantenimiento",
  seguridad: "--color-calendar-seguridad",
  evento: "--color-calendar-evento",
  general: "--color-calendar-general",
  // Placeholder — una actividad "personalizada" en la práctica siempre se
  // pinta con COLOR_PERSONALIZADO_VAR[colorPersonalizado] (ver
  // colorVarDeActividad() más abajo), nunca con esto; queda acá sólo para que
  // este Record siga siendo exhaustivo sobre CategoriaEvento.
  personalizada: "--color-calendar-general",
};
export const CATEGORIA_EVENTO_COLOR_BG_VAR: Record<CategoriaEvento, string> = {
  comision: "--color-calendar-comision-bg",
  asamblea: "--color-calendar-asamblea-bg",
  reunion: "--color-calendar-reunion-bg",
  obra: "--color-calendar-obra-bg",
  importante: "--color-calendar-importante-bg",
  personal: "--color-calendar-personal-bg",
  pago: "--color-calendar-pago-bg",
  tarea: "--color-calendar-tarea-bg",
  mantenimiento: "--color-calendar-mantenimiento-bg",
  seguridad: "--color-calendar-seguridad-bg",
  evento: "--color-calendar-evento-bg",
  general: "--color-calendar-general-bg",
  personalizada: "--color-calendar-general-bg", // ver comentario de arriba
};

function esCategoria(valor: string): valor is CategoriaEvento {
  return (CATEGORIAS_EVENTO as readonly string[]).includes(valor);
}

/**
 * Los eventos de SOLO LECTURA que arma el calendario vienen de 5 tablas
 * distintas de otros módulos (reuniones, jornadas_trabajo, tareas_obra,
 * compromisos_futuros, documentos_seguridad) — cada página les asigna un
 * `tipo` según de qué tabla salieron (ver dashboard/page.tsx y
 * calendario/page.tsx). Acá se traduce ese `tipo` a una de las 6 categorías
 * visuales del rediseño, en un solo lugar.
 */
export function categoriaDeTipoEvento(tipo: string): CategoriaEvento {
  switch (tipo) {
    case "asamblea":
      return "asamblea";
    case "reunion":
      return "reunion";
    case "jornada":
      return "comision"; // jornada de trabajo = actividad de la Comisión de Trabajo
    case "obra":
      return "obra";
    case "finanzas":
    case "seguridad":
      return "importante"; // vencimientos (compromiso futuro / documento de seguridad)
    default:
      return "personal";
  }
}

/**
 * `notas_calendario.color` guardaba, antes de este rediseño, uno de 5
 * valores viejos ("brand"|"verde"|"amarillo"|"rojo"|"gray" — la paleta de
 * `<Badge>`, ver ui.tsx). Para NO necesitar una migración de datos (pedido
 * explícito: "evitar migraciones innecesarias"), las notas ya guardadas con
 * un valor viejo se siguen leyendo bien vía este mapeo — y en cuanto alguien
 * las edite y guarde de nuevo, quedan con una de las 6 categorías nuevas
 * (ver `notaSchema` en calendarioNotas.ts, que ya sólo ACEPTA las 6 nuevas
 * al guardar). La columna sigue llamándose "color" en la base — se la trata
 * como "categoría" desde el código para no requerir un ALTER/rename.
 */
const CATEGORIA_LEGACY: Record<string, CategoriaEvento> = {
  brand: "personal",
  verde: "comision",
  amarillo: "reunion",
  rojo: "importante",
  gray: "personal",
};

/**
 * Rediseño del Calendario, Etapa 1 (25/09): `valorGuardado` ahora puede ser
 * `null` — la migración 0042 permite que "color" (= categoría) quede sin
 * cargar, porque el pedido exige que la categoría sea opcional (punto 8:
 * "algunas cosas simplemente necesitan existir en el calendario sin
 * pertenecer a un módulo específico"). `null` se devuelve tal cual (en vez de
 * caer en "personal" como hacía antes cualquier valor no reconocido) para
 * que quien renderiza pueda mostrar "Sin categoría" en vez de confundirlo con
 * la categoría "General", que sí es una elección activa.
 */
export function categoriaDeNota(valorGuardado: string | null): CategoriaEvento | null {
  if (valorGuardado === null || valorGuardado === "") return null;
  if (esCategoria(valorGuardado)) return valorGuardado;
  return CATEGORIA_LEGACY[valorGuardado] ?? "personal";
}

/** Nombre para mostrar de la categoría de una actividad, incluyendo el caso
 * `null` ("Sin categoría") — ver categoriaDeNota(). */
export function nombreCategoriaActividad(categoria: CategoriaEvento | null): string {
  return categoria === null ? "Sin categoría" : CATEGORIA_EVENTO_NOMBRE[categoria];
}

/** Variables CSS de color para una categoría, incluyendo el caso `null`
 * ("Sin categoría" se pinta igual que "General" — ambas son gris neutro,
 * ver globals.css). */
export function colorVarDeCategoria(categoria: CategoriaEvento | null): string {
  return categoria === null ? "--color-calendar-general" : CATEGORIA_EVENTO_COLOR_VAR[categoria];
}
export function colorBgVarDeCategoria(categoria: CategoriaEvento | null): string {
  return categoria === null ? "--color-calendar-general-bg" : CATEGORIA_EVENTO_COLOR_BG_VAR[categoria];
}

/**
 * Variables CSS de color REALES para una actividad ya guardada — a
 * diferencia de colorVarDeCategoria()/colorBgVarDeCategoria(), acá sí se
 * tiene en cuenta el caso "personalizada": si la categoría es "personalizada"
 * y tiene un color elegido (notas_calendario.color_personalizado), se usa ese
 * color en vez del gris genérico del Record de arriba. Si es "personalizada"
 * pero por algún motivo no tiene color guardado (no debería pasar si el
 * formulario exige elegir uno, pero una fila vieja podría no tenerlo), cae al
 * gris genérico como cualquier otra categoría sin color propio.
 */
export function colorVarDeActividad(categoria: CategoriaEvento | null, colorPersonalizado: string | null): string {
  if (categoria === "personalizada" && colorPersonalizado && colorPersonalizado in COLOR_PERSONALIZADO_VAR) {
    return COLOR_PERSONALIZADO_VAR[colorPersonalizado as ColorPersonalizado];
  }
  return colorVarDeCategoria(categoria);
}
export function colorBgVarDeActividad(categoria: CategoriaEvento | null, colorPersonalizado: string | null): string {
  if (categoria === "personalizada" && colorPersonalizado && colorPersonalizado in COLOR_PERSONALIZADO_BG_VAR) {
    return COLOR_PERSONALIZADO_BG_VAR[colorPersonalizado as ColorPersonalizado];
  }
  return colorBgVarDeCategoria(categoria);
}

/**
 * Recordatorio (punto 21 del pedido): en esta Etapa 1 sólo se guarda la
 * preferencia — todavía no dispara ningún aviso real (decisión confirmada con
 * el usuario; el disparo real vía Vercel Cron queda para una etapa aparte de
 * este mismo rediseño, ver notas_calendario.recordatorio, migración 0042).
 */
export const RECORDATORIO_OPCIONES = ["ninguno", "5min", "15min", "30min", "1hora", "1dia"] as const;
export type RecordatorioOpcion = (typeof RECORDATORIO_OPCIONES)[number];
export const RECORDATORIO_LABEL: Record<RecordatorioOpcion, string> = {
  ninguno: "Sin recordatorio",
  "5min": "5 minutos antes",
  "15min": "15 minutos antes",
  "30min": "30 minutos antes",
  "1hora": "1 hora antes",
  "1dia": "1 día antes",
};
