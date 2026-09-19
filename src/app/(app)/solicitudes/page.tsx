import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { canRead, canEdit } from "@/lib/roles";
import { all } from "@/lib/db";
import { Card, PageHeader, EmptyState } from "@/components/ui";
import dayjs from "dayjs";
import { CrearSolicitudForm } from "@/components/solicitudes/SolicitudesFormularios";
import { SolicitudStatusBadge, PrioridadSolicitudBadge, ESTADO_SOLICITUD, estadoSolicitudLabel, estadoEfectivo, TIPO_SOLICITUD_LABEL } from "@/components/solicitudes/SolicitudStatus";
import { ResumenSolicitudes, type ResumenTileDef, type ResumenTileItem } from "@/components/solicitudes/ResumenSolicitudes";
import { TablaFiltrable, type FiltroDef } from "@/components/TablaFiltrable";
import { FilaConDetalle } from "@/components/FilaConDetalle";

// Fase 3 del sistema de gestión de Comisiones (19/09, pedido explícito,
// sección 3: "Crear una sección o acceso contextual llamado SOLICITUDES").
// Mismo patrón visual que Compras/Contactos/Proveedores: resumen con
// pop-up + filtros arriba + tabla compacta con modal de detalle liviano
// que linkea a la ficha completa /solicitudes/[id] (donde viven las
// acciones reales: responder/derivar/comentar — ver esa página).
//
// Todas las consultas a las tablas nuevas (migración 0029) van con
// `.catch(() => [])` porque esta fase se documenta y despliega ANTES de
// que el usuario corra esa migración en producción — mismo criterio
// defensivo que ya usa compras/[id]/page.tsx con `solicitud_compra_id`.
export default async function SolicitudesPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (!canRead(user.rol, "comisiones")) redirect("/dashboard");

  const puedeEditar = canEdit(user.rol, "comisiones");
  const esOversight = canEdit(user.rol, "finanzas");

  const [solicitudesRaw, comisionesActivas, misComisiones, usuarios] = await Promise.all([
    all<any>(
      `SELECT s.*, co.nombre as origen_nombre, cd.nombre as destino_nombre, r.nombre as responsable_nombre
       FROM solicitudes_comision s
       JOIN comisiones co ON co.id = s.comision_origen_id
       JOIN comisiones cd ON cd.id = s.comision_destino_id
       LEFT JOIN users r ON r.id = s.responsable_id
       ORDER BY CASE s.prioridad WHEN 'urgente' THEN 0 WHEN 'alta' THEN 1 WHEN 'normal' THEN 2 ELSE 3 END, s.creado_en DESC`
    ).catch(() => [] as any[]),
    all<{ id: number; nombre: string }>(`SELECT id, nombre FROM comisiones WHERE activa = 1 ORDER BY nombre ASC`),
    all<{ comision_id: number }>(`SELECT comision_id FROM comision_miembros WHERE user_id = ? AND activo = 1`, [user.id]),
    all<{ id: number; nombre: string }>(`SELECT id, nombre FROM users WHERE activo = 1 ORDER BY nombre ASC`),
  ]);

  const misComisionIds = new Set(misComisiones.map((m) => m.comision_id));
  const solicitudes = esOversight
    ? solicitudesRaw
    : solicitudesRaw.filter((s) => misComisionIds.has(s.comision_origen_id) || misComisionIds.has(s.comision_destino_id));
  const comisionesDisponibles = esOversight ? comisionesActivas : comisionesActivas.filter((c) => misComisionIds.has(c.id));

  const recibidasPendientes = solicitudes.filter((s) => misComisionIds.has(s.comision_destino_id) && ["pendiente", "en_revision", "esperando_informacion", "en_proceso"].includes(s.estado));
  const enviadasPendientes = solicitudes.filter((s) => misComisionIds.has(s.comision_origen_id) && ["pendiente", "en_revision", "esperando_informacion", "en_proceso"].includes(s.estado));
  const vencidas = solicitudes.filter((s) => estadoEfectivo(s.estado, s.fecha_limite) === "vencida");
  const resueltasMes = solicitudes.filter(
    (s) => s.estado === "resuelta" && dayjs(s.actualizado_en).isAfter(dayjs().startOf("month"))
  );

  const itemDe = (s: any): ResumenTileItem => ({
    label: `${s.numero || "#" + s.id} · ${s.titulo}`,
    sublabel: `${s.origen_nombre} → ${s.destino_nombre}`,
    href: `/solicitudes/${s.id}`,
  });

  const tiles: ResumenTileDef[] = [
    {
      id: "recibidas",
      label: "Recibidas pendientes",
      value: String(recibidasPendientes.length),
      color: recibidasPendientes.length > 0 ? "amarillo" : "verde",
      items: recibidasPendientes.map(itemDe),
      vacioTexto: "No tenés solicitudes recibidas pendientes.",
    },
    {
      id: "enviadas",
      label: "Enviadas pendientes",
      value: String(enviadasPendientes.length),
      items: enviadasPendientes.map(itemDe),
      vacioTexto: "No tenés solicitudes enviadas pendientes de respuesta.",
    },
    {
      id: "vencidas",
      label: "Vencidas",
      value: String(vencidas.length),
      color: vencidas.length > 0 ? "rojo" : "verde",
      items: vencidas.map(itemDe),
      vacioTexto: "No hay solicitudes vencidas.",
    },
    {
      id: "resueltas",
      label: "Resueltas este mes",
      value: String(resueltasMes.length),
      color: "verde",
      items: resueltasMes.map(itemDe),
      vacioTexto: "Todavía no se resolvió ninguna este mes.",
    },
  ];

  const filtros: FiltroDef[] = [
    {
      id: "estado",
      label: "Estado",
      opciones: ESTADO_SOLICITUD.map((e) => ({ value: e, label: estadoSolicitudLabel(e) })),
      valores: solicitudes.map((s) => estadoEfectivo(s.estado, s.fecha_limite)),
    },
    {
      id: "tipo",
      label: "Tipo",
      opciones: Object.entries(TIPO_SOLICITUD_LABEL).map(([v, l]) => ({ value: v, label: l })),
      valores: solicitudes.map((s) => s.tipo),
      secundario: true,
    },
    {
      id: "prioridad",
      label: "Prioridad",
      opciones: [
        { value: "urgente", label: "Urgente" },
        { value: "alta", label: "Alta" },
        { value: "normal", label: "Normal" },
        { value: "baja", label: "Baja" },
      ],
      valores: solicitudes.map((s) => s.prioridad),
      secundario: true,
    },
  ];

  const claves = solicitudes.map(
    (s) => `${s.numero || ""} ${s.titulo} ${s.origen_nombre} ${s.destino_nombre} ${TIPO_SOLICITUD_LABEL[s.tipo] || ""}`
  );

  return (
    <div>
      <PageHeader
        title="Solicitudes"
        subtitle="Pedidos, aprobaciones y derivaciones entre comisiones"
        action={puedeEditar && comisionesDisponibles.length > 0 ? <CrearSolicitudForm comisiones={comisionesDisponibles} usuarios={usuarios} /> : undefined}
      />

      <ResumenSolicitudes tiles={tiles} />

      <Card>
        {solicitudes.length === 0 ? (
          <EmptyState>No hay solicitudes todavía.</EmptyState>
        ) : (
          <TablaFiltrable
            placeholder="Buscar por número, título, comisión…"
            claves={claves}
            filtros={filtros}
            encabezado={
              <tr className="text-left text-xs text-ink/50 border-b border-ink/5">
                <th className="py-2 pr-3">Número</th>
                <th className="py-2 pr-3">Título</th>
                <th className="py-2 pr-3">Origen → Destino</th>
                <th className="py-2 pr-3">Responsable</th>
                <th className="py-2 pr-3">Prioridad</th>
                <th className="py-2 pr-3">Estado</th>
                <th className="py-2 pr-3"></th>
              </tr>
            }
          >
            {solicitudes.map((s) => (
              <FilaConDetalle
                key={s.id}
                titulo={`${s.numero || "#" + s.id} · ${s.titulo}`}
                subtitulo={TIPO_SOLICITUD_LABEL[s.tipo] || s.tipo}
                editarHref={`/solicitudes/${s.id}`}
                secciones={[
                  {
                    titulo: "Detalle",
                    items: [
                      { label: "Descripción", valor: s.descripcion || "—" },
                      { label: "Origen", valor: s.origen_nombre },
                      { label: "Destino", valor: s.destino_nombre },
                      { label: "Responsable", valor: s.responsable_nombre || "—" },
                      { label: "Fecha límite", valor: s.fecha_limite ? dayjs(s.fecha_limite).format("DD/MM/YYYY") : "—" },
                    ],
                  },
                  {
                    titulo: "Estado",
                    items: [
                      { label: "Prioridad", valor: <PrioridadSolicitudBadge prioridad={s.prioridad} /> },
                      { label: "Estado", valor: <SolicitudStatusBadge estado={estadoEfectivo(s.estado, s.fecha_limite)} /> },
                    ],
                  },
                ]}
              >
                <td className="py-2 pr-3 font-medium text-[var(--color-brand-900)] whitespace-nowrap">{s.numero || `#${s.id}`}</td>
                <td className="py-2 pr-3 text-ink/70 truncate max-w-[220px]">{s.titulo}</td>
                <td className="py-2 pr-3 text-ink/60 whitespace-nowrap">{s.origen_nombre} → {s.destino_nombre}</td>
                <td className="py-2 pr-3 text-ink/60">{s.responsable_nombre || "—"}</td>
                <td className="py-2 pr-3">
                  <PrioridadSolicitudBadge prioridad={s.prioridad} />
                </td>
                <td className="py-2 pr-3">
                  <SolicitudStatusBadge estado={estadoEfectivo(s.estado, s.fecha_limite)} />
                </td>
              </FilaConDetalle>
            ))}
          </TablaFiltrable>
        )}
      </Card>
    </div>
  );
}
