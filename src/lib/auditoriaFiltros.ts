import { MODULOS_AUDITORIA, entidadesDeModulo } from "@/lib/auditoriaTexto";

/**
 * Filtros de la auditoría (usuario, módulo, tipo, acción, fechas, búsqueda),
 * compartidos por la pantalla y por la descarga en Excel (Fase 2F).
 */
export type FiltrosAuditoria = { usuario_id?: string; entidad?: string; accion?: string; desde?: string; hasta?: string; modulo?: string; q?: string };

export function construirFiltrosAuditoria(sp: FiltrosAuditoria): { whereSql: string; valores: unknown[]; hayFiltros: boolean } {
  const usuarioIdFiltro = sp.usuario_id?.trim() || "";
  const entidadFiltro = sp.entidad?.trim() || "";
  const accionFiltro = sp.accion?.trim() || "";
  const desdeFiltro = sp.desde?.trim() || "";
  const hastaFiltro = sp.hasta?.trim() || "";
  const moduloFiltro = sp.modulo?.trim() || "";
  const qFiltro = sp.q?.trim() || "";
  const hayFiltros = !!(usuarioIdFiltro || entidadFiltro || accionFiltro || desdeFiltro || hastaFiltro || moduloFiltro || qFiltro);
  const condiciones: string[] = [];
  const valores: unknown[] = [];
  if (usuarioIdFiltro && /^\d+$/.test(usuarioIdFiltro)) {
    condiciones.push("a.usuario_id = ?");
    valores.push(Number(usuarioIdFiltro));
  }
  if (entidadFiltro) {
    condiciones.push("a.entidad = ?");
    valores.push(entidadFiltro);
  }
  if (moduloFiltro) {
    const entidades = entidadesDeModulo(moduloFiltro);
    if (moduloFiltro === "Otros") {
      const conocidas = MODULOS_AUDITORIA.filter((m) => m !== "Otros").flatMap((m) => entidadesDeModulo(m));
      condiciones.push(`a.entidad NOT IN (${conocidas.map(() => "?").join(",")})`);
      valores.push(...conocidas);
    } else if (entidades.length) {
      condiciones.push(`a.entidad IN (${entidades.map(() => "?").join(",")})`);
      valores.push(...entidades);
    }
  }
  if (qFiltro) {
    condiciones.push("(u.nombre ILIKE ? OR a.valor_nuevo ILIKE ? OR a.valor_anterior ILIKE ?)");
    const patron = `%${qFiltro.replace(/[%_\\]/g, (c) => `\\${c}`)}%`;
    valores.push(patron, patron, patron);
  }
  if (accionFiltro) {
    condiciones.push("a.accion = ?");
    valores.push(accionFiltro);
  }
  if (desdeFiltro && /^\d{4}-\d{2}-\d{2}$/.test(desdeFiltro)) {
    condiciones.push("a.fecha::date >= ?::date");
    valores.push(desdeFiltro);
  }
  if (hastaFiltro && /^\d{4}-\d{2}-\d{2}$/.test(hastaFiltro)) {
    condiciones.push("a.fecha::date <= ?::date");
    valores.push(hastaFiltro);
  }
  return { whereSql: condiciones.length ? `WHERE ${condiciones.join(" AND ")}` : "", valores, hayFiltros };
}
