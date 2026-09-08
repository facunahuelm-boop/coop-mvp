import type { ReactNode } from "react";
import { getCurrentUser } from "@/lib/auth";
import { all, get } from "@/lib/db";
import { tareasObraConSemaforo, resumenFinanciero, cuentasPorCobrar, recalcularAlertas } from "@/lib/logic";
import { canRead, canEdit, ROLES_FINANZAS_DETALLE } from "@/lib/roles";
import { moduloVisible } from "@/components/Nav";
import { Card, SectionTitle, StatTile, PageHeader, Button, Badge } from "@/components/ui";
import { Saludo } from "@/components/Saludo";
import { InstallHint } from "@/components/InstallHint";
import dayjs from "dayjs";
import Link from "next/link";
import { redirect } from "next/navigation";
import {
  HardHat,
  Handshake,
  ShoppingCart,
  ShieldCheck,
  Wallet,
  Bell,
  Compass,
  CheckCircle2,
  FileText,
  Megaphone,
  ListChecks,
  CalendarClock,
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
// movimientos_cuenta_socio) — no se agregó ningún módulo nuevo. "Reclamos y
// mantenimiento" y un calendario unificado no entran todavía porque esos
// módulos no existen en el sistema (ver §02 del Plan Maestro); en cuanto se
// construyan, alcanza con agregarles su sección acá.

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

const MOD_HREF: Record<string, string> = {
  obra: "/obra",
  trabajo: "/trabajo",
  compras: "/compras",
  seguridad: "/seguridad",
  finanzas: "/finanzas",
};

type Chip = { color: "rojo" | "amarillo" | "brand"; texto: string; href: string };

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
  const verComisiones = canRead(user.rol, "comisiones");
  const verDocumentos = canRead(user.rol, "documentos");
  const verAuditoria = canRead(user.rol, "auditoria");
  // Consejo Directivo y Admin tienen alcance sobre toda la cooperativa
  // (aprueban/configuran todos los módulos) — para ellos, "Comisiones" y las
  // alertas por rol muestran una vista de conjunto en vez de solo lo propio.
  const esOversight = user.rol === "consejo_directivo" || user.rol === "admin";

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
  const misVencidasComision = misTareasComisionRaw.filter((t: any) => t.fecha_vencimiento && t.fecha_vencimiento < dayjs().format("YYYY-MM-DD")).length;
  const misVencidasObra = misTareasObraRaw.filter((t: any) => t.fecha_fin_prevista && t.fecha_fin_prevista < dayjs().format("YYYY-MM-DD")).length;
  const mostrarMisTareas = misTareas.length > 0 || user.rol !== "socio";

  // "Necesita tu atención": reemplaza la barra roja de ancho completo. Se
  // arma con lo más urgente y accionable para ESTA persona — sus propias
  // tareas vencidas, más las alertas ya calculadas por el motor de reglas
  // que le corresponden a su rol (o a cualquiera, si no tienen rol asignado,
  // o todas si tiene alcance de conjunto) — nunca alertas informativas, que
  // no piden ninguna acción.
  const atencion: Chip[] = [];
  if (misVencidasComision > 0) {
    atencion.push({ color: "rojo", texto: `${misVencidasComision} tarea${misVencidasComision > 1 ? "s" : ""} tuya${misVencidasComision > 1 ? "s" : ""} vencida${misVencidasComision > 1 ? "s" : ""}`, href: "/comisiones" });
  }
  if (misVencidasObra > 0) {
    atencion.push({ color: "rojo", texto: `${misVencidasObra} tarea${misVencidasObra > 1 ? "s" : ""} de obra vencida${misVencidasObra > 1 ? "s" : ""}`, href: "/obra" });
  }
  for (const a of alertas) {
    if (a.severidad === "informativa") continue;
    if (!esOversight && a.asignado_a_rol && a.asignado_a_rol !== user.rol) continue;
    atencion.push({ color: a.severidad === "critica" ? "rojo" : "amarillo", texto: a.titulo, href: MOD_HREF[a.origen_modulo] || "/alertas" });
    if (atencion.length >= 5) break;
  }
  if (atencion.length < 5 && proximaReunion) {
    const dias = dayjs(proximaReunion.fecha).startOf("day").diff(dayjs().startOf("day"), "day");
    if (dias === 0) atencion.push({ color: "brand", texto: "Reunión hoy", href: "/reuniones" });
    else if (dias === 1) atencion.push({ color: "brand", texto: "Reunión mañana", href: "/reuniones" });
  }
  const atencionFinal = atencion.slice(0, 5);

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
  if (canEdit(user.rol, "finanzas")) accesos.push({ label: "Registrar movimiento", href: "/finanzas", icon: <Wallet size={16} /> });
  if (canEdit(user.rol, "documentos")) accesos.push({ label: "Subir documento", href: "/documentos", icon: <FileText size={16} /> });

  return (
    <div>
      <InstallHint />

      <PageHeader
        title={<Saludo nombre={user.nombre.split(" ")[0]} />}
        subtitle={dayjs().format("dddd DD [de] MMMM, YYYY")}
        action={
          alertasAbiertasCount > 0 ? (
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
          ) : undefined
        }
      />

      {/* Necesita tu atención — reemplaza la franja roja de ancho completo. */}
      <div className="mb-5">
        <p className="text-xs font-semibold text-ink-faint uppercase tracking-wide mb-2">Necesita tu atención</p>
        {atencionFinal.length > 0 ? (
          <div className="flex flex-wrap gap-2">
            {atencionFinal.map((c, i) => (
              <Link key={i} href={c.href} className="hover:opacity-80 transition-opacity">
                <Badge color={c.color}>{c.texto}</Badge>
              </Link>
            ))}
          </div>
        ) : (
          <p className="flex items-center gap-1.5 text-sm text-[var(--color-verde)]">
            <CheckCircle2 size={15} /> Todo en orden por ahora.
          </p>
        )}
      </div>

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
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              <StatTile
                label="Saldo disponible"
                value={money(fin.disponiblePrudencial)}
                color={fin.disponiblePrudencial < 0 ? "rojo" : fin.disponiblePrudencial < fin.gastosProyectados ? "amarillo" : "verde"}
              />
              <StatTile label="Comprometido" value={money(fin.comprometido)} />
              <StatTile label="Pendiente de cobrar" value={money(pendienteCobrar?.totalACobrar ?? 0)} />
              <StatTile label="Próximos pagos" value={String(proximosPagosCountRow?.n ?? 0)} />
            </div>
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
            <SectionTitle>{tituloConIcono(<CalendarClock size={17} />, "Próximamente")}</SectionTitle>
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
