import { all, get } from "@/lib/db";
import type { FuncionComision } from "@/lib/comisionesFunciones";
import { hoyEnUruguay, sumarDias, textoHoras } from "@/lib/horasObra";
import { obtenerReglamento } from "@/lib/reglamento";
import { proveedoresConDocVencida } from "@/lib/proveedoresDocs";
import { personasDeLaCooperativa, personasConInduccion } from "@/lib/seguridadObra";
import { cargarRubros, avanceFisico, planificadoAl, origenFinanciero, gastoObra } from "@/lib/avanceObra";
import { cargarLibretas } from "@/lib/libretaHoras";

/**
 * Fase 3B — panel propio por función de comisión (plan, 8.8). Cada función
 * registra acá una función que arma su panel: indicadores (KPIs), listas de
 * lo que hay que atender, accesos directos y, si corresponde, formularios
 * propios. La página de la comisión lo dibuja igual para todas; agregar una
 * función nueva es registrar su panel en PANELES, sin tocar la página.
 *
 * Todo se calcula con lo que ya está cargado en COOVA y cada consulta
 * tolera una migración que todavía no corrió (devuelve vacío).
 */

export type Tono = "verde" | "amarillo" | "rojo";
export type KpiPanel = { label: string; valor: string; detalle?: string; tono?: Tono };
export type ItemPanel = { texto: string; detalle?: string; href?: string; tono?: Tono };
export type BloquePanel = { titulo: string; items: ItemPanel[]; vacio: string; verTodo?: { href: string; label: string } };
export type FormularioPanel = "correspondencia" | "eleccion";
export type Panel = { kpis: KpiPanel[]; bloques: BloquePanel[]; accesos: { href: string; label: string }[]; formularios?: FormularioPanel[] };

const n = (v: unknown) => Number(v ?? 0) || 0;
const pct = (a: number, b: number) => (b > 0 ? Math.round((a / b) * 100) : null);
const textoPct = (v: number | null) => (v == null ? "—" : `${v} %`);
const dmy = (f: string | null | undefined) => (f ? String(f).slice(0, 10).split("-").reverse().join("/") : "");
const pesos = (v: number) => `$ ${Math.round(v).toLocaleString("es-UY")}`;
const vacioSi = <T,>(p: Promise<T>, def: T) => p.catch(() => def);
const tonoPct = (v: number | null, bien = 80, regular = 60): Tono | undefined => (v == null ? undefined : v >= bien ? "verde" : v >= regular ? "amarillo" : "rojo");

// ---------- KPIs comunes a todas las comisiones ----------

export async function kpisComunes(comisionId: number): Promise<KpiPanel[]> {
  const hoy = hoyEnUruguay();
  const [tareas, solicitudes, asistencia, actividad] = await Promise.all([
    vacioSi(
      get<{ con_plazo: string; en_plazo: string; vencidas: string }>(
        `SELECT COUNT(*) FILTER (WHERE fecha_vencimiento IS NOT NULL) AS con_plazo,
                COUNT(*) FILTER (WHERE fecha_vencimiento IS NOT NULL AND (estado = 'completada' OR fecha_vencimiento >= ?)) AS en_plazo,
                COUNT(*) FILTER (WHERE estado <> 'completada' AND fecha_vencimiento < ?) AS vencidas
           FROM tareas WHERE comision_id = ?`,
        [hoy, hoy, comisionId]
      ),
      undefined
    ),
    vacioSi(
      get<{ total: string; en_plazo: string }>(
        `SELECT COUNT(*) AS total,
                COUNT(*) FILTER (WHERE r.primera IS NOT NULL AND left(r.primera::text, 10) <= s.fecha_limite) AS en_plazo
           FROM solicitudes_comision s
           LEFT JOIN LATERAL (SELECT MIN(e.creado_en) AS primera FROM solicitud_eventos e WHERE e.solicitud_id = s.id AND e.evento IN ('en_proceso', 'resuelta', 'rechazada')) r ON true
          WHERE s.comision_destino_id = ? AND s.fecha_limite IS NOT NULL AND (s.fecha_limite < ? OR r.primera IS NOT NULL)`,
        [comisionId, hoy]
      ),
      undefined
    ),
    vacioSi(
      get<{ total: string; presentes: string }>(
        `SELECT COUNT(*) AS total, COUNT(*) FILTER (WHERE a.presente = 1) AS presentes
           FROM reunion_asistencias a JOIN reuniones r ON r.id = a.reunion_id WHERE r.comision_id = ?`,
        [comisionId]
      ),
      undefined
    ),
    vacioSi(
      get<{ ultima: string | null }>(
        `SELECT MAX(f) AS ultima FROM (
           SELECT left(creado_en::text, 10) AS f FROM tareas WHERE comision_id = ?
           UNION ALL SELECT left(fecha::text, 10) FROM reuniones WHERE comision_id = ? AND fecha::text <= ?
           UNION ALL SELECT left(creado_en::text, 10) FROM comunicaciones WHERE comision_id = ?
           UNION ALL SELECT left(creado_en::text, 10) FROM decisiones_comision WHERE comision_id = ?
           UNION ALL SELECT left(fecha::text, 10) FROM notas_calendario WHERE comision_id = ? AND fecha <= ?
         ) x`,
        [comisionId, comisionId, hoy + "T23:59", comisionId, comisionId, comisionId, hoy]
      ),
      undefined
    ),
  ]);
  const enPlazo = pct(n(tareas?.en_plazo), n(tareas?.con_plazo));
  const solPlazo = pct(n(solicitudes?.en_plazo), n(solicitudes?.total));
  const asis = pct(n(asistencia?.presentes), n(asistencia?.total));
  const dias = actividad?.ultima ? Math.max(0, Math.round((Date.parse(hoy) - Date.parse(actividad.ultima)) / 86400000)) : null;
  return [
    { label: "Tareas en plazo", valor: textoPct(enPlazo), tono: tonoPct(enPlazo) },
    { label: "Tareas vencidas", valor: String(n(tareas?.vencidas)), tono: n(tareas?.vencidas) ? "rojo" : "verde" },
    { label: "Solicitudes respondidas en plazo", valor: textoPct(solPlazo), tono: tonoPct(solPlazo) },
    { label: "Asistencia a reuniones", valor: textoPct(asis), tono: tonoPct(asis, 70, 50) },
    { label: "Días sin actividad", valor: dias == null ? "—" : String(dias), tono: dias == null ? undefined : dias <= 14 ? "verde" : dias <= 30 ? "amarillo" : "rojo" },
  ];
}

