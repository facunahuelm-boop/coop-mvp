// Constantes compartidas de Sub-fase 1.4 ("Consejo Directivo — vista
// propia"). Separado de actions/consejoDirectivo.ts porque un archivo
// "use server" solo puede exportar funciones async — estas constantes las
// necesitan tanto el server action como la página y el formulario cliente.
//
// Fase 2D: además del Consejo, la Comisión Fiscal y la Comisión Electoral
// (órganos con mandato). Cada cargo da un rol (los permisos salen del cargo).

export const CARGOS_CONSEJO = [
  "presidente",
  "secretario",
  "tesorero",
  "vocal",
  "suplente",
  "fiscal_titular",
  "fiscal_suplente",
  "electoral_titular",
  "electoral_suplente",
] as const;
export type CargoConsejo = (typeof CARGOS_CONSEJO)[number];
export const CARGO_LABEL: Record<CargoConsejo, string> = {
  presidente: "Presidente",
  secretario: "Secretario",
  tesorero: "Tesorero",
  vocal: "Vocal",
  suplente: "Suplente del Consejo",
  fiscal_titular: "Comisión Fiscal (titular)",
  fiscal_suplente: "Comisión Fiscal (suplente)",
  electoral_titular: "Comisión Electoral (titular)",
  electoral_suplente: "Comisión Electoral (suplente)",
};

export type Organo = "consejo" | "fiscal" | "electoral";
export const ORGANO_LABEL: Record<Organo, string> = { consejo: "Consejo Directivo", fiscal: "Comisión Fiscal", electoral: "Comisión Electoral" };

export function organoDeCargo(c: CargoConsejo): Organo {
  if (c.startsWith("fiscal")) return "fiscal";
  if (c.startsWith("electoral")) return "electoral";
  return "consejo";
}

/** El rol que corresponde a cada cargo (null: no cambia el rol de la persona). */
export function rolDeCargo(c: CargoConsejo): string | null {
  if (c === "tesorero") return "tesoreria";
  if (c === "fiscal_titular" || c === "fiscal_suplente") return "fiscal";
  if (c.startsWith("electoral")) return null;
  return "consejo_directivo";
}

/** Roles sensibles: al vencer el mandato hay que revisarlos. */
export const ROLES_DE_CARGO = ["consejo_directivo", "tesoreria", "fiscal"];
