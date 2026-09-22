// Constantes compartidas de Sub-fase 1.4 ("Consejo Directivo — vista
// propia"). Separado de actions/consejoDirectivo.ts porque un archivo
// "use server" solo puede exportar funciones async — estas constantes las
// necesitan tanto el server action como la página y el formulario cliente.

export const CARGOS_CONSEJO = ["presidente", "secretario", "tesorero", "vocal"] as const;
export type CargoConsejo = (typeof CARGOS_CONSEJO)[number];
export const CARGO_LABEL: Record<CargoConsejo, string> = {
  presidente: "Presidente",
  secretario: "Secretario",
  tesorero: "Tesorero",
  vocal: "Vocal",
};