// ---------- Paneles por función ----------

async function panelTrabajo(): Promise<Panel> {
  const hoy = hoyEnUruguay();
  const mes = hoy.slice(0, 7);
  const [libretas, faltas] = await Promise.all([
    vacioSi(cargarLibretas(hoy), []),
    vacioSi(
      get<{ n: string }>(`SELECT COUNT(*) AS n FROM asistencias_horas WHERE anulado_en IS NULL AND estado = 'ausente_injustificada' AND left(fecha, 7) = ?`, [mes]),
      undefined
    ),
  ]);
  const conSemana = libretas.filter((l) => l.semanaActual);
  const real = conSemana.reduce((a, l) => a + (l.semanaActual?.realMin ?? 0), 0);
  const exigible = conSemana.reduce((a, l) => a + (l.semanaActual?.exigibleMin ?? 0), 0);
  const alDia = libretas.filter((l) => l.saldoAcumuladoMin >= 0).length;
  const enRiesgo = libretas.filter((l) => l.saldoAcumuladoMin < 0).sort((a, b) => a.saldoAcumuladoMin - b.saldoAcumuladoMin);
  const cumplido = pct(real, exigible);
  return {
    kpis: [
      { label: "Horas cumplidas esta semana", valor: textoPct(cumplido), detalle: exigible ? `${textoHoras(real)} de ${textoHoras(exigible)}` : undefined, tono: tonoPct(cumplido) },
      { label: "Núcleos al día", valor: `${alDia} de ${libretas.length}`, tono: tonoPct(pct(alDia, libretas.length)) },
      { label: "Faltas sin justificar este mes", valor: String(n(faltas?.n)), tono: n(faltas?.n) ? "amarillo" : "verde" },
    ],
    bloques: [
      {
        titulo: "Núcleos que deben horas",
        items: enRiesgo.slice(0, 8).map((l) => ({ texto: l.nucleo.nombre, detalle: `debe ${textoHoras(-l.saldoAcumuladoMin)}`, tono: "amarillo" as Tono })),
        vacio: "Ningún núcleo debe horas.",
      },
    ],
    accesos: [
      { href: "/qr-obra", label: "QR de asistencia" },
      { href: "/socios/oficios", label: "Directorio de oficios" },
      { href: "/medidas", label: "Medidas propuestas" },
      { href: "/trabajo", label: "Jornadas de trabajo" },
    ],
  };
}

