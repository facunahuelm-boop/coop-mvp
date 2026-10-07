/**
 * Fase 2C — ciclo de vida del socio (plan, 8.5). Sin dependencias del
 * servidor: lo usan también las pantallas.
 *
 * aspirante → activo → suspendido → renunciante → excluido / egresado.
 * "inactivo" y "baja" son los estados de antes: se siguen mostrando bien,
 * pero ya no se ofrecen para elegir.
 */

export const ESTADOS_SOCIO = ["aspirante", "activo", "suspendido", "renunciante", "excluido", "egresado", "inactivo", "baja"] as const;
export type EstadoSocio = (typeof ESTADOS_SOCIO)[number];
/** Los que se pueden elegir hoy. */
export const ESTADOS_ELEGIBLES: EstadoSocio[] = ["aspirante", "activo", "suspendido", "renunciante", "excluido", "egresado"];

export const ESTADO_SOCIO_INFO: Record<EstadoSocio, { label: string; color: "verde" | "amarillo" | "rojo" | "gray" | "azul" | "naranja" | "brand"; explicacion: string }> = {
  aspirante: { label: "Aspirante", color: "azul", explicacion: "Está en proceso de ingreso: todavía no es socio pleno ni paga cuotas." },
  activo: { label: "Activo", color: "verde", explicacion: "Socio con todos sus derechos y obligaciones." },
  suspendido: { label: "Suspendido", color: "naranja", explicacion: "Sanción por un tiempo: sigue pagando cuotas y debiendo horas, pero no vota." },
  renunciante: { label: "Renunciante", color: "amarillo", explicacion: "Presentó la renuncia y está en trámite de salida. Sigue con sus obligaciones hasta que egresa." },
  excluido: { label: "Excluido", color: "rojo", explicacion: "La cooperativa resolvió excluirlo. Ya no es socio." },
  egresado: { label: "Egresado", color: "gray", explicacion: "Salió de la cooperativa (renuncia aceptada o fin del trámite)." },
  inactivo: { label: "Inactivo", color: "amarillo", explicacion: "Estado anterior del sistema." },
  baja: { label: "Dado de baja", color: "gray", explicacion: "Estado anterior del sistema." },
};

/** Ya no forman parte de la cooperativa. */
export const ESTADOS_FUERA: EstadoSocio[] = ["excluido", "egresado", "baja"];
/** Se les generan cuotas y deben horas. */
export const ESTADOS_CON_OBLIGACIONES: EstadoSocio[] = ["activo", "suspendido", "renunciante"];
/** Cambios que son sanciones: los decide el Consejo (o un administrador). */
export const ESTADOS_SANCION: EstadoSocio[] = ["suspendido", "excluido"];

export const SQL_CON_OBLIGACIONES = `('activo', 'suspendido', 'renunciante')`;
export const SQL_FUERA = `('baja', 'egresado', 'excluido')`;

export function etiquetaEstadoSocio(e: string | null | undefined): string {
  return ESTADO_SOCIO_INFO[(e ?? "activo") as EstadoSocio]?.label ?? String(e);
}

/** "3 años y 2 meses" desde una fecha (YYYY-MM-DD) hasta otra. */
export function antiguedad(desde: string | null | undefined, hasta: string): { meses: number; texto: string } | null {
  if (!desde || !/^\d{4}-\d{2}-\d{2}/.test(desde)) return null;
  const [y1, m1, d1] = desde.slice(0, 10).split("-").map(Number);
  const [y2, m2, d2] = hasta.slice(0, 10).split("-").map(Number);
  let meses = (y2 - y1) * 12 + (m2 - m1) - (d2 < d1 ? 1 : 0);
  if (meses < 0) meses = 0;
  const anios = Math.floor(meses / 12);
  const resto = meses % 12;
  const partes: string[] = [];
  if (anios) partes.push(`${anios} ${anios === 1 ? "año" : "años"}`);
  if (resto) partes.push(`${resto} ${resto === 1 ? "mes" : "meses"}`);
  return { meses, texto: partes.length ? partes.join(" y ") : "menos de un mes" };
}

/** Pasos para recibir a un socio nuevo (A23). Los que dicen `auto` se marcan solos. */
export const ITEMS_INGRESO: { clave: string; titulo: string; ayuda: string; auto?: "nucleo" | "usuario" | "documentos" }[] = [
  { clave: "documentos", titulo: "Documentos personales", ayuda: "Cédula y constancia de domicilio, en Documentos de su ficha.", auto: "documentos" },
  { clave: "nucleo", titulo: "Núcleo familiar cargado", ayuda: "Con sus integrantes.", auto: "nucleo" },
  { clave: "usuario", titulo: "Usuario para entrar a COOVA", ayuda: "Para que vea sus cuotas, horas y avisos.", auto: "usuario" },
  { clave: "bienvenida", titulo: "Bienvenida y reglamento", ayuda: "Se le explicó cómo funciona la cooperativa y se le dio el reglamento." },
  { clave: "cuota", titulo: "Cuota y código de pago explicados", ayuda: "Sabe cuánto paga, cuándo vence y cómo transferir con su código." },
  { clave: "induccion", titulo: "Inducción", ayuda: "Charla de ingreso (y de seguridad, si la cooperativa está en obra)." },
];
