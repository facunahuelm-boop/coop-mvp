import dayjs from "dayjs";
import { all, get, upsertAlerta, insert } from "./db";
import { enviarEmailAlerta } from "./email";

// Crea o actualiza una alerta y, si es realmente nueva (no existía ya abierta),
// dispara el email a la casilla configurada en Configuración (si hay una cargada).
async function crearAlerta(params: Parameters<typeof upsertAlerta>[0]) {
  const { esNueva } = await upsertAlerta(params);
  if (esNueva) {
    await enviarEmailAlerta({
      tipo: params.tipo,
      severidad: params.severidad,
      titulo: params.titulo,
      descripcion: params.descripcion,
      origen_modulo: params.origen_modulo,
    });
  }
}

// ============ SEMÁFORO DE OBRA ============
export type Semaforo = "verde" | "amarillo" | "rojo";

export async function semaforoTarea(tarea: {
  estado: string;
  fecha_fin_prevista: string | null;
  id: number;
}): Promise<Semaforo> {
  if (tarea.estado === "completada") return "verde";
  const problemasCriticos = await get<{ n: number }>(
    `SELECT COUNT(*) as n FROM problemas_obra WHERE tarea_id = ? AND estado = 'abierto' AND severidad = 'critica'`,
    [tarea.id]
  );
  if (problemasCriticos && problemasCriticos.n > 0) return "rojo";

  if (tarea.fecha_fin_prevista) {
    const dias = dayjs(tarea.fecha_fin_prevista).diff(dayjs(), "day");
    if (dias < 0) return "rojo";
    if (dias <= 5) return "amarillo";
  }
  const problemasAbiertos = await get<{ n: number }>(
    `SELECT COUNT(*) as n FROM problemas_obra WHERE tarea_id = ? AND estado = 'abierto'`,
    [tarea.id]
  );
  if (problemasAbiertos && problemasAbiertos.n > 0) return "amarillo";
  return "verde";
}

export async function tareasObraConSemaforo() {
  const tareas = await all<any>(
    `SELECT t.*, u.nombre as responsable_nombre, d.nombre as depende_de_nombre
     FROM tareas_obra t
     LEFT JOIN users u ON u.id = t.responsable_id
     LEFT JOIN tareas_obra d ON d.id = t.depende_de_id
     ORDER BY t.fecha_fin_prevista ASC`
  );
  return Promise.all(tareas.map(async (t) => ({ ...t, semaforo: await semaforoTarea(t) })));
}

// ============ FINANZAS ============
export async function resumenFinanciero() {
  const en30dias = dayjs().add(30, "day").format("YYYY-MM-DD");

  const [ingresosRow, egresosRow, comprometidoRow, gastosProyectadosRow, porCategoria, presupuestoVsReal] =
    await Promise.all([
      get<{ s: number }>(`SELECT COALESCE(SUM(monto),0) as s FROM movimientos_financieros WHERE tipo = 'ingreso'`),
      get<{ s: number }>(`SELECT COALESCE(SUM(monto),0) as s FROM movimientos_financieros WHERE tipo = 'egreso'`),
      get<{ s: number }>(`SELECT COALESCE(SUM(monto),0) as s FROM compromisos_futuros`),
      get<{ s: number }>(
        `SELECT COALESCE(SUM(monto),0) as s FROM compromisos_futuros WHERE fecha_estimada <= ?`,
        [en30dias]
      ),
      all<{ categoria: string; total: number }>(
        `SELECT categoria, COALESCE(SUM(monto),0) as total FROM movimientos_financieros WHERE tipo='egreso' GROUP BY categoria ORDER BY total DESC`
      ),
      all<any>(
        `SELECT p.categoria, p.monto_presupuestado,
           COALESCE((SELECT SUM(monto) FROM movimientos_financieros m WHERE m.categoria = p.categoria AND m.tipo='egreso'), 0) as gastado
         FROM presupuesto_general p`
      ),
    ]);

  const ingresos = ingresosRow?.s ?? 0;
  const egresos = egresosRow?.s ?? 0;
  const saldo = ingresos - egresos;
  const comprometido = comprometidoRow?.s ?? 0;
  const gastosProyectados = gastosProyectadosRow?.s ?? 0;
  const disponiblePrudencial = saldo - comprometido;

  return { ingresos, egresos, saldo, comprometido, gastosProyectados, disponiblePrudencial, porCategoria, presupuestoVsReal };
}