async function panelCompras(): Promise<Panel> {
  const hoy = hoyEnUruguay();
  const desde = sumarDias(hoy, -90);
  const reglamento = await obtenerReglamento();
  const [embudo, decididas, sinRecepcion, docsVencidos] = await Promise.all([
    vacioSi(all<{ estado: string; n: string }>(`SELECT estado, COUNT(*) AS n FROM solicitudes_compra WHERE eliminado_en IS NULL AND (estado NOT IN ('entregada', 'rechazada') OR left(actualizado_en, 10) >= ?) GROUP BY estado`, [desde]), []),
    vacioSi(
      all<{ dias: string | null; presupuestos: string; monto: number | null; estimado: number | null }>(
        `SELECT EXTRACT(EPOCH FROM (dc.fecha - s.creado_en)) / 86400 AS dias,
                (SELECT COUNT(*) FROM presupuestos_proveedor p WHERE p.solicitud_id = s.id) AS presupuestos,
                dc.monto, s.presupuesto_estimado AS estimado
           FROM decisiones_compra dc JOIN solicitudes_compra s ON s.id = dc.solicitud_id
          WHERE left(dc.fecha::text, 10) >= ? AND s.eliminado_en IS NULL`,
        [desde]
      ),
      []
    ),
    vacioSi(
      all<{ id: number; material: string; estado: string; desde: string }>(
        `SELECT s.id, s.material, s.estado, left(s.actualizado_en, 10) AS desde FROM solicitudes_compra s
          WHERE s.eliminado_en IS NULL AND s.estado IN ('aprobada', 'pedida')
            AND NOT EXISTS (SELECT 1 FROM recepciones_material r WHERE r.solicitud_id = s.id AND r.anulado_en IS NULL)
          ORDER BY s.actualizado_en`
      ),
      []
    ),
    vacioSi(proveedoresConDocVencida(hoy), new Map<number, string[]>()),
  ]);
  const cuenta = (e: string) => n(embudo.find((x) => x.estado === e)?.n);
  const tiempos = decididas.map((d) => Number(d.dias)).filter((d) => Number.isFinite(d) && d >= 0);
  const tiempo = tiempos.length ? Math.round(tiempos.reduce((a, b) => a + b, 0) / tiempos.length) : null;
  const conN = pct(decididas.filter((d) => n(d.presupuestos) >= reglamento.compras.presupuestosMinimos).length, decididas.length);
  const desvios = decididas.filter((d) => n(d.estimado) > 0 && n(d.monto) > 0).map((d) => (n(d.monto) - n(d.estimado)) / n(d.estimado));
  const desvio = desvios.length ? Math.round((desvios.reduce((a, b) => a + b, 0) / desvios.length) * 100) : null;
  const proveedores = docsVencidos.size
    ? await vacioSi(all<{ id: number; nombre: string }>(`SELECT id, nombre FROM proveedores WHERE id = ANY(?::int[]) ORDER BY nombre`, [[...docsVencidos.keys()]]), [])
    : [];
  return {
    kpis: [
      { label: "Tiempo de compra (promedio)", valor: tiempo == null ? "—" : `${tiempo} días`, detalle: "de la solicitud a la decisión, últimos 90 días" },
      { label: `Con ${reglamento.compras.presupuestosMinimos} presupuestos o más`, valor: textoPct(conN), tono: tonoPct(conN) },
      { label: "Desvío contra lo estimado", valor: desvio == null ? "—" : `${desvio > 0 ? "+" : ""}${desvio} %`, tono: desvio == null ? undefined : Math.abs(desvio) <= 10 ? "verde" : Math.abs(desvio) <= 25 ? "amarillo" : "rojo" },
      { label: "Compras sin recepción", valor: String(sinRecepcion.length), tono: sinRecepcion.length ? "amarillo" : "verde" },
    ],
    bloques: [
      {
        titulo: "Embudo de compras",
        items: [
          { texto: "Esperando presupuestos", detalle: String(cuenta("pendiente_cotizacion")) },
          { texto: "Comparando presupuestos", detalle: String(cuenta("en_comparacion")) },
          { texto: "Aprobadas (falta pedir)", detalle: String(cuenta("aprobada")) },
          { texto: "Pedidas al proveedor", detalle: String(cuenta("pedida")) },
          { texto: "Entregadas (últimos 90 días)", detalle: String(cuenta("entregada")) },
        ],
        vacio: "",
        verTodo: { href: "/compras", label: "Ir a Compras" },
      },
      {
        titulo: "Compras que esperan su recepción",
        items: sinRecepcion.slice(0, 8).map((s) => ({ texto: s.material, detalle: `${s.estado === "pedida" ? "pedida" : "aprobada"} el ${dmy(s.desde)}`, href: `/compras/${s.id}` })),
        vacio: "No hay compras esperando recepción.",
        verTodo: { href: "/compras/recepciones", label: "Recepciones" },
      },
      {
        titulo: "Proveedores con documentación vencida",
        items: proveedores.map((p) => ({ texto: p.nombre, detalle: (docsVencidos.get(p.id) ?? []).join(", "), href: `/proveedores/${p.id}`, tono: "rojo" as Tono })),
        vacio: "Todos los proveedores tienen la documentación al día.",
      },
    ],
    accesos: [
      { href: "/compras", label: "Compras" },
      { href: "/compras/recepciones", label: "Recepción de materiales" },
      { href: "/proveedores", label: "Proveedores" },
    ],
  };
}

