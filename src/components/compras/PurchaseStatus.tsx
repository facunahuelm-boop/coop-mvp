import { Badge } from "@/components/ui";

// Fase 1 del rediseño de Compras (pedido explícito, secciones 8 y 11:
// "el usuario debe poder entender rápidamente dónde está cada solicitud...
// no mostrar solamente texto, utilizar badges/estados visuales"). Antes,
// `estadoColor`/`estadoLabel` vivían duplicados a mano en `compras/page.tsx`
// y `compras/[id]/page.tsx`, con sólo color (sin ícono) — mismo criterio de
// accesibilidad que ya se aplicó en `EstadoTag` del Dashboard: el estado
// nunca debe depender sólo del color para poder distinguirse. A propósito
// se mantienen los MISMOS 5 colores de `Badge` que ya usaba cada estado
// (gray/amarillo/brand/verde/rojo) — no se inventan colores nuevos por
// estado, sólo se agrega el ícono que faltaba.
//
// Los 6 estados son los que ya existen en la base (columna `estado` de
// solicitudes_compra) — no se agregó ningún estado nuevo acá. "Cancelada"
// (pedido en la sección 11 como estado "a evaluar si aporta valor") queda
// pendiente para la fase del flujo de Compras: agregar un estado nuevo
// implica también una acción nueva que lo dispare y un permiso que lo
// controle, y esta fase es sólo de fundaciones visuales.
export const ESTADO_SOLICITUD_COMPRA = [
  "pendiente_cotizacion",
  "en_comparacion",
  "aprobada",
  "pedida",
  "entregada",
  "rechazada",
] as const;

export type EstadoSolicitudCompra = (typeof ESTADO_SOLICITUD_COMPRA)[number];

const ESTADO_SOLICITUD_STYLE: Record<
  EstadoSolicitudCompra,
  { icon: string; label: string; color: "gray" | "amarillo" | "brand" | "verde" | "rojo" }
> = {
  pendiente_cotizacion: { icon: "🕓", label: "Pendiente de cotización", color: "gray" },
  en_comparacion: { icon: "📊", label: "En comparación", color: "amarillo" },
  aprobada: { icon: "✅", label: "Aprobada", color: "brand" },
  pedida: { icon: "📦", label: "Pedida a proveedor", color: "amarillo" },
  entregada: { icon: "✓", label: "Entregada", color: "verde" },
  rechazada: { icon: "✕", label: "Rechazada", color: "rojo" },
};

/** Reemplazo directo del `<Badge>` a mano que ya usaban `/compras` y
 * `/compras/[id]` para el estado de una solicitud — mismo componente, para
 * que un cambio de criterio futuro (agregar un estado, cambiar un ícono) se
 * haga en un solo lugar en vez de en cada pantalla. `estado` no reconocido
 * (dato viejo/corrupto) cae a un badge gris neutro en vez de romper. */
export function SolicitudStatusBadge({ estado }: { estado: string }) {
  const s = ESTADO_SOLICITUD_STYLE[estado as EstadoSolicitudCompra];
  if (!s) return <Badge color="gray">{estado.replace(/_/g, " ")}</Badge>;
  return (
    <Badge color={s.color}>
      <span aria-hidden>{s.icon}</span> {s.label}
    </Badge>
  );
}

export function estadoSolicitudLabel(estado: string): string {
  return ESTADO_SOLICITUD_STYLE[estado as EstadoSolicitudCompra]?.label ?? estado.replace(/_/g, " ");
}
