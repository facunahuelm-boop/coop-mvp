import dayjs from "dayjs";
import { all, get } from "./db";
import { tareasObraConSemaforo, resumenFinanciero, compararPresupuestos } from "./logic";
import type { SessionUser } from "./auth";
import { canRead } from "./roles";

export type IaSource = { label: string; detail: string };
export type IaAnswer = { answer: string; sources: IaSource[]; engine: "local" | "claude" };

const money = (n: number) => `$${Math.round(n).toLocaleString("es-UY")}`;

// ============ Motor local (reglas) ============
// Funciona siempre, sin necesidad de una API key de IA. Lee datos reales
// de la base y arma la respuesta citando la fuente. Cuando se configure
// ANTHROPIC_API_KEY, las mismas funciones de contexto se usan para dar
// respuestas más flexibles generadas por el modelo (ver askClaude más abajo).

async function estadoObra(user: SessionUser): Promise<IaAnswer> {
  const tareas = await tareasObraConSemaforo();
  const total = tareas.length;
  const completadas = tareas.filter((t: any) => t.estado === "completada").length;
  const atrasadas = tareas.filter((t: any) => t.semaforo === "rojo" && t.estado !== "completada");
  const enAtencion = tareas.filter((t: any) => t.semaforo === "amarillo");
  const pct = total ? Math.round((completadas / total) * 100) : 0;

  let answer = `La obra tiene ${total} tareas cargadas, ${completadas} completadas (${pct}%). `;
  if (atrasadas.length > 0) {
    answer += `Hay ${atrasadas.length} tarea(s) en rojo (atrasadas o con problema crítico): ${atrasadas.map((t: any) => t.nombre).join(", ")}. `;
  } else {
    answer += "No hay tareas en rojo en este momento. ";
  }
  if (enAtencion.length > 0) {
    answer += `${enAtencion.length} tarea(s) están en amarillo (requieren atención pronto).`;
  }
  return {
    answer,
    engine: "local",
    sources: [{ label: "Módulo Obra", detail: `${total} tareas registradas, actualizado al momento de la consulta` }],
  };
}

async function tareasAtrasadas(): Promise<IaAnswer> {
  const todas = await tareasObraConSemaforo();
  const tareas = todas.filter((t: any) => t.semaforo === "rojo" && t.estado !== "completada");
  if (tareas.length === 0) {
    return { answer: "No hay tareas atrasadas en este momento. 🟢", engine: "local", sources: [{ label: "Módulo Obra", detail: "Cronograma actual" }] };
  }
  const lineas = tareas.map((t: any) => `• ${t.nombre} (etapa ${t.etapa}${t.fecha_fin_prevista ? `, vencía el ${t.fecha_fin_prevista}` : ""})`);
  return {
    answer: `Tareas atrasadas o con problema crítico:\n${lineas.join("\n")}`,
    engine: "local",
    sources: [{ label: "Módulo Obra", detail: "Cronograma de tareas, campo fecha_fin_prevista y problemas críticos abiertos" }],
  };
}

async function problemasAbiertos(): Promise<IaAnswer> {
  const problemas = await all<any>(`SELECT p.*, t.nombre as tarea_nombre FROM problemas_obra p LEFT JOIN tareas_obra t ON t.id = p.tarea_id WHERE p.estado='abierto' ORDER BY p.severidad DESC`);
  if (problemas.length === 0) {
    return { answer: "No hay problemas de obra abiertos registrados. 🟢", engine: "local", sources: [{ label: "Módulo Obra", detail: "Problemas de obra" }] };
  }
  const lineas = problemas.map((p) => `• [${p.severidad}] ${p.titulo}${p.tarea_nombre ? ` (tarea: ${p.tarea_nombre})` : ""} — registrado el ${dayjs(p.fecha).format("DD/MM/YYYY")}`);
  return {
    answer: `Problemas de obra abiertos (${problemas.length}):\n${lineas.join("\n")}`,
    engine: "local",
    sources: [{ label: "Módulo Obra", detail: "Tabla de problemas de obra" }],
  };
}