// ============ MOTOR DE ALERTAS ============
// Recalcula alertas automáticas a partir de los datos actuales.
// Los umbrales son un punto de partida configurable (ver sección 12 del análisis).
export async function recalcularAlertas() {
  // Documentos de seguridad vencidos / próximos a vencer
  const docs = await all<any>(`SELECT * FROM documentos_seguridad WHERE fecha_vencimiento IS NOT NULL`);
  const hoy = dayjs();
  for (const d of docs) {
    const dias = dayjs(d.fecha_vencimiento).diff(hoy, "day");
    if (dias < 0) {
      await crearAlerta({
        tipo: "documento_vencido",
        severidad: "critica",
        origen_modulo: "seguridad",
        titulo: `Documento vencido: ${d.tipo}`,
        descripcion: `${d.descripcion || d.tipo} venció el ${d.fecha_vencimiento}.`,
        asignado_a_rol: "comision_seguridad",
        ref_tabla: "documentos_seguridad",
        ref_id: d.id,
      });
    } else if (dias <= 15) {
      await crearAlerta({
        tipo: "documento_por_vencer",
        severidad: "importante",
        origen_modulo: "seguridad",
        titulo: `Documento próximo a vencer: ${d.tipo}`,
        descripcion: `${d.descripcion || d.tipo} vence el ${d.fecha_vencimiento} (${dias} días).`,
        asignado_a_rol: "comision_seguridad",
        ref_tabla: "documentos_seguridad",
        ref_id: d.id,
      });
    }
  }

  // Incidentes de seguridad críticos abiertos
  const incidentesCriticos = await all<any>(
    `SELECT * FROM incidentes_seguridad WHERE estado != 'resuelto' AND severidad = 'critica'`
  );
  for (const i of incidentesCriticos) {
    await crearAlerta({
      tipo: "riesgo_critico",
      severidad: "critica",
      origen_modulo: "seguridad",
      titulo: "Riesgo crítico de seguridad abierto",
      descripcion: i.descripcion,
      asignado_a_rol: "consejo_directivo",
      ref_tabla: "incidentes_seguridad",
      ref_id: i.id,
    });
  }

  // Tareas de obra atrasadas
  const tareas = await tareasObraConSemaforo();
  for (const t of tareas as any[]) {
    if (t.semaforo === "rojo" && t.estado !== "completada") {
      const dias = t.fecha_fin_prevista ? -dayjs(t.fecha_fin_prevista).diff(dayjs(), "day") : null;
      await crearAlerta({
        tipo: "tarea_atrasada",
        severidad: t.prioridad === "critica" ? "critica" : "importante",
        origen_modulo: "obra",
        titulo: `Tarea atrasada: ${t.nombre}`,
        descripcion: dias ? `Lleva ${dias} día(s) de atraso.` : "Tiene un problema crítico abierto.",
        asignado_a_rol: "comision_obra",
        ref_tabla: "tareas_obra",
        ref_id: t.id,
      });
    }
  }

  // Problemas de obra críticos abiertos
  const problemas = await all<any>(`SELECT * FROM problemas_obra WHERE estado='abierto' AND severidad='critica'`);
  for (const p of problemas) {
    await crearAlerta({
      tipo: "problema_critico",
      severidad: "critica",
      origen_modulo: "obra",
      titulo: `Problema crítico abierto: ${p.titulo}`,
      descripcion: p.descripcion,
      asignado_a_rol: "consejo_directivo",
      ref_tabla: "problemas_obra",
      ref_id: p.id,
    });
  }

  // Compras pendientes de aprobación vinculadas a tarea crítica/alta prioridad
  const solicitudes = await all<any>(
    `SELECT * FROM solicitudes_compra WHERE estado IN ('pendiente_cotizacion','en_comparacion')`
  );
  for (const s of solicitudes) {
    if (s.prioridad === "critica" || s.prioridad === "alta") {
      await crearAlerta({
        tipo: "compra_pendiente_critica",
        severidad: s.prioridad === "critica" ? "critica" : "importante",
        origen_modulo: "compras",
        titulo: `Compra prioritaria sin resolver: ${s.material}`,
        descripcion: `Solicitada por ${s.comision}, prioridad ${s.prioridad}.`,
        asignado_a_rol: "comision_compras",
        ref_tabla: "solicitudes_compra",
        ref_id: s.id,
      });
    }
  }

  // Finanzas: disponible prudencial bajo o negativo
  const fin = await resumenFinanciero();
  if (fin.disponiblePrudencial < 0) {
    await crearAlerta({
      tipo: "disponible_negativo",
      severidad: "critica",
      origen_modulo: "finanzas",
      titulo: "El disponible prudencial es negativo",
      descripcion: `Saldo $${fin.saldo.toLocaleString("es-UY")} menos comprometido $${fin.comprometido.toLocaleString("es-UY")} da un disponible negativo.`,
      asignado_a_rol: "tesoreria",
      ref_tabla: "movimientos_financieros",
    });
  } else if (fin.disponiblePrudencial < fin.gastosProyectados) {
    await crearAlerta({
      tipo: "disponible_bajo",
      severidad: "importante",
      origen_modulo: "finanzas",
      titulo: "El disponible prudencial es menor a los gastos proyectados a 30 días",
      descripcion: `Disponible $${fin.disponiblePrudencial.toLocaleString("es-UY")} vs. proyectado $${fin.gastosProyectados.toLocaleString("es-UY")}.`,
      asignado_a_rol: "tesoreria",
      ref_tabla: "movimientos_financieros",
    });
  }

  // Presupuesto vs real: desviación > 15%
  for (const p of fin.presupuestoVsReal as any[]) {
    if (p.monto_presupuestado > 0) {
      const desv = (p.gastado - p.monto_presupuestado) / p.monto_presupuestado;
      if (desv > 0.15) {
        await crearAlerta({
          tipo: "desvio_presupuesto",
          severidad: desv > 0.3 ? "critica" : "importante",
          origen_modulo: "finanzas",
          titulo: `Desviación de presupuesto en ${p.categoria}`,
          descripcion: `Gastado $${p.gastado.toLocaleString("es-UY")} vs. presupuestado $${p.monto_presupuestado.toLocaleString("es-UY")} (${Math.round(desv * 100)}% de más).`,
          asignado_a_rol: "tesoreria",
          ref_tabla: "presupuesto_general",
        });
      }
    }
  }

  // Jornada próxima con tareas sin cubrir
  const proximaJornada = await get<any>(
    `SELECT * FROM jornadas_trabajo WHERE fecha >= CURRENT_DATE::text AND estado='planificada' ORDER BY fecha ASC LIMIT 1`
  );
  if (proximaJornada) {
    const tareasJ = await all<any>(`SELECT * FROM tareas_jornada WHERE jornada_id = ?`, [proximaJornada.id]);
    for (const tj of tareasJ) {
      const asignadosRow = await get<{ n: number }>(
        `SELECT COUNT(*) as n FROM asignaciones_jornada WHERE tarea_jornada_id = ?`,
        [tj.id]
      );
      const asignados = asignadosRow?.n ?? 0;
      if (asignados < tj.personas_necesarias) {
        await crearAlerta({
          tipo: "tarea_jornada_sin_cubrir",
          severidad: "importante",
          origen_modulo: "trabajo",
          titulo: `Tarea sin cubrir en la próxima jornada: ${tj.nombre}`,
          descripcion: `Necesita ${tj.personas_necesarias}, asignados ${asignados}.`,
          asignado_a_rol: "comision_trabajo",
          ref_tabla: "tareas_jornada",
          ref_id: tj.id,
        });
      }
    }
  }
}

