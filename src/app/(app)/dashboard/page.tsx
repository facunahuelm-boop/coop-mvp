import type { ReactNode } from "react";
import { getCurrentUser } from "@/lib/auth";
import { all, get } from "@/lib/db";
import { tareasObraConSemaforo, resumenFinanciero, cuentasPorCobrar, recalcularAlertas, calcularCuotasSocio, type MovimientoCuentaSocio } from "@/lib/logic";
import { canRead, ROLES_FINANZAS_DETALLE } from "@/lib/roles";
import { moduloVisible } from "@/components/Nav";
import { Card, SectionTitle, StatTile, PageHeader, Button, Badge } from "@/components/ui";
import { DashboardGrid, DashboardSection, SummaryCard, EstadoTag, DashboardCardLink, DashboardCardModal } from "@/components/DashboardCard";
import { MonthCalendar, type EventoCalendario, type NotaCalendario } from "@/components/MonthCalendar";
import {
  crearNotaCalendarioFormAction,
  editarNotaCalendarioFormAction,
  eliminarNotaCalendarioFormAction,
} from "@/lib/actions/calendarioNotas";
import { InstallHint } from "@/components/InstallHint";
import { UsuarioLink } from "@/components/EntidadLink";
import dayjs from "dayjs";
import Link from "next/link";
import { redirect } from "next/navigation";
import {
  HardHat,
  Handshake,
  ShoppingCart,
  ShieldCheck,
  Wrench,
  Wallet,
  Bell,
  Compass,
  CheckCircle2,
  FileText,
  Megaphone,
  ListChecks,
  CalendarClock,
  Receipt,
  History,
} from "lucide-react";

// Fase "Dashboard: prioridad y simplicidad" del rediseño UI/UX.
//
// El dashboard anterior mostraba una tarjeta por cada módulo que el rol
// podía leer (Obra, Compras, Seguridad, Finanzas, Socios, Comisiones...),
// siempre, ordenadas solo por si tenían algo urgente. Terminaba siendo un
// mapa de funcionalidades ("qué tiene el sistema"), no un centro de
// atención ("qué necesito hacer hoy"). Esta versión invierte el criterio:
// cada sección responde a "¿la persona tiene algo que hacer acá?" y, si la
// respuesta es no, la sección se achica o directamente desaparece — la
// navegación (Nav.tsx) sigue teniendo el módulo completo siempre disponible.
//
// Todo lo que se muestra sale de tablas que ya existen (tareas, tareas_obra,
// alertas, comisiones, documentos categoría "comunicaciones", auditoría,
// movimientos_cuenta_socio, reclamos) — no se agregó ningún dato nuevo, sólo
// se reorganizó cómo se presenta. El calendario unificado (/calendario) junta
// las mismas fechas (reuniones, jornadas, hitos de obra, vencimientos) en una
// sola pantalla para quien quiera ver más que lo más urgente de acá.

const money = (n: number) => `$${Math.round(n).toLocaleString("es-UY")}`;

// Cuán urgente es una fecha límite (vencida / vence pronto / con margen),
// mismo criterio de color que ya usa el resto de la app (rojo/amarillo/verde).
function estadoFecha(fecha: string | null): { texto: string; color: "rojo" | "amarillo" | "verde" } {
  if (!fecha) return { texto: "Sin fecha", color: "verde" };
  const dias = dayjs(fecha).startOf("day").diff(dayjs().startOf("day"), "day");
  if (dias < 0) return { texto: "Vencida", color: "rojo" };
  if (dias === 0) return { texto: "Vence hoy", color: "amarillo" };
  if (dias === 1) return { texto: "Vence mañana", color: "amarillo" };
  if (dias <= 6) return { texto: `Vence ${dayjs(fecha).format("dddd")}`, color: "amarillo" };
  return { texto: `Vence ${dayjs(fecha).format("DD/MM")}`, color: "verde" };
}

// Rediseño del Inicio: la tarjeta compacta de "Actividad" muestra sólo el
// último registro + hace cuánto pasó, en vez de la lista completa (eso queda
// para el modal) — cálculo manual en vez de sumar el plugin relativeTime de
// dayjs, que no se usa en ningún otro lado del proyecto todavía.
function haceTiempo(fecha: string): string {
  const minutos = dayjs().diff(dayjs(fecha), "minute");
  if (minutos < 1) return "recién";
  if (minutos < 60) return `hace ${minutos} min`;
  const horas = dayjs().diff(dayjs(fecha), "hour");
  if (horas < 24) return `hace ${horas} h`;
  const dias = dayjs().diff(dayjs(fecha), "day");
  if (dias === 1) return "hace 1 día";
  return `hace ${dias} días`;
}

