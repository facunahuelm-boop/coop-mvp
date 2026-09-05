import { getCurrentUser } from "@/lib/auth";
import { all, get } from "@/lib/db";
import { tareasObraConSemaforo, resumenFinanciero, recalcularAlertas } from "@/lib/logic";
import { canRead, canEdit, ROLES_FINANZAS_DETALLE } from "@/lib/roles";
import { Card, SectionTitle, Badge, StatTile, EmptyState, PageHeader, Button } from "@/components/ui";
import { Saludo } from "@/components/Saludo";
import { InstallHint } from "@/components/InstallHint";
import dayjs from "dayjs";
import Link from "next/link";
import { redirect } from "next/navigation";

const money = (n: number) => `$${Math.round(n).toLocaleString("es-UY")}`;

export default async function DashboardPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  await recalcularAlertas();

  const verFinanzasDetalle = ROLES_FINANZAS_DETALLE.includes(user.rol);

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
    alertas,
  ] = await Promise.all([
    canRead(user.rol, "obra") ? tareasObraConSemaforo() : Promise.resolve([] as any[]),
    canRead(user.rol, "obra")
      ? get<{ n: number }>(`SELECT COUNT(*) as n FROM problemas_obra WHERE estado='abierto'`)
      : Promise.resolve(undefined),
    canRead(user.rol, "trabajo")
      ? get<any>(`SELECT * FROM jornadas_trabajo WHERE fecha >= CURRENT_DATE::text ORDER BY fecha ASC LIMIT 1`)
      : Promise.resolve(null),
    canRead(user.rol, "compras")
      ? get<{ n: number }>(`SELECT COUNT(*) as n FROM solicitudes_compra WHERE estado IN ('pendiente_cotizacion','en_comparacion')`)
      : Promise.resolve(undefined),
    canRead(user.rol, "compras")
      ? get<{ n: number }>(`SELECT COUNT(DISTINCT solicitud_id) as n FROM presupuestos_proveedor pp JOIN solicitudes_compra sc ON sc.id = pp.solicitud_id WHERE sc.estado='en_comparacion'`)
      : Promise.resolve(undefined),
    canRead(user.rol, "compras")
      ? get<{ n: number }>(`SELECT COUNT(*) as n FROM solicitudes_compra WHERE estado='aprobada'`)
      : Promise.resolve(undefined),
    canRead(user.rol, "seguridad")
      ? get<{ n: number }>(`SELECT COUNT(*) as n FROM documentos_seguridad WHERE fecha_vencimiento < CURRENT_DATE::text`)
      : Promise.resolve(undefined),
    canRead(user.rol, "seguridad")
      ? get<{ n: number }>(`SELECT COUNT(*) as n FROM documentos_seguridad WHERE fecha_vencimiento >= CURRENT_DATE::text AND fecha_vencimiento <= (CURRENT_DATE + 15)::text`)
      : Promise.resolve(undefined),
    canRead(user.rol, "seguridad")
      ? get<{ n: number }>(`SELECT COUNT(*) as n FROM incidentes_seguridad WHERE estado != 'resuelto'`)
      : Promise.resolve(undefined),
    canRead(user.rol, "finanzas") ? resumenFinanciero() : Promise.resolve(null),
    verFinanzasDetalle ? all<any>(`SELECT * FROM compromisos_futuros ORDER BY fecha_estimada ASC LIMIT 3`) : Promise.resolve([] as any[]),
    all<any>(`SELECT * FROM alertas WHERE estado='abierta' ORDER BY CASE severidad WHEN 'critica' THEN 0 WHEN 'importante' THEN 1 ELSE 2 END, fecha DESC`),
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

  const docsVencidos = docsVencidosRow?.n ?? 0;
  const docsPorVencer = docsPorVencerRow?.n ?? 0;
  const riesgosAbiertos = riesgosAbiertosRow?.n ?? 0;

  const criticas = alertas.filter((a) => a.severidad === "critica");
  const importantes = alertas.filter((a) => a.severidad === "importante");
  const informativas = alertas.filter((a) => a.severidad === "informativa");

  // Accesos rápidos: solo se muestran las acciones que el rol del usuario puede editar.
  const accesos: { label: string; href: string; icon: string }[] = [];
  if (canEdit(user.rol, "obra")) accesos.push({ label: "Registrar avance de obra", href: "/obra", icon: "🏗️" });
  if (canEdit(user.rol, "trabajo")) accesos.push({ label: "Gestionar jornada de trabajo", href: "/trabajo", icon: "🤝" });
  if (canEdit(user.rol, "compras")) accesos.push({ label: "Nueva solicitud de compra", href: "/compras", icon: "🛒" });
  if (canEdit(user.rol, "seguridad")) accesos.push({ label: "Cargar inspección o incidente", href: "/seguridad", icon: "🦺" });
  if (canEdit(user.rol, "finanzas")) accesos.push({ label: "Registrar movimiento", href: "/finanzas", icon: "💰" });
  if (canEdit(user.rol, "documentos")) accesos.push({ label: "Subir documento", href: "/documentos", icon: "📄" });

  return (
    <div>
      <InstallHint />

      <PageHeader
        title={<Saludo nombre={user.nombre.split(" ")[0]} />}
        subtitle={dayjs().format("dddd DD [de] MMMM, YYYY")}
      />

      {criticas.length > 0 && (
        <Link
          href="/alertas"
          className="block mb-4 rounded-xl bg-[var(--color-rojo-bg)] border border-[var(--color-rojo)]/20 px-4 py-3 text-sm font-medium text-[var(--color-rojo)] hover:opacity-90"
        >
          🔴 Tenés {criticas.length} alerta{criticas.length === 1 ? "" : "s"} crítica{criticas.length === 1 ? "" : "s"} sin resolver — tocá para verla{criticas.length === 1 ? "" : "s"}
        </Link>
      )}

      {accesos.length > 0 && (
        <div className="flex gap-2 overflow-x-auto pb-1 mb-5 -mx-1 px-1">
          {accesos.map((a) => (
            <Link
              key={a.href}
              href={a.href}
              className="shrink-0 inline-flex items-center gap-2 rounded-xl bg-white border border-black/5 shadow-sm px-3.5 py-2.5 text-xs font-semibold text-[#123240] hover:bg-[#e7eff1] whitespace-nowrap"
            >
              <span>{a.icon}</span>
              {a.label}
            </Link>
          ))}
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {canRead(user.rol, "obra") && (
          <Card>
            <SectionTitle action={<Button href="/obra" variant="ghost" className="!px-2 !py-1 text-xs">Ver más →</Button>}>🏗️ Obra</SectionTitle>
            <div className="grid grid-cols-3 gap-2">
              <StatTile label="Avance" value={`${pctAvance}%`} />
              <StatTile label="Atrasadas" value={String(atrasadas.length)} color={atrasadas.length ? "rojo" : "verde"} />
              <StatTile label="Problemas" value={String(problemasAbiertos)} color={problemasAbiertos ? "amarillo" : "verde"} />
            </div>
          </Card>
        )}

        {canRead(user.rol, "trabajo") && (
          <Card>
            <SectionTitle action={<Button href="/trabajo" variant="ghost" className="!px-2 !py-1 text-xs">Ver más →</Button>}>🤝 Trabajo</SectionTitle>
            {proximaJornada ? (
              <div className="grid grid-cols-2 gap-2">
                <StatTile label="Próxima jornada" value={dayjs(proximaJornada.fecha).format("DD/MM")} />
                <StatTile label="Núcleos asignados" value={String(personasAsignadas)} />
              </div>
            ) : <EmptyState>No hay jornadas próximas planificadas.</EmptyState>}
          </Card>
        )}

        {canRead(user.rol, "compras") && (
          <Card>
            <SectionTitle action={<Button href="/compras" variant="ghost" className="!px-2 !py-1 text-xs">Ver más →</Button>}>🛒 Compras</SectionTitle>
            <div className="grid grid-cols-3 gap-2">
              <StatTile label="Pendientes" value={String(comprasPendientes)} color={comprasPendientes ? "amarillo" : "verde"} />
              <StatTile label="A decidir" value={String(comparacionesListas)} />
              <StatTile label="Por entregar" value={String(entregasPendientes)} />
            </div>
          </Card>
        )}

        {canRead(user.rol, "seguridad") && (
          <Card>
            <SectionTitle action={<Button href="/seguridad" variant="ghost" className="!px-2 !py-1 text-xs">Ver más →</Button>}>🦺 Seguridad</SectionTitle>
            <div className="grid grid-cols-3 gap-2">
              <StatTile label="Vencidos" value={String(docsVencidos)} color={docsVencidos ? "rojo" : "verde"} />
              <StatTile label="Por vencer" value={String(docsPorVencer)} color={docsPorVencer ? "amarillo" : "verde"} />
              <StatTile label="Riesgos abiertos" value={String(riesgosAbiertos)} color={riesgosAbiertos ? "amarillo" : "verde"} />
            </div>
          </Card>
        )}

        {fin && (
          <Card>
            <SectionTitle action={<Button href="/finanzas" variant="ghost" className="!px-2 !py-1 text-xs">Ver más →</Button>}>💰 Finanzas</SectionTitle>
            {verFinanzasDetalle ? (
              <>
                <div className="grid grid-cols-3 gap-2">
                  <StatTile label="Saldo" value={money(fin.saldo)} />
                  <StatTile label="Comprometido" value={money(fin.comprometido)} />
                  <StatTile label="Disponible" value={money(fin.disponiblePrudencial)} color={fin.disponiblePrudencial < 0 ? "rojo" : fin.disponiblePrudencial < fin.gastosProyectados ? "amarillo" : "verde"} />
                </div>
                {proximosPagos.length > 0 && (
                  <ul className="mt-3 text-xs text-black/60 space-y-1">
                    {proximosPagos.map((p) => (
                      <li key={p.id}>• {dayjs(p.fecha_estimada).format("DD/MM")} — {p.descripcion}: {money(p.monto)}</li>
                    ))}
                  </ul>
                )}
              </>
            ) : (
              <EmptyState>Tu rol ve un resumen general; los montos detallados los administra Tesorería.</EmptyState>
            )}
          </Card>
        )}

        <Card>
          <SectionTitle action={<Button href="/alertas" variant="ghost" className="!px-2 !py-1 text-xs">Ver más →</Button>}>🔔 Alertas</SectionTitle>
          <div className="grid grid-cols-3 gap-2">
            <StatTile label="Críticas" value={String(criticas.length)} color={criticas.length ? "rojo" : "verde"} />
            <StatTile label="Importantes" value={String(importantes.length)} color={importantes.length ? "amarillo" : "verde"} />
            <StatTile label="Informativas" value={String(informativas.length)} />
          </div>
          {alertas.length === 0 && <p className="text-xs text-[var(--color-verde)] mt-3">🟢 Todo en orden por ahora.</p>}
        </Card>
      </div>

      <div className="mt-6">
        <SectionTitle>Preguntale a la IA</SectionTitle>
        <Card className="flex items-center justify-between">
          <p className="text-sm text-black/60">¿Cómo viene la obra? ¿Qué tenemos que controlar esta semana?</p>
          <Button href="/ia" className="whitespace-nowrap">Abrir chat →</Button>
        </Card>
      </div>
    </div>
  );
}