async function panelSeguridad(): Promise<Panel> {
  const hoy = hoyEnUruguay();
  const [checklist, ultimaInsp, incidentes, ultimoIncidente, correctivas, personas, conInduccion, conEpp] = await Promise.all([
    vacioSi(get<{ id: number; checklist_json: string }>(`SELECT id, checklist_json FROM inspecciones_seguridad WHERE tipo = 'diaria' AND dia = ? LIMIT 1`, [hoy]), undefined),
    vacioSi(get<{ f: string | null }>(`SELECT MAX(left(fecha::text, 10)) AS f FROM inspecciones_seguridad`), undefined),
    vacioSi(all<{ id: number; tipo: string; severidad: string; descripcion: string; f: string }>(`SELECT id, tipo, severidad, descripcion, left(fecha::text, 10) AS f FROM incidentes_seguridad WHERE estado = 'abierto' ORDER BY fecha DESC`), []),
    vacioSi(get<{ f: string | null }>(`SELECT MAX(left(fecha::text, 10)) AS f FROM incidentes_seguridad WHERE tipo IN ('incidente', 'accidente')`), undefined),
    vacioSi(
      get<{ vencidas: string; en_plazo: string; abiertas: string }>(
        `SELECT COUNT(*) FILTER (WHERE fecha_vencimiento < ?) AS vencidas,
                COUNT(*) FILTER (WHERE fecha_vencimiento < ? AND estado = 'completada') AS en_plazo,
                COUNT(*) FILTER (WHERE estado <> 'completada') AS abiertas
           FROM tareas WHERE inspeccion_id IS NOT NULL`,
        [hoy, hoy]
      ),
      undefined
    ),
    vacioSi(personasDeLaCooperativa(), []),
    vacioSi(personasConInduccion(), new Set<string>()),
    vacioSi(all<{ k: string }>(`SELECT DISTINCT COALESCE('i-' || integrante_id, 's-' || socio_id) AS k FROM epp_entregas WHERE anulado_en IS NULL`), []),
  ]);
  const epp = new Set(conEpp.map((x) => x.k));
  const sinInduccion = conInduccion.size ? personas.filter((p) => !conInduccion.has(p.clave)) : [];
  const sinEpp = personas.filter((p) => !epp.has(p.clave));
  const dias = ultimoIncidente?.f ? Math.max(0, Math.round((Date.parse(hoy) - Date.parse(ultimoIncidente.f)) / 86400000)) : null;
  const corregidas = pct(n(correctivas?.en_plazo), n(correctivas?.vencidas));
  return {
    kpis: [
      { label: "Días sin incidentes", valor: dias == null ? "Ninguno registrado" : String(dias), tono: dias == null || dias >= 30 ? "verde" : dias >= 7 ? "amarillo" : "rojo" },
      { label: "Observaciones corregidas en plazo", valor: textoPct(corregidas), tono: tonoPct(corregidas), detalle: n(correctivas?.abiertas) ? `${n(correctivas?.abiertas)} sin corregir` : undefined },
      { label: "Checklist de hoy", valor: checklist ? "Hecho" : "Sin hacer", tono: checklist ? "verde" : "amarillo" },
      { label: "Incidentes abiertos", valor: String(incidentes.length), tono: incidentes.length ? "rojo" : "verde" },
    ],
    bloques: [
      {
        titulo: "Incidentes abiertos",
        items: incidentes.slice(0, 6).map((i) => ({ texto: `${i.tipo} — ${i.severidad}`, detalle: `${dmy(i.f)} · ${i.descripcion.slice(0, 80)}`, href: "/seguridad", tono: i.severidad === "critica" ? ("rojo" as Tono) : ("amarillo" as Tono) })),
        vacio: "No hay incidentes abiertos.",
      },
      {
        titulo: "Personas sin inducción",
        items: sinInduccion.slice(0, 8).map((p) => ({ texto: p.nombre, detalle: p.nucleo ?? undefined })),
        vacio: conInduccion.size ? "Todas las personas tienen la inducción." : "Todavía no se registró ninguna inducción.",
        verTodo: { href: "/seguridad/induccion", label: "Inducción" },
      },
      {
        titulo: "EPP pendiente (sin ningún elemento entregado)",
        items: sinEpp.slice(0, 8).map((p) => ({ texto: p.nombre, detalle: p.nucleo ?? undefined })),
        vacio: "Todas las personas recibieron sus elementos de protección.",
        verTodo: { href: "/seguridad/epp", label: "EPP" },
      },
    ],
    accesos: [
      { href: "/seguridad/hoy", label: "Checklist de hoy" },
      { href: "/seguridad", label: `Inspecciones${ultimaInsp?.f ? ` (última ${dmy(ultimaInsp.f)})` : ""}` },
      { href: "/seguridad/epp", label: "EPP" },
      { href: "/seguridad/induccion", label: "Inducción" },
    ],
  };
}

async function panelObra(): Promise<Panel> {
  const hoy = hoyEnUruguay();
  const [rubros, plan, origen, diario, atrasadas] = await Promise.all([
    cargarRubros(),
    planificadoAl(hoy.slice(0, 7)),
    origenFinanciero(),
    vacioSi(get<{ f: string | null }>(`SELECT MAX(fecha) AS f FROM diario_obra WHERE anulado_en IS NULL`), undefined),
    vacioSi(all<{ id: number; nombre: string; fin: string }>(`SELECT id, nombre, fecha_fin_prevista AS fin FROM tareas_obra WHERE estado <> 'completada' AND fecha_fin_prevista < ? ORDER BY fecha_fin_prevista LIMIT 8`, [hoy]), []),
  ]);
  const presupuesto = rubros.reduce((a, r) => a + r.monto, 0);
  const fisico = avanceFisico(rubros);
  const financiero = presupuesto > 0 ? Math.round((n(await gastoObra(origen)) / presupuesto) * 1000) / 10 : null;
  const diasDiario = diario?.f ? Math.max(0, Math.round((Date.parse(hoy) - Date.parse(diario.f)) / 86400000)) : null;
  return {
    kpis: [
      { label: "Avance físico", valor: rubros.length ? `${fisico.toLocaleString("es-UY")} %` : "—", detalle: plan != null ? `planificado ${plan.toLocaleString("es-UY")} %` : undefined, tono: plan == null || !rubros.length ? undefined : fisico >= plan - 2 ? "verde" : fisico >= plan - 10 ? "amarillo" : "rojo" },
      { label: "Avance financiero", valor: financiero == null ? "—" : `${financiero.toLocaleString("es-UY")} %`, detalle: presupuesto ? `de ${pesos(presupuesto)}` : undefined, tono: financiero == null || !rubros.length ? undefined : financiero - fisico > 10 ? "amarillo" : "verde" },
      { label: "Diario de obra", valor: diasDiario == null ? "Sin entradas" : diasDiario === 0 ? "Al día" : `hace ${diasDiario} días`, tono: diasDiario == null ? undefined : diasDiario <= 2 ? "verde" : diasDiario <= 7 ? "amarillo" : "rojo" },
    ],
    bloques: [
      {
        titulo: "Avance por rubro",
        items: rubros.map((r) => ({ texto: r.nombre, detalle: `${r.avance.toLocaleString("es-UY")} % (incidencia ${r.peso_pct.toLocaleString("es-UY")} %)` })),
        vacio: "Todavía no se cargaron los rubros.",
        verTodo: { href: "/obra/avance", label: "Avance físico y financiero" },
      },
      {
        titulo: "Hitos atrasados",
        items: atrasadas.map((t) => ({ texto: t.nombre, detalle: `vencía el ${dmy(t.fin)}`, href: `/obra/${t.id}`, tono: "rojo" as Tono })),
        vacio: "No hay hitos atrasados.",
        verTodo: { href: "/obra", label: "Cronograma" },
      },
    ],
    accesos: [
      { href: "/obra/avance", label: "Avance físico y financiero" },
      { href: "/obra/diario", label: "Diario de obra" },
      { href: "/obra/panol", label: "Pañol" },
    ],
  };
}

