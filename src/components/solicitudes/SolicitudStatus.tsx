import { Badge } from "@/components/ui";

// Fase 3 del sistema de gestión de Comisiones (19/09): mismo criterio ya
// probado en Compras (PurchaseStatus.tsx) — un solo lugar para el color/
// ícono/label de cada estado y prioridad, en vez de repetirlo a mano en
// cada pantalla. Los 9 estados son los que define la migración 0029
// (columna `estado` de solicitudes_comision) — reflejan el ciclo de vida
// que pidió el usuario en la sección 3 del pedido (pendiente → en_revision
// → ... → resuelta, con esperando_informacion/derivada/cancelada/vencida
// como ramas posibles).

export const ESTADO_SOLICITUD = [
  "pendiente",
  "en_revision",
  "esperando_informacion",
  "en_proceso",
  "aprobada",
  "rechazada",
  "resuelta",
  "cancelada",
  "vencida",
] as const;

export type EstadoSolicitud = (typeof ESTADO_SOLICITUD)[number];

const ESTADO_STYLE: Record<EstadoSolicitud, { icon: string; label: string; color: "gray" | "amarillo" | "brand" | "verde" | "rojo" }> = {
  pendiente: { icon: "🕓", label: "Pendiente", color: "gray" },
  en_revision: { icon: "🔎", label: "En revisión", color: "amarillo" },
  esperando_informacion: { icon: "❓", label: "Esperando información", color: "amarillo" },
  en_proceso: { icon: "⚙️", label: "En proceso", color: "brand" },
  aprobada: { icon: "✅", label: "Aprobada", color: "verde" },
  rechazada: { icon: "✕", label: "Rechazada", color: "rojo" },
  resuelta: { icon: "✓", label: "Resuelta", color: "verde" },
  cancelada: { icon: "🚫", label: "Cancelada", color: "gray" },
  vencida: { icon: "⏰", label: "Vencida", color: "rojo" },
};

export function SolicitudStatusBadge({ estado }: { estado: string }) {
  const s = ESTADO_STYLE[estado as EstadoSolicitud];
  if (!s) return <Badge color="gray">{estado.replace(/_/g, " ")}</Badge>;
  return (
    <Badge color={s.color}>
      <span aria-hidden>{s.icon}</span> {s.label}
    </Badge>
  );
}

export function estadoSolicitudLabel(estado: string): string {
  return ESTADO_STYLE[estado as EstadoSolicitud]?.label ?? estado.replace(/_/g, " ");
}

export const PRIORIDAD_SOLICITUD = ["baja", "normal", "alta", "urgente"] as const;

const PRIORIDAD_STYLE: Record<string, { label: string; color: "gray" | "amarillo" | "brand" | "rojo" }> = {
  baja: { label: "Baja", color: "gray" },
  normal: { label: "Normal", color: "brand" },
  alta: { label: "Alta", color: "amarillo" },
  urgente: { label: "🔴 Urgente", color: "rojo" },
};

export function PrioridadSolicitudBadge({ prioridad }: { prioridad: string }) {
  const s = PRIORIDAD_STYLE[prioridad] || { label: prioridad, color: "gray" as const };
  return <Badge color={s.color}>{s.label}</Badge>;
}

// Tipos de solicitud (sección 3 del pedido) — texto libre en la base
// (columna `tipo`), esta tabla es sólo para mostrar un label legible.
export const TIPO_SOLICITUD_LABEL: Record<string, string> = {
  informacion: "Información",
  aprobacion: "Aprobación",
  compra: "Compra",
  presupuesto: "Presupuesto",
  tarea: "Tarea",
  documento: "Documento",
  consulta: "Consulta",
  informe: "Informe",
  derivacion: "Derivación",
  incidente: "Incidente",
  urgente: "Urgente",
  otro: "Otro",
};

export function tipoSolicitudLabel(tipo: string): string {
  return TIPO_SOLICITUD_LABEL[tipo] ?? tipo;
}

// "Vencida" (sección 5 del pedido) no es un estado que se guarda en la base
// — se calcula al mostrar, mismo criterio que `situacionDeCuota()` en
// Finanzas (evita una segunda fuente de verdad que un cron tendría que
// mantener sincronizada). Sólo aplica si la solicitud sigue "viva" (no si
// ya se resolvió/aprobó/rechazó/canceló) y tiene fecha límite pasada.
const ESTADOS_ABIERTOS = new Set(["pendiente", "en_revision", "esperando_informacion", "en_proceso"]);

export function estadoEfectivo(estado: string, fechaLimite: string | null): EstadoSolicitud | string {
  if (fechaLimite && ESTADOS_ABIERTOS.has(estado) && fechaLimite < new Date().toISOString().slice(0, 10)) {
    return "vencida";
  }
  return estado;
}