// ============ COMPARACIÓN DE PRESUPUESTOS (motor local, sin LLM) ============
export async function compararPresupuestos(solicitudId: number) {
  const presupuestos = await all<any>(
    `SELECT pp.*, pv.nombre as proveedor_nombre
     FROM presupuestos_proveedor pp JOIN proveedores pv ON pv.id = pp.proveedor_id
     WHERE pp.solicitud_id = ?`,
    [solicitudId]
  );
  if (presupuestos.length === 0) {
    return { texto: "Todavía no hay presupuestos cargados para esta solicitud.", presupuestos: [] };
  }

  const masBarato = [...presupuestos].sort((a, b) => (a.precio + (a.costo_envio || 0)) - (b.precio + (b.costo_envio || 0)))[0];
  const masRapido = [...presupuestos].filter((p) => p.plazo_entrega_dias != null).sort((a, b) => a.plazo_entrega_dias - b.plazo_entrega_dias)[0];
  const conGarantia = presupuestos.filter((p) => p.garantia && p.garantia.trim().length > 0 && !/^no/i.test(p.garantia.trim()));

  const lineas: string[] = [];
  lineas.push(`Comparación entre ${presupuestos.length} presupuesto(s) cargados:`);
  presupuestos.forEach((p) => {
    const total = p.precio + (p.costo_envio || 0);
    lineas.push(
      `• ${p.proveedor_nombre}: $${p.precio.toLocaleString("es-UY")}${p.costo_envio ? ` + $${p.costo_envio.toLocaleString("es-UY")} de envío (total $${total.toLocaleString("es-UY")})` : ""}${p.plazo_entrega_dias != null ? `, entrega en ${p.plazo_entrega_dias} días` : ""}${p.forma_pago ? `, pago: ${p.forma_pago}` : ""}${p.garantia ? `, garantía: ${p.garantia}` : ", sin garantía informada"}.`
    );
  });

  lineas.push("");
  lineas.push(`Proveedor ${masBarato.proveedor_nombre} es el más barato en total (precio + envío).`);
  if (masRapido) lineas.push(`Proveedor ${masRapido.proveedor_nombre} ofrece el plazo de entrega más corto (${masRapido.plazo_entrega_dias} días).`);
  if (conGarantia.length > 0 && masBarato.id !== conGarantia[0].id) {
    lineas.push(`${conGarantia.map((p) => p.proveedor_nombre).join(", ")} ofrece(n) garantía explícita, lo que puede compensar un precio algo mayor.`);
  }
  if (presupuestos.length < 3) {
    lineas.push("");
    lineas.push("Nota: hay menos de tres presupuestos cargados. La buena práctica recomendada para compras relevantes es comparar al menos tres antes de decidir.");
  }
  lineas.push("");
  lineas.push("Esta comparación es una vista objetiva de los datos cargados, no una recomendación de a quién comprarle: la decisión final le corresponde a la persona u órgano con esa atribución.");

  return { texto: lineas.join("\n"), presupuestos, masBarato, masRapido };
}