async function quePasoConProveedor(pregunta: string): Promise<IaAnswer | null> {
  const proveedores = await all<any>(`SELECT * FROM proveedores`);
  const encontrado = proveedores.find((p) => pregunta.toLowerCase().includes(p.nombre.toLowerCase()));
  if (!encontrado) return null;
  const compras = await all<any>(
    `SELECT sc.material, dc.monto, dc.fecha FROM decisiones_compra dc
     JOIN presupuestos_proveedor pp ON pp.id = dc.presupuesto_id
     JOIN solicitudes_compra sc ON sc.id = dc.solicitud_id
     WHERE pp.proveedor_id = ? ORDER BY dc.fecha DESC`,
    [encontrado.id]
  );
  if (compras.length === 0) {
    return {
      answer: `Todavía no hay compras confirmadas con ${encontrado.nombre}, aunque tiene presupuestos cargados en el sistema.`,
      engine: "local",
      sources: [{ label: "Ficha de proveedor", detail: encontrado.nombre }],
    };
  }
  const lineas = compras.map((c) => `• ${c.material}: ${money(c.monto)} (${dayjs(c.fecha).format("DD/MM/YYYY")})`);
  return {
    answer: `Historial de compras a ${encontrado.nombre}:\n${lineas.join("\n")}`,
    engine: "local",
    sources: [{ label: "Historial de compras y decisiones", detail: `Proveedor: ${encontrado.nombre}` }],
  };
}

async function comprasPendientes(): Promise<IaAnswer> {
  const pendientes = await all<any>(`SELECT * FROM solicitudes_compra WHERE estado IN ('pendiente_cotizacion','en_comparacion')`);
  if (pendientes.length === 0) {
    return { answer: "No hay compras pendientes de decisión en este momento.", engine: "local", sources: [{ label: "Módulo Compras", detail: "Solicitudes de compra" }] };
  }
  const lineas = pendientes.map((p) => `• ${p.material} (${p.cantidad} ${p.unidad}) — solicitado por ${p.comision}, prioridad ${p.prioridad}, estado: ${p.estado.replace("_", " ")}`);
  return {
    answer: `Compras pendientes (${pendientes.length}):\n${lineas.join("\n")}`,
    engine: "local",
    sources: [{ label: "Módulo Compras", detail: "Solicitudes de compra en curso" }],
  };
}

async function dineroDisponible(user: SessionUser): Promise<IaAnswer> {
  const fin = await resumenFinanciero();
  return {
    answer:
      `Saldo actual: ${money(fin.saldo)}. Pagos y compromisos ya asumidos: ${money(fin.comprometido)}. ` +
      `Gastos proyectados a 30 días: ${money(fin.gastosProyectados)}. Disponible prudencial: ${money(fin.disponiblePrudencial)}.\n\n` +
      `El disponible prudencial es lo que queda después de descontar del saldo lo que ya está comprometido — no es lo mismo que el saldo bancario.`,
    engine: "local",
    sources: [{ label: "Módulo Finanzas", detail: `Movimientos y compromisos futuros al ${dayjs().format("DD/MM/YYYY")}` }],
  };
}

async function documentosPorVencer(): Promise<IaAnswer> {
  const docs = await all<any>(`SELECT * FROM documentos_seguridad WHERE fecha_vencimiento IS NOT NULL ORDER BY fecha_vencimiento ASC`);
  const hoy = dayjs();
  const relevantes = docs.filter((d) => dayjs(d.fecha_vencimiento).diff(hoy, "day") <= 15);
  if (relevantes.length === 0) {
    return { answer: "No hay documentos de seguridad vencidos ni próximos a vencer en los próximos 15 días.", engine: "local", sources: [{ label: "Módulo Seguridad", detail: "Documentación" }] };
  }
  const lineas = relevantes.map((d) => {
    const dias = dayjs(d.fecha_vencimiento).diff(hoy, "day");
    return `• ${d.tipo}${d.descripcion ? ` — ${d.descripcion}` : ""}: ${dias < 0 ? `vencido hace ${-dias} día(s)` : `vence en ${dias} día(s)`} (${d.fecha_vencimiento})`;
  });
  return { answer: `Documentos vencidos o próximos a vencer:\n${lineas.join("\n")}`, engine: "local", sources: [{ label: "Módulo Seguridad", detail: "Documentación con vencimiento" }] };
}

