import { Badge } from "@/components/ui";

// Fase 7 del sistema de gestión de Comisiones (19/09) — igual criterio que
// DecisionStatus.tsx (Fase 6): constantes/labels/badges de este módulo en su
// propio archivo chico, para no repetir mapas sueltos en cada pantalla.

export const TIPO_COMUNICACION = [
  "privada",
  "entre_comision",
  "general",
  "consejo_directivo",
  "administrativa",
  "urgente",
] as const;
export type TipoComunicacion = (typeof TIPO_COMUNICACION)[number];

// Tipos que sólo puede enviar un rol de conducción (Admin, Consejo
// Directivo, Tesorería o Administración) — son comunicaciones "de arriba
// hacia toda la cooperativa", no un intercambio puntual entre comisiones.
export const TIPOS_COMUNICACION_OVERSIGHT: TipoComunicacion[] = ["general", "consejo_directivo", "administrativa", "urgente"];

export const TIPO_COMUNICACION_LABEL: Record<TipoComunicacion, string> = {
  privada: "Mensaje privado",
  entre_comision: "Entre comisiones",
  general: "General (toda la cooperativa)",
  consejo_directivo: "Consejo Directivo",
  administrativa: "Administrativa",
  urgente: "Urgente",
};

const TIPO_COLOR: Record<TipoComunicacion, "gray" | "brand" | "verde" | "amarillo" | "rojo"> = {
  privada: "gray",
  entre_comision: "brand",
  general: "verde",
  consejo_directivo: "brand",
  administrativa: "amarillo",
  urgente: "rojo",
};

export function tipoComunicacionLabel(tipo: string): string {
  return TIPO_COMUNICACION_LABEL[tipo as TipoComunicacion] || tipo;
}

export function TipoComunicacionBadge({ tipo }: { tipo: string }) {
  const t = tipo as TipoComunicacion;
  return <Badge color={TIPO_COLOR[t] || "gray"}>{tipoComunicacionLabel(tipo)}</Badge>;
}