async function panelAdministrativa(): Promise<Panel> {
  const hoy = hoyEnUruguay();
  const en30 = sumarDias(hoy, 30);
  const [porResponder, docs, sinActa, altas, bajas] = await Promise.all([
    vacioSi(
      all<{ id: number; contraparte: string; asunto: string; fecha: string; responder_antes: string | null }>(
        `SELECT id, contraparte, asunto, fecha, responder_antes FROM correspondencia
          WHERE anulado_en IS NULL AND tipo = 'entrada' AND requiere_respuesta = 1 AND respondida_en IS NULL ORDER BY COALESCE(responder_antes, fecha)`
      ),
      []
    ),
    vacioSi(
      all<{ id: number; nombre: string; venc: string }>(
        `SELECT id, nombre, fecha_vencimiento AS venc FROM documentos WHERE eliminado_en IS NULL AND COALESCE(estado, 'vigente') <> 'reemplazado' AND fecha_vencimiento IS NOT NULL AND fecha_vencimiento <= ? ORDER BY fecha_vencimiento`,
        [en30]
      ),
      []
    ),
    vacioSi(
      all<{ id: number; titulo: string; fecha: string }>(
        `SELECT id, titulo, left(fecha, 10) AS fecha FROM reuniones WHERE estado = 'realizada' AND acta_id IS NULL AND tipo IN ('asamblea', 'consejo_directivo') ORDER BY fecha`
      ),
      []
    ),
    vacioSi(all<{ id: number; nombre: string }>(`SELECT id, nombre FROM socios WHERE estado = 'activo' AND ingreso_completo_en IS NULL AND creado_en >= ? ORDER BY creado_en DESC LIMIT 8`, [sumarDias(hoy, -180)]), []),
    vacioSi(all<{ id: number; nombre: string }>(`SELECT id, nombre FROM socios WHERE estado = 'renunciante' ORDER BY nombre LIMIT 8`), []),
  ]);
  const vencidos = docs.filter((d) => d.venc < hoy);
  return {
    kpis: [
      { label: "Documentos vencidos", valor: String(vencidos.length), tono: vencidos.length ? "rojo" : "verde", detalle: docs.length - vencidos.length ? `${docs.length - vencidos.length} vencen en 30 días` : undefined },
      { label: "Actas atrasadas", valor: String(sinActa.length), tono: sinActa.length ? "amarillo" : "verde", detalle: "reuniones realizadas sin acta" },
      { label: "Correspondencia por responder", valor: String(porResponder.length), tono: porResponder.some((c) => c.responder_antes && c.responder_antes < hoy) ? "rojo" : porResponder.length ? "amarillo" : "verde" },
    ],
    bloques: [
      {
        titulo: "Correspondencia que espera respuesta",
        items: porResponder.slice(0, 8).map((c) => ({ texto: `${c.contraparte}: ${c.asunto}`, detalle: c.responder_antes ? `responder antes del ${dmy(c.responder_antes)}` : `llegó el ${dmy(c.fecha)}`, tono: c.responder_antes && c.responder_antes < hoy ? ("rojo" as Tono) : undefined })),
        vacio: "No hay correspondencia pendiente de respuesta.",
      },
      {
        titulo: "Vencimientos de documentos",
        items: docs.slice(0, 8).map((d) => ({ texto: d.nombre, detalle: d.venc < hoy ? `venció el ${dmy(d.venc)}` : `vence el ${dmy(d.venc)}`, href: "/documentos", tono: d.venc < hoy ? ("rojo" as Tono) : ("amarillo" as Tono) })),
        vacio: "No hay documentos vencidos ni por vencer.",
      },
      {
        titulo: "Reuniones sin acta",
        items: sinActa.slice(0, 8).map((r) => ({ texto: r.titulo, detalle: dmy(r.fecha), href: `/reuniones/${r.id}` })),
        vacio: "Las actas están al día.",
        verTodo: { href: "/libros-sociales", label: "Libros sociales" },
      },
      {
        titulo: "Altas y bajas en trámite",
        items: [
          ...altas.map((s) => ({ texto: s.nombre, detalle: "alta: falta completar el ingreso", href: `/socios/${s.id}` })),
          ...bajas.map((s) => ({ texto: s.nombre, detalle: "baja: renunciante", href: `/socios/${s.id}` })),
        ],
        vacio: "No hay altas ni bajas en trámite.",
      },
    ],
    accesos: [
      { href: "/documentos", label: "Documentos" },
      { href: "/libros-sociales", label: "Libros sociales" },
      { href: "/plantillas", label: "Plantillas" },
    ],
    formularios: ["correspondencia"],
  };
}

const ENTIDADES_SENSIBLES = ["movimientos_financieros", "movimientos_cuenta_socio", "recibos", "convenios_pago", "periodos_financieros", "facturas_proveedor", "compromisos_futuros", "decisiones_compra"];