async function queControlarEstaSemana(): Promise<IaAnswer> {
  const [todasTareas, alertas, proximaJornada] = await Promise.all([
    tareasObraConSemaforo(),
    all<any>(`SELECT * FROM alertas WHERE estado='abierta' AND severidad IN ('critica','importante') ORDER BY severidad ASC`),
    get<any>(`SELECT * FROM jornadas_trabajo WHERE fecha >= CURRENT_DATE::text ORDER BY fecha ASC LIMIT 1`),
  ]);
  const tareas = todasTareas.filter((t: any) => t.semaforo !== "verde" && t.estado !== "completada");
  const partes: string[] = [];
  if (tareas.length > 0) partes.push(`${tareas.length} tarea(s) de obra en amarillo o rojo: ${tareas.map((t: any) => t.nombre).join(", ")}.`);
  if (alertas.length > 0) partes.push(`${alertas.length} alerta(s) críticas o importantes abiertas.`);
  if (proximaJornada) partes.push(`Próxima jornada de ayuda mutua: ${dayjs(proximaJornada.fecha).format("dddd DD/MM")}.`);
  if (partes.length === 0) return { answer: "Esta semana no hay puntos críticos pendientes según lo cargado en el sistema. 🟢", engine: "local", sources: [{ label: "Dashboard", detail: "Estado consolidado" }] };
  return { answer: `Para esta semana conviene priorizar:\n${partes.map((p) => `• ${p}`).join("\n")}`, engine: "local", sources: [{ label: "Dashboard", detail: "Obra, alertas y trabajo combinados" }] };
}

async function comparacionCompra(pregunta: string): Promise<IaAnswer | null> {
  const solicitudes = await all<any>(`SELECT * FROM solicitudes_compra`);
  const match = solicitudes.find((s) => pregunta.toLowerCase().includes(s.material.toLowerCase()));
  if (!match) return null;
  const cmp = await compararPresupuestos(match.id);
  return { answer: cmp.texto, engine: "local", sources: [{ label: "Módulo Compras", detail: `Solicitud #${match.id} — ${match.material}` }] };
}

async function actasYDecisiones(pregunta: string): Promise<IaAnswer | null> {
  const actas = await all<any>(`SELECT * FROM actas ORDER BY fecha DESC`);
  if (actas.length === 0) return null;
  const lower = pregunta.toLowerCase();
  const match = actas.find((a) => lower.includes(a.titulo.toLowerCase().split(" ")[0]) || lower.includes("acta") || lower.includes("asamblea") || lower.includes("resolv"));
  if (!match) return null;
  return {
    answer: `Acta de ${match.organo === "asamblea" ? "Asamblea" : "Consejo Directivo"} del ${dayjs(match.fecha).format("DD/MM/YYYY")} — "${match.titulo}":\n${match.resumen}`,
    engine: "local",
    sources: [{ label: "Repositorio de documentos — Actas", detail: `${match.organo}, ${match.fecha}` }],
  };
}

const HANDLERS: { test: (q: string) => boolean; run: (q: string, u: SessionUser) => Promise<IaAnswer | null> }[] = [
  { test: (q) => /c[oó]mo (viene|va|est[aá]) la (obra|construcci[oó]n)/.test(q), run: (q, u) => estadoObra(u) },
  { test: (q) => /atrasad/.test(q) && /tarea/.test(q), run: () => tareasAtrasadas() },
  { test: (q) => /problema/.test(q) && /abiert/.test(q), run: () => problemasAbiertos() },
  { test: (q) => /qu[eé] deber[ií]amos controlar|controlar esta semana|hacer esta semana|qu[eé] tenemos que hacer/.test(q), run: () => queControlarEstaSemana() },
  { test: (q) => /(compra|proveedor)/.test(q) && /pendient/.test(q), run: () => comprasPendientes() },
  { test: (q) => /cu[aá]nto dinero|cu[aá]nto (podemos gastar|tenemos)|disponible/.test(q), run: (q, u) => dineroDisponible(u) },
  { test: (q) => /documento.*(vencer|vencid)/.test(q), run: () => documentosPorVencer() },
  { test: (q) => /a qui[eé]n.*compramos|proveedor/.test(q), run: (q) => quePasoConProveedor(q) },
  { test: (q) => /comparaci[oó]n|comparar|presupuesto/.test(q), run: (q) => comparacionCompra(q) },
  { test: (q) => /acta|asamblea|resolv/.test(q), run: (q) => actasYDecisiones(q) },
];

