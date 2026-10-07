import { all } from "@/lib/db";
import { sumarDias } from "@/lib/horasObra";

/**
 * Fase 2G — documentación de proveedores con vencimiento (certificados de
 * BPS y DGI, seguro del BSE, habilitaciones).
 */
export const TIPO_DOC_PROVEEDOR_LABEL: Record<string, string> = {
  bps: "Certificado de BPS",
  dgi: "Certificado de DGI",
  bse: "Seguro del BSE",
  habilitacion: "Habilitación",
  otro: "Otro",
};

export type DocProveedor = {
  id: number;
  proveedor_id: number;
  tipo: string;
  descripcion: string | null;
  fecha_vencimiento: string | null;
  documento_id: number | null;
  archivo_url?: string | null;
};

export type EstadoDoc = "vigente" | "por_vencer" | "vencido" | "sin_fecha";

export function estadoDoc(d: { fecha_vencimiento: string | null }, hoy: string): EstadoDoc {
  if (!d.fecha_vencimiento) return "sin_fecha";
  if (d.fecha_vencimiento < hoy) return "vencido";
  if (d.fecha_vencimiento <= sumarDias(hoy, 30)) return "por_vencer";
  return "vigente";
}

export const ESTADO_DOC_LABEL: Record<EstadoDoc, string> = { vigente: "Vigente", por_vencer: "Vence pronto", vencido: "Vencido", sin_fecha: "Sin vencimiento" };
export const ESTADO_DOC_COLOR: Record<EstadoDoc, "verde" | "amarillo" | "rojo" | "gray"> = { vigente: "verde", por_vencer: "amarillo", vencido: "rojo", sin_fecha: "gray" };

export async function documentosDeProveedor(proveedorId: number): Promise<DocProveedor[]> {
  return all<DocProveedor>(
    `SELECT pd.id, pd.proveedor_id, pd.tipo, pd.descripcion, pd.fecha_vencimiento, pd.documento_id, d.archivo_url
       FROM proveedor_documentos pd LEFT JOIN documentos d ON d.id = pd.documento_id
      WHERE pd.proveedor_id = ? AND pd.activo = 1 ORDER BY pd.fecha_vencimiento NULLS LAST, pd.id`,
    [proveedorId]
  ).catch(() => []);
}

/** Proveedores con algún documento vencido: id → lista de qué venció. */
export async function proveedoresConDocVencida(hoy: string): Promise<Map<number, string[]>> {
  const filas = await all<{ proveedor_id: number; tipo: string; descripcion: string | null }>(
    `SELECT proveedor_id, tipo, descripcion FROM proveedor_documentos WHERE activo = 1 AND fecha_vencimiento IS NOT NULL AND fecha_vencimiento < ?`,
    [hoy]
  ).catch(() => []);
  const m = new Map<number, string[]>();
  for (const f of filas) m.set(f.proveedor_id, [...(m.get(f.proveedor_id) ?? []), f.descripcion || TIPO_DOC_PROVEEDOR_LABEL[f.tipo] || f.tipo]);
  return m;
}
