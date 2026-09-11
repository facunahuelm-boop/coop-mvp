import type { ReactNode } from "react";
import { getCurrentUser } from "@/lib/auth";
import { all, get } from "@/lib/db";
import { tareasObraConSemaforo, resumenFinanciero, cuentasPorCobrar, recalcularAlertas } from "@/lib/logic";
import { canRead, canEdit, ROLES_FINANZAS_DETALLE } from "@/lib/roles";
import { moduloVisible } from "@/components/Nav";
import { Card, SectionTitle, StatTile, PageHeader, Button, Badge } from "@/components/ui";
import { MonthCalendar, type EventoCalendario, type NotaCalendario } from "@/components/MonthCalendar";
import { crearNotaCalendarioAction, editarNotaCalendarioAction, eliminarNotaCalendarioAction } from "@/lib/actions/calendarioNotas";
import { InstallHint } from "@/components/InstallHint";
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
  Search,
  Receipt,
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

function tituloConIcono(icon: ReactNode, texto: string) {
  return (
    <span className="inline-flex items-center gap-1.5">
      {icon}
      {texto}
    </span>
  );
}

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
  let miSaldo: number | null = null;
  if (!verFinanzasDetalle) {
    const misocio = await get<{ id: number }>(`SELECT id FROM socios WHERE user_id = ?`, [user.id]);
    if (misocio) {
      const row = await get<{ s: number }>(
        `SELECT COALESCE(SUM(CASE WHEN tipo='cargo' THEN monto ELSE -monto END),0) as s FROM movimientos_cuenta_socio WHERE socio_id = ?`,
        [misocio.id]
      );
      miSaldo = row?.s ?? 0;
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
  const misTareas = [
    ...misTareasComisionRaw.map((t: any) => ({ id: `c${t.id}`, titulo: t.titulo, fecha: t.fecha_vencimiento as string | null, href: "/comisiones" })),
    ...misTareasObraRaw.map((t: any) => ({ id: `o${t.id}`, titulo: t.nombre, fecha: t.fecha_fin_prevista as string | null, href: "/obra" })),
  ]
    .sort((a, b) => (a.fecha || "9999-12-31").localeCompare(b.fecha || "9999-12-31"))
    .slice(0, 4);
  const mostrarMisTareas = misTareas.length > 0 || user.rol !== "socio";

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
    autorNombre: n.autor_nombre || "—",
    esPropia: n.autor_id === user.id || user.rol === "admin" || user.rol === "consejo_directivo",
  }));

  // Comunicaciones: documentos ya categorizados "comunicaciones" + la
  // próxima asamblea planificada, si hay una.
  const comunicacionesItems: { texto: string; sub?: string; href: string }[] = [];
  if (proximaAsamblea) {
    comunicacionesItems.push({ texto: `Asamblea general — ${dayjs(proximaAsamblea.fecha).format("dddd DD/MM · HH:mm")}`, href: "/reuniones" });
  }
  for (const d of comunicados) {
    comunicacionesItems.push({ texto: d.nombre, sub: dayjs(d.fecha).format("DD/MM"), href: "/documentos" });
  }

  // Accesos rápidos: solo se muestran las acciones que el rol del usuario puede editar.
  const accesos: { label: string; href: string; icon: ReactNode }[] = [];
  if (verObra && canEdit(user.rol, "obra")) accesos.push({ label: "Registrar avance de obra", href: "/obra", icon: <HardHat size={16} /> });
  if (verTrabajo && canEdit(user.rol, "trabajo")) accesos.push({ label: "Gestionar jornada de trabajo", href: "/trabajo", icon: <Handshake size={16} /> });
  if (canEdit(user.rol, "compras")) accesos.push({ label: "Nueva solicitud de compra", href: "/compras", icon: <ShoppingCart size={16} /> });
  if (verSeguridad && canEdit(user.rol, "seguridad")) accesos.push({ label: "Cargar inspección o incidente", href: "/seguridad", icon: <ShieldCheck size={16} /> });
  if (verReclamos && canEdit(user.rol, "reclamos")) accesos.push({ label: "Reportar un problema", href: "/reclamos", icon: <Wrench size={16} /> });
  if (canEdit(user.rol, "finanzas")) accesos.push({ label: "Registrar movimiento", href: "/finanzas", icon: <Wallet size={16} /> });
  if (canEdit(user.rol, "documentos")) accesos.push({ label: "Subir documento", href: "/documentos", icon: <FileText size={16} /> });

  return (
    <div>
      <InstallHint />

      <PageHeader
        title="Inicio"
        subtitle={dayjs().format("dddd DD [de] MMMM, YYYY")}
        action={
          <div className="flex items-center gap-2 shrink-0">
            {/* El buscador ya no está en la barra lateral — se accede desde
                acá, al lado de las alertas, en la pantalla que todos ven al
                entrar. */}
            <Link
              href="/buscar"
              aria-label="Buscar"
              className="inline-flex items-center justify-center h-10 w-10 rounded-full bg-surface border border-border shadow-[var(--shadow-sm)] text-ink-muted hover:bg-brand-100 shrink-0"
            >
              <Search size={18} />
            </Link>
            {alertasAbiertasCount > 0 && (
              <Link
                href="/alertas"
                aria-label={`${alertasAbiertasCount} alertas abiertas`}
                className="relative inline-flex items-center justify-center h-10 w-10 rounded-full bg-surface border border-border shadow-[var(--shadow-sm)] text-ink-muted hover:bg-brand-100 shrink-0"
              >
                <Bell size={18} />
                <span
                  className={`absolute -top-1 -right-1 min-w-[18px] h-[18px] px-1 rounded-full text-[10px] font-bold flex items-center justify-center text-white ${
                    criticas.length > 0 ? "bg-[var(--color-rojo)]" : "bg-[var(--color-amarillo)]"
                  }`}
                >
                  {alertasAbiertasCount}
                </span>
              </Link>
            )}
          </div>
        }
      />

      {accesos.length > 0 && (
        <div className="flex gap-2 overflow-x-auto pb-1 mb-5 -mx-1 px-1">
          {accesos.map((a) => (
            <Link
              key={a.href}
              href={a.href}
              className="shrink-0 inline-flex items-center gap-2 rounded-xl bg-surface border border-border shadow-[var(--shadow-sm)] px-3.5 py-2.5 text-xs font-semibold text-ink hover:bg-brand-100 whitespace-nowrap"
            >
              {a.icon}
              {a.label}
            </Link>
          ))}
        </div>
      )}

      <div className="space-y-5">
        {/* Resumen financiero (cooperativa) o estado de cuenta personal (socio) */}
        {verFinanzasDetalle && fin && (
          <Card>
            <SectionTitle action={<Button href="/finanzas" variant="ghost" className="!px-2 !py-1 text-xs">Ver finanzas →</Button>}>
              {tituloConIcono(<Wallet size={17} />, "Finanzas")}
            </SectionTitle>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
              <StatTile
                label="Balance total"
                value={money(fin.saldo)}
                color={fin.saldo < 0 ? "rojo" : "verde"}
              />
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
          </Card>
        )}

        {!verFinanzasDetalle && miSaldo !== null && (
          <Card>
            <SectionTitle>{tituloConIcono(<Wallet size={17} />, "Tu estado de cuenta")}</SectionTitle>
            {miSaldo > 0 ? (
              <p className="text-sm text-ink">Debés <span className="font-bold">{money(miSaldo)}</span>.</p>
            ) : miSaldo < 0 ? (
              <p className="text-sm text-[var(--color-verde)]">Estás al día — tenés un saldo a favor de {money(-miSaldo)}.</p>
            ) : (
              <p className="text-sm text-[var(--color-verde)]">Estás al día.</p>
            )}
          </Card>
        )}

        {/* Gastos por Comisión: tarjeta compacta (sección 9 del pedido — nunca
            un dashboard sobrecargado). Solo aparece si ya hay algo cargado
            este mes; una cooperativa recién empezando con esto no ve una
            tarjeta en cero. */}
        {verGastos && gastosResumen && (Number(gastosResumen.total_mes) > 0 || Number(gastosResumen.cantidad_pendiente) > 0) && (
          <Card>
            <SectionTitle action={<Button href="/gastos" variant="ghost" className="!px-2 !py-1 text-xs">Ver gastos →</Button>}>
              {tituloConIcono(<Receipt size={17} />, "Gastos por comisión")}
            </SectionTitle>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
              <StatTile label="Gastado este mes" value={money(gastosResumen.total_mes)} />
              <StatTile label="Pendientes de pago" value={String(gastosResumen.cantidad_pendiente)} color={Number(gastosResumen.cantidad_pendiente) > 0 ? "amarillo" : "verde"} />
              {gastosPorComision[0] && <StatTile label="Comisión que más gastó" value={gastosPorComision[0].nombre} hint={money(gastosPorComision[0].total)} />}
            </div>
          </Card>
        )}

        {/* Tus tareas */}
        {mostrarMisTareas && (
          <Card>
            <SectionTitle>{tituloConIcono(<ListChecks size={17} />, "Tus tareas")}</SectionTitle>
            {misTareas.length > 0 ? (
              <ul className="space-y-2">
                {misTareas.map((t) => {
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
          </Card>
        )}

        {/* Próximamente */}
        {proximamente.length > 0 && (
          <Card>
            <SectionTitle action={<Button href="/calendario" variant="ghost" className="!px-2 !py-1 text-xs">Ver calendario →</Button>}>
              {tituloConIcono(<CalendarClock size={17} />, "Próximamente")}
            </SectionTitle>
            <ul className="space-y-2">
              {proximamente.slice(0, 3).map((p, i) => (
                <li key={i}>
                  <Link href={p.href} className="flex items-start gap-2.5 rounded-lg hover:bg-surface-sunken px-2 py-1.5 -mx-2">
                    <span aria-hidden>{p.icon}</span>
                    <span>
                      <span className="block text-sm text-ink">{p.texto}</span>
                      <span className="block text-xs text-ink-faint">{p.sub}</span>
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </Card>
        )}

        {/* Calendario visual de la semana: siempre visible (no solo cuando ya
            hay algo cargado) porque ahora también sirve para agregar una nota
            nueva — antes era solo de lectura. */}
        <Card>
          <SectionTitle action={<Button href="/calendario" variant="ghost" className="!px-2 !py-1 text-xs">Ver calendario completo →</Button>}>
            {tituloConIcono(<CalendarClock size={17} />, "Calendario")}
          </SectionTitle>
          <MonthCalendar
            eventos={eventosCalendario}
            notas={notasCalendario}
            compact
            crearNota={crearNotaCalendarioAction}
            editarNota={editarNotaCalendarioAction}
            eliminarNota={eliminarNotaCalendarioAction}
          />
        </Card>

        {/* Compras y Seguridad: solo lo que necesita revisión */}
        {(verCompras || verSeguridad) && (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {verCompras && (
              <Card>
                <SectionTitle action={<Button href="/compras" variant="ghost" className="!px-2 !py-1 text-xs">Ver compras →</Button>}>
                  {tituloConIcono(<ShoppingCart size={17} />, "Compras")}
                </SectionTitle>
                {hayComprasPendientes ? (
                  <div className="grid grid-cols-3 gap-2">
                    <StatTile label="Pendientes" value={String(comprasPendientes)} color={comprasPendientes ? "amarillo" : "verde"} />
                    <StatTile label="A decidir" value={String(comparacionesListas)} color={comparacionesListas ? "amarillo" : undefined} />
                    <StatTile label="Por entregar" value={String(entregasPendientes)} />
                  </div>
                ) : (
                  <p className="text-sm text-ink-muted">No hay compras pendientes.</p>
                )}
              </Card>
            )}

            {verSeguridad && (
              <Card>
                <SectionTitle action={<Button href="/seguridad" variant="ghost" className="!px-2 !py-1 text-xs">Ver más →</Button>}>
                  {tituloConIcono(<ShieldCheck size={17} />, "Seguridad")}
                </SectionTitle>
                {docsVencidos > 0 || docsPorVencer > 0 || riesgosAbiertos > 0 ? (
                  <div className="grid grid-cols-3 gap-2">
                    <StatTile label="Vencidos" value={String(docsVencidos)} color={docsVencidos ? "rojo" : "verde"} />
                    <StatTile label="Por vencer" value={String(docsPorVencer)} color={docsPorVencer ? "amarillo" : "verde"} />
                    <StatTile label="Riesgos" value={String(riesgosAbiertos)} color={riesgosAbiertos ? "amarillo" : "verde"} />
                  </div>
                ) : (
                  <p className="text-sm text-ink-muted">Todo está al día.</p>
                )}
              </Card>
            )}
          </div>
        )}

        {/* Reclamos y mantenimiento: solo si hay algo abierto o en proceso */}
        {verReclamos && (
          <Card>
            <SectionTitle action={<Button href="/reclamos" variant="ghost" className="!px-2 !py-1 text-xs">Ver reclamos →</Button>}>
              {tituloConIcono(<Wrench size={17} />, "Reclamos y mantenimiento")}
            </SectionTitle>
            {reclamosAbiertos > 0 || reclamosEnProceso > 0 ? (
              <ul className="space-y-1.5">
                {reclamosAbiertos > 0 && (
                  <li className="flex items-center gap-1.5 text-sm text-ink">
                    <span aria-hidden>🔴</span> {reclamosAbiertos} reclamo{reclamosAbiertos > 1 ? "s" : ""} pendiente{reclamosAbiertos > 1 ? "s" : ""}
                  </li>
                )}
                {reclamosEnProceso > 0 && (
                  <li className="flex items-center gap-1.5 text-sm text-ink">
                    <span aria-hidden>🟠</span> {reclamosEnProceso} reparación{reclamosEnProceso > 1 ? "es" : ""} en proceso
                  </li>
                )}
              </ul>
            ) : (
              <p className="text-sm text-ink-muted">Todo está al día.</p>
            )}
          </Card>
        )}

        {/* Trabajo de las comisiones: solo las que tienen algo pendiente */}
        {comisionesTrabajo.length > 0 && (
          <Card>
            <SectionTitle action={<Button href="/comisiones" variant="ghost" className="!px-2 !py-1 text-xs">Ver comisiones →</Button>}>
              {tituloConIcono(<Compass size={17} />, "Trabajo de las comisiones")}
            </SectionTitle>
            <ul className="space-y-2">
              {comisionesTrabajo.map((c) => (
                <li key={c.id}>
                  <Link href="/comisiones" className="flex items-center justify-between gap-3 rounded-lg hover:bg-surface-sunken px-2 py-1.5 -mx-2">
                    <span className="text-sm text-ink">{c.nombre}</span>
                    <Badge color={c.vencidas > 0 ? "rojo" : "amarillo"}>
                      {c.pendientes} tarea{c.pendientes > 1 ? "s" : ""} pendiente{c.pendientes > 1 ? "s" : ""}
                      {c.vencidas > 0 ? ` (${c.vencidas} vencida${c.vencidas > 1 ? "s" : ""})` : ""}
                    </Badge>
                  </Link>
                </li>
              ))}
            </ul>
          </Card>
        )}

        {/* Obra: tarjeta resumen, solo si la etapa actual la muestra */}
        {verObra && (
          <Card>
            <SectionTitle action={<Button href="/obra" variant="ghost" className="!px-2 !py-1 text-xs">Ver obra →</Button>}>
              {tituloConIcono(<HardHat size={17} />, "Obra")}
            </SectionTitle>
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
          </Card>
        )}

        {/* Trabajo: si la cooperativa ya no muestra Obra pero sí Trabajo
            (etapa habitada con override, por ejemplo), la próxima jornada
            igual aparece en "Próximamente" arriba — acá solo si hace falta
            un lugar propio porque Obra está oculta. */}
        {!verObra && verTrabajo && proximaJornada && (
          <Card>
            <SectionTitle action={<Button href="/trabajo" variant="ghost" className="!px-2 !py-1 text-xs">Ver más →</Button>}>
              {tituloConIcono(<Handshake size={17} />, "Trabajo")}
            </SectionTitle>
            <div className="grid grid-cols-3 gap-2">
              <StatTile label="Próxima jornada" value={dayjs(proximaJornada.fecha).format("DD/MM")} />
              <StatTile label="Núcleos asignados" value={String(personasAsignadas)} />
              <StatTile label="Tareas de la jornada" value={String(tareasJornadaPendientes)} />
            </div>
          </Card>
        )}

        {/* Comunicaciones */}
        {comunicacionesItems.length > 0 && (
          <Card>
            <SectionTitle action={<Button href="/documentos" variant="ghost" className="!px-2 !py-1 text-xs">Ver comunicaciones →</Button>}>
              {tituloConIcono(<Megaphone size={17} />, "Comunicaciones")}
            </SectionTitle>
            <ul className="space-y-1.5">
              {comunicacionesItems.map((c, i) => (
                <li key={i}>
                  <Link href={c.href} className="flex items-center gap-2 text-sm text-ink hover:underline">
                    📢 {c.texto} {c.sub && <span className="text-xs text-ink-faint">· {c.sub}</span>}
                  </Link>
                </li>
              ))}
            </ul>
          </Card>
        )}

        {/* Actividad reciente: mismos roles que ya pueden leer Auditoría */}
        {verAuditoria && actividad.length > 0 && (
          <Card>
            <SectionTitle action={<Button href="/auditoria" variant="ghost" className="!px-2 !py-1 text-xs">Ver toda la actividad →</Button>}>
              Actividad reciente
            </SectionTitle>
            <ul className="space-y-1.5 text-sm text-ink-muted">
              {actividad.map((r: any) => (
                <li key={r.id}>
                  <span className="text-ink font-medium">{r.usuario_nombre || "Sistema"}</span> — {r.accion.replace(/_/g, " ")} en {r.entidad}
                  {r.entidad_id ? ` #${r.entidad_id}` : ""}
                </li>
              ))}
            </ul>
          </Card>
        )}
      </div>

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
