import type { ReactNode } from "react";
import { getCurrentUser } from "@/lib/auth";
import { all, get } from "@/lib/db";
import { tareasObraConSemaforo, resumenFinanciero, recalcularAlertas } from "@/lib/logic";
import { canRead, canEdit, ROLES_FINANZAS_DETALLE } from "@/lib/roles";
import { moduloVisible } from "@/components/Nav";
import { Card, SectionTitle, StatTile, EmptyState, PageHeader, Button } from "@/components/ui";
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
  Users,
  Compass,
  AlertCircle,
  CheckCircle2,
  FileText,
} from "lucide-react";

// Fase B del rediseño UI/UX: las tarjetas de módulo ya no van en un orden
// fijo — se ordenan poniendo primero lo que necesita atención (algo
// atrasado, vencido o pendiente de decidir), igual que pediría cualquier
// persona que abre el sistema a la mañana y quiere saber "¿qué tengo que
// mirar hoy?" en vez de tener que barrer con la vista todas las tarjetas.
type ModuloDashboard = { key: string; urgente: boolean; node: ReactNode };

function tituloConIcono(icon: ReactNode, texto: string) {
  return (
    <span className="inline-flex items-center gap-1.5">
      {icon}
      {texto}
    </span>
  );
}

const money = (n: number) => `$${Math.round(n).toLocaleString("es-UY")}`;

