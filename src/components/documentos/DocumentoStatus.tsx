import { Badge } from "@/components/ui";

// Sub-fase 1.1 de la evolución de la plataforma (22/09, "Centro Documental"):
// mismo criterio ya probado en solicitudes/SolicitudStatus.tsx — un solo
// lugar para el color/ícono/label de cada estado de un documento, y el
// cálculo de "vencido" (que no se guarda como tal en la base, ver el
// comentario de la migración 0030) en una única función reutilizable.

export const ESTADO_DOCUMENTO = ["vigente", "pendiente", "archivado"] as const;
export type EstadoDocumentoGuardado = (typeof ESTADO_DOCUMENTO)[number];
export type EstadoDocumentoEfectivo = EstadoDocumentoGuardado | "vencido";

const ESTADO_STYLE: Record<EstadoDocumentoEfectivo, { icon: string; label: string; color: "gray" | "amarillo" | "brand" | "verde" | "rojo" }> = {
  vigente: { icon: "✓", label: "Vigente", color: "verde" },
  pendiente: { icon: "🕓", label: "Pendiente", color: "amarillo" },
  archivado: { icon: "🗄", label: "Archivado", color: "gray" },
  vencido: { icon: "⏰", label: "Vencido", color: "rojo" },
};

export const ESTADO_DOCUMENTO_LABEL: Record<EstadoDocumentoGuardado, string> = {
  vigente: "Vigente",
  pendiente: "Pendiente",
  archivado: "Archivado",
};

export function DocumentoStatusBadge({ estado }: { estado: string }) {
  const s = ESTADO_STYLE[estado as EstadoDocumentoEfectivo];
  if (!s) return <Badge color="gray">{estado.replace(/_/g, " ")}</Badge>;
  return (
    <Badge color={s.color}>
      <span aria-hidden>{s.icon}</span> {s.label}
    </Badge>
  );
}

/**
 * "Vencido" no es un valor que se guarda en `documentos.estado` — se calcula
 * al mostrar, a partir de `fecha_vencimiento`, mismo criterio que
 * estadoEfectivo() en solicitudes (evita una segunda fuente de verdad que un
 * cron tendría que mantener sincronizada). Un documento archivado nunca se
 * muestra como vencido: ya salió de circulación a propósito.
 */
export function estadoEfectivoDocumento(estado: string, fechaVencimiento: string | null | undefined): EstadoDocumentoEfectivo | string {
  if (estado === "archivado") return "archivado";
  if (fechaVencimiento && fechaVencimiento < new Date().toISOString().slice(0, 10)) return "vencido";
  return estado;
}
