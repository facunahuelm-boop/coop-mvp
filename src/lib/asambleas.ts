import { all, get, insert, update, run } from "@/lib/db";
import { calcularCuotasSocio, cargarMovimientosCuenta } from "@/lib/logic";
import { antiguedad } from "@/lib/sociosEstados";
import { hoyEnUruguay } from "@/lib/horasObra";
import type { Reglamento } from "@/lib/reglamento";

/**
 * Fase 2D — asambleas formales (plan, 8.6). COOVA ayuda a contar: calcula el
 * padrón habilitado según el reglamento, la asistencia, el quórum y las
 * votaciones. La validez la decide siempre la mesa de la asamblea según el
 * estatuto (no se promete validez legal).
 */

export type FilaPadron = {
  id: number;
  socio_id: number;
  integrante_id: number | null;
  nombre: string;
  habilitado: number;
  causa: string | null;
  presente: number;
  llegada_en: string | null;
  representado_por_id: number | null;
};

const diasEntre = (a: string, b: string) => Math.round((Date.parse(b.slice(0, 10) + "T12:00:00Z") - Date.parse(a.slice(0, 10) + "T12:00:00Z")) / 86400000);

/** ¿Se convocó con la anticipación que pide el estatuto? */
export function revisarAnticipacion(
  tipoAsamblea: string | null,
  fechaAsamblea: string,
  fechaConvocatoria: string | null,
  r: Reglamento["asambleas"]
): { ok: boolean; minimo: number; dias: number; mensaje: string } {
  const minimo = tipoAsamblea === "extraordinaria" ? r.anticipacionExtraordinaria : r.anticipacionOrdinaria;
  const desde = fechaConvocatoria || hoyEnUruguay();
  const dias = diasEntre(desde, fechaAsamblea);
  const ok = dias >= minimo;
  return {
    ok,
    minimo,
    dias,
    mensaje: ok
      ? `Se convoca con ${dias} día(s) de anticipación (el estatuto pide ${minimo}).`
      : `El estatuto pide convocar con ${minimo} día(s) de anticipación y faltan ${dias}. La asamblea tendría que ser a partir del ${fechaMinima(desde, minimo)}.`,
  };
}

function fechaMinima(desde: string, dias: number) {
  return new Date(Date.parse(desde.slice(0, 10) + "T12:00:00Z") + dias * 86400000).toISOString().slice(0, 10).split("-").reverse().join("/");
}

/**
 * Arma (o actualiza) el padrón de la asamblea: quién vota y si está
 * habilitado, con la causa visible. Respeta lo ya registrado (asistencia,
 * poderes) si se vuelve a calcular.
 */