export default async function DashboardPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  await recalcularAlertas();

  const verFinanzasDetalle = ROLES_FINANZAS_DETALLE.includes(user.rol);
  // Fase D: Obra/Trabajo/Seguridad quedan afuera del dashboard cuando la
  // etapa (o un override manual desde Configuración → Módulos) los oculta
  // del menú — mismo criterio en los dos lugares.
  const verObra = canRead(user.rol, "obra") && moduloVisible("obra", user.etapa, user.modulos_override);
  const verTrabajo = canRead(user.rol, "trabajo") && moduloVisible("trabajo", user.etapa, user.modulos_override);
  const verSeguridad = canRead(user.rol, "seguridad") && moduloVisible("seguridad", user.etapa, user.modulos_override);
  const verCompras = canRead(user.rol, "compras");
  // Gastos por Comisión (pedido explícito, sección 9: tarjeta compacta, sin
  // sobrecargar el dashboard) — mismo criterio de lectura amplia que la
  // pantalla /gastos ("todos ven el resumen, cada uno edita solo lo suyo").
  const verGastos = canRead(user.rol, "compras") || canRead(user.rol, "finanzas");
  const verReclamos = canRead(user.rol, "reclamos") && moduloVisible("reclamos", user.etapa, user.modulos_override);
  const verComisiones = canRead(user.rol, "comisiones");
  const verDocumentos = canRead(user.rol, "documentos");
  const verAuditoria = canRead(user.rol, "auditoria");
  // Consejo Directivo y Admin tienen alcance sobre toda la cooperativa
  // (aprueban/configuran todos los módulos) — para ellos, "Comisiones" y las
  // alertas por rol muestran una vista de conjunto en vez de solo lo propio.
  const esOversight = user.rol === "consejo_directivo" || user.rol === "admin";
  const desdeMes = dayjs().startOf("month").format("YYYY-MM-DD");

  const [
    tareas,
    problemasAbiertosRow,
    proximaJornada,
    comprasPendientesRow,
    comparacionesListasRow,
    entregasPendientesRow,
    docsVencidosRow,
    docsPorVencerRow,
    riesgosAbiertosRow,
    reclamosRow,
    fin,
    proximosPagos,
    proximosPagosCountRow,
    alertas,
    proximaReunion,
    proximaAsamblea,
    misTareasComisionRaw,
    misTareasObraRaw,
    proximosHitos,
    comunicados,
    actividad,
    reunionesMes,
    jornadasMes,
    hitosObraMes,
    pagosMes,
    docsSeguridadMes,
    notasCalendarioMes,
    gastosResumen,
    gastosPorComision,
    documentosCountRow,
  ] = await Promise.all([
    verObra ? tareasObraConSemaforo() : Promise.resolve([] as any[]),
    verObra
      ? get<{ n: number }>(`SELECT COUNT(*) as n FROM problemas_obra WHERE estado='abierto'`)
      : Promise.resolve(undefined),
    verTrabajo
      ? get<any>(`SELECT * FROM jornadas_trabajo WHERE fecha >= CURRENT_DATE::text ORDER BY fecha ASC LIMIT 1`)
      : Promise.resolve(null),
    verCompras
      ? get<{ n: number }>(`SELECT COUNT(*) as n FROM solicitudes_compra WHERE estado IN ('pendiente_cotizacion','en_comparacion')`)
      : Promise.resolve(undefined),
    verCompras
      ? get<{ n: number }>(`SELECT COUNT(DISTINCT solicitud_id) as n FROM presupuestos_proveedor pp JOIN solicitudes_compra sc ON sc.id = pp.solicitud_id WHERE sc.estado='en_comparacion'`)
      : Promise.resolve(undefined),
    verCompras
      ? get<{ n: number }>(`SELECT COUNT(*) as n FROM solicitudes_compra WHERE estado='aprobada'`)
      : Promise.resolve(undefined),
    verSeguridad
      ? get<{ n: number }>(`SELECT COUNT(*) as n FROM documentos_seguridad WHERE fecha_vencimiento < CURRENT_DATE::text`)
      : Promise.resolve(undefined),
    verSeguridad
      ? get<{ n: number }>(`SELECT COUNT(*) as n FROM documentos_seguridad WHERE fecha_vencimiento >= CURRENT_DATE::text AND fecha_vencimiento <= (CURRENT_DATE + 15)::text`)
      : Promise.resolve(undefined),
    verSeguridad
      ? get<{ n: number }>(`SELECT COUNT(*) as n FROM incidentes_seguridad WHERE estado != 'resuelto'`)
      : Promise.resolve(undefined),
    verReclamos
      ? get<{ abiertos: number; en_proceso: number }>(
          `SELECT COUNT(*) FILTER (WHERE estado='abierto')::int as abiertos, COUNT(*) FILTER (WHERE estado='en_proceso')::int as en_proceso FROM reclamos`
        ).catch(() => undefined)
      : Promise.resolve(undefined),
    canRead(user.rol, "finanzas") ? resumenFinanciero() : Promise.resolve(null),
    verFinanzasDetalle ? all<any>(`SELECT * FROM compromisos_futuros ORDER BY fecha_estimada ASC LIMIT 3`) : Promise.resolve([] as any[]),
    verFinanzasDetalle ? get<{ n: number }>(`SELECT COUNT(*) as n FROM compromisos_futuros`) : Promise.resolve(undefined),
    all<any>(`SELECT * FROM alertas WHERE estado='abierta' ORDER BY CASE severidad WHEN 'critica' THEN 0 WHEN 'importante' THEN 1 ELSE 2 END, fecha DESC`),
    verComisiones
      ? get<any>(`SELECT * FROM reuniones WHERE estado='planificada' ORDER BY fecha ASC LIMIT 1`)
      : Promise.resolve(null),
    verComisiones
      ? get<any>(`SELECT * FROM reuniones WHERE tipo='asamblea' AND estado='planificada' ORDER BY fecha ASC LIMIT 1`)
      : Promise.resolve(null),
    verComisiones
      ? all<any>(`SELECT * FROM tareas WHERE responsable_id = ? AND estado != 'completada' ORDER BY fecha_vencimiento ASC LIMIT 5`, [user.id])
      : Promise.resolve([] as any[]),
    verObra
      ? all<any>(`SELECT * FROM tareas_obra WHERE responsable_id = ? AND estado != 'completada' ORDER BY fecha_fin_prevista ASC LIMIT 5`, [user.id])
      : Promise.resolve([] as any[]),
    verObra
      ? all<any>(`SELECT * FROM tareas_obra WHERE estado != 'completada' AND fecha_fin_prevista >= CURRENT_DATE::text ORDER BY fecha_fin_prevista ASC LIMIT 3`)
      : Promise.resolve([] as any[]),
    verDocumentos
      ? all<any>(`SELECT * FROM documentos WHERE categoria='comunicaciones' ORDER BY fecha DESC LIMIT 3`)
      : Promise.resolve([] as any[]),
    verAuditoria
      ? all<any>(`SELECT a.*, u.nombre as usuario_nombre FROM auditoria a LEFT JOIN users u ON u.id = a.usuario_id ORDER BY a.fecha DESC LIMIT 5`)
      : Promise.resolve([] as any[]),
    // Mini-calendario visual: mismas fuentes que /calendario, acotadas al mes
    // en curso — no hace falta traer todo lo que trae la pantalla completa.
    verComisiones
      ? all<any>(`SELECT * FROM reuniones WHERE estado='planificada' AND fecha >= ? ORDER BY fecha ASC LIMIT 40`, [desdeMes])
      : Promise.resolve([] as any[]),
    verTrabajo
      ? all<any>(`SELECT * FROM jornadas_trabajo WHERE estado='planificada' AND fecha >= ? ORDER BY fecha ASC LIMIT 40`, [desdeMes])
      : Promise.resolve([] as any[]),
    verObra
      ? all<any>(`SELECT * FROM tareas_obra WHERE estado != 'completada' AND fecha_fin_prevista IS NOT NULL AND fecha_fin_prevista >= ? ORDER BY fecha_fin_prevista ASC LIMIT 40`, [desdeMes])
      : Promise.resolve([] as any[]),
    verFinanzasDetalle
      ? all<any>(`SELECT * FROM compromisos_futuros WHERE fecha_estimada >= ? ORDER BY fecha_estimada ASC LIMIT 40`, [desdeMes])
      : Promise.resolve([] as any[]),
    verSeguridad
      ? all<any>(`SELECT * FROM documentos_seguridad WHERE fecha_vencimiento IS NOT NULL AND fecha_vencimiento >= ? ORDER BY fecha_vencimiento ASC LIMIT 40`, [desdeMes])
      : Promise.resolve([] as any[]),
    // Notas de calendario personalizadas (texto libre, cualquiera puede
    // escribir una) — ver migrations/0015_notas_calendario.sql. Si esa
    // migración todavía no se corrió en esta cooperativa, la tabla no
    // existe: el .catch acá evita que ESO tire abajo todo el Dashboard —
    // el resto de la pantalla sigue andando, solo sin notas hasta que se
    // corra la migración.
    all<any>(
      `SELECT n.*, u.nombre as autor_nombre FROM notas_calendario n LEFT JOIN users u ON u.id = n.autor_id WHERE n.fecha >= ? ORDER BY n.fecha ASC LIMIT 100`,
      [desdeMes]
    ).catch(() => [] as any[]),
    // Gastos por Comisión (sección 9 del pedido: tarjeta compacta en el
    // dashboard). .catch(...): ver nota de notas_calendario arriba — misma
    // razón (migración 0017 y despliegue de código son dos pasos manuales
    // separados, no algo atómico).
    verGastos
      ? get<any>(
          `SELECT
             COALESCE(SUM(importe) FILTER (WHERE estado != 'anulado' AND fecha >= ?), 0) as total_mes,
             COUNT(*) FILTER (WHERE estado = 'pendiente') as cantidad_pendiente
           FROM gastos_comision`,
          [desdeMes]
        ).catch(() => undefined)
      : Promise.resolve(undefined),
    verGastos
      ? all<{ nombre: string; total: number }>(
          `SELECT c.nombre, COALESCE(SUM(g.importe) FILTER (WHERE g.estado != 'anulado' AND g.fecha >= ?), 0) as total
           FROM comisiones c LEFT JOIN gastos_comision g ON g.comision_id = c.id
           WHERE c.activa = 1
           GROUP BY c.nombre
           HAVING COALESCE(SUM(g.importe) FILTER (WHERE g.estado != 'anulado' AND g.fecha >= ?), 0) > 0
           ORDER BY total DESC LIMIT 3`,
          [desdeMes, desdeMes]
        ).catch(() => [] as any[])
      : Promise.resolve([] as any[]),
    // Rediseño del Inicio (sección "Información"): el pedido original pide
    // una tarjeta de Documentos separada de Comunicaciones, con "N nuevos" —
    // el dashboard hasta ahora no traía esta cuenta. Es la única consulta
    // nueva que agrega este rediseño (documentado acá y en REQUIREMENTS.md,
    // punto #43 del pedido: "documentar antes de implementar" cualquier
    // cambio funcional imprescindible para la UX) y es mínima a propósito —
    // sólo dos COUNT(*), nunca trae las filas — mismo criterio que ya pide
    // el propio pedido ("no consultar 5000 documentos para mostrar un
    // número").
    verDocumentos
      ? get<{ total: number; nuevos: number }>(
          `SELECT COUNT(*)::int as total, COUNT(*) FILTER (WHERE fecha >= ?)::int as nuevos FROM documentos`,
          [dayjs().subtract(7, "day").format("YYYY-MM-DD")]
        ).catch(() => undefined)
      : Promise.resolve(undefined),
  ]);

  const totalTareas = tareas.length;
  const completadas = tareas.filter((t: any) => t.estado === "completada").length;
  const pctAvance = totalTareas ? Math.round((completadas / totalTareas) * 100) : 0;
  const atrasadas = tareas.filter((t: any) => t.semaforo === "rojo" && t.estado !== "completada");
  const problemasAbiertos = problemasAbiertosRow?.n ?? 0;

  const [personasAsignadasRow, tareasJornadaPendientesRow] = proximaJornada
    ? await Promise.all([
        get<{ n: number }>(`SELECT COUNT(*) as n FROM asignaciones_jornada WHERE jornada_id = ?`, [proximaJornada.id]),
        get<{ n: number }>(`SELECT COUNT(*) as n FROM tareas_jornada WHERE jornada_id = ?`, [proximaJornada.id]),
      ])
    : [undefined, undefined];
  const personasAsignadas = personasAsignadasRow?.n ?? 0;
  const tareasJornadaPendientes = tareasJornadaPendientesRow?.n ?? 0;

  const comprasPendientes = comprasPendientesRow?.n ?? 0;
  const comparacionesListas = comparacionesListasRow?.n ?? 0;
  const entregasPendientes = entregasPendientesRow?.n ?? 0;
  const hayComprasPendientes = comprasPendientes > 0 || comparacionesListas > 0 || entregasPendientes > 0;

  const docsVencidos = docsVencidosRow?.n ?? 0;
  const docsPorVencer = docsPorVencerRow?.n ?? 0;
  const riesgosAbiertos = riesgosAbiertosRow?.n ?? 0;
  const reclamosAbiertos = reclamosRow?.abiertos ?? 0;
  const reclamosEnProceso = reclamosRow?.en_proceso ?? 0;

  const criticas = alertas.filter((a) => a.severidad === "critica");
  const importantes = alertas.filter((a) => a.severidad === "importante");
  const alertasAbiertasCount = criticas.length + importantes.length;

  // Estado de cuenta personal: solo para quien NO ve el resumen financiero
  // completo de la cooperativa (socio y similares) y tiene ficha de socio
  // vinculada a su cuenta — "¿cuánto debo?" sin llamar a tesorería.
  // Rediseño profundo de Finanzas (16/09): además del saldo simple que ya
  // había, se suma cuotas pendientes/vencidas (mismo cálculo FIFO que usa
  // la ficha del socio y la pestaña "Cuotas y convenios" de Finanzas — una
  // sola fuente de verdad) y si tiene un convenio activo, para que "cada
  // socio pueda ver su cuota" también desde el Inicio, no solo entrando a
  // Finanzas o a su propia ficha.
  let miSaldo: number | null = null;
  let miSocioId: number | null = null;
  let misCuotasPendientes = 0;
  let misCuotasVencidas = 0;
  let miProximoVencimiento: string | null = null;
  let miConvenio: { id: number; motivo: string; monto_cuota: number } | null = null;
  if (!verFinanzasDetalle) {
    const misocio = await get<{ id: number }>(`SELECT id FROM socios WHERE user_id = ?`, [user.id]);
    if (misocio) {
      miSocioId = misocio.id;
      const movimientos = await all<MovimientoCuentaSocio>(
        `SELECT id, tipo, concepto, monto, fecha, fecha_vencimiento, convenio_id FROM movimientos_cuenta_socio WHERE socio_id = ?`,
        [misocio.id]
      );
      const { cuotas, saldo } = calcularCuotasSocio(movimientos);
      miSaldo = saldo;
      misCuotasPendientes = cuotas.filter((c) => c.estado === "pendiente" || c.estado === "parcial").length;
      misCuotasVencidas = cuotas.filter((c) => c.estado === "vencida").length;
      miProximoVencimiento = cuotas
        .filter((c) => (c.estado === "pendiente" || c.estado === "parcial") && c.fechaVencimiento)
        .map((c) => c.fechaVencimiento as string)
        .sort()[0] || null;
      miConvenio = (await get<{ id: number; motivo: string; monto_cuota: number }>(
        `SELECT id, motivo, monto_cuota FROM convenios_pago WHERE socio_id = ? AND estado = 'activo' ORDER BY creado_en DESC LIMIT 1`,
        [misocio.id]
      ).catch(() => null)) ?? null;
    }
  }
  const pendienteCobrar = verFinanzasDetalle ? await cuentasPorCobrar() : null;

  // Comisiones con trabajo pendiente: las propias (de las que la persona es
  // integrante) salvo que tenga alcance de conjunto (Consejo/Admin), en cuyo
  // caso ve las de toda la cooperativa. Una comisión sin tareas pendientes
  // ni siquiera aparece en la lista — "existe" no es motivo para mostrarla.
  const comisionesTrabajo = verComisiones
    ? await all<{ id: number; nombre: string; pendientes: number; vencidas: number }>(
        esOversight
          ? `SELECT c.id, c.nombre,
               COUNT(t.id) FILTER (WHERE t.estado != 'completada')::int as pendientes,
               COUNT(t.id) FILTER (WHERE t.estado != 'completada' AND t.fecha_vencimiento IS NOT NULL AND t.fecha_vencimiento < CURRENT_DATE::text)::int as vencidas
             FROM comisiones c
             LEFT JOIN tareas t ON t.comision_id = c.id
             WHERE c.activa = 1
             GROUP BY c.id, c.nombre
             HAVING COUNT(t.id) FILTER (WHERE t.estado != 'completada') > 0
             ORDER BY vencidas DESC, pendientes DESC
             LIMIT 4`
          : `SELECT c.id, c.nombre,
               COUNT(t.id) FILTER (WHERE t.estado != 'completada')::int as pendientes,
               COUNT(t.id) FILTER (WHERE t.estado != 'completada' AND t.fecha_vencimiento IS NOT NULL AND t.fecha_vencimiento < CURRENT_DATE::text)::int as vencidas
             FROM comisiones c
             JOIN comision_miembros m ON m.comision_id = c.id AND m.user_id = ? AND m.activo = 1
             LEFT JOIN tareas t ON t.comision_id = c.id
             WHERE c.activa = 1
             GROUP BY c.id, c.nombre
             HAVING COUNT(t.id) FILTER (WHERE t.estado != 'completada') > 0
             ORDER BY vencidas DESC, pendientes DESC
             LIMIT 4`,
        esOversight ? [] : [user.id]
      )
    : [];

  // "Tus tareas": se combinan las de comisiones y las de obra asignadas a
  // esta persona puntual — nunca todas las tareas del sistema.
  const misTareasTodas = [
    ...misTareasComisionRaw.map((t: any) => ({ id: `c${t.id}`, titulo: t.titulo, fecha: t.fecha_vencimiento as string | null, href: "/comisiones" })),
    ...misTareasObraRaw.map((t: any) => ({ id: `o${t.id}`, titulo: t.nombre, fecha: t.fecha_fin_prevista as string | null, href: "/obra" })),
  ].sort((a, b) => (a.fecha || "9999-12-31").localeCompare(b.fecha || "9999-12-31"));
  const mostrarMisTareas = misTareasTodas.length > 0 || user.rol !== "socio";
  // Tarjeta compacta: sólo la más urgente (la que quedó primera tras
  // ordenar por fecha) — el resto de la lista vive en el modal de detalle.
  const tareaMasUrgente = misTareasTodas[0] ?? null;

  // "Próximamente": lo más cercano en el tiempo entre reunión, jornada y
  // vencimiento financiero — máximo 3, ordenado por fecha.
  const proximamente: { icon: ReactNode; texto: string; sub: string; href: string; fecha: string }[] = [];
  if (proximaReunion) {
    proximamente.push({
      icon: "📅",
      texto: proximaReunion.titulo,
      sub: dayjs(proximaReunion.fecha).format("dddd DD/MM · HH:mm"),
      href: "/reuniones",
      fecha: proximaReunion.fecha,
    });
  }
  // Si Obra está oculta (etapa habitada), la jornada tiene su propia
  // tarjeta más abajo con el detalle completo — no hace falta duplicarla acá.
  if (verObra && verTrabajo && proximaJornada) {
    proximamente.push({
      icon: "📅",
      texto: "Jornada de trabajo",
      sub: `${dayjs(proximaJornada.fecha).format("dddd DD/MM")} · ${personasAsignadas} núcleo(s) asignados, ${tareasJornadaPendientes} tarea(s)`,
      href: "/trabajo",
      fecha: proximaJornada.fecha,
    });
  }
  if (verFinanzasDetalle && proximosPagos[0]) {
    proximamente.push({
      icon: "⏰",
      texto: `Vencimiento: ${proximosPagos[0].descripcion}`,
      sub: dayjs(proximosPagos[0].fecha_estimada).format("dddd DD/MM"),
      href: "/finanzas",
      fecha: proximosPagos[0].fecha_estimada,
    });
  }
  proximamente.sort((a, b) => a.fecha.localeCompare(b.fecha));

  // Mini-calendario visual del mes: mismo criterio de colores por tipo que
  // /calendario (ver components/MonthCalendar.tsx).
  const eventosCalendario: EventoCalendario[] = [
    ...reunionesMes.map((r: any) => ({
      id: `r${r.id}`,
      fecha: r.fecha,
      titulo: r.titulo,
      tipo: r.tipo === "asamblea" ? "asamblea" : "reunion",
      href: `/reuniones/${r.id}`,
      hora: dayjs(r.fecha).format("HH:mm"),
    })),
    ...jornadasMes.map((j: any) => ({
      id: `j${j.id}`,
      fecha: j.fecha,
      titulo: "Jornada de trabajo",
      tipo: "jornada",
      href: `/trabajo/${j.id}`,
    })),
    ...hitosObraMes.map((h: any) => ({
      id: `o${h.id}`,
      fecha: h.fecha_fin_prevista,
      titulo: h.nombre,
      tipo: "obra",
      href: `/obra/${h.id}`,
    })),
    ...pagosMes.map((p: any) => ({
      id: `f${p.id}`,
      fecha: p.fecha_estimada,
      titulo: p.descripcion,
      tipo: "finanzas",
      href: "/finanzas",
    })),
    ...docsSeguridadMes.map((d: any) => ({
      id: `s${d.id}`,
      fecha: d.fecha_vencimiento,
      titulo: `Vence: ${d.tipo}`,
      tipo: "seguridad",
      href: "/seguridad",
    })),
  ];

  const notasCalendario: NotaCalendario[] = notasCalendarioMes.map((n: any) => ({
    id: n.id,
    fecha: n.fecha,
    hora: n.hora,
    titulo: n.titulo,
    color: n.color,
    descripcion: n.descripcion ?? null,
    autorNombre: n.autor_nombre || "—",
    esPropia: n.autor_id === user.id || user.rol === "admin" || user.rol === "consejo_directivo",
  }));

  // Tarjeta compacta de Calendario: cuenta + próximo evento entre lo que ya
  // se armó para pintar el mini-calendario del mes — sin ninguna consulta
  // adicional.
  const hoyIso = dayjs().format("YYYY-MM-DD");
  const eventosProximos = eventosCalendario
    .filter((e) => e.fecha.slice(0, 10) >= hoyIso)
    .sort((a, b) => a.fecha.localeCompare(b.fecha));
  const proximoEvento = eventosProximos[0] ?? null;

  const documentosTotal = documentosCountRow?.total ?? 0;
  const documentosNuevos = documentosCountRow?.nuevos ?? 0;

  // Texto de la tarjeta compacta de Calendario: prioriza lo más relevante
  // para esta persona puntual (reunión/jornada/vencimiento propio, el mismo
  // criterio que antes armaba la tarjeta "Próximamente"), y si no hay nada
  // de eso cae en el próximo evento del mes que sea — así no se pierde
  // ninguna de las dos señales que ya calculaba el Dashboard, sólo se
  // muestran juntas en una sola tarjeta en vez de dos.
  const calendarioResumenTexto = proximamente[0]?.texto ?? proximoEvento?.titulo ?? null;

  // Comunicaciones: documentos ya categorizados "comunicaciones" + la
  // próxima asamblea planificada, si hay una.
  const comunicacionesItems: { texto: string; sub?: string; href: string }[] = [];
  if (proximaAsamblea) {
    comunicacionesItems.push({ texto: `Asamblea general — ${dayjs(proximaAsamblea.fecha).format("dddd DD/MM · HH:mm")}`, href: "/reuniones" });
  }
  for (const d of comunicados) {
    comunicacionesItems.push({ texto: d.nombre, sub: dayjs(d.fecha).format("DD/MM"), href: "/documentos" });
  }

  // Rediseño "Color secundario + Top Bar": los accesos rápidos y los
  // botones de Buscar/Alertas que vivían acá arriba (sólo en Inicio) ahora
  // están en la Top Bar y la franja de Accesos rápidos globales, visibles
  // en cualquier pantalla (ver components/Nav.tsx: accesosRapidosFor /
  // AccesosRapidos, montada en (app)/layout.tsx) — se sacan de acá para no
  // mostrar dos veces la misma fila de botones, uno debajo del otro, justo
  // encima de este mismo título. La tarjeta "Alertas" del bloque
  // "Información" más abajo sigue igual, con sus mismos datos.

  return (
    <div>
      <InstallHint />

      <PageHeader title="Inicio" subtitle={dayjs().format("dddd DD [de] MMMM, YYYY")} />

      {/* Rediseño del Inicio — RESUMEN → CLICK → POP-UP → DETALLE. Cada
          módulo que antes era una <Card> larga y siempre desplegada ahora es
          una tarjeta chica (SummaryCard) agrupada en 3 bloques: Resumen
          personal, Comisiones y módulos, Información. Ni los datos ni los
          permisos cambiaron — sólo cómo se presentan (ver comentario grande
          al principio del archivo y REQUIREMENTS.md, sección del rediseño
          del Inicio, para el detalle de qué se mantuvo igual y qué decisión
          de alcance se tomó en cada caso). */}

      <DashboardSection title="Resumen personal">
        <DashboardGrid>
          {mostrarMisTareas && (
            <DashboardCardModal
              title="Tus tareas"
              trigger={
                <SummaryCard
                  icon={<ListChecks size={16} />}
                  title="Tareas"
                  accent="blue"
                  value={misTareasTodas.length}
                  status={
                    tareaMasUrgente ? (
                      <Badge color={estadoFecha(tareaMasUrgente.fecha).color}>{estadoFecha(tareaMasUrgente.fecha).texto}</Badge>
                    ) : (
                      <EstadoTag estado="ok" texto="Sin pendientes" />
                    )
                  }
                  hint={tareaMasUrgente?.titulo}
                />
              }
            >
              {misTareasTodas.length > 0 ? (
                <ul className="space-y-2">
                  {misTareasTodas.map((t) => {
                    const ef = estadoFecha(t.fecha);
                    return (
                      <li key={t.id}>
                        <Link href={t.href} className="flex items-center justify-between gap-3 rounded-lg hover:bg-surface-sunken px-2 py-1.5 -mx-2">
                          <span className="text-sm text-ink truncate">{t.titulo}</span>
                          <Badge color={ef.color}>{ef.texto}</Badge>
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              ) : (
                <p className="flex items-center gap-1.5 text-sm text-[var(--color-verde)]">
                  <CheckCircle2 size={15} /> No tenés tareas pendientes.
                </p>
              )}
            </DashboardCardModal>
          )}

          <DashboardCardModal
            title="Calendario"
            size="lg"
            trigger={
              <SummaryCard
                icon={<CalendarClock size={16} />}
                title="Calendario"
                accent="violet"
                value={dayjs().format("DD/MM")}
                status={
                  calendarioResumenTexto ? (
                    <span className="block truncate text-xs font-medium text-ink">{calendarioResumenTexto}</span>
                  ) : (
                    <EstadoTag estado="ok" texto="Sin eventos próximos" />
                  )
                }
                hint={eventosProximos.length > 0 ? `${eventosProximos.length} evento${eventosProximos.length > 1 ? "s" : ""} próximo${eventosProximos.length > 1 ? "s" : ""}` : undefined}
              />
            }
          >
            <MonthCalendar
              eventos={eventosCalendario}
              notas={notasCalendario}
              crearNota={crearNotaCalendarioFormAction}
              editarNota={editarNotaCalendarioFormAction}
              eliminarNota={eliminarNotaCalendarioFormAction}
            />
          </DashboardCardModal>

          {verFinanzasDetalle && fin && (
            <DashboardCardModal
              title="Finanzas"
              size="lg"
              trigger={
                <SummaryCard
                  icon={<Wallet size={16} />}
                  title="Finanzas"
                  accent="teal"
                  value={money(fin.saldo)}
                  status={
                    <EstadoTag
                      estado={fin.disponiblePrudencial < 0 ? "error" : fin.disponiblePrudencial < fin.gastosProyectados ? "atencion" : "ok"}
                      texto={`Disponible: ${money(fin.disponiblePrudencial)}`}
                    />
                  }
                />
              }
            >
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                <StatTile label="Balance total" value={money(fin.saldo)} color={fin.saldo < 0 ? "rojo" : "verde"} />
                <StatTile
                  label="Saldo disponible"
                  value={money(fin.disponiblePrudencial)}
                  color={fin.disponiblePrudencial < 0 ? "rojo" : fin.disponiblePrudencial < fin.gastosProyectados ? "amarillo" : "verde"}
                />
                <StatTile label="Ingresos del mes" value={money(fin.ingresosMes)} color="verde" />
                <StatTile label="Comprometido" value={money(fin.comprometido)} />
                <StatTile label="Pendiente de cobrar" value={money(pendienteCobrar?.totalACobrar ?? 0)} />
                <StatTile label="Próximos pagos" value={String(proximosPagosCountRow?.n ?? 0)} />
              </div>
              <p className="text-xs text-ink-faint mt-2">Balance total: todo el dinero de la cooperativa a hoy (ingresos menos egresos, desde siempre).</p>
              {proximosPagos.length > 0 && (
                <ul className="mt-3 text-xs text-ink-muted space-y-1">
                  {proximosPagos.map((p) => (
                    <li key={p.id}>• {dayjs(p.fecha_estimada).format("DD/MM")} — {p.descripcion}: {money(p.monto)}</li>
                  ))}
                </ul>
              )}
              <div className="mt-4">
                <Button href="/finanzas" variant="ghost" className="!px-2 !py-1 text-xs">Ir a Finanzas →</Button>
              </div>
            </DashboardCardModal>
          )}

          {!verFinanzasDetalle && miSaldo !== null && (
            <DashboardCardModal
              title="Tu estado de cuenta"
              trigger={
                <SummaryCard
                  icon={<Wallet size={16} />}
                  title="Mi cuenta"
                  accent="teal"
                  value={miSaldo > 0 ? money(miSaldo) : "Al día"}
                  status={miSaldo > 0 ? <EstadoTag estado="atencion" texto="Saldo pendiente" /> : <EstadoTag estado="ok" />}
                />
              }
            >
              {miSaldo > 0 ? (
                <p className="text-sm text-ink">Debés <span className="font-bold">{money(miSaldo)}</span>.</p>
              ) : miSaldo < 0 ? (
                <p className="text-sm text-[var(--color-verde)]">Estás al día — tenés un saldo a favor de {money(-miSaldo)}.</p>
              ) : (
                <p className="text-sm text-[var(--color-verde)]">Estás al día. No tenés pagos pendientes.</p>
              )}
              {(misCuotasPendientes > 0 || misCuotasVencidas > 0) && (
                <div className="grid grid-cols-2 gap-3 mt-3">
                  <StatTile label="Cuotas pendientes" value={String(misCuotasPendientes)} color={misCuotasPendientes > 0 ? "amarillo" : undefined} />
                  <StatTile label="Cuotas vencidas" value={String(misCuotasVencidas)} color={misCuotasVencidas > 0 ? "rojo" : undefined} />
                </div>
              )}
              {miProximoVencimiento && (
                <p className="text-xs text-ink/50 mt-2">Próximo vencimiento: {dayjs(miProximoVencimiento).format("DD/MM/YYYY")}</p>
              )}
              {miConvenio && (
                <p className="text-sm text-ink mt-2">
                  Tenés un convenio de pago activo (<span className="font-medium">{miConvenio.motivo}</span>, cuota {money(miConvenio.monto_cuota)}).
                </p>
              )}
              <div className="mt-4">
                <Button href={`/socios/${miSocioId}`} variant="ghost" className="!px-2 !py-1 text-xs">Ver mi ficha completa →</Button>
              </div>
            </DashboardCardModal>
          )}
        </DashboardGrid>
      </DashboardSection>

      {(comisionesTrabajo.length > 0 ||
        verObra ||
        verCompras ||
        verSeguridad ||
        verReclamos ||
        (!verObra && verTrabajo && !!proximaJornada) ||
        (verGastos && !!gastosResumen && (Number(gastosResumen.total_mes) > 0 || Number(gastosResumen.cantidad_pendiente) > 0))) && (
        <DashboardSection title="Comisiones y módulos">
          <DashboardGrid>
            {comisionesTrabajo.map((c) => (
              <DashboardCardLink key={c.id} href="/comisiones">
                <SummaryCard
                  icon={<Compass size={16} />}
                  title={c.nombre}
                  accent="violet"
                  value={c.pendientes}
                  status={
                    <EstadoTag
                      estado={c.vencidas > 0 ? "alerta" : "atencion"}
                      texto={`${c.pendientes} tarea${c.pendientes > 1 ? "s" : ""} pendiente${c.pendientes > 1 ? "s" : ""}${c.vencidas > 0 ? ` (${c.vencidas} vencida${c.vencidas > 1 ? "s" : ""})` : ""}`}
                    />
                  }
                  action="Ver comisión →"
                />
              </DashboardCardLink>
            ))}

            {verObra && (
              <DashboardCardModal
                title="Obra"
                trigger={
                  <SummaryCard
                    icon={<HardHat size={16} />}
                    title="Obra"
                    accent="violet"
                    value={`${pctAvance}%`}
                    status={
                      atrasadas.length > 0 ? (
                        <EstadoTag estado="alerta" texto={`${atrasadas.length} atrasada${atrasadas.length > 1 ? "s" : ""}`} />
                      ) : problemasAbiertos > 0 ? (
                        <EstadoTag estado="atencion" texto={`${problemasAbiertos} problema${problemasAbiertos > 1 ? "s" : ""}`} />
                      ) : (
                        <EstadoTag estado="ok" />
                      )
                    }
                    hint="Avance de obra"
                  />
                }
              >
                <div className="grid grid-cols-3 gap-2">
                  <StatTile label="Avance" value={`${pctAvance}%`} />
                  <StatTile label="Atrasadas" value={String(atrasadas.length)} color={atrasadas.length ? "rojo" : "verde"} />
                  <StatTile label="Problemas" value={String(problemasAbiertos)} color={problemasAbiertos ? "amarillo" : "verde"} />
                </div>
                {proximosHitos.length > 0 && (
                  <ul className="mt-3 text-xs text-ink-muted space-y-1">
                    {proximosHitos.map((h: any) => (
                      <li key={h.id}>• {dayjs(h.fecha_fin_prevista).format("DD/MM")} — {h.nombre}</li>
                    ))}
                  </ul>
                )}
                <div className="mt-4">
                  <Button href="/obra" variant="ghost" className="!px-2 !py-1 text-xs">Ir a Obra →</Button>
                </div>
              </DashboardCardModal>
            )}

            {verCompras && (
              <DashboardCardLink href="/compras">
                <SummaryCard
                  icon={<ShoppingCart size={16} />}
                  title="Compras"
                  accent="violet"
                  value={comprasPendientes}
                  status={
                    hayComprasPendientes ? (
                      <EstadoTag estado="atencion" texto={`${comprasPendientes} pendiente${comprasPendientes !== 1 ? "s" : ""}`} />
                    ) : (
                      <EstadoTag estado="ok" texto="Sin pendientes" />
                    )
                  }
                  hint={comparacionesListas > 0 ? `${comparacionesListas} a decidir` : undefined}
                  action="Ver compras →"
                />
              </DashboardCardLink>
            )}

            {verSeguridad && (
              <DashboardCardLink href="/seguridad">
                <SummaryCard
                  icon={<ShieldCheck size={16} />}
                  title="Seguridad"
                  accent="violet"
                  value={docsVencidos + docsPorVencer + riesgosAbiertos}
                  status={
                    docsVencidos > 0 ? (
                      <EstadoTag estado="error" texto={`${docsVencidos} vencido${docsVencidos > 1 ? "s" : ""}`} />
                    ) : docsPorVencer > 0 || riesgosAbiertos > 0 ? (
                      <EstadoTag estado="atencion" />
                    ) : (
                      <EstadoTag estado="ok" />
                    )
                  }
                  action="Ver seguridad →"
                />
              </DashboardCardLink>
            )}

            {verReclamos && (
              <DashboardCardLink href="/reclamos">
                <SummaryCard
                  icon={<Wrench size={16} />}
                  title="Reclamos"
                  accent="violet"
                  value={reclamosAbiertos + reclamosEnProceso}
                  status={
                    reclamosAbiertos > 0 ? (
                      <EstadoTag estado="atencion" texto={`${reclamosAbiertos} sin tomar`} />
                    ) : reclamosEnProceso > 0 ? (
                      <EstadoTag estado="atencion" texto={`${reclamosEnProceso} en proceso`} />
                    ) : (
                      <EstadoTag estado="ok" />
                    )
                  }
                  action="Ver reclamos →"
                />
              </DashboardCardLink>
            )}

            {!verObra && verTrabajo && proximaJornada && (
              <DashboardCardLink href="/trabajo">
                <SummaryCard
                  icon={<Handshake size={16} />}
                  title="Trabajo"
                  accent="violet"
                  value={dayjs(proximaJornada.fecha).format("DD/MM")}
                  status={<EstadoTag estado={tareasJornadaPendientes > 0 ? "atencion" : "ok"} texto={`${personasAsignadas} núcleo(s), ${tareasJornadaPendientes} tarea(s)`} />}
                  hint="Próxima jornada"
                  action="Ver trabajo →"
                />
              </DashboardCardLink>
            )}

            {verGastos && gastosResumen && (Number(gastosResumen.total_mes) > 0 || Number(gastosResumen.cantidad_pendiente) > 0) && (
              <DashboardCardLink href="/gastos">
                <SummaryCard
                  icon={<Receipt size={16} />}
                  title="Gastos por comisión"
                  accent="violet"
                  value={money(gastosResumen.total_mes)}
                  status={
                    Number(gastosResumen.cantidad_pendiente) > 0 ? (
                      <EstadoTag estado="atencion" texto={`${gastosResumen.cantidad_pendiente} pendiente(s) de pago`} />
                    ) : (
                      <EstadoTag estado="ok" />
                    )
                  }
                  hint={gastosPorComision[0] ? `${gastosPorComision[0].nombre}: ${money(gastosPorComision[0].total)}` : undefined}
                  action="Ver gastos →"
                />
              </DashboardCardLink>
            )}
          </DashboardGrid>
        </DashboardSection>
      )}

      {(comunicacionesItems.length > 0 || (verDocumentos && documentosTotal > 0) || alertasAbiertasCount > 0 || (verAuditoria && actividad.length > 0)) && (
        <DashboardSection title="Información">
          <DashboardGrid>
            {comunicacionesItems.length > 0 && (
              <DashboardCardLink href="/documentos">
                <SummaryCard
                  icon={<Megaphone size={16} />}
                  title="Comunicaciones"
                  accent="blue"
                  value={comunicacionesItems.length}
                  hint={comunicacionesItems[0]?.texto}
                  action="Ver comunicaciones →"
                />
              </DashboardCardLink>
            )}

            {verDocumentos && documentosTotal > 0 && (
              <DashboardCardLink href="/documentos">
                <SummaryCard
                  icon={<FileText size={16} />}
                  title="Documentos"
                  accent="amber"
                  value={documentosTotal}
                  status={
                    documentosNuevos > 0 ? (
                      <EstadoTag estado="atencion" texto={`${documentosNuevos} nuevo${documentosNuevos > 1 ? "s" : ""}`} />
                    ) : (
                      <EstadoTag estado="ok" texto="Sin novedades" />
                    )
                  }
                  action="Ver documentos →"
                />
              </DashboardCardLink>
            )}

            {alertasAbiertasCount > 0 && (
              <DashboardCardModal
                title="Alertas"
                trigger={
                  <SummaryCard
                    icon={<Bell size={16} />}
                    title="Alertas"
                    accent="amber"
                    value={alertasAbiertasCount}
                    status={<EstadoTag estado={criticas.length > 0 ? "error" : "atencion"} texto={`${alertasAbiertasCount} pendiente${alertasAbiertasCount > 1 ? "s" : ""}`} />}
                  />
                }
              >
                <ul className="space-y-2">
                  {[...criticas, ...importantes].map((a: any) => (
                    <li key={a.id} className="flex items-start gap-2">
                      <Badge color={a.severidad === "critica" ? "rojo" : "amarillo"}>{a.severidad === "critica" ? "Crítica" : "Importante"}</Badge>
                      <span className="text-sm text-ink">{a.titulo}</span>
                    </li>
                  ))}
                </ul>
                <div className="mt-4">
                  <Button href="/alertas" variant="ghost" className="!px-2 !py-1 text-xs">Ver todas las alertas →</Button>
                </div>
              </DashboardCardModal>
            )}

            {verAuditoria && actividad.length > 0 && (
              <DashboardCardModal
                title="Actividad reciente"
                trigger={
                  <SummaryCard
                    icon={<History size={16} />}
                    title="Actividad"
                    value={actividad.length}
                    hint={`Últ.: ${actividad[0].accion.replace(/_/g, " ")} (${haceTiempo(actividad[0].fecha)})`}
                    action="Ver toda la actividad →"
                  />
                }
              >
                <ul className="space-y-1.5 text-sm text-ink-muted">
                  {actividad.map((r: any) => (
                    <li key={r.id}>
                      <span className="text-ink font-medium"><UsuarioLink id={r.usuario_id} nombre={r.usuario_nombre} fallback="Sistema" /></span> — {r.accion.replace(/_/g, " ")} en {r.entidad}
                      {r.entidad_id ? ` #${r.entidad_id}` : ""}
                    </li>
                  ))}
                </ul>
              </DashboardCardModal>
            )}
          </DashboardGrid>
        </DashboardSection>
      )}

      <div className="mt-6">
        <SectionTitle>Preguntale a la IA</SectionTitle>
        <Card className="flex items-center justify-between">
          <p className="text-sm text-ink-muted">¿Cómo viene la obra? ¿Qué tenemos que controlar esta semana?</p>
          <Button href="/ia" className="whitespace-nowrap">Abrir chat →</Button>
        </Card>
      </div>
    </div>
  );
}