export default async function DashboardPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  await recalcularAlertas();

  const verFinanzasDetalle = ROLES_FINANZAS_DETALLE.includes(user.rol);
  // Fase D: Obra/Trabajo/Seguridad quedan afuera del dashboard cuando la
  // etapa (o un override manual desde Configuración → Módulos) los oculta
  // del menú — mismo criterio en los dos lugares, para que no quede un
  // módulo "escondido" de la nav pero igual destacado acá.
  const verObra = canRead(user.rol, "obra") && moduloVisible("obra", user.etapa, user.modulos_override);
  const verTrabajo = canRead(user.rol, "trabajo") && moduloVisible("trabajo", user.etapa, user.modulos_override);
  const verSeguridad = canRead(user.rol, "seguridad") && moduloVisible("seguridad", user.etapa, user.modulos_override);

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
    sociosActivosRow,
    enEsperaRow,
    comisionesTareasRow,
    proximaReunion,
  ] = await Promise.all([
    verObra ? tareasObraConSemaforo() : Promise.resolve([] as any[]),
    verObra
      ? get<{ n: number }>(`SELECT COUNT(*) as n FROM problemas_obra WHERE estado='abierto'`)
      : Promise.resolve(undefined),
    verTrabajo
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
    all<any>(`SELECT * FROM alertas WHERE estado='abierta' ORDER BY CASE severidad WHEN 'critica' THEN 0 WHEN 'importante' THEN 1 ELSE 2 END, fecha DESC`),
    canRead(user.rol, "socios")
      ? get<{ n: number }>(`SELECT COUNT(*) as n FROM socios WHERE estado='activo'`)
      : Promise.resolve(undefined),
    canRead(user.rol, "socios")
      ? get<{ n: number }>(`SELECT COUNT(*) as n FROM lista_espera WHERE estado='en_espera'`)
      : Promise.resolve(undefined),
    canRead(user.rol, "comisiones")
      ? get<{ pendientes: number; vencidas: number }>(
          `SELECT
             COUNT(*) FILTER (WHERE estado != 'completada')::int as pendientes,
             COUNT(*) FILTER (WHERE estado != 'completada' AND fecha_vencimiento IS NOT NULL AND fecha_vencimiento < CURRENT_DATE::text)::int as vencidas
           FROM tareas`
        )
      : Promise.resolve(undefined),
    canRead(user.rol, "comisiones")
      ? get<any>(`SELECT * FROM reuniones WHERE estado='planificada' ORDER BY fecha ASC LIMIT 1`)
      : Promise.resolve(null),
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

  const sociosActivos = sociosActivosRow?.n ?? 0;
  const enEspera = enEsperaRow?.n ?? 0;
  const tareasComisionesPendientes = comisionesTareasRow?.pendientes ?? 0;
  const tareasComisionesVencidas = comisionesTareasRow?.vencidas ?? 0;

  // Accesos rápidos: solo se muestran las acciones que el rol del usuario puede editar.
  const accesos: { label: string; href: string; icon: ReactNode }[] = [];
  if (verObra && canEdit(user.rol, "obra")) accesos.push({ label: "Registrar avance de obra", href: "/obra", icon: <HardHat size={16} /> });
  if (verTrabajo && canEdit(user.rol, "trabajo")) accesos.push({ label: "Gestionar jornada de trabajo", href: "/trabajo", icon: <Handshake size={16} /> });
  if (canEdit(user.rol, "compras")) accesos.push({ label: "Nueva solicitud de compra", href: "/compras", icon: <ShoppingCart size={16} /> });
  if (verSeguridad && canEdit(user.rol, "seguridad")) accesos.push({ label: "Cargar inspección o incidente", href: "/seguridad", icon: <ShieldCheck size={16} /> });
  if (canEdit(user.rol, "finanzas")) accesos.push({ label: "Registrar movimiento", href: "/finanzas", icon: <Wallet size={16} /> });
  if (canEdit(user.rol, "documentos")) accesos.push({ label: "Subir documento", href: "/documentos", icon: <FileText size={16} /> });

  // Fase B: en vez de un orden fijo, cada tarjeta declara si tiene algo que
  // necesita atención (algo atrasado, vencido o pendiente de decidir). Las
  // que sí, van primero — así lo más urgente queda arriba sin que la
  // persona tenga que leer las ocho tarjetas para encontrarlo.
  const modulos: ModuloDashboard[] = [];

  if (verObra) {
    modulos.push({
      key: "obra",
      urgente: atrasadas.length > 0 || problemasAbiertos > 0,
      node: (
        <Card>
          <SectionTitle action={<Button href="/obra" variant="ghost" className="!px-2 !py-1 text-xs">Ver más →</Button>}>
            {tituloConIcono(<HardHat size={17} />, "Obra")}
          </SectionTitle>
          <div className="grid grid-cols-3 gap-2">
            <StatTile label="Avance" value={`${pctAvance}%`} />
            <StatTile label="Atrasadas" value={String(atrasadas.length)} color={atrasadas.length ? "rojo" : "verde"} />
            <StatTile label="Problemas" value={String(problemasAbiertos)} color={problemasAbiertos ? "amarillo" : "verde"} />
          </div>
        </Card>
      ),
    });
  }

  if (verTrabajo) {
    modulos.push({
      key: "trabajo",
      urgente: false,
      node: (
        <Card>
          <SectionTitle action={<Button href="/trabajo" variant="ghost" className="!px-2 !py-1 text-xs">Ver más →</Button>}>
            {tituloConIcono(<Handshake size={17} />, "Trabajo")}
          </SectionTitle>
          {proximaJornada ? (
            <div className="grid grid-cols-3 gap-2">
              <StatTile label="Próxima jornada" value={dayjs(proximaJornada.fecha).format("DD/MM")} />
              <StatTile label="Núcleos asignados" value={String(personasAsignadas)} />
              <StatTile label="Tareas de la jornada" value={String(tareasJornadaPendientes)} />
            </div>
          ) : <EmptyState>No hay jornadas próximas planificadas.</EmptyState>}
        </Card>
      ),
    });
  }

  if (canRead(user.rol, "compras")) {
    modulos.push({
      key: "compras",
      urgente: comprasPendientes > 0 || comparacionesListas > 0,
      node: (
        <Card>
          <SectionTitle action={<Button href="/compras" variant="ghost" className="!px-2 !py-1 text-xs">Ver más →</Button>}>
            {tituloConIcono(<ShoppingCart size={17} />, "Compras")}
          </SectionTitle>
          <div className="grid grid-cols-3 gap-2">
            <StatTile label="Pendientes" value={String(comprasPendientes)} color={comprasPendientes ? "amarillo" : "verde"} />
            <StatTile label="A decidir" value={String(comparacionesListas)} />
            <StatTile label="Por entregar" value={String(entregasPendientes)} />
          </div>
        </Card>
      ),
    });
  }

  if (verSeguridad) {
    modulos.push({
      key: "seguridad",
      urgente: docsVencidos > 0 || riesgosAbiertos > 0,
      node: (
        <Card>
          <SectionTitle action={<Button href="/seguridad" variant="ghost" className="!px-2 !py-1 text-xs">Ver más →</Button>}>
            {tituloConIcono(<ShieldCheck size={17} />, "Seguridad")}
          </SectionTitle>
          <div className="grid grid-cols-3 gap-2">
            <StatTile label="Vencidos" value={String(docsVencidos)} color={docsVencidos ? "rojo" : "verde"} />
            <StatTile label="Por vencer" value={String(docsPorVencer)} color={docsPorVencer ? "amarillo" : "verde"} />
            <StatTile label="Riesgos abiertos" value={String(riesgosAbiertos)} color={riesgosAbiertos ? "amarillo" : "verde"} />
          </div>
        </Card>
      ),
    });
  }

  if (fin) {
    modulos.push({
      key: "finanzas",
      urgente: verFinanzasDetalle && fin.disponiblePrudencial < 0,
      node: (
        <Card>
          <SectionTitle action={<Button href="/finanzas" variant="ghost" className="!px-2 !py-1 text-xs">Ver más →</Button>}>
            {tituloConIcono(<Wallet size={17} />, "Finanzas")}
          </SectionTitle>
          {verFinanzasDetalle ? (
            <>
              <div className="grid grid-cols-3 gap-2">
                <StatTile label="Saldo" value={money(fin.saldo)} />
                <StatTile label="Comprometido" value={money(fin.comprometido)} />
                <StatTile label="Disponible" value={money(fin.disponiblePrudencial)} color={fin.disponiblePrudencial < 0 ? "rojo" : fin.disponiblePrudencial < fin.gastosProyectados ? "amarillo" : "verde"} />
              </div>
              {proximosPagos.length > 0 && (
                <ul className="mt-3 text-xs text-ink-muted space-y-1">
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
      ),
    });
  }

  if (canRead(user.rol, "socios")) {
    modulos.push({
      key: "socios",
      urgente: false,
      node: (
        <Card>
          <SectionTitle action={<Button href="/socios" variant="ghost" className="!px-2 !py-1 text-xs">Ver más →</Button>}>
            {tituloConIcono(<Users size={17} />, "Socios")}
          </SectionTitle>
          <div className="grid grid-cols-2 gap-2">
            <StatTile label="Activos" value={String(sociosActivos)} />
            <StatTile label="En lista de espera" value={String(enEspera)} />
          </div>
        </Card>
      ),
    });
  }

  if (canRead(user.rol, "comisiones")) {
    modulos.push({
      key: "comisiones",
      urgente: tareasComisionesVencidas > 0,
      node: (
        <Card>
          <SectionTitle action={<Button href="/comisiones" variant="ghost" className="!px-2 !py-1 text-xs">Ver más →</Button>}>
            {tituloConIcono(<Compass size={17} />, "Comisiones y reuniones")}
          </SectionTitle>
          <div className="grid grid-cols-2 gap-2">
            <StatTile label="Tareas pendientes" value={String(tareasComisionesPendientes)} color={tareasComisionesVencidas ? "rojo" : undefined} hint={tareasComisionesVencidas ? `${tareasComisionesVencidas} vencida(s)` : undefined} />
            <StatTile label="Próxima reunión" value={proximaReunion ? dayjs(proximaReunion.fecha).format("DD/MM") : "—"} />
          </div>
        </Card>
      ),
    });
  }

  modulos.push({
    key: "alertas",
    urgente: criticas.length > 0 || importantes.length > 0,
    node: (
      <Card>
        <SectionTitle action={<Button href="/alertas" variant="ghost" className="!px-2 !py-1 text-xs">Ver más →</Button>}>
          {tituloConIcono(<Bell size={17} />, "Alertas")}
        </SectionTitle>
        <div className="grid grid-cols-3 gap-2">
          <StatTile label="Críticas" value={String(criticas.length)} color={criticas.length ? "rojo" : "verde"} />
          <StatTile label="Importantes" value={String(importantes.length)} color={importantes.length ? "amarillo" : "verde"} />
          <StatTile label="Informativas" value={String(informativas.length)} />
        </div>
        {alertas.length === 0 && (
          <p className="flex items-center gap-1.5 text-xs text-[var(--color-verde)] mt-3">
            <CheckCircle2 size={14} /> Todo en orden por ahora.
          </p>
        )}
      </Card>
    ),
  });

  // sort() de JS es estable: entre dos tarjetas con la misma urgencia, se
  // respeta el orden en que se agregaron arriba.
  const modulosOrdenados = [...modulos].sort((a, b) => Number(b.urgente) - Number(a.urgente));

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
          className="flex items-center gap-2 mb-4 rounded-xl bg-[var(--color-rojo-bg)] border border-[var(--color-rojo)]/20 px-4 py-3 text-sm font-medium text-[var(--color-rojo)] hover:opacity-90"
        >
          <AlertCircle size={18} className="shrink-0" />
          Tenés {criticas.length} alerta{criticas.length === 1 ? "" : "s"} crítica{criticas.length === 1 ? "" : "s"} sin resolver — tocá para verla{criticas.length === 1 ? "" : "s"}
        </Link>
      )}

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

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {modulosOrdenados.map((m) => (
          <div key={m.key}>{m.node}</div>
        ))}
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