// ============ PROPUESTA DE DISTRIBUCIÓN DE JORNADA (IA local) ============
// Arma un borrador de asignación de núcleos a tareas según habilidades,
// prioridad y disponibilidad. Siempre queda como propuesta editable
// (confirmado = 0) hasta que la Comisión de Trabajo la confirme.
export async function proponerDistribucionJornada(jornadaId: number) {
  const [tareas, asignacionesJornada, nucleosTodos, habilidades] = await Promise.all([
    all<any>(`SELECT * FROM tareas_jornada WHERE jornada_id = ? ORDER BY CASE prioridad WHEN 'alta' THEN 0 WHEN 'critica' THEN -1 ELSE 1 END`, [jornadaId]),
    all<any>(`SELECT nucleo_id FROM asignaciones_jornada WHERE jornada_id = ?`, [jornadaId]),
    all<any>(`SELECT * FROM nucleos_familiares`),
    all<any>(`SELECT * FROM habilidades_nucleo`),
  ]);
  const yaAsignados = new Set(asignacionesJornada.map((a) => a.nucleo_id));
  const nucleos = nucleosTodos.filter((n) => !yaAsignados.has(n.id));

  const propuestas: { tarea: string; nucleo: string; motivo: string }[] = [];

  for (const t of tareas) {
    const yaEnEstaTareaRows = await all<any>(`SELECT * FROM asignaciones_jornada WHERE tarea_jornada_id = ?`, [t.id]);
    let faltan = t.personas_necesarias - yaEnEstaTareaRows.length;
    if (faltan <= 0) continue;

    // 1) priorizar núcleos con la habilidad requerida
    if (t.habilidad_requerida) {
      const conHabilidad = nucleos.filter((n) => habilidades.some((h) => h.nucleo_id === n.id && h.habilidad === t.habilidad_requerida) && !yaAsignados.has(n.id));
      for (const n of conHabilidad) {
        if (faltan <= 0) break;
        await insert("asignaciones_jornada", { jornada_id: jornadaId, tarea_jornada_id: t.id, nucleo_id: n.id, propuesta_por_ia: 1, confirmado: 0 });
        propuestas.push({ tarea: t.nombre, nucleo: n.nombre, motivo: `tiene la habilidad "${t.habilidad_requerida}" registrada` });
        yaAsignados.add(n.id);
        faltan--;
      }
    }
    // 2) completar con cualquier núcleo disponible
    const disponibles = nucleos.filter((n) => !yaAsignados.has(n.id));
    for (const n of disponibles) {
      if (faltan <= 0) break;
      await insert("asignaciones_jornada", { jornada_id: jornadaId, tarea_jornada_id: t.id, nucleo_id: n.id, propuesta_por_ia: 1, confirmado: 0 });
      propuestas.push({ tarea: t.nombre, nucleo: n.nombre, motivo: "disponible para la jornada, sin habilidad específica requerida" });
      yaAsignados.add(n.id);
      faltan--;
    }
  }

  return propuestas;
}

export async function historialProveedor(proveedorId: number) {
  const compras = await all<any>(
    `SELECT sc.material, dc.monto, dc.fecha, sc.id as solicitud_id
     FROM decisiones_compra dc
     JOIN presupuestos_proveedor pp ON pp.id = dc.presupuesto_id
     JOIN solicitudes_compra sc ON sc.id = dc.solicitud_id
     WHERE pp.proveedor_id = ?
     ORDER BY dc.fecha DESC`,
    [proveedorId]
  );
  return compras;
}
