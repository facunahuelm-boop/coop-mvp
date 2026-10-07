import { all } from "@/lib/db";
import { hoyEnUruguay } from "@/lib/horasObra";

/**
 * Fase 2E — Trámites e hitos (Pre-obra). Sin dependencias del cliente: los
 * textos están en tramitesTexto.ts.
 */

export type Hito = {
  id: number;
  titulo: string;
  descripcion: string | null;
  categoria: string;
  orden: number;
  responsable_id: number | null;
  responsable_nombre: string | null;
  responsable_texto: string | null;
  fecha_estimada: string | null;
  fecha_real: string | null;
  estado: "pendiente" | "en_curso" | "hecho" | "trabado" | "no_aplica";
  visible_socios: number;
  nota_para_socios: string | null;
  documentos: number;
};

export async function listarHitos(soloSocios = false): Promise<Hito[]> {
  const filas = await all<Hito & { documentos: string }>(
    `SELECT t.*, u.nombre AS responsable_nombre, (SELECT COUNT(*) FROM documentos d WHERE d.tramite_id = t.id) AS documentos
       FROM tramites_hitos t LEFT JOIN users u ON u.id = t.responsable_id
      WHERE t.activo = 1 ${soloSocios ? "AND t.visible_socios = 1" : ""}
      ORDER BY t.orden, t.id`
  ).catch(() => []);
  return filas.map((f) => ({ ...f, documentos: Number(f.documentos || 0) }));
}

export function hitoVencido(h: Pick<Hito, "estado" | "fecha_estimada">, hoy = hoyEnUruguay()): boolean {
  return !!h.fecha_estimada && h.fecha_estimada < hoy && (h.estado === "pendiente" || h.estado === "en_curso" || h.estado === "trabado");
}

/** El paso en el que está la cooperativa: el primero que no está hecho. */
export function pasoActual(hitos: Hito[]): Hito | null {
  return hitos.find((h) => h.estado !== "hecho" && h.estado !== "no_aplica") ?? null;
}
