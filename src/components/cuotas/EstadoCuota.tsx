import { Badge } from "@/components/ui";
import type { EstadoCuota } from "@/lib/logic";

/**
 * Gestión cooperativa integrada (04/10) — estado de una cuota, con los
 * colores pedidos: verde pagada, amarillo pendiente, rojo vencida, azul en
 * convenio, naranja pago parcial. Un solo lugar para que la ficha del
 * núcleo, el panel de morosidad y cualquier otra pantalla lo muestren igual.
 */
export const ESTADO_CUOTA_LABEL: Record<EstadoCuota, string> = {
  pagada: "Pagada",
  pendiente: "Pendiente",
  vencida: "Vencida",
  convenio: "En convenio",
  parcial: "Pago parcial",
};

export const ESTADO_CUOTA_COLOR: Record<EstadoCuota, "verde" | "amarillo" | "rojo" | "azul" | "naranja"> = {
  pagada: "verde",
  pendiente: "amarillo",
  vencida: "rojo",
  convenio: "azul",
  parcial: "naranja",
};

export function EstadoCuotaBadge({ estado, conPagoParcial = false }: { estado: EstadoCuota; conPagoParcial?: boolean }) {
  return (
    <Badge color={ESTADO_CUOTA_COLOR[estado]}>
      {ESTADO_CUOTA_LABEL[estado]}
      {estado === "vencida" && conPagoParcial ? " (pago parcial)" : ""}
    </Badge>
  );
}
