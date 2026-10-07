import type { EtapaCooperativa, FuncionComision } from "@/lib/comisionesFunciones";

/**
 * Fase 2H — plantillas de alta de una cooperativa (plan, 12): según la
 * modalidad y la etapa, precargan las comisiones sugeridas, algunos valores
 * del reglamento y las plantillas de texto. Nada automático se prende: los
 * valores de cuotas, recargos y avisos quedan apagados hasta que la
 * cooperativa los revise.
 */

export type Modalidad = "ayuda_mutua" | "ahorro_previo";
export const MODALIDAD_LABEL: Record<Modalidad, string> = { ayuda_mutua: "Ayuda mutua", ahorro_previo: "Ahorro previo" };

export type ComisionSugerida = { nombre: string; funcion: FuncionComision; descripcion: string };
export type PlantillaAlta = {
  clave: string;
  nombre: string;
  descripcion: string;
  modalidad: Modalidad;
  etapa: EtapaCooperativa;
  comisiones: ComisionSugerida[];
  /** Valores del reglamento (sólo se cargan si la cooperativa todavía no los tiene). */
  reglamento: Record<string, string>;
  /** Pre-obra: cargar los pasos típicos de los trámites. */
  hitos: boolean;
  /** Módulos que no aplican (ej. horas de ayuda mutua en ahorro previo). */
  ocultar: string[];
};

const ADMINISTRATIVA: ComisionSugerida = { nombre: "Comisión Administrativa", funcion: "administrativa", descripcion: "Padrón, correspondencia, libros y documentación." };
const FOMENTO: ComisionSugerida = { nombre: "Comisión de Fomento", funcion: "general", descripcion: "Actividades, integración y comunicación con los socios." };
const TRABAJO: ComisionSugerida = { nombre: "Comisión de Trabajo", funcion: "trabajo", descripcion: "Organiza las horas de ayuda mutua y la asistencia a la obra." };
const COMPRAS: ComisionSugerida = { nombre: "Comisión de Compras", funcion: "compras", descripcion: "Pide presupuestos, compara y sigue las compras." };
const SEGURIDAD: ComisionSugerida = { nombre: "Comisión de Seguridad", funcion: "seguridad", descripcion: "Seguridad en la obra, elementos de protección e incidentes." };
const MANTENIMIENTO: ComisionSugerida = { nombre: "Comisión de Mantenimiento", funcion: "general", descripcion: "Reclamos, mantenimiento preventivo y el fondo de mantenimiento." };

export const PLANTILLAS_ALTA: PlantillaAlta[] = [
  {
    clave: "ayuda_mutua_pre_obra",
    nombre: "Ayuda mutua – Pre-obra",
    descripcion: "Cooperativa que todavía está con trámites, terreno y proyecto.",
    modalidad: "ayuda_mutua",
    etapa: "pre_obra",
    comisiones: [ADMINISTRATIVA, FOMENTO],
    reglamento: { horas_justificadas: "no_generan_deuda", horas_a_favor: "acumulan" },
    hitos: true,
    ocultar: [],
  },
  {
    clave: "ayuda_mutua_obra",
    nombre: "Ayuda mutua – Obra",
    descripcion: "Cooperativa construyendo, con horas de ayuda mutua.",
    modalidad: "ayuda_mutua",
    etapa: "obra",
    comisiones: [ADMINISTRATIVA, TRABAJO, COMPRAS, SEGURIDAD, FOMENTO],
    reglamento: { horas_justificadas: "no_generan_deuda", horas_a_favor: "acumulan" },
    hitos: false,
    ocultar: [],
  },
  {
    clave: "ahorro_previo",
    nombre: "Ahorro previo",
    descripcion: "Los socios ahorran y la obra la hace una empresa (sin horas de ayuda mutua).",
    modalidad: "ahorro_previo",
    etapa: "pre_obra",
    comisiones: [ADMINISTRATIVA, COMPRAS, FOMENTO],
    reglamento: {},
    hitos: true,
    ocultar: ["trabajo"],
  },
  {
    clave: "habitada",
    nombre: "Habitada",
    descripcion: "Cooperativa con las viviendas terminadas y habitadas.",
    modalidad: "ayuda_mutua",
    etapa: "habitada",
    comisiones: [ADMINISTRATIVA, MANTENIMIENTO, FOMENTO],
    reglamento: {},
    hitos: false,
    ocultar: [],
  },
];

export function plantillaAlta(clave: string): PlantillaAlta | undefined {
  return PLANTILLAS_ALTA.find((p) => p.clave === clave);
}

/** Comisiones sugeridas para una etapa (las de la plantilla que corresponde). */
export function comisionesSugeridas(modalidad: Modalidad, etapa: EtapaCooperativa): ComisionSugerida[] {
  if (etapa === "habitada") return plantillaAlta("habitada")!.comisiones;
  if (modalidad === "ahorro_previo") return plantillaAlta("ahorro_previo")!.comisiones;
  return plantillaAlta(etapa === "obra" ? "ayuda_mutua_obra" : "ayuda_mutua_pre_obra")!.comisiones;
}

/** Plantillas de texto que se cargan al dar de alta (con variables). */
export const PLANTILLAS_TEXTO_BASE: { nombre: string; categoria: "constancia" | "nota" | "convocatoria"; cuerpo: string }[] = [
  {
    nombre: "Constancia de socio",
    categoria: "constancia",
    cuerpo:
      "La {cooperativa} deja constancia de que {socio}, cédula de identidad {documento}, es socio/a de esta cooperativa desde el {fecha_ingreso}, integrando el {nucleo}.\n\nSe expide la presente a pedido del interesado/a, en {lugar}, el {fecha}.",
  },
  {
    nombre: "Constancia de estar al día",
    categoria: "constancia",
    cuerpo:
      "La {cooperativa} deja constancia de que {socio}, cédula de identidad {documento}, no registra cuotas sociales vencidas a la fecha.\n\nSe expide la presente a pedido del interesado/a, el {fecha}.",
  },
  {
    nombre: "Nota a un organismo",
    categoria: "nota",
    cuerpo: "Señores:\n\nPor la presente, la {cooperativa} se dirige a ustedes a efectos de …\n\nSin otro particular, saludamos atentamente.\n\n{fecha}",
  },
  {
    nombre: "Convocatoria a asamblea",
    categoria: "convocatoria",
    cuerpo:
      "La {cooperativa} convoca a sus socios a la Asamblea que se realizará el día … a la hora …, en …, para tratar el siguiente orden del día:\n\n1. …\n2. …\n\n{fecha}",
  },
];

/** Variables disponibles en las plantillas de texto. */
export const VARIABLES_PLANTILLA: { clave: string; texto: string }[] = [
  { clave: "cooperativa", texto: "Nombre de la cooperativa" },
  { clave: "socio", texto: "Nombre del socio" },
  { clave: "documento", texto: "Cédula del socio" },
  { clave: "nucleo", texto: "Núcleo del socio" },
  { clave: "fecha_ingreso", texto: "Fecha de ingreso del socio" },
  { clave: "monto", texto: "Monto (se escribe al generar)" },
  { clave: "fecha", texto: "Fecha de hoy" },
  { clave: "lugar", texto: "Lugar (se escribe al generar)" },
];

/** Reemplaza {variable} por su valor; las que no tienen valor quedan como «…». */
export function completarPlantilla(cuerpo: string, valores: Record<string, string | null | undefined>): string {
  return cuerpo.replace(/\{([a-z_]+)\}/g, (_m, clave: string) => {
    const v = valores[clave];
    return v === undefined || v === null || v === "" ? "…" : v;
  });
}
