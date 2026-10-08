/**
 * Comisiones como áreas de trabajo (05/10) — catálogo de FUNCIONES de
 * comisión, igual para todas las cooperativas.
 *
 * Una comisión sigue siendo un registro libre (nombre, descripción,
 * integrantes…), pero ahora además tiene una función que define:
 *  - en qué etapas de la cooperativa está disponible por defecto (ej. la
 *    Comisión de Trabajo sólo tiene sentido en etapa de obra);
 *  - qué herramientas propias suma a su página (ej. Trabajo → calendario de
 *    horas por núcleo). Las demás funciones irán sumando las suyas acá, sin
 *    tocar la estructura general de la comisión.
 *
 * Cada comisión puede pisar las etapas por defecto (columna
 * `comisiones.etapas`) — la regla es configurable, no está escrita para una
 * cooperativa en particular. Nunca se borra nada: una comisión fuera de su
 * etapa simplemente no se muestra como activa.
 */

export const ETAPAS_COOPERATIVA = ["pre_obra", "obra", "habitada"] as const;
export type EtapaCooperativa = (typeof ETAPAS_COOPERATIVA)[number];
export const ETAPA_LABEL: Record<EtapaCooperativa, string> = {
  pre_obra: "Pre-obra",
  obra: "Obra",
  habitada: "Habitada",
};

export const FUNCIONES_COMISION = [
  "trabajo",
  "compras",
  "seguridad",
  "obra",
  "administrativa",
  "fiscal",
  "electoral",
  "mantenimiento",
  "fomento",
  "general",
] as const;
export type FuncionComision = (typeof FUNCIONES_COMISION)[number];

/** Herramienta propia de una función: una pestaña extra en su página. */
export type HerramientaComision = { id: string; label: string };

type DefFuncion = {
  label: string;
  /** null = disponible en todas las etapas. */
  etapasDefault: EtapaCooperativa[] | null;
  herramientas: HerramientaComision[];
  /** Módulo existente de Coova con el que trabaja (link desde su página). */
  modulo?: { href: string; label: string };
};

/**
 * Fase 3B — cada función suma su panel propio (pestaña «Panel», ver
 * src/lib/panelesComision.ts). Agregar una función nueva = sumarla acá y
 * registrar su panel allá; la página de la comisión no cambia.
 */
const PANEL: HerramientaComision = { id: "panel", label: "Panel propio" };

export const FUNCION_COMISION: Record<FuncionComision, DefFuncion> = {
  trabajo: {
    label: "Trabajo",
    etapasDefault: ["obra"],
    herramientas: [{ id: "horas", label: "Horas de trabajo" }, PANEL],
    modulo: { href: "/trabajo", label: "Jornadas de trabajo" },
  },
  compras: {
    label: "Compras",
    etapasDefault: ["obra"],
    herramientas: [PANEL],
    modulo: { href: "/compras", label: "Compras" },
  },
  seguridad: {
    label: "Seguridad",
    etapasDefault: ["obra"],
    herramientas: [PANEL],
    modulo: { href: "/seguridad", label: "Seguridad" },
  },
  obra: {
    label: "Obra",
    etapasDefault: ["obra"],
    herramientas: [PANEL],
    modulo: { href: "/obra", label: "Avance de obra" },
  },
  administrativa: { label: "Administrativa", etapasDefault: null, herramientas: [PANEL], modulo: { href: "/documentos", label: "Documentos" } },
  fiscal: { label: "Fiscal", etapasDefault: null, herramientas: [PANEL], modulo: { href: "/fiscal", label: "Control fiscal" } },
  electoral: { label: "Electoral", etapasDefault: null, herramientas: [PANEL], modulo: { href: "/consejo-directivo", label: "Consejo y cargos" } },
  mantenimiento: { label: "Mantenimiento", etapasDefault: ["habitada"], herramientas: [PANEL], modulo: { href: "/reclamos", label: "Reclamos y mantenimiento" } },
  fomento: { label: "Fomento", etapasDefault: null, herramientas: [PANEL] },
  general: { label: "General", etapasDefault: null, herramientas: [PANEL] },
};

export function funcionDe(valor: string | null | undefined): FuncionComision {
  return (FUNCIONES_COMISION as readonly string[]).includes(valor || "") ? (valor as FuncionComision) : "general";
}

/** Etapas guardadas en la comisión ("pre_obra,obra") → lista válida, o null si usa el default. */
export function etapasPropias(valor: string | null | undefined): EtapaCooperativa[] | null {
  if (!valor) return null;
  const lista = valor
    .split(",")
    .map((e) => e.trim())
    .filter((e): e is EtapaCooperativa => (ETAPAS_COOPERATIVA as readonly string[]).includes(e));
  return lista.length ? lista : null;
}

/** Etapas en las que la comisión está disponible (null = todas). */
export function etapasDeComision(c: { funcion?: string | null; etapas?: string | null }): EtapaCooperativa[] | null {
  return etapasPropias(c.etapas) ?? FUNCION_COMISION[funcionDe(c.funcion)].etapasDefault;
}

/** ¿La comisión corresponde a la etapa actual de la cooperativa? */
export function comisionDisponibleEnEtapa(c: { funcion?: string | null; etapas?: string | null }, etapa: string): boolean {
  const etapas = etapasDeComision(c);
  return !etapas || (etapas as string[]).includes(etapa);
}

export function textoEtapas(c: { funcion?: string | null; etapas?: string | null }): string {
  const etapas = etapasDeComision(c);
  return etapas ? etapas.map((e) => ETAPA_LABEL[e]).join(", ") : "Todas las etapas";
}