async function panelFiscal(): Promise<Panel> {
  const hoy = hoyEnUruguay();
  const [cambios, cierres, visados, alertas] = await Promise.all([
    vacioSi(
      all<{ id: number; accion: string; entidad: string; usuario: string | null; f: string }>(
        `SELECT a.id, a.accion, a.entidad, u.nombre AS usuario, left(a.fecha::text, 10) AS f FROM auditoria a LEFT JOIN users u ON u.id = a.usuario_id
          WHERE a.entidad = ANY(?::text[]) AND a.accion IN ('anular', 'editar', 'eliminar', 'reabrir_periodo', 'anular_pago', 'anular_movimiento', 'editar_movimiento') AND left(a.fecha::text, 10) >= ?
          ORDER BY a.fecha DESC LIMIT 10`,
        [ENTIDADES_SENSIBLES, sumarDias(hoy, -30)]
      ),
      []
    ),
    vacioSi(all<{ periodo: string; observacion_fiscal: string | null }>(`SELECT periodo, observacion_fiscal FROM periodos_financieros WHERE estado = 'cerrado' ORDER BY periodo`), []),
    vacioSi(get<{ n: string; total: string }>(`SELECT COUNT(*) FILTER (WHERE estado = 'visado') AS n, COUNT(*) FILTER (WHERE estado IN ('cerrado', 'visado')) AS total FROM periodos_financieros`), undefined),
    vacioSi(all<{ id: number; titulo: string; f: string }>(`SELECT id, titulo, left(fecha::text, 10) AS f FROM alertas WHERE COALESCE(estado, 'abierta') <> 'resuelta' ORDER BY fecha DESC LIMIT 6`), []),
  ]);
  const observados = cierres.filter((c) => c.observacion_fiscal);
  return {
    kpis: [
      { label: "Cierres visados", valor: visados && n(visados.total) ? `${n(visados.n)} de ${n(visados.total)}` : "—", tono: cierres.length ? "amarillo" : "verde" },
      { label: "Observaciones abiertas", valor: String(observados.length), tono: observados.length ? "amarillo" : "verde" },
      { label: "Cambios sensibles (30 días)", valor: String(cambios.length), tono: cambios.length > 5 ? "amarillo" : undefined },
    ],
    bloques: [
      {
        titulo: "Cierres para visar",
        items: cierres.map((c) => ({ texto: `Mes ${c.periodo.split("-").reverse().join("/")}`, detalle: c.observacion_fiscal ? `observado: ${c.observacion_fiscal.slice(0, 80)}` : "esperando el visto", href: "/finanzas/cierre", tono: c.observacion_fiscal ? ("amarillo" as Tono) : undefined })),
        vacio: "No hay meses cerrados esperando el visto.",
      },
      {
        titulo: "Cambios sensibles",
        items: cambios.map((c) => ({ texto: `${c.usuario ?? "El sistema"}: ${c.accion.replace(/_/g, " ")} (${c.entidad.replace(/_/g, " ")})`, detalle: dmy(c.f), href: "/auditoria" })),
        vacio: "No hubo cambios sensibles en los últimos 30 días.",
        verTodo: { href: "/auditoria", label: "Auditoría" },
      },
      {
        titulo: "Anomalías y alertas",
        items: alertas.map((a) => ({ texto: a.titulo, detalle: dmy(a.f), href: "/alertas", tono: "amarillo" as Tono })),
        vacio: "No hay alertas abiertas.",
      },
    ],
    accesos: [
      { href: "/fiscal", label: "Control fiscal" },
      { href: "/finanzas/cierre", label: "Cierres del mes" },
      { href: "/auditoria", label: "Auditoría" },
    ],
  };
}

async function panelElectoral(): Promise<Panel> {
  const hoy = hoyEnUruguay();
  const [padron, mandatos, elecciones, listas] = await Promise.all([
    vacioSi(get<{ n: string }>(`SELECT COUNT(*) AS n FROM socios WHERE estado = 'activo'`), undefined),
    vacioSi(
      all<{ id: number; cargo: string; organo: string | null; nombre: string; fin: string }>(
        `SELECT c.id, c.cargo, c.organo, u.nombre, c.fecha_fin_prevista AS fin FROM consejo_directivo_cargos c JOIN users u ON u.id = c.user_id
          WHERE c.fecha_fin IS NULL AND c.fecha_fin_prevista IS NOT NULL AND c.fecha_fin_prevista <= ? ORDER BY c.fecha_fin_prevista`,
        [sumarDias(hoy, 120)]
      ),
      []
    ),
    vacioSi(
      all<{ id: number; titulo: string; fecha_eleccion: string; fecha_cierre_listas: string | null; organos: string | null }>(
        `SELECT id, titulo, fecha_eleccion, fecha_cierre_listas, organos FROM elecciones WHERE estado = 'abierta' ORDER BY fecha_eleccion`
      ),
      []
    ),
    vacioSi(all<{ id: number; eleccion_id: number; nombre: string; estado: string; presentada_en: string }>(`SELECT id, eleccion_id, nombre, estado, presentada_en FROM listas_electorales WHERE estado <> 'retirada' ORDER BY presentada_en`), []),
  ]);
  const proxima = elecciones[0];
  const cronograma: ItemPanel[] = [];
  for (const e of elecciones) {
    if (e.fecha_cierre_listas) cronograma.push({ texto: `${e.titulo}: cierre de listas`, detalle: dmy(e.fecha_cierre_listas), tono: e.fecha_cierre_listas < hoy ? undefined : "amarillo" });
    cronograma.push({ texto: `${e.titulo}: elección${e.organos ? ` (${e.organos})` : ""}`, detalle: dmy(e.fecha_eleccion) });
  }
  for (const m of mandatos) cronograma.push({ texto: `Vence el mandato de ${m.nombre} (${m.cargo.replace(/_/g, " ")})`, detalle: dmy(m.fin), tono: m.fin < hoy ? "rojo" : "amarillo", href: "/consejo-directivo" });
  cronograma.sort((a, b) => ((a.detalle ?? "").split("/").reverse().join("") < (b.detalle ?? "").split("/").reverse().join("") ? -1 : 1));
  const ESTADO_LISTA: Record<string, string> = { presentada: "presentada", aceptada: "aceptada", observada: "observada" };
  return {
    kpis: [
      { label: "Padrón (socios activos)", valor: String(n(padron?.n)) },
      { label: "Próxima elección", valor: proxima ? dmy(proxima.fecha_eleccion) : "Sin fecha" },
      { label: "Mandatos que vencen (4 meses)", valor: String(mandatos.length), tono: mandatos.length ? "amarillo" : "verde" },
    ],
    bloques: [
      { titulo: "Cronograma", items: cronograma, vacio: "No hay elecciones ni vencimientos de mandatos cerca." },
      {
        titulo: "Listas presentadas",
        items: listas.map((l) => ({ texto: l.nombre, detalle: `${ESTADO_LISTA[l.estado] ?? l.estado} el ${dmy(l.presentada_en)} · ${elecciones.find((e) => e.id === l.eleccion_id)?.titulo ?? ""}`, tono: l.estado === "observada" ? ("amarillo" as Tono) : undefined })),
        vacio: "Todavía no se presentaron listas.",
      },
    ],
    accesos: [
      { href: "/consejo-directivo", label: "Consejo y cargos" },
      { href: "/asambleas", label: "Asambleas" },
      { href: "/socios", label: "Padrón de socios" },
    ],
    formularios: ["eleccion"],
  };
}

