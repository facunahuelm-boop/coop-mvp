import { Badge } from "@/components/ui";

// Fase 6 del sistema de gestión de Comisiones (19/09, sección "decisiones/
// votaciones"): mismo criterio ya probado en SolicitudStatus.tsx — un solo
// lugar para el color/ícono/label de cada resultado y tipo, en vez de
// repetirlo a mano en cada pantalla.

export const RESULTADO_DECISION = ["pendiente", "aprobada", "rechazada"] as const;
export type ResultadoDecision = (typeof RESULTADO_DECISION)[number];

const RESULTADO_STYLE: Record<ResultadoDecision, { icon: string; label: string; color: "gray" | "verde" | "rojo" }> = {
  pendiente: { icon: "🕓", label: "Pendiente", color: "gray" },
  aprobada: { icon: "✅", label: "Aprobada", color: "verde" },
  rechazada: { icon: "✕", label: "Rechazada", color: "rojo" },
};

export function ResultadoDecisionBadge({ resultado }: { resultado: string }) {
  const s = RESULTADO_STYLE[resultado as ResultadoDecision];
  if (!s) return <Badge color="gray">{resultado}</Badge>;
  return (
    <Badge color={s.color}>
      <span aria-hidden>{s.icon}</span> {s.label}
    </Badge>
  );
}

export function resultadoDecisionLabel(resultado: string): string {
  return RESULTADO_STYLE[resultado as ResultadoDecision]?.label ?? resultado;
}

// Tipos de votación (sección "votaciones"): encuesta = pulso informal sin
// peso formal; votacion = conteo con intención de definir algo; decision_formal
// = la votación que efectivamente resuelve una decisión de comisión.
export const TIPO_VOTACION = ["encuesta", "votacion", "decision_formal"] as const;
export type TipoVotacion = (typeof TIPO_VOTACION)[number];

export const TIPO_VOTACION_LABEL: Record<TipoVotacion, string> = {
  encuesta: "Encuesta",
  votacion: "Votación",
  decision_formal: "Votación formal (define la decisión)",
};

export function tipoVotacionLabel(tipo: string): string {
  return TIPO_VOTACION_LABEL[tipo as TipoVotacion] ?? tipo;
}

export function EstadoVotacionBadge({ estado }: { estado: string }) {
  return estado === "cerrada" ? <Badge color="gray">Cerrada</Badge> : <Badge color="brand">Abierta</Badge>;
}
