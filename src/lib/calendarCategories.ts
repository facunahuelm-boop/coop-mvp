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

export type CategoriaEvento = "comision" | "asamblea" | "reunion" | "obra" | "importante" | "personal";

export const CATEGORIAS_EVENTO = [
  "comision",
  "asamblea",
  "reunion",
  "obra",
  "importante",
  "personal",
] as const satisfies readonly CategoriaEvento[];

/** Etiqueta visible (con el emoji del pedido, para la leyenda y el <select>
 * de categoría del formulario de crear/editar evento). */
export const CATEGORIA_EVENTO_LABEL: Record<CategoriaEvento, string> = {
  comision: "🟢 Comisión",
  asamblea: "🔵 Asamblea",
  reunion: "🟡 Reunión",
  obra: "🟣 Obra",
  importante: "🔴 Importante",
  personal: "⚪ Personal",
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
};
export const CATEGORIA_EVENTO_COLOR_BG_VAR: Record<CategoriaEvento, string> = {
  comision: "--color-calendar-comision-bg",
  asamblea: "--color-calendar-asamblea-bg",
  reunion: "--color-calendar-reunion-bg",
  obra: "--color-calendar-obra-bg",
  importante: "--color-calendar-importante-bg",
  personal: "--color-calendar-personal-bg",
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

export function categoriaDeNota(valorGuardado: string): CategoriaEvento {
  if (esCategoria(valorGuardado)) return valorGuardado;
  return CATEGORIA_LEGACY[valorGuardado] ?? "personal";
}
