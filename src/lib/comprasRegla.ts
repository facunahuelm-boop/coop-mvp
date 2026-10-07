import type { Reglamento } from "@/lib/reglamento";

/**
 * Fase 2G — A14: regla de montos de Compras (función pura, la usan la
 * pantalla y la acción de aprobar). Si la compra supera el monto del
 * reglamento, pide N presupuestos y que la apruebe quien corresponda.
 */
export type EstadoRegla = {
  aplica: boolean;
  monto: number;
  minimo: number;
  presupuestos: number;
  faltanPresupuestos: number;
  soloConsejo: boolean;
  texto: string;
};

const pesos = (n: number) => `$ ${Math.round(n).toLocaleString("es-UY")}`;

export function reglaDeCompra(monto: number, presupuestos: number, r: Reglamento["compras"]): EstadoRegla {
  const aplica = r.montoFormal > 0 && monto > r.montoFormal;
  const faltan = aplica ? Math.max(0, r.presupuestosMinimos - presupuestos) : 0;
  const soloConsejo = aplica && r.aprobacion === "consejo";
  const texto = aplica
    ? `Esta compra supera ${pesos(r.montoFormal)}: el reglamento pide ${r.presupuestosMinimos} presupuesto${r.presupuestosMinimos === 1 ? "" : "s"}${
        soloConsejo ? " y que la apruebe el Consejo Directivo" : ""
      }.${faltan ? ` Falta${faltan === 1 ? "" : "n"} ${faltan}.` : " Ya están."}`
    : "";
  return { aplica, monto, minimo: r.presupuestosMinimos, presupuestos, faltanPresupuestos: faltan, soloConsejo, texto };
}

/** ¿Este rol puede aprobar una compra que cae en la regla? */
export function puedeAprobarSegunRegla(rol: string, regla: EstadoRegla): boolean {
  return !regla.soloConsejo || rol === "consejo_directivo" || rol === "admin";
}