async function panelMantenimiento(): Promise<Panel> {
  const [abiertos, resueltos, fondo] = await Promise.all([
    vacioSi(all<{ id: number; titulo: string; prioridad: string; fecha: string }>(`SELECT id, titulo, prioridad, fecha FROM reclamos WHERE estado NOT IN ('resuelto', 'cerrado') ORDER BY CASE prioridad WHEN 'alta' THEN 0 WHEN 'media' THEN 1 ELSE 2 END, fecha`), []),
    vacioSi(all<{ dias: string }>(`SELECT (left(resuelto_en, 10)::date - left(fecha, 10)::date) AS dias FROM reclamos WHERE resuelto_en IS NOT NULL AND left(resuelto_en, 10) >= ?`, [sumarDias(hoyEnUruguay(), -180)]), []),
    vacioSi(
      get<{ saldo: string; gastado: string }>(
        `SELECT COALESCE(SUM(f.saldo_inicial), 0) + COALESCE((SELECT SUM(CASE WHEN m.tipo = 'ingreso' THEN m.monto ELSE -m.monto END) FROM movimientos_financieros m WHERE m.fondo_id IN (SELECT id FROM fondos WHERE tipo = 'mantenimiento') AND COALESCE(m.estado, 'activo') <> 'anulado'), 0) AS saldo,
                COALESCE((SELECT SUM(m.monto) FROM movimientos_financieros m WHERE m.tipo = 'egreso' AND m.fondo_id IN (SELECT id FROM fondos WHERE tipo = 'mantenimiento') AND COALESCE(m.estado, 'activo') <> 'anulado' AND left(m.fecha::text, 4) = ?), 0) AS gastado
           FROM fondos f WHERE f.tipo = 'mantenimiento' AND f.activo = 1`,
        [hoyEnUruguay().slice(0, 4)]
      ),
      undefined
    ),
  ]);
  const tiempos = resueltos.map((r) => Number(r.dias)).filter((d) => Number.isFinite(d) && d >= 0);
  const tiempo = tiempos.length ? Math.round(tiempos.reduce((a, b) => a + b, 0) / tiempos.length) : null;
  const hoy = hoyEnUruguay();
  const preventivo = await vacioSi(
    all<{ id: number; titulo: string; proxima_fecha: string }>(`SELECT id, titulo, proxima_fecha FROM mantenimiento_preventivo WHERE activo = 1 AND proxima_fecha <= ? ORDER BY proxima_fecha`, [sumarDias(hoy, 14)]),
    []
  );
  return {
    kpis: [
      { label: "Tiempo de resolución (promedio)", valor: tiempo == null ? "—" : `${tiempo} días`, tono: tiempo == null ? undefined : tiempo <= 7 ? "verde" : tiempo <= 21 ? "amarillo" : "rojo" },
      { label: "Solicitudes abiertas", valor: String(abiertos.length), tono: abiertos.length > 10 ? "amarillo" : undefined },
      { label: "Fondo de mantenimiento", valor: fondo ? pesos(n(fondo.saldo)) : "—", detalle: fondo ? `gastado este año ${pesos(n(fondo.gastado))}` : "sin fondo de mantenimiento" },
    ],
    bloques: [
      {
        titulo: "Solicitudes de mantenimiento abiertas",
        items: abiertos.slice(0, 10).map((r) => ({ texto: r.titulo, detalle: `${r.prioridad} · desde el ${dmy(r.fecha)}`, href: `/reclamos/${r.id}`, tono: r.prioridad === "alta" ? ("rojo" as Tono) : undefined })),
        vacio: "No hay solicitudes abiertas.",
        verTodo: { href: "/reclamos", label: "Reclamos y mantenimiento" },
      },
      {
        titulo: "Mantenimiento preventivo (atrasado o próximo)",
        items: preventivo.map((p) => ({ texto: p.titulo, detalle: p.proxima_fecha < hoy ? `atrasado desde el ${dmy(p.proxima_fecha)}` : `el ${dmy(p.proxima_fecha)}`, href: "/mantenimiento", tono: p.proxima_fecha < hoy ? ("rojo" as Tono) : ("amarillo" as Tono) })),
        vacio: "El preventivo está al día.",
        verTodo: { href: "/mantenimiento", label: "Plan de mantenimiento" },
      },
    ],
    accesos: [
      { href: "/reclamos", label: "Reclamos y mantenimiento" },
      { href: "/mantenimiento", label: "Mantenimiento preventivo" },
      { href: "/reservas", label: "Reservas de espacios" },
    ],
  };
}