export async function askLocal(pregunta: string, user: SessionUser): Promise<IaAnswer> {
  const q = pregunta.toLowerCase().trim();
  for (const h of HANDLERS) {
    if (h.test(q)) {
      const res = await h.run(q, user);
      if (res) return res;
    }
  }
  return {
    answer:
      "No tengo una respuesta específica cargada para esa pregunta todavía. Podés preguntarme, por ejemplo: \"¿cómo viene la obra?\", \"¿qué tareas están atrasadas?\", \"¿qué compras están pendientes?\", \"¿cuánto dinero tenemos?\" o \"¿qué documentos están por vencer?\". " +
      (process.env.ANTHROPIC_API_KEY ? "" : "Este motor todavía funciona con reglas locales: cuando se conecte una API key de IA, va a poder responder preguntas más abiertas sobre los mismos datos."),
    engine: "local",
    sources: [],
  };
}

// ============ Motor con LLM real (Claude), cuando hay API key ============
export async function askClaude(pregunta: string, user: SessionUser): Promise<IaAnswer> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return askLocal(pregunta, user);

  // Contexto acotado por permisos del usuario (RAG simplificado: se arma con
  // las mismas funciones de consulta que usa el motor local).
  const [obra, finanzas, comprasPendientesCtx, alertas] = await Promise.all([
    canRead(user.rol, "obra") ? tareasObraConSemaforo() : Promise.resolve(null),
    canRead(user.rol, "finanzas") ? resumenFinanciero() : Promise.resolve(null),
    canRead(user.rol, "compras")
      ? all(`SELECT * FROM solicitudes_compra WHERE estado IN ('pendiente_cotizacion','en_comparacion')`)
      : Promise.resolve(null),
    all(`SELECT * FROM alertas WHERE estado='abierta' ORDER BY severidad ASC LIMIT 20`),
  ]);
  const contexto = {
    obra: obra ? obra.slice(0, 30) : null,
    finanzas,
    comprasPendientes: comprasPendientesCtx,
    alertas,
  };

  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-5",
        max_tokens: 600,
        system:
          "Sos la IA central del sistema de gestión de una cooperativa de vivienda por ayuda mutua en Uruguay. " +
          "Respondé SOLO en base al JSON de contexto que te paso, citando de qué módulo sale cada dato. " +
          "Nunca aprobás compras, pagos ni decisiones: solo informás y sugerís. Si no tenés el dato, decilo explícitamente.",
        messages: [
          { role: "user", content: `Contexto (JSON):\n${JSON.stringify(contexto)}\n\nPregunta: ${pregunta}` },
        ],
      }),
    });
    if (!res.ok) return askLocal(pregunta, user);
    const data = await res.json();
    const text = data?.content?.[0]?.text || "";
    return { answer: text || "No obtuve respuesta del modelo.", engine: "claude", sources: [{ label: "IA (Claude)", detail: "Respuesta generada a partir de los datos del sistema" }] };
  } catch {
    return askLocal(pregunta, user);
  }
}

export async function askIA(pregunta: string, user: SessionUser): Promise<IaAnswer> {
  if (process.env.ANTHROPIC_API_KEY) return askClaude(pregunta, user);
  return askLocal(pregunta, user);
}

export const PREGUNTAS_SUGERIDAS = [
  "¿Cómo viene la obra?",
  "¿Qué tareas están atrasadas?",
  "¿Qué deberíamos controlar esta semana?",
  "¿Qué problemas están abiertos?",
  "¿Qué compras están pendientes?",
  "¿Cuánto dinero tenemos?",
  "¿Qué documentos están por vencer?",
];