export async function calcularPadron(reunionId: number, r: Reglamento["asambleas"], usuarioId: number | null): Promise<{ total: number; habilitados: number }> {
  const hoy = hoyEnUruguay();
  const socios = await all<{ id: number; nombre: string; estado: string; fecha_ingreso: string | null }>(
    `SELECT id, nombre, estado, fecha_ingreso FROM socios WHERE estado IN ('activo', 'suspendido', 'renunciante') ORDER BY nombre`
  );
  const movimientos = r.maxCuotasVencidas !== null ? await cargarMovimientosCuenta() : [];
  const porSocio = new Map<number, typeof movimientos>();
  for (const m of movimientos) porSocio.set(m.socio_id, [...(porSocio.get(m.socio_id) ?? []), m]);
  const integrantes =
    r.voto === "persona"
      ? await all<{ id: number; socio_id: number; nombre: string; apellido: string | null }>(
          `SELECT id, socio_id, nombre, apellido FROM socio_integrantes WHERE estado = 'activo' AND COALESCE(tipo_integrante, 'adulto') = 'adulto' AND COALESCE(relacion, '') <> 'titular'`
        ).catch(() => [])
      : [];
  const existentes = await all<{ id: number; socio_id: number; integrante_id: number | null }>(`SELECT id, socio_id, integrante_id FROM asamblea_padron WHERE reunion_id = ?`, [reunionId]);
  const clave = (s: number, i: number | null) => `${s}:${i ?? 0}`;
  const vistos = new Set<string>();
  let habilitados = 0;
  let total = 0;
  for (const s of socios) {
    const causas: string[] = [];
    if (s.estado === "suspendido") causas.push("Está suspendido");
    if (r.antiguedadMinimaMeses > 0) {
      const a = antiguedad(s.fecha_ingreso, hoy);
      if (!a || a.meses < r.antiguedadMinimaMeses) causas.push(`Tiene menos de ${r.antiguedadMinimaMeses} meses de antigüedad`);
    }
    if (r.maxCuotasVencidas !== null) {
      const vencidas = calcularCuotasSocio(porSocio.get(s.id) ?? []).cuotas.filter((c) => c.estado === "vencida").length;
      if (vencidas > r.maxCuotasVencidas) causas.push(`Debe ${vencidas} cuota(s) vencida(s) (máximo ${r.maxCuotasVencidas})`);
    }
    const habilitado = causas.length === 0;
    const filas = [{ integrante_id: null as number | null, nombre: s.nombre }, ...integrantes.filter((i) => i.socio_id === s.id).map((i) => ({ integrante_id: i.id, nombre: `${i.nombre} ${i.apellido ?? ""}`.trim() }))];
    for (const f of filas) {
      total++;
      if (habilitado) habilitados++;
      const k = clave(s.id, f.integrante_id);
      vistos.add(k);
      const ya = existentes.find((e) => clave(e.socio_id, e.integrante_id) === k);
      if (ya) await update("asamblea_padron", ya.id, { nombre: f.nombre, habilitado: habilitado ? 1 : 0, causa: causas.join(". ") || null });
      else await insert("asamblea_padron", { reunion_id: reunionId, socio_id: s.id, integrante_id: f.integrante_id, nombre: f.nombre, habilitado: habilitado ? 1 : 0, causa: causas.join(". ") || null, registrado_por_id: usuarioId });
    }
  }
  for (const e of existentes) {
    if (!vistos.has(clave(e.socio_id, e.integrante_id))) await update("asamblea_padron", e.id, { habilitado: 0, causa: "Ya no figura entre los socios con derecho a voto" });
  }
  await run(`UPDATE reuniones SET padron_calculado_en = ? WHERE id = ?`, [new Date().toISOString(), reunionId]);
  return { total, habilitados };
}

export type Quorum = {
  habilitados: number;
  presentes: number;
  porPoder: number;
  votosPosibles: number;
  necesariosPrimera: number;
  necesariosSegunda: number;
  hayPrimera: boolean;
  haySegunda: boolean;
  horaSegunda: string;
};