async function panelActividades(comisionId: number): Promise<Panel> {
  const hoy = hoyEnUruguay();
  const [proximas, pasadas] = await Promise.all([
    vacioSi(all<{ id: number; titulo: string; fecha: string }>(`SELECT id, titulo, fecha FROM notas_calendario WHERE comision_id = ? AND fecha >= ? ORDER BY fecha LIMIT 8`, [comisionId, hoy]), []),
    vacioSi(
      all<{ id: number; titulo: string; fecha: string; participantes: string }>(
        `SELECT n.id, n.titulo, n.fecha, (SELECT COUNT(*) FROM actividad_participantes p WHERE p.nota_id = n.id) AS participantes
           FROM notas_calendario n WHERE n.comision_id = ? AND n.fecha < ? AND n.fecha >= ? ORDER BY n.fecha DESC`,
        [comisionId, hoy, sumarDias(hoy, -365)]
      ),
      []
    ),
  ]);
  const promedio = pasadas.length ? Math.round(pasadas.reduce((a, p) => a + n(p.participantes), 0) / pasadas.length) : null;
  return {
    kpis: [
      { label: "Actividades en el último año", valor: String(pasadas.length) },
      { label: "Participación promedio", valor: promedio == null ? "—" : `${promedio} personas` },
      { label: "Próximas actividades", valor: String(proximas.length) },
    ],
    bloques: [
      { titulo: "Próximas actividades", items: proximas.map((a) => ({ texto: a.titulo, detalle: dmy(a.fecha) })), vacio: "No hay actividades agendadas." },
      { titulo: "Últimas actividades", items: pasadas.slice(0, 6).map((a) => ({ texto: a.titulo, detalle: `${dmy(a.fecha)} · ${n(a.participantes)} personas` })), vacio: "Sin actividades en el último año." },
    ],
    accesos: [{ href: "/calendario", label: "Calendario" }],
  };
}

const PANELES: Record<FuncionComision, (comisionId: number) => Promise<Panel>> = {
  trabajo: () => panelTrabajo(),
  compras: () => panelCompras(),
  seguridad: () => panelSeguridad(),
  obra: () => panelObra(),
  administrativa: () => panelAdministrativa(),
  fiscal: () => panelFiscal(),
  electoral: () => panelElectoral(),
  mantenimiento: () => panelMantenimiento(),
  fomento: (id) => panelActividades(id),
  general: (id) => panelActividades(id),
};

export async function panelDeFuncion(funcion: FuncionComision, comisionId: number): Promise<Panel | null> {
  try {
    return await PANELES[funcion](comisionId);
  } catch (err) {
    console.error("[panel de comisión]", funcion, err);
    return null;
  }
}

// ---------- Datos de los formularios propios ----------

export type FilaCorrespondencia = {
  id: number;
  tipo: "entrada" | "salida";
  fecha: string;
  contraparte: string;
  asunto: string;
  referencia: string | null;
  requiere_respuesta: number;
  responder_antes: string | null;
  respondida_en: string | null;
  responsable: string | null;
};

export async function correspondenciaReciente(): Promise<FilaCorrespondencia[]> {
  return vacioSi(
    all<FilaCorrespondencia>(
      `SELECT c.id, c.tipo, c.fecha, c.contraparte, c.asunto, c.referencia, c.requiere_respuesta, c.responder_antes, c.respondida_en, u.nombre AS responsable
         FROM correspondencia c LEFT JOIN users u ON u.id = c.responsable_id
        WHERE c.anulado_en IS NULL ORDER BY c.fecha DESC, c.id DESC LIMIT 30`
    ),
    []
  );
}

export type EleccionConListas = {
  id: number;
  titulo: string;
  organos: string | null;
  fecha_cierre_listas: string | null;
  fecha_eleccion: string;
  listas: { id: number; nombre: string; integrantes: string; estado: string; presentada_en: string; observaciones: string | null }[];
};

export async function eleccionesAbiertas(): Promise<EleccionConListas[]> {
  const [elecciones, listas] = await Promise.all([
    vacioSi(
      all<Omit<EleccionConListas, "listas">>(`SELECT id, titulo, organos, fecha_cierre_listas, fecha_eleccion FROM elecciones WHERE estado = 'abierta' ORDER BY fecha_eleccion`),
      []
    ),
    vacioSi(
      all<EleccionConListas["listas"][number] & { eleccion_id: number }>(
        `SELECT id, eleccion_id, nombre, integrantes, estado, presentada_en, observaciones FROM listas_electorales WHERE estado <> 'retirada' ORDER BY presentada_en, id`
      ),
      []
    ),
  ]);
  return elecciones.map((e) => ({ ...e, listas: listas.filter((l) => l.eleccion_id === e.id) }));
}