export function calcularQuorum(padron: FilaPadron[], fechaAsamblea: string, r: Reglamento["asambleas"]): Quorum {
  const habil = padron.filter((p) => p.habilitado);
  const presentesIds = new Set(habil.filter((p) => p.presente).map((p) => p.id));
  const presentes = presentesIds.size;
  const porPoder = r.poderes ? habil.filter((p) => !p.presente && p.representado_por_id && presentesIds.has(p.representado_por_id)).length : 0;
  const n = habil.length;
  const necesario = (pct: number) => (pct <= 0 ? 1 : pct === 50 ? Math.floor(n / 2) + 1 : Math.ceil((n * pct) / 100));
  const necesariosPrimera = necesario(r.quorumPrimera);
  const necesariosSegunda = necesario(r.quorumSegunda);
  const votosPosibles = presentes + porPoder;
  const inicio = new Date(fechaAsamblea.length <= 10 ? fechaAsamblea + "T00:00:00" : fechaAsamblea);
  const segunda = new Date(inicio.getTime() + r.minutosSegunda * 60000);
  const hh = (d: Date) => `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  return {
    habilitados: n,
    presentes,
    porPoder,
    votosPosibles,
    necesariosPrimera,
    necesariosSegunda,
    hayPrimera: votosPosibles >= necesariosPrimera,
    haySegunda: votosPosibles >= necesariosSegunda,
    horaSegunda: hh(segunda),
  };
}

export const MAYORIA_LABEL: Record<string, string> = {
  simple: "Mayoría simple (más a favor que en contra)",
  absoluta: "Mayoría absoluta (más de la mitad de los que pueden votar)",
  dos_tercios: "Dos tercios de los votos emitidos",
};

/** Resultado de una votación según la mayoría elegida. */
export function resultadoVotacion(mayoria: string, aFavor: number, enContra: number, abst: number, votosPosibles: number): "aprobada" | "rechazada" | "empate" {
  if (mayoria === "absoluta") return aFavor > votosPosibles / 2 ? "aprobada" : "rechazada";
  if (mayoria === "dos_tercios") {
    const emitidos = aFavor + enContra;
    return emitidos > 0 && aFavor * 3 >= emitidos * 2 ? "aprobada" : "rechazada";
  }
  if (aFavor === enContra) return "empate";
  return aFavor > enContra ? "aprobada" : "rechazada";
}

export const RESULTADO_LABEL: Record<string, string> = { aprobada: "Aprobada", rechazada: "Rechazada", empate: "Empate" };

/** Borrador del acta con lo registrado (plan: «acta: borrador automático con los datos registrados»). */
export async function borradorDeActa(reunionId: number, organizacion: string): Promise<string> {
  const reunion = await get<{ titulo: string; fecha: string; lugar: string | null; tipo_asamblea: string | null; quorum_confirmado: string | null; quorum_detalle: string | null; orden_del_dia: string | null }>(
    `SELECT titulo, fecha, lugar, tipo_asamblea, quorum_confirmado, quorum_detalle, orden_del_dia FROM reuniones WHERE id = ?`,
    [reunionId]
  );
  if (!reunion) return "";
  const [agenda, votaciones, presentes] = await Promise.all([
    all<{ id: number; titulo: string; resultado: string | null }>(`SELECT id, titulo, resultado FROM reunion_agenda_items WHERE reunion_id = ? ORDER BY orden`, [reunionId]).catch(() => []),
    all<{ agenda_item_id: number | null; titulo: string; a_favor: number; en_contra: number; abstenciones: number; resultado: string | null; mayoria: string }>(
      `SELECT agenda_item_id, titulo, a_favor, en_contra, abstenciones, resultado, mayoria FROM asamblea_votaciones WHERE reunion_id = ? AND estado = 'cerrada' ORDER BY id`,
      [reunionId]
    ).catch(() => []),
    get<{ n: string; habil: string }>(`SELECT COUNT(*) FILTER (WHERE presente = 1) AS n, COUNT(*) FILTER (WHERE habilitado = 1) AS habil FROM asamblea_padron WHERE reunion_id = ?`, [reunionId]).catch(() => undefined),
  ]);
  const fecha = new Date(reunion.fecha);
  const dia = reunion.fecha.slice(0, 10).split("-").reverse().join("/");
  const hora = reunion.fecha.length > 10 ? `${String(fecha.getHours()).padStart(2, "0")}:${String(fecha.getMinutes()).padStart(2, "0")}` : "";
  const lineas: string[] = [];
  lineas.push(
    `En ${reunion.lugar || "el lugar indicado en la convocatoria"}, el ${dia}${hora ? ` a las ${hora}` : ""}, se reúne la Asamblea General ${reunion.tipo_asamblea === "extraordinaria" ? "Extraordinaria" : "Ordinaria"} de socios de ${organizacion}.`
  );
  if (reunion.quorum_confirmado) {
    lineas.push(`La mesa da comienzo a la asamblea en ${reunion.quorum_confirmado === "segunda" ? "segunda" : "primera"} convocatoria. ${reunion.quorum_detalle ?? ""}`.trim());
  } else if (presentes) {
    lineas.push(`Asisten ${presentes.n} de ${presentes.habil} socios habilitados.`);
  }
  lineas.push("");
  lineas.push("Orden del día y resoluciones:");
  agenda.forEach((a, i) => {
    lineas.push(`${i + 1}. ${a.titulo}`);
    for (const v of votaciones.filter((x) => x.agenda_item_id === a.id)) {
      lineas.push(`   Se vota: ${v.titulo}. A favor ${v.a_favor}, en contra ${v.en_contra}, abstenciones ${v.abstenciones}. ${RESULTADO_LABEL[v.resultado ?? ""] ?? ""}.`);
    }
    if (a.resultado) lineas.push(`   Resolución: ${a.resultado}`);
  });
  for (const v of votaciones.filter((x) => !x.agenda_item_id)) {
    lineas.push(`- Se vota: ${v.titulo}. A favor ${v.a_favor}, en contra ${v.en_contra}, abstenciones ${v.abstenciones}. ${RESULTADO_LABEL[v.resultado ?? ""] ?? ""}.`);
  }
  if (!agenda.length && reunion.orden_del_dia) lineas.push(reunion.orden_del_dia);
  lineas.push("");
  lineas.push("Sin más asuntos que tratar, se levanta la sesión.");
  return lineas.join("\n");
}
